/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import { ethers } from "hardhat"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { MockNexus__factory } from "types/generated/factories/MockNexus__factory"
import {
    AssetProxy__factory,
    QuestManager__factory,
    MockERC20,
    MockERC20__factory,
    MockNexus,
    PlatformTokenVendorFactory__factory,
    SignatureVerifier__factory,
    MockStakedTokenWithPrice,
    MockStakedTokenWithPrice__factory,
    QuestManager,
    MockEmissionController__factory,
    MockBPT,
    MockBPT__factory,
    MockBVault,
    MockBVault__factory,
    StakedTokenBPT__factory,
    StakedTokenBPT,
} from "types"
import { DEAD_ADDRESS } from "index"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { assertBNClose } from "@utils/assertions"
import { simpleToExactAmount, BN } from "@utils/math"
import { expect } from "chai"
import { getTimestamp, increaseTime } from "@utils/time"
import { formatBytes32String } from "ethers/lib/utils"
import { BalConfig, UserStakingData } from "types/stakedToken"

interface Deployment {
    stakedToken: StakedTokenBPT
    questManager: QuestManager
    bpt: BPTDeployment
}

interface BPTDeployment {
    vault: MockBVault
    bpt: MockBPT
    bal: MockERC20
    underlying: MockERC20[]
}

describe("Staked Token BPT", () => {
    let sa: StandardAccounts
    let deployTime: BN

    let nexus: MockNexus
    let rewardToken: MockERC20
    let stakedToken: StakedTokenBPT
    let questManager: QuestManager
    let bpt: BPTDeployment

    console.log(`Staked contract size ${StakedTokenBPT__factory.bytecode.length / 2} bytes`)

    const deployBPT = async (mockMTA: MockERC20): Promise<BPTDeployment> => {
        const token2 = await new MockERC20__factory(sa.default.signer).deploy("Test Token 2", "TST2", 18, sa.default.address, 10000000)
        const mockBal = await new MockERC20__factory(sa.default.signer).deploy("Mock BAL", "mkBAL", 18, sa.default.address, 10000000)
        const bptLocal = await new MockBPT__factory(sa.default.signer).deploy("Balance Pool Token", "mBPT")
        const vault = await new MockBVault__factory(sa.default.signer).deploy()
        await mockMTA.approve(vault.address, simpleToExactAmount(100000))
        await token2.approve(vault.address, simpleToExactAmount(100000))
        await vault.addPool(
            bptLocal.address,
            [mockMTA.address, token2.address],
            [simpleToExactAmount(3.28), simpleToExactAmount(0.0002693)],
        )
        return {
            vault,
            bpt: bptLocal,
            bal: mockBal,
            underlying: [mockMTA, token2],
        }
    }

    const redeployStakedToken = async (useFakePrice = false): Promise<Deployment> => {
        deployTime = await getTimestamp()
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        await nexus.setRecollateraliser(sa.mockRecollateraliser.address)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, 10000000)
        const bptLocal = await deployBPT(rewardToken)

        const signatureVerifier = await new SignatureVerifier__factory(sa.default.signer).deploy()
        const questManagerLibraryAddresses = {
            "contracts/governance/staking/deps/SignatureVerifier.sol:SignatureVerifier": signatureVerifier.address,
        }
        const questManagerImpl = await new QuestManager__factory(questManagerLibraryAddresses, sa.default.signer).deploy(nexus.address)
        let data = questManagerImpl.interface.encodeFunctionData("initialize", [sa.questMaster.address, sa.questSigner.address])
        const questManagerProxy = await new AssetProxy__factory(sa.default.signer).deploy(questManagerImpl.address, DEAD_ADDRESS, data)

        const platformTokenVendorFactory = await new PlatformTokenVendorFactory__factory(sa.default.signer).deploy()
        const stakedTokenLibraryAddresses = {
            "contracts/rewards/staking/PlatformTokenVendorFactory.sol:PlatformTokenVendorFactory": platformTokenVendorFactory.address,
        }
        let sToken
        if (useFakePrice) {
            const stakedTokenFactory = new MockStakedTokenWithPrice__factory(stakedTokenLibraryAddresses, sa.default.signer)
            const stakedTokenImpl = await stakedTokenFactory.deploy(
                nexus.address,
                rewardToken.address,
                questManagerProxy.address,
                bptLocal.bpt.address,
                ONE_WEEK,
                ONE_DAY.mul(2),
            )
            data = stakedTokenImpl.interface.encodeFunctionData("initialize", [
                formatBytes32String("Staked Rewards"),
                formatBytes32String("stkRWD"),
                sa.mockRewardsDistributor.address,
            ])
            const stakedTokenProxy = await new AssetProxy__factory(sa.default.signer).deploy(stakedTokenImpl.address, DEAD_ADDRESS, data)
            sToken = stakedTokenFactory.attach(stakedTokenProxy.address) as any as StakedTokenBPT
        } else {
            const stakedTokenFactory = new StakedTokenBPT__factory(stakedTokenLibraryAddresses, sa.default.signer)
            const stakedTokenImpl = await stakedTokenFactory.deploy(
                nexus.address,
                rewardToken.address,
                questManagerProxy.address,
                bptLocal.bpt.address,
                ONE_WEEK,
                ONE_DAY.mul(2),
                [bptLocal.bal.address, bptLocal.vault.address],
                await bptLocal.vault.poolIds(bptLocal.bpt.address),
            )
            data = stakedTokenImpl.interface.encodeFunctionData("initialize", [
                formatBytes32String("Staked Rewards"),
                formatBytes32String("stkRWD"),
                sa.mockRewardsDistributor.address,
                sa.fundManager.address,
                44000,
            ])
            const stakedTokenProxy = await new AssetProxy__factory(sa.default.signer).deploy(stakedTokenImpl.address, DEAD_ADDRESS, data)
            sToken = stakedTokenFactory.attach(stakedTokenProxy.address) as StakedTokenBPT
        }

        const qMaster = QuestManager__factory.connect(questManagerProxy.address, sa.default.signer)
        await qMaster.connect(sa.governor.signer).addStakedToken(sToken.address)

        // Test: Add Emission Data
        const emissionController = await new MockEmissionController__factory(sa.default.signer).deploy()
        await emissionController.addStakingContract(sToken.address)
        await emissionController.setPreferences(65793)
        await sToken.connect(sa.governor.signer).setGovernanceHook(emissionController.address)

        return {
            stakedToken: sToken,
            questManager: qMaster,
            bpt: bptLocal,
        }
    }

    const snapBalData = async (): Promise<BalConfig> => {
        const balRecipient = await stakedToken.balRecipient()
        const keeper = await stakedToken.keeper()
        const pendingBPTFees = await stakedToken.pendingBPTFees()
        const priceCoefficient = await stakedToken.priceCoefficient()
        const lastPriceUpdateTime = await stakedToken.lastPriceUpdateTime()
        return {
            balRecipient,
            keeper,
            pendingBPTFees,
            priceCoefficient,
            lastPriceUpdateTime,
        }
    }

    const snapshotUserStakingData = async (user = sa.default.address, skipBalData = false): Promise<UserStakingData> => {
        const scaledBalance = await stakedToken.balanceOf(user)
        const votes = await stakedToken.getVotes(user)
        const earnedRewards = await stakedToken.earned(user)
        const numCheckpoints = await stakedToken.numCheckpoints(user)
        const rewardTokenBalance = await rewardToken.balanceOf(user)
        const rawBalance = await stakedToken.balanceData(user)
        const userPriceCoeff = await stakedToken.userPriceCoeff(user)
        const questBalance = await questManager.balanceData(user)

        return {
            scaledBalance,
            votes,
            earnedRewards,
            numCheckpoints,
            rewardTokenBalance,
            rawBalance,
            userPriceCoeff,
            questBalance,
            balData: skipBalData ? null : await snapBalData(),
        }
    }

    before("Create Contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
    })

    // '''..................................................................'''
    // '''....................    STAKEDTOKEN.DATA    ......................'''
    // '''..................................................................'''

    context("deploy and initialize", () => {
        before(async () => {
            ;({ stakedToken, questManager, bpt } = await redeployStakedToken())
        })
        it("post initialize", async () => {
            const data = await snapBalData()
            expect(await stakedToken.BAL()).eq(bpt.bal.address)
            expect(await stakedToken.balancerVault()).eq(bpt.vault.address)
            expect(await stakedToken.poolId()).eq(await bpt.vault.poolIds(bpt.bpt.address))
            expect(data.balRecipient).eq(sa.fundManager.address)
            expect(data.keeper).eq(ZERO_ADDRESS)
            expect(data.pendingBPTFees).eq(0)
            expect(data.priceCoefficient).eq(44000)
            expect(data.lastPriceUpdateTime).eq(0)
        })
    })

    // '''..................................................................'''
    // '''...................        BAL TOKENS       ......................'''
    // '''..................................................................'''

    context("claiming BAL rewards", () => {
        const balAirdrop = simpleToExactAmount(100)
        before(async () => {
            ;({ stakedToken, questManager, bpt } = await redeployStakedToken())
            await bpt.bal.transfer(stakedToken.address, balAirdrop)
        })
        it("should allow governor to set bal recipient", async () => {
            await expect(stakedToken.setBalRecipient(sa.fundManager.address)).to.be.revertedWith("Only governor can execute")
            const tx = stakedToken.connect(sa.governor.signer).setBalRecipient(sa.fundManager.address)
            await expect(tx).to.emit(stakedToken, "BalRecipientChanged").withArgs(sa.fundManager.address)
            expect(await stakedToken.balRecipient()).to.eq(sa.fundManager.address)
        })
        it("should allow BAL tokens to be claimed", async () => {
            const balBefore = await bpt.bal.balanceOf(sa.fundManager.address)
            const tx = stakedToken.claimBal()
            await expect(tx).to.emit(stakedToken, "BalClaimed")
            const balAfter = await bpt.bal.balanceOf(sa.fundManager.address)
            expect(balAfter.sub(balBefore)).eq(balAirdrop)
        })
    })

    // '''..................................................................'''
    // '''........................    FEES ETC    ..........................'''
    // '''..................................................................'''

    context("collecting fees", () => {
        const stakeAmount = simpleToExactAmount(100)
        const expectedFees = stakeAmount.sub(stakeAmount.mul(1000).div(1075))
        let data: UserStakingData
        let expectedMTA: BN
        before(async () => {
            ;({ stakedToken, questManager, bpt } = await redeployStakedToken())
            await bpt.bpt.approve(stakedToken.address, stakeAmount)
            await stakedToken["stake(uint256)"](stakeAmount)
            await stakedToken.startCooldown(stakeAmount)
            await increaseTime(ONE_WEEK.add(1))
            await stakedToken.withdraw(stakeAmount, sa.default.address, true, true)
            data = await snapshotUserStakingData()
            expectedMTA = expectedFees.mul(data.balData.priceCoefficient).div(12000)
        })
        it("should collect 7.5% as fees", async () => {
            expect(await stakedToken.pendingAdditionalReward()).eq(0)
            expect(data.balData.pendingBPTFees).eq(expectedFees)
        })
        it("should convert fees back into $MTA", async () => {
            const bptBalBefore = await bpt.bpt.balanceOf(stakedToken.address)
            const mtaBalBefore = await rewardToken.balanceOf(stakedToken.address)
            const tx = stakedToken.convertFees()
            // it should emit the event
            await expect(tx).to.emit(stakedToken, "FeesConverted")
            const dataAfter = await snapshotUserStakingData()
            // should reset the pendingFeesBPT var to 1
            expect(dataAfter.balData.pendingBPTFees).eq(1)
            // should add the new fees to headlessstakingrewards
            expect(await stakedToken.pendingAdditionalReward()).gt(expectedMTA)

            // should burn bpt and receive mta
            const bptBalAfter = await bpt.bpt.balanceOf(stakedToken.address)
            const mtaBalAfter = await rewardToken.balanceOf(stakedToken.address)
            expect(mtaBalAfter.sub(mtaBalBefore)).gt(expectedMTA)
            expect(mtaBalAfter).eq(await stakedToken.pendingAdditionalReward())
            expect(bptBalBefore.sub(bptBalAfter)).eq(expectedFees.sub(1))
        })
        it("should add the correct amount of fees, and deposit to the vendor when notifying", async () => {
            await stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(0)
            expect(await rewardToken.balanceOf(stakedToken.address)).eq(1)
            expect(await stakedToken.pendingAdditionalReward()).eq(1)
        })
        it("should fail if there is nothing to collect", async () => {
            await expect(stakedToken.convertFees()).to.be.revertedWith("Must have something to convert")
        })
    })

    // '''..................................................................'''
    // '''...................    PRICE COEFFICIENT    ......................'''
    // '''..................................................................'''

    context("setting keeper", () => {
        before(async () => {
            ;({ stakedToken, questManager, bpt } = await redeployStakedToken())
        })
        it("should allow governance to set keeper", async () => {
            await expect(stakedToken.setKeeper(sa.default.address)).to.be.revertedWith("Only governor can execute")
            const tx = stakedToken.connect(sa.governor.signer).setKeeper(sa.default.address)
            await expect(tx).to.emit(stakedToken, "KeeperUpdated").withArgs(sa.default.address)
            expect(await stakedToken.keeper()).to.eq(sa.default.address)
        })
    })

    context("fetching live priceCoeff", () => {
        before(async () => {
            ;({ stakedToken, questManager, bpt } = await redeployStakedToken())
        })
        it("should fail if not called by governor or keeper", async () => {
            await expect(stakedToken.fetchPriceCoefficient()).to.be.revertedWith("Gov or keeper")
        })
        it("should allow govenror or keeper to fetch new price Coeff", async () => {
            const newPrice = await stakedToken.getProspectivePriceCoefficient()
            expect(newPrice).gt(30000)
            expect(newPrice).lt(55000)
            const tx = stakedToken.connect(sa.governor.signer).fetchPriceCoefficient()
            await expect(tx).to.emit(stakedToken, "PriceCoefficientUpdated").withArgs(newPrice)
            const timeNow = await getTimestamp()
            expect(await stakedToken.priceCoefficient()).eq(newPrice)
            assertBNClose(await stakedToken.lastPriceUpdateTime(), timeNow, 3)
        })
        it("should fail to set more than once per 14 days", async () => {
            await expect(stakedToken.connect(sa.governor.signer).fetchPriceCoefficient()).to.be.revertedWith("Max 1 update per 14 days")
        })
        it("should fail to set if the diff is < 5%", async () => {
            await increaseTime(ONE_WEEK.mul(2).add(1))
            await expect(stakedToken.connect(sa.governor.signer).fetchPriceCoefficient()).to.be.revertedWith("Must be > 5% diff")
        })
        it("should fail if its's out of bounds", async () => {
            await bpt.vault.setUnitsPerBpt(bpt.bpt.address, [simpleToExactAmount(0.5), simpleToExactAmount(0.0002693)])
            let priceCoeff = await stakedToken.getProspectivePriceCoefficient()
            expect(priceCoeff).eq(6250)
            await expect(stakedToken.connect(sa.governor.signer).fetchPriceCoefficient()).to.be.revertedWith("Out of bounds")

            await bpt.vault.setUnitsPerBpt(bpt.bpt.address, [simpleToExactAmount(6.5), simpleToExactAmount(0.0002693)])
            priceCoeff = await stakedToken.getProspectivePriceCoefficient()
            expect(priceCoeff).eq(81250)
            await expect(stakedToken.connect(sa.governor.signer).fetchPriceCoefficient()).to.be.revertedWith("Out of bounds")

            await bpt.vault.setUnitsPerBpt(bpt.bpt.address, [simpleToExactAmount(4.2), simpleToExactAmount(0.0002693)])
            priceCoeff = await stakedToken.getProspectivePriceCoefficient()
            expect(priceCoeff).eq(52500)
            await stakedToken.connect(sa.governor.signer).fetchPriceCoefficient()
            expect(await stakedToken.priceCoefficient()).eq(priceCoeff)
        })
    })

    context("when a StakedToken has price coefficient", () => {
        const stakedAmount = simpleToExactAmount(1000)
        let mockStakedToken: MockStakedTokenWithPrice
        before(async () => {
            ;({ stakedToken, bpt, questManager } = await redeployStakedToken(true))
            mockStakedToken = stakedToken as any as MockStakedTokenWithPrice
            await bpt.bpt.connect(sa.default.signer).approve(mockStakedToken.address, stakedAmount.mul(3))
        })
        it("should allow basic staking and save coeff to users acc", async () => {
            await mockStakedToken["stake(uint256)"](stakedAmount)
            const data = await snapshotUserStakingData(sa.default.address, true)
            expect(data.userPriceCoeff).eq(10000)
            expect(data.votes).eq(stakedAmount)
        })
        it("should allow setting of a new priceCoeff", async () => {
            await mockStakedToken.setPriceCoefficient(15000)
            expect(await mockStakedToken.priceCoefficient()).eq(15000)
        })
        it("should update the users balance when they claim rewards", async () => {
            await mockStakedToken["claimReward()"]()
            const data = await snapshotUserStakingData(sa.default.address, true)
            expect(data.userPriceCoeff).eq(15000)
            expect(data.votes).eq(stakedAmount.mul(3).div(2))
        })
        it("should update the users balance when they stake more", async () => {
            await mockStakedToken.setPriceCoefficient(10000)
            await mockStakedToken["stake(uint256)"](stakedAmount)
            const data = await snapshotUserStakingData(sa.default.address, true)
            expect(data.userPriceCoeff).eq(10000)
            expect(data.votes).eq(stakedAmount.mul(2))
        })
    })
})
