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
import { assertBNClose, DEAD_ADDRESS } from "index"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { getTimestamp, increaseTime } from "@utils/time"
import { arrayify, formatBytes32String, solidityKeccak256 } from "ethers/lib/utils"
import { BigNumberish, Signer } from "ethers"
import { QuestStatus, QuestType, UserStakingData } from "types/stakedToken"

const signUserQuests = async (user: string, questIds: BigNumberish[], questSigner: Signer): Promise<string> => {
    const messageHash = solidityKeccak256(["address", "uint256[]"], [user, questIds])
    const signature = await questSigner.signMessage(arrayify(messageHash))
    return signature
}

const signQuestUsers = async (questId: BigNumberish, users: string[], questSigner: Signer): Promise<string> => {
    const messageHash = solidityKeccak256(["uint256", "address[]"], [questId, users])
    const signature = await questSigner.signMessage(arrayify(messageHash))
    return signature
}

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

    const snapshotUserStakingData = async (user = sa.default.address): Promise<UserStakingData> => {
        const stakedBalance = await stakedToken.balanceOf(user)
        const votes = await stakedToken.getVotes(user)
        const earnedRewards = await stakedToken.earned(user)
        const rewardsBalance = await rewardToken.balanceOf(user)
        const userBalances = await stakedToken.balanceData(user)
        const userPriceCoeff = await stakedToken.userPriceCoeff(user)
        const questBalance = await questManager.balanceData(user)

        return {
            stakedBalance,
            votes,
            earnedRewards,
            rewardsBalance,
            userBalances,
            userPriceCoeff,
            questBalance,
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
            expect(await stakedToken.priceCoefficient()).eq(44000)
            // BAL
            // balancerVault
            // poolId
            // balRecipient
            // keeper
            // pendingBPTFees
            // priceCoefficient
            // lastPriceUpdateTime
        })
    })

    // '''..................................................................'''
    // '''...................    PRICE COEFFICIENT    ......................'''
    // '''..................................................................'''

    context("setting keeper", () => {
        it("should allow governance to set keeper")
    })

    context("fetching live priceCoeff", () => {
        before(async () => {
            ;({ stakedToken, questManager, bpt } = await redeployStakedToken())
        })
        // TODO - also call the `getProspectivePriceCoefficient` fn
        it("should allow govenror or keeper to fetch new price Coeff", async () => {
            const newPrice = await stakedToken.getProspectivePriceCoefficient()
            expect(newPrice).gt(30000)
            expect(newPrice).lt(55000)
            await stakedToken.connect(sa.governor.signer).fetchPriceCoefficient()
            expect(await stakedToken.priceCoefficient()).eq(newPrice)
        })
        it("should fail to set more than once per 14 days")
        it("should fail to set if the diff is < 5% or it's out of bounds")
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
            const data = await snapshotUserStakingData(sa.default.address)
            expect(data.userPriceCoeff).eq(10000)
            expect(data.votes).eq(stakedAmount)
        })
        it("should allow setting of a new priceCoeff", async () => {
            await mockStakedToken.setPriceCoefficient(15000)
            expect(await mockStakedToken.priceCoefficient()).eq(15000)
        })
        it("should update the users balance when they claim rewards", async () => {
            await mockStakedToken["claimReward()"]()
            const data = await snapshotUserStakingData(sa.default.address)
            expect(data.userPriceCoeff).eq(15000)
            expect(data.votes).eq(stakedAmount.mul(3).div(2))
        })
        it("should update the users balance when they stake more", async () => {
            await mockStakedToken.setPriceCoefficient(10000)
            await mockStakedToken["stake(uint256)"](stakedAmount)
            const data = await snapshotUserStakingData(sa.default.address)
            expect(data.userPriceCoeff).eq(10000)
            expect(data.votes).eq(stakedAmount.mul(2))
        })
    })

    // '''..................................................................'''
    // '''...................        BAL TOKENS       ......................'''
    // '''..................................................................'''

    context("claiming BAL rewards", () => {
        it("should allow BAL tokens to be claimed")
        it("should allow govner to set bal recipient")
    })

    // '''..................................................................'''
    // '''........................    FEES ETC    ..........................'''
    // '''..................................................................'''

    context("collecting fees", () => {
        it("should convert fees back into $MTA")
        it("should add the correct amount of fees, and deposit to the vendor")
        it("should notify the headlessstakingrewards")
        it("should reset the pendingFeesBPT var to 1")
    })
})
