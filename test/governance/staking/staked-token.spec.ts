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
    StakedToken,
    StakedTokenWrapper__factory,
    StakedToken__factory,
    QuestManager,
    MockEmissionController__factory,
} from "types"
import { assertBNClose, DEAD_ADDRESS } from "index"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { advanceBlock, getTimestamp, increaseTime } from "@utils/time"
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

// TODO
//  - Consider how to enforce invariant that sum(balances) == totalSupply.
describe("Staked Token", () => {
    let sa: StandardAccounts
    let deployTime: BN

    let nexus: MockNexus
    let rewardToken: MockERC20
    let stakedToken: StakedToken
    let questManager: QuestManager

    const startingMintAmount = simpleToExactAmount(10000000)

    console.log(`Staked contract size ${StakedToken__factory.bytecode.length / 2} bytes`)

    interface Deployment {
        stakedToken: StakedToken
        questManager: QuestManager
    }

    const redeployStakedToken = async (): Promise<Deployment> => {
        deployTime = await getTimestamp()
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        await nexus.setRecollateraliser(sa.mockRecollateraliser.address)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, 10000100)

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
        const stakedTokenFactory = new StakedToken__factory(stakedTokenLibraryAddresses, sa.default.signer)
        const stakedTokenImpl = await stakedTokenFactory.deploy(
            nexus.address,
            rewardToken.address,
            questManagerProxy.address,
            rewardToken.address,
            ONE_WEEK,
            ONE_DAY.mul(2),
            false,
        )
        data = stakedTokenImpl.interface.encodeFunctionData("__StakedToken_init", [
            formatBytes32String("Staked Rewards"),
            formatBytes32String("stkRWD"),
            sa.mockRewardsDistributor.address,
        ])
        const stakedTokenProxy = await new AssetProxy__factory(sa.default.signer).deploy(stakedTokenImpl.address, DEAD_ADDRESS, data)
        const sToken = stakedTokenFactory.attach(stakedTokenProxy.address) as StakedToken

        const qMaster = QuestManager__factory.connect(questManagerProxy.address, sa.default.signer)
        await qMaster.connect(sa.governor.signer).addStakedToken(stakedTokenProxy.address)

        // Test: Add Emission Data
        const emissionController = await new MockEmissionController__factory(sa.default.signer).deploy()
        await emissionController.addStakingContract(sToken.address)
        await emissionController.setPreferences(65793)
        await sToken.connect(sa.governor.signer).setGovernanceHook(emissionController.address)

        await rewardToken.transfer(sa.mockRewardsDistributor.address, simpleToExactAmount(100))
        await rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(sToken.address, simpleToExactAmount(100))
        await sToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(simpleToExactAmount(100))

        return {
            stakedToken: sToken,
            questManager: qMaster,
        }
    }

    const snapshotUserStakingData = async (user = sa.default.address): Promise<UserStakingData> => {
        const stakedBalance = await stakedToken.balanceOf(user)
        const votes = await stakedToken.getVotes(user)
        const earnedRewards = await stakedToken.earned(user)
        const numCheckpoints = await stakedToken.numCheckpoints(user)
        const rewardsBalance = await rewardToken.balanceOf(user)
        const userBalances = await stakedToken.balanceData(user)
        const userPriceCoeff = await stakedToken.userPriceCoeff(user)
        const questBalance = await questManager.balanceData(user)

        return {
            stakedBalance,
            votes,
            earnedRewards,
            numCheckpoints,
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
            expect(await stakedToken.name(), "name").to.eq("Staked Rewards")
            expect(await stakedToken.symbol(), "symbol").to.eq("stkRWD")
            expect(await stakedToken.decimals(), "decimals").to.eq(18)
            expect(await stakedToken.rewardsDistributor(), "rewards distributor").to.eq(sa.mockRewardsDistributor.address)
            expect(await stakedToken.nexus(), "nexus").to.eq(nexus.address)
            expect(await stakedToken.STAKED_TOKEN(), "staked token").to.eq(rewardToken.address)
            expect(await stakedToken.REWARDS_TOKEN(), "reward token").to.eq(rewardToken.address)
            expect(await stakedToken.COOLDOWN_SECONDS(), "cooldown").to.eq(ONE_WEEK)
            expect(await stakedToken.UNSTAKE_WINDOW(), "unstake window").to.eq(ONE_DAY.mul(2))
            expect(await stakedToken.questManager(), "quest manager").to.eq(questManager.address)
            expect(await stakedToken.hasPriceCoeff(), "price coeff").to.eq(false)

            const safetyData = await stakedToken.safetyData()
            expect(safetyData.collateralisationRatio, "Collateralisation ratio").to.eq(simpleToExactAmount(1))
            expect(safetyData.slashingPercentage, "Slashing percentage").to.eq(0)
        })
    })

    // '''..................................................................'''
    // '''...............  STAKEDTOKEN.STAKE & DELEGATE   ..................'''
    // '''..................................................................'''

    // TODO - factor in `rawBalanceOf` here
    context("staking and delegating", () => {
        const stakedAmount = simpleToExactAmount(1000)
        beforeEach(async () => {
            ;({ stakedToken, questManager } = await redeployStakedToken())
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount.mul(3))

            const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataBefore.userBalances.weightedTimestamp, "weighted timestamp before").to.eq(0)
            expect(stakerDataBefore.userBalances.questMultiplier, "quest multiplier").to.eq(0)
            expect(stakerDataBefore.questBalance.lastAction, "last action before").to.eq(0)
            expect(stakerDataBefore.questBalance.permMultiplier, "perm multiplier before").to.eq(0)
            expect(stakerDataBefore.questBalance.seasonMultiplier, "season multiplier before").to.eq(0)
            expect(stakerDataBefore.userBalances.timeMultiplier, "time multiplier before").to.eq(0)
            expect(stakerDataBefore.userBalances.cooldownUnits, "cooldown multiplier before").to.eq(0)
            expect(stakerDataBefore.stakedBalance, "staker stkRWD before").to.eq(0)
            expect(stakerDataBefore.rewardsBalance, "staker RWD before").to.eq(startingMintAmount)
            expect(stakerDataBefore.votes, "staker votes before").to.eq(0)
            expect(stakerDataBefore.userBalances.cooldownTimestamp, "staker cooldown before").to.eq(0)
            expect(stakerDataBefore.numCheckpoints, "staked checkpoints before").to.eq(0)

            const delegateDataBefore = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataBefore.stakedBalance, "delegate stkRWD before").to.eq(0)
            expect(delegateDataBefore.rewardsBalance, "delegate RWD before").to.eq(0)
            expect(delegateDataBefore.votes, "delegate votes before").to.eq(0)
            expect(delegateDataBefore.userBalances.cooldownTimestamp, "delegate cooldown before").to.eq(0)
            expect(delegateDataBefore.numCheckpoints, "delegate checkpoints before").to.eq(0)

            expect(await stakedToken.totalSupply(), "total staked before").to.eq(0)
        })
        it("should delegate to self by default", async () => {
            const stakerAddress = sa.default.address
            const tx = await stakedToken["stake(uint256)"](stakedAmount)

            const stakedTimestamp = await getTimestamp()

            await expect(tx).to.emit(stakedToken, "Staked").withArgs(stakerAddress, stakedAmount, ZERO_ADDRESS)
            await expect(tx).to.not.emit(stakedToken, "DelegateChanged")
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(stakerAddress, 0, stakedAmount)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(stakerAddress, stakedToken.address, stakedAmount)
            await expect(tx).to.not.emit(stakedToken, "CooldownExited")

            const afterData = await snapshotUserStakingData(stakerAddress)

            expect(afterData.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
            expect(afterData.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
            expect(afterData.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
            expect(afterData.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
            expect(afterData.userBalances.questMultiplier, "quest multiplier").to.eq(0)
            expect(afterData.questBalance.lastAction, "last action after").to.eq(0)
            expect(afterData.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
            expect(afterData.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
            expect(afterData.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
            expect(afterData.stakedBalance, "staked balance after").to.eq(stakedAmount)
            expect(afterData.votes, "staker votes after").to.eq(stakedAmount)
            // Staker checkpoint
            expect(afterData.numCheckpoints, "staked checkpoints after").to.eq(1)
            const checkpoint = await stakedToken.checkpoints(stakerAddress, 0)
            const receipt = await tx.wait()
            expect(checkpoint.fromBlock, "staked checkpoint block").to.eq(receipt.blockNumber)
            expect(checkpoint.votes, "staked checkpoint votes").to.eq(stakedAmount)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount)
        })
        it("should assign delegate", async () => {
            const stakerAddress = sa.default.address
            const delegateAddress = sa.dummy1.address
            const tx = await stakedToken["stake(uint256,address)"](stakedAmount, delegateAddress)

            const stakedTimestamp = await getTimestamp()

            await expect(tx).to.emit(stakedToken, "Staked").withArgs(stakerAddress, stakedAmount, delegateAddress)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(stakerAddress, stakerAddress, delegateAddress)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(delegateAddress, 0, stakedAmount)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(stakerAddress, stakedToken.address, stakedAmount)
            await expect(tx).to.not.emit(stakedToken, "CooldownExited")

            const stakerDataAfter = await snapshotUserStakingData(stakerAddress)
            expect(stakerDataAfter.userBalances.raw, "staker raw balance after").to.eq(stakedAmount)
            expect(stakerDataAfter.userBalances.weightedTimestamp, "staker weighted timestamp after").to.eq(stakedTimestamp)
            expect(stakerDataAfter.questBalance.lastAction, "staker last action after").to.eq(0)
            expect(stakerDataAfter.stakedBalance, "staker stkRWD after").to.eq(stakedAmount)
            expect(stakerDataAfter.votes, "staker votes after").to.eq(0)
            expect(stakerDataAfter.userBalances.cooldownTimestamp, "staker cooldown after").to.eq(0)
            expect(stakerDataAfter.numCheckpoints, "staker checkpoints after").to.eq(0)

            const delegateDataAfter = await snapshotUserStakingData(delegateAddress)
            expect(delegateDataAfter.userBalances.raw, "delegate raw balance after").to.eq(0)
            expect(delegateDataAfter.userBalances.weightedTimestamp, "delegate weighted timestamp after").to.eq(0)
            expect(delegateDataAfter.questBalance.lastAction, "delegate last action after").to.eq(0)
            expect(delegateDataAfter.stakedBalance, "delegate stkRWD after").to.eq(0)
            expect(delegateDataAfter.votes, "delegate votes after").to.eq(stakedAmount)
            expect(delegateDataAfter.userBalances.cooldownTimestamp, "delegate cooldown after").to.eq(0)
            expect(delegateDataAfter.numCheckpoints, "delegate checkpoints after").to.eq(1)
            // Delegate Checkpoint
            const checkpoint = await stakedToken.checkpoints(delegateAddress, 0)
            const receipt = await tx.wait()
            expect(checkpoint.fromBlock, "delegate checkpoint block").to.eq(receipt.blockNumber)
            expect(checkpoint.votes, "delegate checkpoint votes").to.eq(stakedAmount)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount)
        })
        it("should stake to a delegate after staking with self as delegate", async () => {
            const firstStakedAmount = simpleToExactAmount(100)
            const secondStakedAmount = simpleToExactAmount(200)
            const bothStakedAmounts = firstStakedAmount.add(secondStakedAmount)
            const stakerAddress = sa.default.address
            const delegateAddress = sa.dummy1.address
            const tx1 = await stakedToken["stake(uint256)"](firstStakedAmount)
            const receipt1 = await tx1.wait()

            await increaseTime(ONE_WEEK)

            const tx2 = await stakedToken["stake(uint256,address)"](secondStakedAmount, delegateAddress)
            const receipt2 = await tx2.wait()

            const secondStakedTimestamp = await getTimestamp()

            await expect(tx2).to.emit(stakedToken, "Staked").withArgs(stakerAddress, secondStakedAmount, delegateAddress)
            await expect(tx2).to.emit(stakedToken, "DelegateChanged").withArgs(stakerAddress, stakerAddress, delegateAddress)
            await expect(tx2).to.emit(stakedToken, "DelegateVotesChanged").withArgs(stakerAddress, firstStakedAmount, 0)
            await expect(tx2).to.emit(stakedToken, "DelegateVotesChanged").withArgs(delegateAddress, 0, firstStakedAmount)
            await expect(tx2).to.emit(stakedToken, "DelegateVotesChanged").withArgs(delegateAddress, firstStakedAmount, bothStakedAmounts)
            await expect(tx2).to.emit(rewardToken, "Transfer").withArgs(stakerAddress, stakedToken.address, secondStakedAmount)
            await expect(tx2).to.not.emit(stakedToken, "CooldownExited")

            // Staker
            const stakerDataAfter = await snapshotUserStakingData(stakerAddress)
            expect(stakerDataAfter.userBalances.raw, "staker raw balance after").to.eq(bothStakedAmounts)
            // TODO
            // expect(stakerDataAfter.userBalances.weightedTimestamp, "staker weighted timestamp after").to.eq(secondStakedTimestamp)
            expect(stakerDataAfter.questBalance.lastAction, "staker last action after").to.eq(0)
            expect(stakerDataAfter.stakedBalance, "staker stkRWD after").to.eq(bothStakedAmounts)
            expect(stakerDataAfter.votes, "staker votes after").to.eq(0)
            expect(stakerDataAfter.userBalances.cooldownTimestamp, "staker cooldown after").to.eq(0)
            expect(stakerDataAfter.numCheckpoints, "staker checkpoints after").to.eq(2)
            // Staker 1st checkpoint
            const stakerCheckpoint1 = await stakedToken.checkpoints(stakerAddress, 0)
            expect(stakerCheckpoint1.fromBlock, "staker 1st checkpoint block").to.eq(receipt1.blockNumber)
            expect(stakerCheckpoint1.votes, "staker 1st checkpoint votes").to.eq(firstStakedAmount)
            // Staker 2nd checkpoint
            const stakerCheckpoint2 = await stakedToken.checkpoints(stakerAddress, 1)
            expect(stakerCheckpoint2.fromBlock, "staker 2nd checkpoint block").to.eq(receipt2.blockNumber)
            expect(stakerCheckpoint2.votes, "staker 2nd checkpoint votes").to.eq(0)

            // Delegate
            const delegateDataAfter = await snapshotUserStakingData(delegateAddress)
            expect(delegateDataAfter.userBalances.raw, "delegate raw balance after").to.eq(0)
            expect(delegateDataAfter.userBalances.weightedTimestamp, "delegate weighted timestamp after").to.eq(0)
            expect(delegateDataAfter.questBalance.lastAction, "delegate last action after").to.eq(0)
            expect(delegateDataAfter.stakedBalance, "delegate stkRWD after").to.eq(0)
            expect(delegateDataAfter.votes, "delegate votes after").to.eq(bothStakedAmounts)
            expect(delegateDataAfter.userBalances.cooldownTimestamp, "delegate cooldown after").to.eq(0)
            expect(delegateDataAfter.numCheckpoints, "delegate checkpoints after").to.eq(1)
            // Delegate Checkpoint
            const delegateCheckpoint = await stakedToken.checkpoints(delegateAddress, 0)
            expect(delegateCheckpoint.fromBlock, "delegate checkpoint block").to.eq(receipt2.blockNumber)
            expect(delegateCheckpoint.votes, "delegate checkpoint votes").to.eq(bothStakedAmounts)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(bothStakedAmounts)
        })
        it("should not chain delegate votes", async () => {
            const delegateStakedAmount = simpleToExactAmount(2000)
            await rewardToken.transfer(sa.dummy1.address, delegateStakedAmount)
            await rewardToken.connect(sa.dummy1.signer).approve(stakedToken.address, delegateStakedAmount)

            await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)
            await stakedToken.connect(sa.dummy1.signer)["stake(uint256,address)"](delegateStakedAmount, sa.dummy2.address)

            const afterStakerData = await snapshotUserStakingData(sa.default.address)
            expect(afterStakerData.stakedBalance, "staker stkRWD after").to.eq(stakedAmount)
            expect(afterStakerData.votes, "staker votes after").to.eq(0)

            const afterDelegateData = await snapshotUserStakingData(sa.dummy1.address)
            expect(afterDelegateData.stakedBalance, "delegate stkRWD after").to.eq(delegateStakedAmount)
            expect(afterDelegateData.votes, "delegate votes after").to.eq(stakedAmount)

            const afterDelegatesDelegateData = await snapshotUserStakingData(sa.dummy2.address)
            expect(afterDelegatesDelegateData.stakedBalance, "delegate stkRWD after").to.eq(0)
            expect(afterDelegatesDelegateData.votes, "delegate votes after").to.eq(delegateStakedAmount)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount.add(delegateStakedAmount))
        })
        it("should stake twice in the same block")
        it("should update weightedTimestamp after subsequent stake")
        it("should exit cooldown if cooldown period has expired")
        context("should fail when", () => {
            it("staking 0 amount", async () => {
                const tx = stakedToken["stake(uint256)"](0)
                await expect(tx).to.revertedWith("INVALID_ZERO_AMOUNT")
            })
            it("staking 0 amount while exiting cooldown", async () => {
                const tx = stakedToken["stake(uint256,bool)"](0, true)
                await expect(tx).to.revertedWith("INVALID_ZERO_AMOUNT")
            })
            it("staking 0 amount with delegate", async () => {
                const tx = stakedToken["stake(uint256,address)"](0, sa.dummy1.address)
                await expect(tx).to.revertedWith("INVALID_ZERO_AMOUNT")
            })
        })
    })
    context("change delegate votes", () => {
        const stakedAmount = simpleToExactAmount(100)
        beforeEach(async () => {
            ;({ stakedToken, questManager } = await redeployStakedToken())
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
        })
        it("should change by staker from self to delegate", async () => {
            await stakedToken["stake(uint256)"](stakedAmount)

            const stakedTimestamp = await getTimestamp()
            const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataBefore.votes).to.equal(stakedAmount)
            expect(stakerDataBefore.stakedBalance).to.equal(stakedAmount)
            const delegateDataBefore = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataBefore.votes).to.equal(0)

            await increaseTime(ONE_WEEK)

            // Staker delegates to delegate
            const tx = await stakedToken.delegate(sa.dummy1.address)

            // Events from delegate tx
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.default.address, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, stakedAmount, 0)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, 0, stakedAmount)

            // Staker
            const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataAfter.userBalances.raw, "staker raw balance after").to.eq(stakedAmount)
            expect(stakerDataAfter.userBalances.weightedTimestamp, "staker weighted timestamp after").to.eq(stakedTimestamp)
            expect(stakerDataAfter.questBalance.lastAction, "staker last action after").to.eq(0)
            expect(stakerDataAfter.votes, "staker votes after").to.equal(0)
            expect(stakerDataAfter.stakedBalance, "staker staked balance after").to.equal(stakedAmount)
            // Delegate
            const delegateDataAfter = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataAfter.userBalances.raw, "delegate raw balance after").to.eq(0)
            expect(delegateDataAfter.userBalances.weightedTimestamp, "delegate weighted timestamp after").to.eq(0)
            expect(delegateDataAfter.questBalance.lastAction, "delegate last action after").to.eq(0)
            expect(delegateDataAfter.votes, "delegate votes after").to.equal(stakedAmount)
            expect(delegateDataAfter.stakedBalance, "delegate staked balance after").to.equal(0)
        })
        it("should change delegate by staker from dummy 1 to 2", async () => {
            await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)

            const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataBefore.votes).to.equal(0)
            const oldDelegateDataBefore = await snapshotUserStakingData(sa.dummy1.address)
            expect(oldDelegateDataBefore.votes).to.equal(stakedAmount)
            const newDelegateDataBefore = await snapshotUserStakingData(sa.dummy2.address)
            expect(newDelegateDataBefore.votes).to.equal(0)

            const tx = await stakedToken.delegate(sa.dummy2.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.dummy1.address, sa.dummy2.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, stakedAmount, 0)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy2.address, 0, stakedAmount)

            const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataAfter.votes).to.equal(0)
            expect(stakerDataAfter.stakedBalance).to.equal(stakedAmount)
            const oldDelegateDataAfter = await snapshotUserStakingData(sa.dummy1.address)
            expect(oldDelegateDataAfter.votes).to.equal(0)
            expect(oldDelegateDataAfter.stakedBalance).to.equal(0)
            const newDelegateDataAfter = await snapshotUserStakingData(sa.dummy2.address)
            expect(newDelegateDataAfter.votes).to.equal(stakedAmount)
            expect(newDelegateDataAfter.stakedBalance).to.equal(0)
        })
        it("should change by staker from delegate to self", async () => {
            await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)

            const stakedTimestamp = await getTimestamp()
            const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataBefore.votes).to.equal(0)
            expect(stakerDataBefore.stakedBalance).to.equal(stakedAmount)
            const delegateDataBefore = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataBefore.votes).to.equal(stakedAmount)

            // Staker delegates from delegate back to themselves
            const tx = await stakedToken.delegate(sa.default.address)

            // Events
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.dummy1.address, sa.default.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, 0, stakedAmount)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, stakedAmount, 0)

            // Staker
            const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataAfter.userBalances.raw, "staker raw balance after").to.eq(stakedAmount)
            expect(stakerDataAfter.userBalances.weightedTimestamp, "staker weighted timestamp after").to.eq(stakedTimestamp)
            expect(stakerDataAfter.questBalance.lastAction, "staker last action after").to.eq(0)
            expect(stakerDataAfter.votes, "staker votes after").to.equal(stakedAmount)
            expect(stakerDataAfter.stakedBalance, "staker staked balance after").to.equal(stakedAmount)
            // Delegate
            const delegateDataAfter = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataAfter.votes, "delegate votes after").to.equal(0)
            expect(delegateDataAfter.stakedBalance, "delegate staked balance after").to.equal(0)
        })
        it("by delegate", async () => {
            const tx = await stakedToken.connect(sa.dummy1.signer).delegate(sa.dummy2.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.dummy1.address, sa.dummy1.address, sa.dummy2.address)
        })
        context("should fail", () => {
            it("by delegate", async () => {
                stakedToken.connect(sa.dummy1.signer).delegate(sa.dummy2.address)
            })
        })
    })

    // '''..................................................................'''
    // '''............    STAKEDTOKEN.COOLDOWN & WITHDRAW    ...............'''
    // '''..................................................................'''

    // TODO - factor in `rawBalanceOf` here
    context("cooldown", () => {
        const stakedAmount = simpleToExactAmount(7000)
        context("with no delegate", () => {
            let stakedTimestamp: BN
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
                stakedTimestamp = await getTimestamp()
                await increaseTime(ONE_WEEK.mul(2))
            })
            context("should fail when", () => {
                it("nothing staked", async () => {
                    await expect(stakedToken.connect(sa.dummy1.signer).startCooldown(stakedAmount)).to.revertedWith(
                        "INVALID_BALANCE_ON_COOLDOWN",
                    )
                })
                it("0 units", async () => {
                    await expect(stakedToken.startCooldown(0)).to.revertedWith("Must choose between 0 and 100%")
                })
                it("too many units", async () => {
                    await expect(stakedToken.startCooldown(stakedAmount.add(1))).to.revertedWith("Must choose between 0 and 100%")
                })
            })
            it("should start cooldown", async () => {
                const tx = await stakedToken.startCooldown(stakedAmount)

                await expect(tx).to.emit(stakedToken, "Cooldown").withArgs(sa.default.address, stakedAmount)

                const startCooldownTimestamp = await getTimestamp()
                const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(startCooldownTimestamp)
                expect(stakerDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(stakedAmount)
                expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(0)
                expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                expect(stakerDataAfter.questBalance.lastAction, "last action after").to.eq(0)
                expect(stakerDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
                expect(stakerDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
                expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(0)
                expect(stakerDataAfter.votes, "votes after").to.eq(0)
            })
            it("should partial cooldown again after it has already started", async () => {
                const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataBefore.userBalances.weightedTimestamp, "weighted timestamp before").to.eq(stakedTimestamp)

                // First cooldown for 80% of stake
                const firstCooldown = stakedAmount.mul(4).div(5)
                await stakedToken.startCooldown(firstCooldown)

                const cooldown1stTimestamp = await getTimestamp()
                const stakerDataAfter1stCooldown = await snapshotUserStakingData(sa.default.address)

                expect(stakerDataAfter1stCooldown.userBalances.cooldownTimestamp, "cooldown timestamp after 1st").to.eq(
                    cooldown1stTimestamp,
                )
                expect(stakerDataAfter1stCooldown.userBalances.cooldownUnits, "cooldown units after 1st").to.eq(firstCooldown)
                expect(stakerDataAfter1stCooldown.userBalances.raw, "staked raw balance after 1st").to.eq(stakedAmount.sub(firstCooldown))
                expect(stakerDataAfter1stCooldown.userBalances.weightedTimestamp, "weighted timestamp after 1st").to.eq(stakedTimestamp)
                expect(stakerDataAfter1stCooldown.questBalance.lastAction, "last action after 1st").to.eq(0)
                expect(stakerDataAfter1stCooldown.questBalance.permMultiplier, "perm multiplier after 1st").to.eq(0)
                expect(stakerDataAfter1stCooldown.questBalance.seasonMultiplier, "season multiplier after 1st").to.eq(0)
                expect(stakerDataAfter1stCooldown.userBalances.timeMultiplier, "time multiplier after 1st").to.eq(0)
                expect(stakerDataAfter1stCooldown.stakedBalance, "staked balance after 1st").to.eq(stakedAmount.div(5))

                await increaseTime(ONE_DAY)

                // Second cooldown for only 20% of stake
                const secondCooldown = stakedAmount.div(5)
                await stakedToken.startCooldown(secondCooldown)

                const cooldown2ndTimestamp = await getTimestamp()
                const stakerDataAfter2ndCooldown = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfter2ndCooldown.userBalances.cooldownTimestamp, "cooldown timestamp after 2nd").to.eq(
                    cooldown2ndTimestamp,
                )
                expect(stakerDataAfter2ndCooldown.userBalances.cooldownUnits, "cooldown units after 2nd").to.eq(secondCooldown)
                expect(stakerDataAfter2ndCooldown.userBalances.raw, "staked raw balance after 2nd").to.eq(stakedAmount.sub(secondCooldown))
                expect(stakerDataAfter2ndCooldown.userBalances.weightedTimestamp, "weighted timestamp after 2nd").to.eq(stakedTimestamp)
                expect(stakerDataAfter2ndCooldown.questBalance.lastAction, "last action after 2nd").to.eq(0)
                expect(stakerDataAfter2ndCooldown.questBalance.permMultiplier, "perm multiplier after 2nd").to.eq(0)
                expect(stakerDataAfter2ndCooldown.questBalance.seasonMultiplier, "season multiplier after 2nd").to.eq(0)
                expect(stakerDataAfter2ndCooldown.userBalances.timeMultiplier, "time multiplier after 2nd").to.eq(0)
                expect(stakerDataAfter2ndCooldown.stakedBalance, "staked balance after 2nd").to.eq(stakedAmount.mul(4).div(5))
                expect(stakerDataAfter2ndCooldown.votes, "votes balance after 2nd").to.eq(stakedAmount.mul(4).div(5))
                expect(await stakedToken.totalSupply(), "total supply").to.eq(stakedAmount.mul(4).div(5))
            })
            it("should reduce cooldown percentage enough to end the cooldown")

            context("should end 100% cooldown", () => {
                beforeEach(async () => {
                    await increaseTime(ONE_WEEK)
                    await stakedToken.startCooldown(stakedAmount)
                })
                it("in cooldown", async () => {
                    await increaseTime(ONE_DAY)
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.questBalance.lastAction, "last action after").to.eq(0)
                    expect(stakerDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("in unstake window", async () => {
                    await increaseTime(ONE_DAY.mul(8))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.questBalance.lastAction, "last action after").to.eq(0)
                    expect(stakerDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("after unstake window", async () => {
                    await increaseTime(ONE_DAY.mul(12))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.questBalance.lastAction, "last action after").to.eq(0)
                    expect(stakerDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("after time multiplier increases", async () => {
                    await increaseTime(ONE_WEEK.mul(14))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.questBalance.lastAction, "last action after").to.eq(0)
                    expect(stakerDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(20)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount.mul(12).div(10))
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount.mul(12).div(10))
                })
            })
            context("should end partial cooldown", () => {
                beforeEach(async () => {
                    await increaseTime(ONE_WEEK)
                    const cooldownAmount = stakedAmount.mul(3).div(10)
                    await stakedToken.startCooldown(cooldownAmount)
                })
                it("in cooldown", async () => {
                    await increaseTime(ONE_DAY)
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.questBalance.lastAction, "last action after").to.eq(0)
                    expect(stakerDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("in unstake window", async () => {
                    await increaseTime(ONE_DAY.mul(8))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.questBalance.lastAction, "last action after").to.eq(0)
                    expect(stakerDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("after unstake window", async () => {
                    await increaseTime(ONE_DAY.mul(12))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.questBalance.lastAction, "last action after").to.eq(0)
                    expect(stakerDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
            })
            context("should end partial cooldown", () => {
                it("in cooldown")
                it("in unstake window")
                it("after unstake window")
            })
            it("should end partial cooldown via staking", async () => {
                // skip ahead 4 weeks
                await increaseTime(ONE_WEEK.mul(4))

                // Cooldown 80% of stake so only 20% of their voting power remains
                const cooldownAmount = stakedAmount.mul(4).div(5)
                await stakedToken.startCooldown(cooldownAmount)
                const cooldownTimestamp = await getTimestamp()

                const stakerDataAfterCooldown = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfterCooldown.userBalances.cooldownTimestamp, "cooldown timestamp after cooldown").to.eq(cooldownTimestamp)
                expect(stakerDataAfterCooldown.userBalances.cooldownUnits, "cooldown units after cooldown").to.eq(cooldownAmount)
                expect(stakerDataAfterCooldown.userBalances.raw, "staked raw balance after cooldown").to.eq(
                    stakedAmount.sub(cooldownAmount),
                )
                expect(stakerDataAfterCooldown.userBalances.weightedTimestamp, "weighted timestamp after cooldown").to.eq(stakedTimestamp)
                expect(stakerDataAfterCooldown.questBalance.lastAction, "last action after cooldown").to.eq(0)
                expect(stakerDataAfterCooldown.stakedBalance, "staked after cooldown").to.eq(stakedAmount.div(5))
                expect(stakerDataAfterCooldown.userBalances.timeMultiplier, "time multiplier after cooldown").to.eq(0)
                expect(stakerDataAfterCooldown.votes, "20% of vote after 80% cooldown").to.eq(stakedAmount.div(5))

                // Stake 3000 on top of 7000 and end cooldown
                const secondStakeAmount = simpleToExactAmount(3000)
                const tx = await stakedToken["stake(uint256,bool)"](secondStakeAmount, true)
                const secondStakedTimestamp = await getTimestamp()

                await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, secondStakeAmount, ZERO_ADDRESS)
                await expect(tx).to.not.emit(stakedToken, "DelegateChanged")
                await expect(tx)
                    .to.emit(stakedToken, "DelegateVotesChanged")
                    .withArgs(sa.default.address, stakedAmount.div(5), stakedAmount.add(secondStakeAmount))
                await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, secondStakeAmount)
                await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                const stakerDataAfter2ndStake = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfter2ndStake.userBalances.cooldownTimestamp, "cooldown timestamp after 2nd stake").to.eq(0)
                expect(stakerDataAfter2ndStake.userBalances.cooldownUnits, "cooldown units after 2nd stake").to.eq(0)
                expect(stakerDataAfter2ndStake.userBalances.raw, "staked raw balance after 2nd stake").to.eq(
                    stakedAmount.add(secondStakeAmount),
                )
                // TODO need to calculate the weightedTimestamp =
                // expect(stakerDataAfter2ndStake.userBalances.weightedTimestamp, "weighted timestamp after 2nd stake").to.eq(stakedTimestamp)
                expect(stakerDataAfter2ndStake.questBalance.lastAction, "last action after 2nd stake").to.eq(0)
                expect(stakerDataAfter2ndStake.userBalances.timeMultiplier, "time multiplier after 2nd stake").to.eq(0)
                expect(stakerDataAfter2ndStake.stakedBalance, "staked after 2nd stake").to.eq(stakedAmount.add(secondStakeAmount))
                expect(stakerDataAfter2ndStake.votes, "vote after 2nd stake").to.eq(stakedAmount.add(secondStakeAmount))
            })
            it("should proportionally reset cooldown when staking in cooldown", async () => {
                await increaseTime(ONE_WEEK)

                // Staker cooldown 100% of stake
                await stakedToken.startCooldown(stakedAmount)

                const stakerDataAfterCooldown = await snapshotUserStakingData(sa.default.address)
                const cooldownTime = await getTimestamp()
                expect(stakerDataAfterCooldown.userBalances.cooldownTimestamp, "staker cooldown timestamp after cooldown").to.eq(
                    cooldownTime,
                )

                await increaseTime(ONE_DAY.mul(5))

                // 2nd stake of 3000 on top of the existing 7000
                const secondStakeAmount = simpleToExactAmount(3000)
                await stakedToken["stake(uint256,address)"](secondStakeAmount, sa.default.address)

                const secondStakeTimestamp = await getTimestamp()

                const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfter.userBalances.cooldownTimestamp, "staker cooldown timestamp after 2nd stake").to.eq(
                    stakerDataAfterCooldown.userBalances.cooldownTimestamp,
                )
                expect(stakerDataAfter.userBalances.cooldownUnits, "staker cooldown units after 2nd stake").to.eq(stakedAmount)
                expect(stakerDataAfter.userBalances.raw, "staked raw balance after 2nd stake").to.eq(secondStakeAmount)
                expect(stakerDataAfter.stakedBalance, "staker staked after 2nd stake").to.eq(secondStakeAmount)
                expect(stakerDataAfter.votes, "staker votes after 2nd stake").to.eq(secondStakeAmount)
                // TODO calculate new weighted timestamp
                // expect(stakerDataAfter.userBalances.weightedTimestamp, "staker weighted timestamp after").to.eq(stakedTimestamp)
                expect(stakerDataAfter.questBalance.lastAction, "staker last action after 2nd stake").to.eq(0)
                expect(stakerDataAfter.userBalances.timeMultiplier, "staker time multiplier after 2nd stake").to.eq(0)
            })
        })
        context("with delegate", () => {
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)
            })
            it("should fail by delegate", async () => {
                const tx = stakedToken.connect(sa.dummy1.address).startCooldown(stakedAmount)
                await expect(tx).to.revertedWith("INVALID_BALANCE_ON_COOLDOWN")
            })
        })
    })
    context("withdraw", () => {
        const stakedAmount = simpleToExactAmount(2000)
        let cooldownTimestamp: BN
        context("should not be possible", () => {
            const withdrawAmount = simpleToExactAmount(100)
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
            })
            it("with zero balance", async () => {
                await stakedToken.startCooldown(stakedAmount)
                await increaseTime(ONE_DAY.mul(7).add(60))
                await expect(stakedToken.withdraw(0, sa.default.address, false, false)).to.revertedWith("INVALID_ZERO_AMOUNT")
            })
            it("before cooldown started", async () => {
                await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)).to.revertedWith(
                    "UNSTAKE_WINDOW_FINISHED",
                )
            })
            it("before cooldown finished", async () => {
                await stakedToken.startCooldown(stakedAmount)
                await increaseTime(ONE_DAY.mul(7).sub(60))
                await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)).to.revertedWith(
                    "INSUFFICIENT_COOLDOWN",
                )
            })
            it("after the unstake window", async () => {
                await stakedToken.startCooldown(stakedAmount)
                await increaseTime(ONE_DAY.mul(9).add(60))
                await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)).to.revertedWith(
                    "UNSTAKE_WINDOW_FINISHED",
                )
            })
            it("when withdrawing too much", async () => {
                await stakedToken.startCooldown(10000)
                await increaseTime(ONE_DAY.mul(7).add(60))
                await expect(stakedToken.withdraw(stakedAmount.add(1), sa.default.address, false, false)).to.revertedWith(
                    "Exceeds max withdrawal",
                )
            })
        })

        context("with no delegate, after 100% cooldown and in unstake window", () => {
            let beforeData: UserStakingData
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
                await stakedToken.startCooldown(stakedAmount)
                cooldownTimestamp = await getTimestamp()

                await increaseTime(ONE_DAY.mul(7).add(60))

                beforeData = await snapshotUserStakingData(sa.default.address)
                expect(beforeData.userBalances.raw, "staked raw balance before").to.eq(0)
                expect(beforeData.stakedBalance, "staker staked before").to.eq(0)
                expect(beforeData.votes, "staker votes before").to.eq(0)
                expect(beforeData.rewardsBalance, "staker rewards before").to.eq(startingMintAmount.sub(stakedAmount))
                expect(beforeData.userBalances.cooldownTimestamp, "cooldown timestamp before").to.eq(cooldownTimestamp)
                expect(beforeData.userBalances.cooldownUnits, "cooldown units before").to.eq(stakedAmount)
                // expect(beforeData.userBalances.cooldownMultiplier, "cooldown multiplier before").to.eq(100)
            })
            it("partial withdraw not including fee", async () => {
                const withdrawAmount = simpleToExactAmount(100)
                const redemptionFee = withdrawAmount.mul(75).div(1000)
                const tx2 = await stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, withdrawAmount)

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker staked after").to.eq(0)
                expect(afterData.votes, "staker votes after").to.eq(0)
                expect(afterData.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(
                    beforeData.userBalances.cooldownTimestamp,
                )
                expect(afterData.userBalances.cooldownUnits, "cooldown units after").to.eq(
                    beforeData.userBalances.cooldownUnits.sub(withdrawAmount).sub(redemptionFee),
                )
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(0)
                expect(afterData.rewardsBalance, "staker rewards after").to.eq(beforeData.rewardsBalance.add(withdrawAmount))
            })
            it("full withdraw including fee", async () => {
                // withdrawal = stakedAmount / (1 + rate)
                // fee = stakedAmount - withdrawal
                // fee = stakedAmount - (stakedAmount / (1 + rate))
                const redemptionFee = stakedAmount.sub(stakedAmount.mul(1000).div(1075))

                const tx2 = await stakedToken.withdraw(stakedAmount, sa.default.address, true, true)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, stakedAmount)

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker stkRWD after").to.eq(0)
                expect(afterData.votes, "staker votes after").to.eq(0)
                expect(afterData.userBalances.cooldownTimestamp, "staked cooldown start after").to.eq(0)
                expect(afterData.userBalances.cooldownUnits, "staked cooldown units after").to.eq(0)
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(0)
                assertBNClose(afterData.rewardsBalance, beforeData.rewardsBalance.add(stakedAmount).sub(redemptionFee), 1)
            })
            it("not reset the cooldown timer unless all is all unstaked")
            it("apply a redemption fee which is added to the pendingRewards from the rewards contract")
            it("distribute these pendingAdditionalReward with the next notification")
        })
        // TODO - calculate weightedTimestamp updates, voting balance, totalSupply
        context("with no delegate, after 70% cooldown and in unstake window", () => {
            let beforeData: UserStakingData
            // 2000 * 0.3 = 600
            const remainingBalance = stakedAmount.mul(3).div(10)
            // 2000 * 0.7 = 1400
            const cooldownAmount = stakedAmount.mul(7).div(10)
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                // Stake 2000
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
                // Cooldown 70% of 2000 = 1400
                await stakedToken.startCooldown(cooldownAmount)
                cooldownTimestamp = await getTimestamp()

                await increaseTime(ONE_DAY.mul(7).add(60))

                beforeData = await snapshotUserStakingData(sa.default.address)
                expect(beforeData.userBalances.raw, "staked raw balance before").to.eq(remainingBalance)
                expect(beforeData.stakedBalance, "staker staked before").to.eq(remainingBalance)
                expect(beforeData.votes, "staker votes before").to.eq(remainingBalance)
                expect(beforeData.rewardsBalance, "staker rewards before").to.eq(startingMintAmount.sub(stakedAmount))
                expect(beforeData.userBalances.cooldownTimestamp, "cooldown timestamp before").to.eq(cooldownTimestamp)
                expect(beforeData.userBalances.cooldownUnits, "cooldown units before").to.eq(cooldownAmount)
                // expect(beforeData.userBalances.cooldownMultiplier, "cooldown multiplier before").to.eq(70)
            })
            it("partial withdraw not including fee", async () => {
                const withdrawAmount = simpleToExactAmount(300)
                const redemptionFee = withdrawAmount.mul(75).div(1000)
                const tx2 = await stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, withdrawAmount)

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker staked after").to.eq(remainingBalance)
                expect(afterData.votes, "staker votes after").to.eq(remainingBalance)
                expect(afterData.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(
                    beforeData.userBalances.cooldownTimestamp,
                )
                expect(afterData.userBalances.cooldownUnits, "cooldown units after").to.eq(
                    cooldownAmount.sub(withdrawAmount).sub(redemptionFee),
                )
                // expect(afterData.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(64)
                // 2000 - 300 - 30 = 1670
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(remainingBalance)
                expect(afterData.rewardsBalance, "staker rewards after").to.eq(beforeData.rewardsBalance.add(withdrawAmount))
            })
            it("full withdraw of cooldown amount including fee", async () => {
                const redemptionFee = cooldownAmount.sub(cooldownAmount.mul(1000).div(1075))
                const tx2 = await stakedToken.withdraw(cooldownAmount, sa.default.address, true, true)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, cooldownAmount)

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker stkRWD after").to.eq(remainingBalance)
                expect(afterData.votes, "staker votes after").to.eq(remainingBalance)
                expect(afterData.userBalances.cooldownTimestamp, "staked cooldown start after").to.eq(0)
                expect(afterData.userBalances.cooldownUnits, "staked cooldown units after").to.eq(0)
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(remainingBalance)
                assertBNClose(afterData.rewardsBalance, beforeData.rewardsBalance.add(cooldownAmount).sub(redemptionFee), 1)
            })
            it("not reset the cooldown timer unless all is all unstaked")
            it("apply a redemption fee which is added to the pendingRewards from the rewards contract")
            it("distribute these pendingAdditionalReward with the next notification")
        })
        context("after 25% slashing and recollateralisation", () => {
            const slashingPercentage = simpleToExactAmount(25, 16)
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
                await increaseTime(ONE_DAY.mul(7).add(60))
                await stakedToken.connect(sa.governor.signer).changeSlashingPercentage(slashingPercentage)
                await stakedToken.connect(sa.mockRecollateraliser.signer).emergencyRecollateralisation()
            })
            it("should withdraw all incl fee and get 75% of balance", async () => {
                const tx = await stakedToken.withdraw(stakedAmount, sa.default.address, true, false)
                await expect(tx).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, stakedAmount)
                await expect(tx)
                    .to.emit(rewardToken, "Transfer")
                    .withArgs(stakedToken.address, sa.default.address, stakedAmount.mul(3).div(4))

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker stkRWD after").to.eq(0)
                expect(afterData.votes, "staker votes after").to.eq(0)
                expect(afterData.userBalances.cooldownTimestamp, "staked cooldown start after").to.eq(0)
                expect(afterData.userBalances.cooldownUnits, "staked cooldown units after").to.eq(0)
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(0)
            })
            it("should withdraw all excl. fee and get 75% of balance", async () => {
                const tx = await stakedToken.withdraw(stakedAmount, sa.default.address, false, false)
                await expect(tx).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, stakedAmount)
                await expect(tx)
                    .to.emit(rewardToken, "Transfer")
                    .withArgs(stakedToken.address, sa.default.address, stakedAmount.mul(3).div(4))

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker stkRWD after").to.eq(0)
                expect(afterData.votes, "staker votes after").to.eq(0)
                expect(afterData.userBalances.cooldownTimestamp, "staked cooldown start").to.eq(0)
                expect(afterData.userBalances.cooldownUnits, "staked cooldown units").to.eq(0)
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(0)
            })
            it("should partial withdraw and get 75% of balance", async () => {
                const withdrawAmount = stakedAmount.div(10)
                const tx = await stakedToken.withdraw(withdrawAmount, sa.default.address, true, false)
                await expect(tx).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, withdrawAmount)
                await expect(tx)
                    .to.emit(rewardToken, "Transfer")
                    .withArgs(stakedToken.address, sa.default.address, withdrawAmount.mul(3).div(4))

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker stkRWD after").to.eq(0)
                expect(afterData.votes, "staker votes after").to.eq(0)
                expect(afterData.userBalances.cooldownTimestamp, "staked cooldown start").to.eq(0)
                expect(afterData.userBalances.cooldownUnits, "staked cooldown units").to.eq(stakedAmount.sub(withdrawAmount))
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(0)
            })
        })
        context("calc redemption fee", () => {
            let currentTime: BN
            before(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                currentTime = await getTimestamp()
            })
            const runs = [
                { stakedSeconds: BN.from(0), expected: 75, desc: "immediate" },
                { stakedSeconds: ONE_DAY, expected: 75, desc: "1 day" },
                { stakedSeconds: ONE_WEEK, expected: 75, desc: "1 week" },
                { stakedSeconds: ONE_WEEK.mul(2), expected: 75, desc: "2 weeks" },
                { stakedSeconds: ONE_WEEK.mul(32).div(10), expected: 71.82458365, desc: "3.1 weeks" },
                { stakedSeconds: ONE_WEEK.mul(10), expected: 29.77225575, desc: "10 weeks" },
                { stakedSeconds: ONE_WEEK.mul(12), expected: 25, desc: "12 weeks" },
                { stakedSeconds: ONE_WEEK.mul(47), expected: 0.26455763, desc: "47 weeks" },
                { stakedSeconds: ONE_WEEK.mul(48), expected: 0, desc: "48 weeks" },
                { stakedSeconds: ONE_WEEK.mul(50), expected: 0, desc: "50 weeks" },
            ]
            runs.forEach((run) => {
                it(run.desc, async () => {
                    expect(await stakedToken.calcRedemptionFeeRate(currentTime.sub(run.stakedSeconds))).to.eq(
                        simpleToExactAmount(run.expected, 15),
                    )
                })
            })
        })
    })

    // '''..................................................................'''
    // '''....................    STAKEDTOKEN. ETC    ......................'''
    // '''..................................................................'''

    context("backward compatibility", () => {
        const stakedAmount = simpleToExactAmount(2000)
        beforeEach(async () => {
            ;({ stakedToken, questManager } = await redeployStakedToken())
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount.mul(2))
        })
        it("createLock", async () => {
            const tx = await stakedToken.createLock(stakedAmount, ONE_WEEK.mul(12))

            const stakedTimestamp = await getTimestamp()

            await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, stakedAmount, ZERO_ADDRESS)
            await expect(tx).to.not.emit(stakedToken, "DelegateChanged")
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, 0, stakedAmount)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, stakedAmount)

            const afterData = await snapshotUserStakingData(sa.default.address)

            expect(afterData.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
            expect(afterData.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
            expect(afterData.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
            expect(afterData.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
            expect(afterData.questBalance.lastAction, "last action after").to.eq(0)
            expect(afterData.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
            expect(afterData.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
            expect(afterData.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
            expect(afterData.stakedBalance, "staked balance after").to.eq(stakedAmount)
            expect(afterData.votes, "staker votes after").to.eq(stakedAmount)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount)
        })
        it("increaseLockAmount", async () => {
            await stakedToken.createLock(stakedAmount, ONE_WEEK.mul(12))
            const stakeTimestamp = await getTimestamp()
            await increaseTime(ONE_WEEK.mul(10))
            const increaseAmount = simpleToExactAmount(200)
            const newBalance = stakedAmount.add(increaseAmount)
            const tx = await stakedToken.increaseLockAmount(increaseAmount)

            await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, increaseAmount, ZERO_ADDRESS)
            await expect(tx).to.not.emit(stakedToken, "DelegateChanged")
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, stakedAmount, newBalance)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, increaseAmount)

            const afterData = await snapshotUserStakingData(sa.default.address)

            expect(afterData.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
            expect(afterData.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
            expect(afterData.userBalances.raw, "staked raw balance after").to.eq(newBalance)
            // expect(afterData.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(increaseTimestamp)
            expect(afterData.questBalance.lastAction, "last action after").to.eq(0)
            expect(afterData.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
            expect(afterData.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
            expect(afterData.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
            expect(afterData.stakedBalance, "staked balance after").to.eq(newBalance)
            expect(afterData.votes, "staker votes after").to.eq(newBalance)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(newBalance)
        })
        it("fails to increaseLockAmount if the user has no stake", async () => {
            // Fresh slate, fail
            await expect(stakedToken.increaseLockAmount(stakedAmount)).to.revertedWith("Nothing to increase")

            // Stake, withdraw, fail
            await stakedToken.createLock(stakedAmount, ONE_WEEK.mul(12))
            await stakedToken.startCooldown(stakedAmount)
            await increaseTime(ONE_DAY.mul(8))
            await stakedToken.withdraw(stakedAmount, sa.default.address, true, false)
            const data = await snapshotUserStakingData()
            expect(data.stakedBalance).eq(BN.from(0))
            expect(data.userBalances.cooldownTimestamp).eq(BN.from(0))
            await expect(stakedToken.increaseLockAmount(stakedAmount)).to.revertedWith("Nothing to increase")
        })
        it("first exit", async () => {
            await stakedToken.createLock(stakedAmount, ONE_WEEK.mul(20))
            const stakeTimestamp = await getTimestamp()
            await increaseTime(ONE_WEEK.mul(18))

            const tx = await stakedToken.exit()

            await expect(tx).to.emit(stakedToken, "Cooldown").withArgs(sa.default.address, stakedAmount)

            const startCooldownTimestamp = await getTimestamp()
            const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(startCooldownTimestamp)
            expect(stakerDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(stakedAmount)
            expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(0)
            expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakeTimestamp)
            expect(stakerDataAfter.questBalance.lastAction, "last action after").to.eq(0)
            expect(stakerDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
            expect(stakerDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
            expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(20)
            expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(0)
            expect(stakerDataAfter.votes, "votes after").to.eq(0)
        })
        it("second exit", async () => {
            await stakedToken.createLock(stakedAmount, ONE_WEEK.mul(20))
            const stakedTimestamp = await getTimestamp()
            await increaseTime(ONE_DAY.mul(1))
            await stakedToken.exit()
            await increaseTime(ONE_DAY.mul(8))

            const tx = await stakedToken.exit()

            const redemptionFee = stakedAmount.sub(stakedAmount.mul(1000).div(1075))
            await expect(tx).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, stakedAmount)
            await expect(tx)
                .to.emit(rewardToken, "Transfer")
                .withArgs(stakedToken.address, sa.default.address, stakedAmount.sub(redemptionFee))

            const withdrawTimestamp = await getTimestamp()
            const afterData = await snapshotUserStakingData(sa.default.address)
            expect(afterData.stakedBalance, "staker stkRWD after").to.eq(0)
            expect(afterData.votes, "staker votes after").to.eq(0)
            expect(afterData.userBalances.cooldownTimestamp, "staked cooldown start").to.eq(0)
            expect(afterData.userBalances.cooldownUnits, "staked cooldown units").to.eq(0)
            expect(afterData.userBalances.raw, "staked raw balance after").to.eq(0)
            // TODO expect(afterData.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(withdrawTimestamp)
            expect(afterData.questBalance.lastAction, "last action after").to.eq(0)
            expect(afterData.rewardsBalance, "staker rewards after").to.eq(startingMintAmount.sub(redemptionFee))
        })
    })
    context("interacting from a smart contract", () => {
        let stakedTokenWrapper
        const stakedAmount = simpleToExactAmount(1000)
        before(async () => {
            ;({ stakedToken, questManager } = await redeployStakedToken())

            stakedTokenWrapper = await new StakedTokenWrapper__factory(sa.default.signer).deploy(rewardToken.address, stakedToken.address)
            await rewardToken.transfer(stakedTokenWrapper.address, stakedAmount.mul(3))
        })
        it("should allow governor to whitelist a contract", async () => {
            expect(await stakedToken.whitelistedWrappers(stakedTokenWrapper.address), "wrapper not whitelisted before").to.be.false
            const tx = await stakedToken.connect(sa.governor.signer).whitelistWrapper(stakedTokenWrapper.address)
            await expect(tx).to.emit(stakedToken, "WrapperWhitelisted").withArgs(stakedTokenWrapper.address)
            expect(await stakedToken.whitelistedWrappers(stakedTokenWrapper.address), "wrapper whitelisted after").to.be.true

            const tx2 = await stakedTokenWrapper["stake(uint256)"](stakedAmount)
            await expect(tx2).to.emit(stakedToken, "Staked").withArgs(stakedTokenWrapper.address, stakedAmount, ZERO_ADDRESS)
        })
        it("should allow governor to blacklist a contract", async () => {
            const tx = await stakedToken.connect(sa.governor.signer).whitelistWrapper(stakedTokenWrapper.address)
            await expect(tx).to.emit(stakedToken, "WrapperWhitelisted").withArgs(stakedTokenWrapper.address)
            expect(await stakedToken.whitelistedWrappers(stakedTokenWrapper.address), "wrapper whitelisted").to.be.true

            const tx2 = await stakedToken.connect(sa.governor.signer).blackListWrapper(stakedTokenWrapper.address)
            await expect(tx2).to.emit(stakedToken, "WrapperBlacklisted").withArgs(stakedTokenWrapper.address)
            expect(await stakedToken.whitelistedWrappers(stakedTokenWrapper.address), "wrapper not whitelisted").to.be.false

            await expect(stakedTokenWrapper["stake(uint256)"](stakedAmount)).to.revertedWith("Not a whitelisted contract")
        })
        it("Votes can be delegated to a smart contract", async () => {
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)

            const tx = await stakedToken["stake(uint256,address)"](stakedAmount, stakedTokenWrapper.address)

            await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, stakedAmount, stakedTokenWrapper.address)
        })
        context("should not", () => {
            it("be possible to stake when not whitelisted", async () => {
                await expect(stakedTokenWrapper["stake(uint256)"](stakedAmount)).to.revertedWith("Not a whitelisted contract")
            })
            it("be possible to withdraw when not whitelisted", async () => {
                await stakedToken.connect(sa.governor.signer).whitelistWrapper(stakedTokenWrapper.address)
                await stakedTokenWrapper["stake(uint256)"](stakedAmount)
                await stakedToken.connect(sa.governor.signer).blackListWrapper(stakedTokenWrapper.address)
                const tx = stakedTokenWrapper.withdraw(stakedAmount, sa.default.address, true, true)

                await expect(tx).to.revertedWith("Not a whitelisted contract")
            })
            it("allow non governor to whitelist a contract", async () => {
                const tx = stakedToken.whitelistWrapper(stakedTokenWrapper.address)
                await expect(tx).to.revertedWith("Only governor can execute")
            })
            it("allow non governor to blacklist a contract", async () => {
                await stakedToken.connect(sa.governor.signer).whitelistWrapper(stakedTokenWrapper.address)

                const tx = stakedToken.blackListWrapper(stakedTokenWrapper.address)
                await expect(tx).to.revertedWith("Only governor can execute")
            })
        })
    })
    context("when there is a priceCoeff but no overload", () => {
        it("should default to 10000")
    })

    // '''..................................................................'''
    // '''...................    STAKEDTOKEN.ADMIN    ......................'''
    // '''..................................................................'''

    context("recollateralisation", () => {
        const stakedAmount = simpleToExactAmount(10000)
        beforeEach(async () => {
            ;({ stakedToken, questManager } = await redeployStakedToken())
            const users = [sa.default, sa.dummy1, sa.dummy2, sa.dummy3, sa.dummy4]
            for (const user of users) {
                await rewardToken.transfer(user.address, stakedAmount)
                await rewardToken.connect(user.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken.connect(user.signer)["stake(uint256,address)"](stakedAmount, user.address)
            }
        })
        it("should allow governor to set 25% slashing", async () => {
            const slashingPercentage = simpleToExactAmount(25, 16)
            const tx = await stakedToken.connect(sa.governor.signer).changeSlashingPercentage(slashingPercentage)
            await expect(tx).to.emit(stakedToken, "SlashRateChanged").withArgs(slashingPercentage)

            const safetyDataAfter = await stakedToken.safetyData()
            expect(await safetyDataAfter.slashingPercentage, "slashing percentage after").to.eq(slashingPercentage)
            expect(await safetyDataAfter.collateralisationRatio, "collateralisation ratio after").to.eq(simpleToExactAmount(1))
        })
        it("should allow governor to slash a second time before recollateralisation", async () => {
            const firstSlashingPercentage = simpleToExactAmount(10, 16)
            const secondSlashingPercentage = simpleToExactAmount(20, 16)
            await stakedToken.connect(sa.governor.signer).changeSlashingPercentage(firstSlashingPercentage)
            const tx = stakedToken.connect(sa.governor.signer).changeSlashingPercentage(secondSlashingPercentage)
            await expect(tx).to.emit(stakedToken, "SlashRateChanged").withArgs(secondSlashingPercentage)

            const safetyDataAfter = await stakedToken.safetyData()
            expect(await safetyDataAfter.slashingPercentage, "slashing percentage after").to.eq(secondSlashingPercentage)
            expect(await safetyDataAfter.collateralisationRatio, "collateralisation ratio after").to.eq(simpleToExactAmount(1))
        })
        it("should allow recollateralisation", async () => {
            const slashingPercentage = simpleToExactAmount(25, 16)
            await stakedToken.connect(sa.governor.signer).changeSlashingPercentage(slashingPercentage)

            const tx = stakedToken.connect(sa.mockRecollateraliser.signer).emergencyRecollateralisation()

            // Events
            await expect(tx).to.emit(stakedToken, "Recollateralised")
            // transfer amount = 5 * 10,000 * 25% = 12,500
            await expect(tx)
                .to.emit(rewardToken, "Transfer")
                .withArgs(stakedToken.address, sa.mockRecollateraliser.address, simpleToExactAmount(12500))

            const safetyDataAfter = await stakedToken.safetyData()
            expect(await safetyDataAfter.slashingPercentage, "slashing percentage after").to.eq(slashingPercentage)
            expect(await safetyDataAfter.collateralisationRatio, "collateralisation ratio after").to.eq(
                simpleToExactAmount(1).sub(slashingPercentage),
            )

            // TODO - withdrawal should return 75%
        })
        context("should not allow", () => {
            const slashingPercentage = simpleToExactAmount(10, 16)
            it("governor to slash after recollateralisation", async () => {
                await stakedToken.connect(sa.governor.signer).changeSlashingPercentage(slashingPercentage)
                await stakedToken.connect(sa.mockRecollateraliser.signer).emergencyRecollateralisation()

                const tx = stakedToken.connect(sa.governor.signer).changeSlashingPercentage(slashingPercentage)
                await expect(tx).to.revertedWith("Only while fully collateralised")
            })
            it("slash percentage > 50%", async () => {
                const tx = stakedToken.connect(sa.governor.signer).changeSlashingPercentage(simpleToExactAmount(51, 16))
                await expect(tx).to.revertedWith("Cannot exceed 50%")
            })
            it("non governor to change slash percentage", async () => {
                const tx = stakedToken.changeSlashingPercentage(slashingPercentage)
                await expect(tx).to.revertedWith("Only governor can execute")
            })
            it("non recollateralisation module to recollateralisation", async () => {
                await stakedToken.connect(sa.governor.signer).changeSlashingPercentage(slashingPercentage)
                const tx = stakedToken.connect(sa.default.signer).emergencyRecollateralisation()
                await expect(tx).to.revertedWith("Only Recollateralisation Module")
            })
            it("governor to recollateralisation", async () => {
                await stakedToken.connect(sa.governor.signer).changeSlashingPercentage(slashingPercentage)
                const tx = stakedToken.connect(sa.governor.signer).emergencyRecollateralisation()
                await expect(tx).to.revertedWith("Only Recollateralisation Module")
            })
            it("a second recollateralisation", async () => {
                await stakedToken.connect(sa.governor.signer).changeSlashingPercentage(slashingPercentage)
                await stakedToken.connect(sa.mockRecollateraliser.signer).emergencyRecollateralisation()

                const tx = stakedToken.connect(sa.mockRecollateraliser.signer).emergencyRecollateralisation()
                await expect(tx).to.revertedWith("Only while fully collateralised")
            })
        })
    })

    // '''..................................................................'''
    // '''.................    QUESTING & MULTIPLIERS    ...................'''
    // '''..................................................................'''

    // TODO - test startTime and seasonEpoch
    context("questManager", () => {
        context("adding staked token", () => {
            before(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
            })
            it("should fail if address 0", async () => {
                const tx = questManager.connect(sa.governor.signer).addStakedToken(ZERO_ADDRESS)
                await expect(tx).to.revertedWith("Invalid StakedToken")
            })
            it("should fail if not governor", async () => {
                const tx = questManager.addStakedToken(sa.mockInterestValidator.address)
                await expect(tx).to.revertedWith("Only governor can execute")
            })
            it("should fail if quest master", async () => {
                const tx = questManager.connect(sa.questMaster.signer).addStakedToken(sa.mockInterestValidator.address)
                await expect(tx).to.revertedWith("Only governor can execute")
            })
            it("should fail if quest signer", async () => {
                const tx = questManager.connect(sa.questSigner.signer).addStakedToken(sa.mockInterestValidator.address)
                await expect(tx).to.revertedWith("Only governor can execute")
            })
            it("should allow governor to add staked token", async () => {
                const tx = await questManager.connect(sa.governor.signer).addStakedToken(sa.mockInterestValidator.address)
                await expect(tx).to.emit(questManager, "StakedTokenAdded").withArgs(sa.mockInterestValidator.address)
            })
        })
        context("add quest", () => {
            const stakedAmount = simpleToExactAmount(5000)
            before(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
            })
            let id = 0
            it("should allow governor to add a seasonal quest", async () => {
                const multiplier = 20 // 1.2x
                const expiry = deployTime.add(ONE_WEEK.mul(12))
                const tx = await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, multiplier, expiry)

                await expect(tx)
                    .to.emit(questManager, "QuestAdded")
                    .withArgs(sa.governor.address, 0, QuestType.SEASONAL, multiplier, QuestStatus.ACTIVE, expiry)

                const quest = await questManager.getQuest(id)
                expect(quest.model).to.eq(QuestType.SEASONAL)
                expect(quest.multiplier).to.eq(multiplier)
                expect(quest.status).to.eq(QuestStatus.ACTIVE)
                expect(quest.expiry).to.eq(expiry)
            })
            it("should allow governor to add a permanent quest", async () => {
                id += 1
                const multiplier = 40 // 1.4x
                const expiry = deployTime.add(ONE_WEEK.mul(26))
                const tx = await questManager.connect(sa.governor.signer).addQuest(QuestType.PERMANENT, multiplier, expiry)

                await expect(tx)
                    .to.emit(questManager, "QuestAdded")
                    .withArgs(sa.governor.address, 1, QuestType.PERMANENT, multiplier, QuestStatus.ACTIVE, expiry)

                const quest = await questManager.getQuest(id)
                expect(quest.model).to.eq(QuestType.PERMANENT)
                expect(quest.multiplier).to.eq(multiplier)
                expect(quest.status).to.eq(QuestStatus.ACTIVE)
                expect(quest.expiry).to.eq(expiry)
            })
            context("should allow governor to add", () => {
                it("quest with 1.01x multiplier", async () => {
                    await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 1, deployTime.add(ONE_WEEK.mul(12)))
                })
                it("quest with 50x multiplier", async () => {
                    await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 50, deployTime.add(ONE_WEEK.mul(12)))
                })
                it("quest with 1 day expiry", async () => {
                    const currentTime = await getTimestamp()
                    await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, currentTime.add(ONE_DAY).add(2))
                })
            })
            context("should not add quest", () => {
                const multiplier = 10 // 1.1x
                it("from deployer account", async () => {
                    await expect(questManager.addQuest(QuestType.SEASONAL, multiplier, deployTime.add(ONE_WEEK))).to.revertedWith(
                        "Not verified",
                    )
                })
                it("with < 1 day expiry", async () => {
                    await expect(
                        questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, multiplier, deployTime.add(ONE_DAY).sub(60)),
                    ).to.revertedWith("Quest window too small")
                })
                it("with 0 multiplier", async () => {
                    await expect(
                        questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 0, deployTime.add(ONE_WEEK)),
                    ).to.revertedWith("Quest multiplier too large > 1.5x")
                })
                it("with > 1.5x multiplier", async () => {
                    await expect(
                        questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 51, deployTime.add(ONE_WEEK)),
                    ).to.revertedWith("Quest multiplier too large > 1.5x")
                })
                // NOTE - this is max uint8. Stops irresponsible quests being added
                it("if it will push multiplier over 2.5x")
            })
        })
        context("expire quest", () => {
            let expiry: BN
            before(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                expiry = deployTime.add(ONE_WEEK.mul(12))
            })
            it("should allow governor to expire a seasonal quest", async () => {
                const tx0 = await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, expiry)
                const receipt = await tx0.wait()
                const { id } = receipt.events[0].args
                const currentTime = await getTimestamp()
                const tx = await questManager.connect(sa.governor.signer).expireQuest(id)

                await expect(tx).to.emit(questManager, "QuestExpired").withArgs(id)

                const quest = await questManager.getQuest(id)
                expect(quest.status, "status after").to.eq(QuestStatus.EXPIRED)
                expect(quest.expiry, "expiry after").to.eq(currentTime.add(1))
            })
            it("should allow quest master to expire a permanent quest", async () => {
                const tx0 = await questManager.connect(sa.questMaster.signer).addQuest(QuestType.PERMANENT, 10, expiry)
                const receipt = await tx0.wait()
                const { id } = receipt.events[0].args
                const currentTime = await getTimestamp()
                const tx = await questManager.connect(sa.governor.signer).expireQuest(id)

                await expect(tx).to.emit(questManager, "QuestExpired").withArgs(id)

                const quest = await questManager.getQuest(id)
                expect(quest.status, "status after").to.eq(QuestStatus.EXPIRED)
                expect(quest.expiry, "expiry after").to.eq(currentTime.add(1))
            })
            it("expired quest can no longer be completed", async () => {
                const tx0 = await questManager.connect(sa.questMaster.signer).addQuest(QuestType.PERMANENT, 10, expiry)
                const receipt = await tx0.wait()
                const { id } = receipt.events[0].args
                await questManager.connect(sa.governor.signer).expireQuest(id)

                const signature = await signUserQuests(sa.dummy1.address, [id], sa.questSigner.signer)
                const tx = questManager.connect(sa.default.signer).completeUserQuests(sa.dummy1.address, [id], signature)
                await expect(tx).revertedWith("Err: Invalid Quest")
            })
            it("should expire quest after expiry", async () => {
                const tx0 = await questManager.connect(sa.governor.signer).addQuest(QuestType.PERMANENT, 5, expiry)
                const receipt = await tx0.wait()
                const { id } = receipt.events[0].args
                await increaseTime(ONE_WEEK.mul(13))

                const tx = await questManager.connect(sa.governor.signer).expireQuest(id)

                await expect(tx).to.emit(questManager, "QuestExpired").withArgs(id)

                const quest = await questManager.getQuest(id)
                expect(quest.status, "status after").to.eq(QuestStatus.EXPIRED)
                expect(quest.expiry, "expiry after").to.eq(expiry)
            })
            context("should fail to expire quest", () => {
                let id: number
                before(async () => {
                    ;({ stakedToken, questManager } = await redeployStakedToken())
                    expiry = deployTime.add(ONE_WEEK.mul(12))
                    const tx = await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, expiry)
                    const receipt = await tx.wait()
                    id = receipt.events[0].args.id
                })
                it("from deployer", async () => {
                    await expect(questManager.expireQuest(id)).to.revertedWith("Not verified")
                })
                it("from quest signer", async () => {
                    await expect(questManager.connect(sa.questSigner.signer).expireQuest(id)).to.revertedWith("Not verified")
                })
                it("with id does not exists", async () => {
                    await expect(questManager.connect(sa.governor.signer).expireQuest(id + 1)).to.revertedWith("Quest does not exist")
                })
                it("that has already been expired", async () => {
                    await questManager.connect(sa.governor.signer).expireQuest(id)
                    await expect(questManager.connect(sa.governor.signer).expireQuest(id)).to.revertedWith("Quest already expired")
                })
            })
        })
        context("start season", () => {
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                const expiry = deployTime.add(ONE_WEEK.mul(12))
                await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, expiry)
                await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 11, expiry)
                expect(await questManager.startTime(), "season epoch before").to.gt(deployTime)
                expect(await questManager.seasonEpoch(), "season epoch before").to.eq(0)
            })
            it("should allow governor to start season after 39 weeks", async () => {
                await increaseTime(ONE_WEEK.mul(39).add(60))
                const tx = await questManager.connect(sa.governor.signer).startNewQuestSeason()
                await expect(tx).to.emit(questManager, "QuestSeasonEnded")
                const currentTime = await getTimestamp()
                expect(await questManager.seasonEpoch(), "season epoch after").to.eq(currentTime)
            })
            context("should fail to start season", () => {
                it("from deployer", async () => {
                    const tx = questManager.startNewQuestSeason()
                    await expect(tx).to.revertedWith("Not verified")
                })
                it("should fail if called within 39 weeks of the startTime", async () => {
                    await increaseTime(ONE_WEEK.mul(39).sub(60))
                    const tx = questManager.connect(sa.governor.signer).startNewQuestSeason()
                    await expect(tx).revertedWith("First season has not elapsed")
                })
                it("before 39 week from last season", async () => {
                    await increaseTime(ONE_WEEK.mul(39).add(60))
                    await questManager.connect(sa.governor.signer).startNewQuestSeason()
                    const newSeasonStart = await getTimestamp()
                    await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, newSeasonStart.add(ONE_WEEK.mul(39)))

                    await increaseTime(ONE_WEEK.mul(39).sub(60))
                    const tx = questManager.connect(sa.governor.signer).startNewQuestSeason()
                    await expect(tx).to.revertedWith("Season has not elapsed")
                })
                it("if there are still active quests", async () => {
                    await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 12, deployTime.add(ONE_WEEK.mul(40)))
                    await increaseTime(ONE_WEEK.mul(39).add(60))
                    const tx = questManager.connect(sa.governor.signer).startNewQuestSeason()
                    await expect(tx).to.revertedWith("All seasonal quests must have expired")
                })
            })
        })
        context("questMaster", () => {
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                expect(await questManager.questMaster(), "quest master before").to.eq(sa.questMaster.address)
            })
            it("should set questMaster by governor", async () => {
                const tx = await questManager.connect(sa.governor.signer).setQuestMaster(sa.dummy1.address)
                await expect(tx).to.emit(questManager, "QuestMaster").withArgs(sa.questMaster.address, sa.dummy1.address)
                expect(await questManager.questMaster(), "quest master after").to.eq(sa.dummy1.address)
            })
            it("should set questMaster by quest master", async () => {
                const tx = await questManager.connect(sa.questMaster.signer).setQuestMaster(sa.dummy2.address)
                await expect(tx).to.emit(questManager, "QuestMaster").withArgs(sa.questMaster.address, sa.dummy2.address)
                expect(await questManager.questMaster(), "quest master after").to.eq(sa.dummy2.address)
            })
            it("should fail to set quest master by anyone", async () => {
                await expect(questManager.connect(sa.dummy3.signer).setQuestMaster(sa.dummy3.address)).to.revertedWith("Not verified")
            })
        })
        context("questSigner", () => {
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
            })
            it("should set quest signer by governor", async () => {
                const tx = await questManager.connect(sa.governor.signer).setQuestSigner(sa.dummy1.address)
                await expect(tx).to.emit(questManager, "QuestSigner").withArgs(sa.questSigner.address, sa.dummy1.address)
            })
            it("should fail to set quest signer by quest master", async () => {
                await expect(questManager.connect(sa.questMaster.signer).setQuestSigner(sa.dummy3.address)).to.revertedWith(
                    "Only governor can execute",
                )
            })
            it("should fail to set quest signer by anyone", async () => {
                await expect(questManager.connect(sa.dummy3.signer).setQuestSigner(sa.dummy3.address)).to.revertedWith(
                    "Only governor can execute",
                )
            })
        })
    })

    context("questing and multipliers", () => {
        context("completeQuestusers", () => {
            it("should require valid signature")
            it("should require valid questId")
            it("should require account list")
        })
        // TODO - should update lastActiontime after quest completion
        context("complete user quests", () => {
            let stakedTime
            let permanentQuestId: BN
            let seasonQuestId: BN
            const permanentMultiplier = 10
            const seasonMultiplier = 20
            const stakedAmount = simpleToExactAmount(5000)
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
                stakedTime = await getTimestamp()

                await increaseTime(ONE_WEEK.mul(39).add(1))
                await questManager.connect(sa.governor.signer).startNewQuestSeason()

                const expiry = (await getTimestamp()).add(ONE_WEEK.mul(12))
                await questManager.connect(sa.governor.signer).addQuest(QuestType.PERMANENT, permanentMultiplier, expiry)
                const tx = await questManager.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, seasonMultiplier, expiry)
                const receipt = await tx.wait()
                seasonQuestId = receipt.events[0].args.id
                permanentQuestId = seasonQuestId.sub(1)
                await increaseTime(ONE_DAY)
            })
            it("should allow quest signer to complete a user's seasonal quest", async () => {
                const userAddress = sa.default.address
                expect(await questManager.hasCompleted(userAddress, seasonQuestId), "quest completed before").to.be.false

                // Complete User Season Quest
                const signature = await signUserQuests(userAddress, [seasonQuestId], sa.questSigner.signer)
                const tx = await questManager.connect(sa.default.signer).completeUserQuests(userAddress, [seasonQuestId], signature)

                const completeTime = await getTimestamp()
                // Check events
                await expect(tx).to.emit(questManager, "QuestCompleteQuests").withArgs(userAddress, [seasonQuestId])

                // Check data
                expect(await questManager.hasCompleted(userAddress, seasonQuestId), "quest completed after").to.be.true
                const userDataAfter = await snapshotUserStakingData(userAddress)
                expect(userDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                expect(userDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
                expect(userDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                expect(userDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTime)
                expect(userDataAfter.questBalance.lastAction, "last action after").to.eq(completeTime)
                expect(userDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(0)
                expect(userDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(seasonMultiplier)
                expect(userDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(30)
                const expectedBalance = stakedAmount
                    .mul(100 + seasonMultiplier)
                    .div(100)
                    .mul(130)
                    .div(100)
                expect(userDataAfter.stakedBalance, "staked balance after").to.eq(expectedBalance)
                expect(userDataAfter.votes, "votes after").to.eq(expectedBalance)
            })
            it("should allow quest signer to complete a user's permanent quest", async () => {
                const userAddress = sa.default.address
                expect(await questManager.hasCompleted(userAddress, permanentQuestId), "quest completed before").to.be.false

                // Complete User Permanent Quest
                const signature = await signUserQuests(userAddress, [permanentQuestId], sa.questSigner.signer)
                const tx = await questManager.connect(sa.questSigner.signer).completeUserQuests(userAddress, [permanentQuestId], signature)
                const completeTime = await getTimestamp()

                // Check events
                await expect(tx).to.emit(questManager, "QuestCompleteQuests").withArgs(userAddress, [permanentQuestId])
                // Check data
                expect(await questManager.hasCompleted(userAddress, permanentQuestId), "quest completed after").to.be.true
                const userDataAfter = await snapshotUserStakingData(userAddress)
                expect(userDataAfter.userBalances.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                expect(userDataAfter.userBalances.cooldownUnits, "cooldown units after").to.eq(0)
                expect(userDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                expect(userDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTime)
                expect(userDataAfter.questBalance.lastAction, "last action after").to.eq(completeTime)
                expect(userDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(permanentMultiplier)
                expect(userDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(0)
                expect(userDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(30)
                const expectedBalance = stakedAmount
                    .mul(100 + permanentMultiplier)
                    .div(100)
                    .mul(130)
                    .div(100)
                expect(userDataAfter.stakedBalance, "staked balance after").to.eq(expectedBalance)
                expect(userDataAfter.votes, "votes after").to.eq(expectedBalance)
            })
            it("should complete user quest before a user stakes", async () => {
                const userAddress = sa.dummy1.address
                expect(await questManager.hasCompleted(userAddress, permanentQuestId), "quest completed before").to.be.false

                // Complete User Permanent and Seasonal Quests
                const signature = await signUserQuests(userAddress, [permanentQuestId, seasonQuestId], sa.questSigner.signer)
                const tx = await questManager
                    .connect(sa.questSigner.signer)
                    .completeUserQuests(userAddress, [permanentQuestId, seasonQuestId], signature)

                const completeQuestTimestamp = await getTimestamp()

                // Check events
                await expect(tx).to.emit(questManager, "QuestCompleteQuests").withArgs(userAddress, [permanentQuestId, seasonQuestId])

                // Check data
                expect(await questManager.hasCompleted(userAddress, permanentQuestId), "quest completed after").to.be.true
                const userDataAfter = await snapshotUserStakingData(userAddress)
                expect(userDataAfter.userBalances.raw, "staked raw balance after").to.eq(0)
                expect(userDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(0)
                expect(userDataAfter.questBalance.lastAction, "last action after").to.eq(completeQuestTimestamp)
                expect(userDataAfter.questBalance.permMultiplier, "perm multiplier after").to.eq(permanentMultiplier)
                expect(userDataAfter.questBalance.seasonMultiplier, "season multiplier after").to.eq(seasonMultiplier)
                expect(userDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                expect(userDataAfter.stakedBalance, "staked balance after").to.eq(0)
                expect(userDataAfter.votes, "votes after").to.eq(0)
            })
            it("should complete a quest for 4 users", async () => {
                const user1Address = sa.dummy1.address
                const user2Address = sa.dummy2.address
                const user3Address = sa.dummy3.address
                const user4Address = sa.dummy4.address
                expect(await questManager.hasCompleted(user1Address, permanentQuestId), "user 1 quest completed before").to.be.false
                expect(await questManager.hasCompleted(user2Address, permanentQuestId), "user 2 quest completed before").to.be.false
                expect(await questManager.hasCompleted(user3Address, permanentQuestId), "user 3 quest completed before").to.be.false
                expect(await questManager.hasCompleted(user4Address, permanentQuestId), "user 4 quest completed before").to.be.false

                // Complete User Permanent and Seasonal Quests
                const signature = await signQuestUsers(
                    permanentQuestId,
                    [user1Address, user2Address, user3Address, user4Address],
                    sa.questSigner.signer,
                )
                const tx = await questManager
                    .connect(sa.questSigner.signer)
                    .completeQuestUsers(permanentQuestId, [user1Address, user2Address, user3Address, user4Address], signature)

                const completeQuestTimestamp = await getTimestamp()

                // Check events
                await expect(tx)
                    .to.emit(questManager, "QuestCompleteUsers")
                    .withArgs(permanentQuestId, [user1Address, user2Address, user3Address, user4Address])

                // Check data
                expect(await questManager.hasCompleted(user1Address, permanentQuestId), "user 1 quest completed after").to.be.true
                expect(await questManager.hasCompleted(user2Address, permanentQuestId), "user 2 quest completed after").to.be.true
                const user1DataAfter = await snapshotUserStakingData(user1Address)
                expect(user1DataAfter.questBalance.lastAction, "user 1 last action after").to.eq(completeQuestTimestamp)
                expect(user1DataAfter.questBalance.permMultiplier, "user 1 perm multiplier after").to.eq(permanentMultiplier)
                expect(user1DataAfter.questBalance.seasonMultiplier, "user 1 season multiplier after").to.eq(0)
                const user2DataAfter = await snapshotUserStakingData(user2Address)
                expect(user2DataAfter.questBalance.lastAction, "user 2 last action after").to.eq(completeQuestTimestamp)
                expect(user2DataAfter.questBalance.permMultiplier, "user 2 perm multiplier after").to.eq(permanentMultiplier)
                expect(user2DataAfter.questBalance.seasonMultiplier, "user 2 season multiplier after").to.eq(0)
            })
            it("should fail to complete a user quest again", async () => {
                const userAddress = sa.dummy2.address
                const signature = await signUserQuests(userAddress, [permanentQuestId], sa.questSigner.signer)
                await questManager.connect(sa.questSigner.signer).completeUserQuests(userAddress, [permanentQuestId], signature)
                await expect(
                    questManager.connect(sa.questSigner.signer).completeUserQuests(userAddress, [permanentQuestId], signature),
                ).to.revertedWith("Err: Already Completed")
            })
            it("should fail a user signing quest completion", async () => {
                const userAddress = sa.dummy3.address
                const signature = await signUserQuests(userAddress, [permanentQuestId], sa.dummy3.signer)
                await expect(
                    questManager.connect(sa.dummy3.signer).completeUserQuests(userAddress, [permanentQuestId], signature),
                ).to.revertedWith("Invalid Quest Signer Signature")
                // TODO - check for completeQuestUsers
            })
            // e.g. wrong quest ID
            // TODO - for both types of completion
            it("should propagate quest completion to all stakedTokens", async () => {})
            it("should fail if the signature is invalid")
            it("should fail if the signature is for a different account")
            it("should fail if the signature is too long or short")
        })
        context("time multiplier", () => {
            let stakerDataBefore: UserStakingData
            let anySigner: Signer
            const stakedAmount = simpleToExactAmount(5000)
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)

                anySigner = sa.dummy4.signer
            })
            it("staker data just after stake", async () => {
                stakerDataBefore = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataBefore.userBalances.timeMultiplier).to.eq(0)
                expect(stakerDataBefore.userBalances.raw).to.eq(stakedAmount)
                expect(stakerDataBefore.votes).to.eq(stakedAmount)
                expect(stakerDataBefore.stakedBalance).to.eq(stakedAmount)
            })
            const runs = [
                { weeks: 13, multiplierBefore: BN.from(0), multiplierAfter: BN.from(20) },
                { weeks: 26, multiplierBefore: BN.from(20), multiplierAfter: BN.from(30) },
                { weeks: 52, multiplierBefore: BN.from(30), multiplierAfter: BN.from(40) },
                { weeks: 78, multiplierBefore: BN.from(40), multiplierAfter: BN.from(50) },
                { weeks: 104, multiplierBefore: BN.from(50), multiplierAfter: BN.from(60) },
                { weeks: 312, multiplierBefore: BN.from(60), multiplierAfter: BN.from(60) },
            ]
            runs.forEach((run) => {
                it(`anyone can review timestamp before ${run.weeks} weeks`, async () => {
                    await increaseTime(ONE_WEEK.mul(run.weeks).sub(60))

                    if (run.multiplierBefore.eq(0)) {
                        await expect(stakedToken.connect(anySigner).reviewTimestamp(sa.default.address)).to.revertedWith(
                            "Nothing worth poking here",
                        )
                    } else {
                        await stakedToken.connect(anySigner).reviewTimestamp(sa.default.address)
                    }

                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "timeMultiplier after").to.eq(run.multiplierBefore)
                    expect(stakerDataAfter.userBalances.raw, "raw balance after").to.eq(stakedAmount)
                    // balance = staked amount * (100 + time multiplier) / 100
                    const expectedBalance = stakedAmount.mul(run.multiplierBefore.add(100)).div(100)
                    expect(stakerDataAfter.votes, "votes after").to.eq(expectedBalance)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(expectedBalance)
                })
                it(`anyone can review timestamp after ${run.weeks} weeks`, async () => {
                    await increaseTime(ONE_WEEK.mul(run.weeks).add(60))

                    await stakedToken.connect(anySigner).reviewTimestamp(sa.default.address)

                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "timeMultiplier after").to.eq(run.multiplierAfter)
                    expect(stakerDataAfter.userBalances.raw, "raw balance after").to.eq(stakedAmount)
                    // balance = staked amount * (100 + time multiplier) / 100
                    const expectedBalance = stakedAmount.mul(run.multiplierAfter.add(100)).div(100)
                    expect(stakerDataAfter.votes, "votes after").to.eq(expectedBalance)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(expectedBalance)
                })
            })
        })
        context("multiple multipliers", () => {
            const quests: { type: QuestType; multiplier: number; weeks: number }[] = [
                { type: QuestType.PERMANENT, multiplier: 12, weeks: 12 },
                { type: QuestType.PERMANENT, multiplier: 22, weeks: 4 },
                { type: QuestType.SEASONAL, multiplier: 5, weeks: 6 },
                { type: QuestType.SEASONAL, multiplier: 8, weeks: 10 },
            ]
            const stakedAmount = simpleToExactAmount(5000)
            beforeEach(async () => {
                ;({ stakedToken, questManager } = await redeployStakedToken())

                const questStart = await getTimestamp()
                for (const quest of quests) {
                    await questManager
                        .connect(sa.governor.signer)
                        .addQuest(quest.type, quest.multiplier, questStart.add(ONE_WEEK.mul(quest.weeks)))
                }

                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
            })
            const runs: {
                desc: string
                weeks: number
                completedQuests: number[]
                cooldown?: {
                    start: number
                    end?: number
                    units: BN
                }
                timeMultiplier?: number
                permMultiplier?: number
                seasonMultiplier?: number
                cooldownUnits?: BN
                reviewTimestamp?: boolean
                endCooldown?: boolean
            }[] = [
                { desc: "no multipliers", weeks: 1, completedQuests: [] },
                {
                    desc: "all quests before 13 weeks",
                    weeks: 2,
                    completedQuests: [0, 1, 2, 3],
                    timeMultiplier: 0,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                },
                {
                    desc: "all quests after 13 weeks",
                    weeks: 14,
                    completedQuests: [0, 1, 2, 3],
                    timeMultiplier: 20,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                    reviewTimestamp: true,
                },
                {
                    desc: "only perm quests after 27 weeks",
                    weeks: 27,
                    completedQuests: [0, 1],
                    timeMultiplier: 30,
                    permMultiplier: 34,
                    seasonMultiplier: 0,
                    reviewTimestamp: true,
                },
                {
                    desc: "only season quests after 55 weeks",
                    weeks: 55,
                    completedQuests: [2, 3],
                    timeMultiplier: 40,
                    permMultiplier: 0,
                    seasonMultiplier: 13,
                    reviewTimestamp: true,
                },
                {
                    desc: "no quests, 10 weeks, in 100% cooldown",
                    weeks: 10,
                    completedQuests: [],
                    cooldown: {
                        start: 8,
                        units: stakedAmount,
                    },
                    timeMultiplier: 0,
                    permMultiplier: 0,
                    seasonMultiplier: 0,
                    cooldownUnits: stakedAmount,
                },
                {
                    desc: "no quests, 11 weeks, out of 100% cooldown, not ended",
                    weeks: 11,
                    completedQuests: [],
                    cooldown: {
                        start: 8,
                        units: stakedAmount,
                    },
                    timeMultiplier: 0,
                    permMultiplier: 0,
                    seasonMultiplier: 0,
                    cooldownUnits: stakedAmount,
                },
                {
                    desc: "no quests, 11 weeks, out of 100% cooldown, ended",
                    weeks: 11,
                    completedQuests: [],
                    cooldown: {
                        start: 8,
                        units: stakedAmount,
                    },
                    timeMultiplier: 0,
                    permMultiplier: 0,
                    seasonMultiplier: 0,
                    endCooldown: true,
                },
                {
                    desc: "no quests, 11 weeks, 100% cooldown ended",
                    weeks: 11,
                    completedQuests: [],
                    cooldown: {
                        start: 8,
                        units: stakedAmount,
                        end: 10,
                    },
                    timeMultiplier: 0,
                    permMultiplier: 0,
                    seasonMultiplier: 0,
                },
                {
                    desc: "all quests, 20 weeks, in 20% cooldown",
                    weeks: 20,
                    completedQuests: [0, 1, 2, 3],
                    cooldown: {
                        start: 19,
                        units: stakedAmount.div(5),
                    },
                    timeMultiplier: 20,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                    cooldownUnits: stakedAmount.div(5),
                },
                {
                    desc: "all quests, 23 weeks, after 30% cooldown, not ended",
                    weeks: 23,
                    completedQuests: [0, 1, 2, 3],
                    cooldown: {
                        start: 19,
                        units: stakedAmount.mul(3).div(10),
                    },
                    timeMultiplier: 20,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                    cooldownUnits: stakedAmount.mul(3).div(10),
                },
                {
                    desc: "all quests, 23 weeks, after 30% cooldown, ended",
                    weeks: 23,
                    completedQuests: [0, 1, 2, 3],
                    cooldown: {
                        start: 19,
                        units: stakedAmount.mul(3).div(10),
                    },
                    timeMultiplier: 20,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                    endCooldown: true,
                },
                {
                    desc: "all quests, 24 weeks, after 20% cooldown ended",
                    weeks: 24,
                    completedQuests: [0, 1, 2, 3],
                    cooldown: {
                        start: 19,
                        end: 23,
                        units: stakedAmount.div(5),
                    },
                    timeMultiplier: 20,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                },
            ]
            runs.forEach((run) => {
                it(run.desc, async () => {
                    const user = sa.default.address
                    if (run.completedQuests.length) {
                        const signature = await signUserQuests(user, run.completedQuests, sa.questSigner.signer)
                        await questManager.completeUserQuests(user, run.completedQuests, signature)
                    }

                    if (run.cooldown?.start) {
                        await increaseTime(ONE_WEEK.mul(run.cooldown.start))
                        await stakedToken.startCooldown(run.cooldown.units)

                        if (run.cooldown.end) {
                            await increaseTime(ONE_WEEK.mul(run.weeks - run.cooldown.end))
                            await stakedToken.endCooldown()
                            await increaseTime(ONE_WEEK.mul(run.weeks - run.cooldown.end))
                        } else {
                            await increaseTime(ONE_WEEK.mul(run.weeks - run.cooldown.start))
                        }
                    } else {
                        await increaseTime(ONE_WEEK.mul(run.weeks))
                    }

                    if (run.reviewTimestamp) {
                        await stakedToken.reviewTimestamp(user)
                    }
                    if (run.endCooldown) {
                        await stakedToken.endCooldown()
                    }

                    const timeMultiplierExpected = BN.from(run.timeMultiplier || 0)
                    const permMultiplierExpected = BN.from(run.permMultiplier || 0)
                    const seasonMultiplierExpected = BN.from(run.seasonMultiplier || 0)
                    const cooldownUnitsExpected = run.cooldownUnits || 0

                    const rawBalanceExpected = stakedAmount.sub(cooldownUnitsExpected)
                    const questBalanceExpected = rawBalanceExpected
                        .mul(permMultiplierExpected.add(seasonMultiplierExpected).add(100))
                        .div(100)
                    const balanceExpected = questBalanceExpected.mul(timeMultiplierExpected.add(100)).div(100)

                    const stakerDataAfter = await snapshotUserStakingData(user)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "timeMultiplier After").to.eq(timeMultiplierExpected)
                    expect(stakerDataAfter.questBalance.permMultiplier, "permMultiplier After").to.eq(permMultiplierExpected)
                    expect(stakerDataAfter.questBalance.seasonMultiplier, "seasonMultiplier After").to.eq(seasonMultiplierExpected)
                    expect(stakerDataAfter.userBalances.cooldownUnits, "cooldownUnits After").to.eq(cooldownUnitsExpected)
                    expect(stakerDataAfter.userBalances.raw, "raw balance after").to.eq(rawBalanceExpected)
                    expect(stakerDataAfter.votes, "votes after").to.eq(balanceExpected)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(balanceExpected)
                })
            })
        })
        // Important that each action (checkTimestamp, completeQuest, mint) applies this because
        // scaledBalance could actually decrease, even in these situations, since old seasonMultipliers are slashed
        context("in a new season", () => {
            it("should slash an old seasons reward on any action")
        })
        it("should always keep totalSupply == sum(boostedBalances)")
        it("should update total votingPower, totalSupply, etc, retroactively")
    })

    context("claiming rewards after season finish", () => {
        it("should update the users scaled balance and multiplier")
    })

    context("reviewing timestamp and completing quests with no stake", () => {
        it("should do nothing")
        it("should not result in unfair advantages somehow")
    })

    // '''..................................................................'''
    // '''......................    VOTINGTOKEN    .........................'''
    // '''..................................................................'''

    // TODO - consider forking OZ tests https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/master/test/token/ERC20/extensions/ERC20Votes.test.js

    context("maintaining checkpoints and balances", () => {
        // TODO - look up historical checkpoints via `getVotes`, `getPastVotes`, `numCheckpoints` and `checkpoints`
        context("with no delegate", () => {
            // stake, stake again, other stake, partial cooldown, partial withdraw, partial cooldown, stake and exit cooldown, full cooldown, full withdraw
            let stakerAddress
            let otherStakerAddress
            const firstStakedAmount = simpleToExactAmount(1000)
            const secondStakedAmount = simpleToExactAmount(2000)
            const thirdStakedAmount = simpleToExactAmount(3000)
            const firstCooldownAmount = simpleToExactAmount(500)
            const secondCooldownAmount = simpleToExactAmount(2500)
            const thirdCooldownAmount = simpleToExactAmount(5500)

            const firstOtherStakedAmount = simpleToExactAmount(100)
            const blocks: number[] = []
            let totalSupply = BN.from(0)
            let stakerVotes = BN.from(0)
            before(async () => {
                stakerAddress = sa.default.address
                otherStakerAddress = sa.dummy1.address
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(1000000))
                await rewardToken.transfer(otherStakerAddress, simpleToExactAmount(100000))
                await rewardToken.connect(sa.dummy1.signer).approve(stakedToken.address, simpleToExactAmount(1000000))
                const block = await sa.default.signer.provider.getBlock("latest")
                blocks.push(block.number)
            })
            beforeEach(async () => {
                await increaseTime(ONE_WEEK)
                await advanceBlock()
            })
            it("first stake", async () => {
                const tx = await stakedToken["stake(uint256)"](firstStakedAmount)
                const receipt = await tx.wait()
                blocks.push(receipt.blockNumber)

                // Staker Checkpoint
                const stakerCheckpoint = await stakedToken.checkpoints(stakerAddress, 0)
                expect(stakerCheckpoint.fromBlock, "checkpoint block").to.eq(receipt.blockNumber)
                stakerVotes = stakerVotes.add(firstStakedAmount)
                expect(stakerCheckpoint.votes, "checkpoint votes").to.eq(stakerVotes)

                // Total Supply
                totalSupply = totalSupply.add(firstStakedAmount)
                expect(await stakedToken.totalSupply(), "total staked after").to.eq(totalSupply)
            })
            it("second stake", async () => {
                const tx = await stakedToken["stake(uint256)"](secondStakedAmount)
                const receipt = await tx.wait()
                blocks.push(receipt.blockNumber)

                // Staker Checkpoint
                const stakerCheckpoint = await stakedToken.checkpoints(stakerAddress, 1)
                expect(stakerCheckpoint.fromBlock, "checkpoint block").to.eq(receipt.blockNumber)
                stakerVotes = stakerVotes.add(secondStakedAmount)
                expect(stakerCheckpoint.votes, "checkpoint votes").to.eq(stakerVotes)

                // Total Supply
                totalSupply = totalSupply.add(secondStakedAmount)
                expect(await stakedToken.totalSupply(), "total staked after").to.eq(totalSupply)
            })
            it("first stake from other", async () => {
                const tx = await stakedToken.connect(sa.dummy1.signer)["stake(uint256)"](firstOtherStakedAmount)
                const receipt = await tx.wait()
                blocks.push(receipt.blockNumber)

                // Staker Checkpoint
                const stakerCheckpoint = await stakedToken.checkpoints(otherStakerAddress, 0)
                expect(stakerCheckpoint.fromBlock, "checkpoint block").to.eq(receipt.blockNumber)
                expect(stakerCheckpoint.votes, "checkpoint votes").to.eq(firstOtherStakedAmount)

                // Total Supply
                totalSupply = totalSupply.add(firstOtherStakedAmount)
                expect(await stakedToken.totalSupply(), "total staked after").to.eq(totalSupply)
            })
            it("first cooldown partial", async () => {
                const tx = await stakedToken.startCooldown(firstCooldownAmount)
                const receipt = await tx.wait()
                blocks.push(receipt.blockNumber)

                // Staker Checkpoint
                const stakerCheckpoint = await stakedToken.checkpoints(stakerAddress, 2)
                expect(stakerCheckpoint.fromBlock, "checkpoint block").to.eq(receipt.blockNumber)
                stakerVotes = stakerVotes.sub(firstCooldownAmount)
                expect(stakerCheckpoint.votes, "checkpoint votes").to.eq(stakerVotes)

                // Total Supply
                totalSupply = totalSupply.sub(firstCooldownAmount)
                expect(await stakedToken.totalSupply(), "total staked after").to.eq(totalSupply)
            })
            it("first withdraw partial", async () => {
                const tx = await stakedToken.withdraw(firstCooldownAmount, stakerAddress, true, true)
                const receipt = await tx.wait()
                blocks.push(receipt.blockNumber)

                // Not new Staker Checkpoint
                expect(await stakedToken.numCheckpoints(stakerAddress), "checkpoint block").to.eq(3)
                // Total Supply unchanged
                expect(await stakedToken.totalSupply(), "total staked after").to.eq(totalSupply)
            })
            it("second cooldown full", async () => {
                const tx = await stakedToken.startCooldown(secondCooldownAmount)
                const receipt = await tx.wait()
                blocks.push(receipt.blockNumber)

                // Staker Checkpoint
                const stakerCheckpoint = await stakedToken.checkpoints(stakerAddress, 3)
                expect(stakerCheckpoint.fromBlock, "checkpoint block").to.eq(receipt.blockNumber)
                stakerVotes = BN.from(0)
                expect(stakerCheckpoint.votes, "checkpoint votes").to.eq(stakerVotes)

                // Total Supply
                totalSupply = totalSupply.sub(secondCooldownAmount)
                expect(await stakedToken.totalSupply(), "total staked after").to.eq(totalSupply)
            })
            it("third stake and exit cooldown", async () => {
                const tx = await stakedToken["stake(uint256,bool)"](thirdStakedAmount, true)
                const receipt = await tx.wait()
                blocks.push(receipt.blockNumber)

                // Staker Checkpoint
                const stakerCheckpoint = await stakedToken.checkpoints(stakerAddress, 4)
                expect(stakerCheckpoint.fromBlock, "checkpoint block").to.eq(receipt.blockNumber)
                stakerVotes = secondCooldownAmount.add(thirdStakedAmount)
                expect(stakerCheckpoint.votes, "checkpoint votes").to.eq(stakerVotes)

                // Total Supply
                totalSupply = totalSupply.add(secondCooldownAmount).add(thirdStakedAmount)
                expect(await stakedToken.totalSupply(), "total staked after").to.eq(totalSupply)
            })
            it("third cooldown full", async () => {
                const tx = await stakedToken.startCooldown(thirdCooldownAmount)
                const receipt = await tx.wait()
                blocks.push(receipt.blockNumber)

                // Staker Checkpoint
                const stakerCheckpoint = await stakedToken.checkpoints(stakerAddress, 5)
                expect(stakerCheckpoint.fromBlock, "checkpoint block").to.eq(receipt.blockNumber)
                stakerVotes = BN.from(0)
                expect(stakerCheckpoint.votes, "checkpoint votes").to.eq(stakerVotes)

                // Total Supply
                totalSupply = totalSupply.sub(thirdCooldownAmount)
                expect(await stakedToken.totalSupply(), "total staked after").to.eq(totalSupply)
            })
            it("third withdraw full", async () => {
                const tx = await stakedToken.withdraw(thirdCooldownAmount, stakerAddress, true, true)
                const receipt = await tx.wait()
                blocks.push(receipt.blockNumber)

                // Not new Staker Checkpoint
                expect(await stakedToken.numCheckpoints(stakerAddress), "checkpoint block").to.eq(6)
                // Total Supply unchanged
                expect(await stakedToken.totalSupply(), "total staked after").to.eq(totalSupply)
            })

            const assertPastCheckpoint = async (
                action: string,
                blockNumber: number,
                _votesBefore: BN | undefined,
                changeAmount: BN,
                stake = true,
            ): Promise<BN> => {
                const votesBefore = _votesBefore === undefined ? BN.from(0) : _votesBefore
                const votesAfter = stake ? votesBefore.add(changeAmount) : votesBefore.sub(changeAmount)
                if (votesBefore) {
                    expect(await stakedToken.getPastVotes(stakerAddress, blockNumber - 1), `just before ${action}`).to.eq(votesBefore)
                }
                expect(await stakedToken.getPastVotes(stakerAddress, blockNumber), `at ${action}`).to.eq(votesAfter)
                expect(await stakedToken.getPastVotes(stakerAddress, blockNumber + 1), `just after ${action}`).to.eq(votesAfter)

                return votesAfter
            }
            it("past votes", async () => {
                await increaseTime(ONE_WEEK)
                await advanceBlock()

                let votesAfter = await assertPastCheckpoint("staked token deploy", blocks[0], undefined, BN.from(0))
                votesAfter = await assertPastCheckpoint("first stake", blocks[1], votesAfter, firstStakedAmount)
                votesAfter = await assertPastCheckpoint("second stake", blocks[2], votesAfter, secondStakedAmount)
                votesAfter = await assertPastCheckpoint("first other stake", blocks[3], votesAfter, BN.from(0))
                votesAfter = await assertPastCheckpoint("first cooldown partial", blocks[4], votesAfter, firstCooldownAmount, false)
                votesAfter = await assertPastCheckpoint("first withdraw partial", blocks[5], votesAfter, BN.from(0))
                votesAfter = await assertPastCheckpoint("second cooldown full", blocks[6], votesAfter, secondCooldownAmount, false)
                votesAfter = await assertPastCheckpoint(
                    "third stake and exit cooldown",
                    blocks[7],
                    votesAfter,
                    secondCooldownAmount.add(thirdStakedAmount),
                )
                votesAfter = await assertPastCheckpoint("third cooldown full", blocks[8], votesAfter, thirdCooldownAmount, false)
                await assertPastCheckpoint("third withdraw full", blocks[9], votesAfter, BN.from(0))
            })

            const assertPastTotalSupply = async (
                action: string,
                blockNumber: number,
                _supplyBefore: BN | undefined,
                changeAmount: BN,
                stake = true,
            ): Promise<BN> => {
                const supplyBefore = _supplyBefore === undefined ? BN.from(0) : _supplyBefore
                const supplyAfter = stake ? supplyBefore.add(changeAmount) : supplyBefore.sub(changeAmount)
                if (_supplyBefore) {
                    expect(await stakedToken.getPastTotalSupply(blockNumber - 1), `just before ${action}`).to.eq(supplyBefore)
                }
                expect(await stakedToken.getPastTotalSupply(blockNumber), `at ${action}`).to.eq(supplyAfter)
                expect(await stakedToken.getPastTotalSupply(blockNumber + 1), `just after ${action}`).to.eq(supplyAfter)

                return supplyAfter
            }
            it("past total supply", async () => {
                await increaseTime(ONE_WEEK)
                await advanceBlock()

                let afterTotal = await assertPastTotalSupply("staked token deploy", blocks[0], undefined, BN.from(0))
                afterTotal = await assertPastTotalSupply("first stake", blocks[1], afterTotal, firstStakedAmount)
                afterTotal = await assertPastTotalSupply("second stake", blocks[2], afterTotal, secondStakedAmount)
                afterTotal = await assertPastTotalSupply("first other stake", blocks[3], afterTotal, firstOtherStakedAmount)
                afterTotal = await assertPastTotalSupply("first cooldown partial", blocks[4], afterTotal, firstCooldownAmount, false)
                afterTotal = await assertPastTotalSupply("first withdraw partial", blocks[5], afterTotal, BN.from(0), false)
                afterTotal = await assertPastTotalSupply("second cooldown full", blocks[6], afterTotal, secondCooldownAmount, false)
                afterTotal = await assertPastTotalSupply(
                    "third stake and exit cooldown",
                    blocks[7],
                    afterTotal,
                    secondCooldownAmount.add(thirdStakedAmount),
                )
                afterTotal = await assertPastTotalSupply("third cooldown full", blocks[8], afterTotal, thirdCooldownAmount, false)
                await assertPastTotalSupply("third withdraw full", blocks[9], afterTotal, BN.from(0), false)
            })
        })
        context("with delegate", () => {
            // stake, stake again, other stake, partial cooldown, partial withdraw, partial cooldown, stake and exit cooldown, full cooldown, full withdraw
            let stakerAddress
            let otherStakerAddress
            let firstDelegateAddress
            let secondDelegateAddress

            const blocks: number[] = []
            before(async () => {
                stakerAddress = sa.default.address
                otherStakerAddress = sa.dummy1.address
                ;({ stakedToken, questManager } = await redeployStakedToken())
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(1000000))
                await rewardToken.transfer(otherStakerAddress, simpleToExactAmount(100000))
                await rewardToken.connect(sa.dummy1.signer).approve(stakedToken.address, simpleToExactAmount(1000000))
                const block = await sa.default.signer.provider.getBlock("latest")
                blocks.push(block.number)
            })
            beforeEach(async () => {
                await increaseTime(ONE_WEEK)
                await advanceBlock()
            })
            // stake to delegate, stake again to delegate, change delegate, partial withdraw, stake again to delegate, full withdraw
        })
        // stake to self, stake to delegate, change delegate, withdraw, stake
        it("should track users balance as checkpoints")
        it("should maintain totalsupply checkpoints")
    })
    context("triggering the governance hook", () => {
        it("should allow governor to add a governanceHook")
        it("should trigger governanceHook each time voting weight changes")
        // WE should write a mock IGovernanceHook here.. and project how much it's going to cost.
        // If the flow is:
        //  - Look up preferences of the user
        //  - Update their personal balances in each gauge <- can we remove the SSTORES from this step and just use the gain/loss in voting power?
        //  - Update the total balance in each gauge & total overall balance
        // Then it could end up costing ~4 SLOADS and ~2 SSTORES per dial preference, which is >18k per dial (4 dials and we are up to 80k...)
        // This can be optimised as part of the dials release but worth thinking about now.
        it("should not cause a ridiculous amount of extra gas to trigger")
    })

    // '''..................................................................'''
    // '''....................    GAMIFIED TOKEN    ........................'''
    // '''..................................................................'''

    context("calling applyQuestMultiplier", () => {
        it("should fail unless called by questManager")
        it("should do nothing if there is no stake")
        it("should update quest & time multiplier")
    })
})
