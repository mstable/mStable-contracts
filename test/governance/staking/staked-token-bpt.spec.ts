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
} from "types"
import { DEAD_ADDRESS } from "index"
import { ONE_DAY, ONE_WEEK } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
// import { getTimestamp } from "@utils/time"
import { formatBytes32String } from "ethers/lib/utils"

// import { arrayify, formatBytes32String, solidityKeccak256 } from "ethers/lib/utils"
// import { BigNumberish, Signer } from "ethers"
import { UserStakingData } from "types/stakedToken"

// const signUserQuests = async (user: string, questIds: BigNumberish[], questSigner: Signer): Promise<string> => {
//     const messageHash = solidityKeccak256(["address", "uint256[]"], [user, questIds])
//     const signature = await questSigner.signMessage(arrayify(messageHash))
//     return signature
// }

// const signQuestUsers = async (questId: BigNumberish, users: string[], questSigner: Signer): Promise<string> => {
//     const messageHash = solidityKeccak256(["uint256", "address[]"], [questId, users])
//     const signature = await questSigner.signMessage(arrayify(messageHash))
//     return signature
// }

describe("Staked Token BPT", () => {
    let sa: StandardAccounts
    // let deployTime: BN

    let nexus: MockNexus
    let rewardToken: MockERC20
    let stakedToken: MockStakedTokenWithPrice
    let questManager: QuestManager

    // const startingMintAmount = simpleToExactAmount(10000000)

    console.log(`Staked contract size ${MockStakedTokenWithPrice__factory.bytecode.length / 2} bytes`)

    interface Deployment {
        stakedToken: MockStakedTokenWithPrice
        questManager: QuestManager
    }

    const redeployStakedToken = async (): Promise<Deployment> => {
        // deployTime = await getTimestamp()
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        await nexus.setRecollateraliser(sa.mockRecollateraliser.address)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, 10000000)

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
        const stakedTokenFactory = new MockStakedTokenWithPrice__factory(stakedTokenLibraryAddresses, sa.default.signer)
        const stakedTokenImpl = await stakedTokenFactory.deploy(
            nexus.address,
            rewardToken.address,
            questManagerProxy.address,
            rewardToken.address,
            ONE_WEEK,
            ONE_DAY.mul(2),
        )
        data = stakedTokenImpl.interface.encodeFunctionData("initialize", [
            formatBytes32String("Staked Rewards"),
            formatBytes32String("stkRWD"),
            sa.mockRewardsDistributor.address,
        ])
        const stakedTokenProxy = await new AssetProxy__factory(sa.default.signer).deploy(stakedTokenImpl.address, DEAD_ADDRESS, data)
        const sToken = stakedTokenFactory.attach(stakedTokenProxy.address) as MockStakedTokenWithPrice

        const qMaster = QuestManager__factory.connect(questManagerProxy.address, sa.default.signer)
        await qMaster.connect(sa.governor.signer).addStakedToken(stakedTokenProxy.address)

        // Test: Add Emission Data
        const emissionController = await new MockEmissionController__factory(sa.default.signer).deploy()
        await emissionController.addStakingContract(sToken.address)
        await emissionController.setPreferences(65793)
        await sToken.connect(sa.governor.signer).setGovernanceHook(emissionController.address)

        return {
            stakedToken: sToken,
            questManager: qMaster,
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
            ;({ stakedToken, questManager } = await redeployStakedToken())
        })
        it("post initialize", async () => {
            expect(await stakedToken.priceCoefficient()).eq(10000)
        })
    })

    // '''..................................................................'''
    // '''...................    PRICE COEFFICIENT    ......................'''
    // '''..................................................................'''

    context("when a StakedToken has price coefficient", () => {
        const stakedAmount = simpleToExactAmount(1000)
        before(async () => {
            ;({ stakedToken, questManager } = await redeployStakedToken())
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount.mul(3))
        })
        it("should allow basic staking and save coeff to users acc", async () => {
            await stakedToken["stake(uint256)"](stakedAmount)
            const data = await snapshotUserStakingData(sa.default.address)
            expect(data.userPriceCoeff).eq(10000)
            expect(data.votes).eq(stakedAmount)
        })
        it("should allow setting of a new priceCoeff", async () => {
            await stakedToken.setPriceCoefficient(15000)
            expect(await stakedToken.priceCoefficient()).eq(15000)
        })
        it("should update the users balance when they claim rewards", async () => {
            await stakedToken["claimReward()"]()
            const data = await snapshotUserStakingData(sa.default.address)
            expect(data.userPriceCoeff).eq(15000)
            expect(data.votes).eq(stakedAmount.mul(3).div(2))
        })
        it("should update the users balance when they stake more", async () => {
            await stakedToken.setPriceCoefficient(10000)
            await stakedToken["stake(uint256)"](stakedAmount)
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
    })

    // '''..................................................................'''
    // '''........................    FEES ETC    ..........................'''
    // '''..................................................................'''

    context("collecting fees", () => {
        it("should convert fees back into $MTA")
    })
})
