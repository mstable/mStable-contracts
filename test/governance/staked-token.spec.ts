import { ethers } from "hardhat"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { MockNexus__factory } from "types/generated/factories/MockNexus__factory"
import { AssetProxy__factory, MockERC20, MockERC20__factory, MockNexus } from "types"
import { StakedToken } from "types/generated/StakedToken"
import { StakedToken__factory } from "types/generated/factories/StakedToken__factory"
import { DEAD_ADDRESS } from "index"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { increaseTime } from "@utils/time"

interface UserStakingData {
    stakedBalance: BN
    votes: BN
    earnedRewards: BN
    stakersCooldown: BN
    rewardsBalance: BN
}

describe("Staked Token", () => {
    // const ctx: Partial<IModuleBehaviourContext> = {}
    let sa: StandardAccounts

    let nexus: MockNexus
    let rewardToken: MockERC20
    let stakedToken: StakedToken

    const redeployStakedToken = async (): Promise<StakedToken> => {
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, 10000000)

        const stakedTokenFactory = await new StakedToken__factory(sa.default.signer)
        const stakedTokenImpl = await stakedTokenFactory.deploy(
            sa.default.address,
            nexus.address,
            rewardToken.address,
            ONE_WEEK,
            rewardToken.address,
            ONE_WEEK,
            ONE_DAY.mul(2),
            ONE_WEEK.mul(4),
        )
        const rewardsDistributorAddress = DEAD_ADDRESS
        const data = stakedTokenImpl.interface.encodeFunctionData("initialize", ["Staked Rewards", "stkRWD", rewardsDistributorAddress])
        const stakedTokenProxy = await new AssetProxy__factory(sa.default.signer).deploy(stakedTokenImpl.address, DEAD_ADDRESS, data)

        return stakedTokenFactory.attach(stakedTokenProxy.address)
    }

    const snapshotUserStakingData = async (user = sa.default): Promise<UserStakingData> => {
        const stakedBalance = await stakedToken.balanceOf(user.address)
        const votes = await stakedToken.getVotes(user.address)
        const earnedRewards = await stakedToken.earned(user.address)
        const stakersCooldown = await stakedToken.stakersCooldowns(user.address)
        const rewardsBalance = await rewardToken.balanceOf(user.address)

        return {
            stakedBalance,
            votes,
            earnedRewards,
            stakersCooldown,
            rewardsBalance,
        }
    }

    before("Create Contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
    })

    // shouldBehaveLikeModule(ctx as Required<typeof ctx>)

    context("deploy and initialize", () => {
        before(async () => {
            stakedToken = await redeployStakedToken()
        })
        it("post initialize", async () => {
            expect(await stakedToken.name()).to.eq("Staked Rewards")
            expect(await stakedToken.symbol()).to.eq("stkRWD")
            expect(await stakedToken.decimals()).to.eq(18)
            expect(await stakedToken.rewardsDistributor()).to.eq(DEAD_ADDRESS)
        })
    })

    context("staking and delegating", () => {
        const stakedAmount = simpleToExactAmount(1000)
        beforeEach(async () => {
            stakedToken = await redeployStakedToken()
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount.mul(3))

            expect(await stakedToken.balanceOf(sa.default.address), "staker stkRWD before").to.eq(0)
            expect(await stakedToken.getVotes(sa.default.address), "staker votes before").to.eq(0)
            expect(await stakedToken.balanceOf(sa.dummy1.address)).to.eq(0)
            expect(await stakedToken.balanceOf(sa.dummy1.address), "delegate stkRWD before").to.eq(0)
            expect(await stakedToken.getVotes(sa.dummy1.address), "delegate votes before").to.eq(0)
            expect(await stakedToken.totalSupply(), "total staked before").to.eq(0)
        })
        it("should delegate to self by default", async () => {
            const tx = await stakedToken["stake(uint256)"](stakedAmount)
            await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, stakedAmount, ZERO_ADDRESS)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").not
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, 0, stakedAmount)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, stakedAmount)

            const afterData = await snapshotUserStakingData(sa.default)
            expect(afterData.stakedBalance, "staker stkRWD after").to.eq(stakedAmount)
            expect(afterData.votes, "staker votes after").to.eq(stakedAmount)
            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount)
        })
        it("should assign delegate", async () => {
            const tx = await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, stakedAmount, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").not
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, 0, stakedAmount)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, stakedAmount)

            const afterStakerData = await snapshotUserStakingData(sa.default)
            expect(afterStakerData.stakedBalance, "staker stkRWD after").to.eq(stakedAmount)
            expect(afterStakerData.votes, "staker votes after").to.eq(0)
            const afterDelegateData = await snapshotUserStakingData(sa.dummy1)
            expect(afterDelegateData.stakedBalance, "delegate stkRWD after").to.eq(0)
            expect(afterDelegateData.votes, "delegate votes after").to.eq(stakedAmount)
            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount)
        })
    })

    context("change delegate votes", () => {})

    context("withdraw staked tokens", () => {
        it("should extend the cooldown timer proportionately")
    })

    context("boosting", () => {
        it("should apply a multiplier if the user stakes within the migration window")
        it("should apply the multiplier to voting power but not raw balance")
        it("should update total votingPower, totalSupply, etc, retroactively")
    })

    context("questing and multipliers", () => {
        it("should allow an admin to add a seasonal quest")
        it("should allow a user to complete a seasonal quest with verification")
        it("should increase a users voting power when they complete said quest")
        it("should allow an admin to end the quest season")
        // Important that each action (checkTimestamp, completeQuest, mint) applies this because
        // scaledBalance could actually decrease, even in these situations, since old seasonMultipliers are slashed
        it("should slash an old seasons reward on any action")
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

    context("withdraw", () => {
        beforeEach(async () => {
            stakedToken = await redeployStakedToken()
            const stakedAmount = simpleToExactAmount(2000)
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
            await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
        })
        const withdrawAmount = simpleToExactAmount(100)
        it("should not be possible before cooldown started", async () => {
            await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false)).to.revertedWith("UNSTAKE_WINDOW_FINISHED")
        })
        it("should not be possible before cooldown finished", async () => {
            await stakedToken.startCooldown()
            await increaseTime(ONE_DAY.mul(7).sub(60))
            await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false)).to.revertedWith("INSUFFICIENT_COOLDOWN")
        })
        it("should after cooldown and in unstake window", async () => {
            const beforeData = await snapshotUserStakingData(sa.default)

            await stakedToken.startCooldown()
            await increaseTime(ONE_DAY.mul(7).add(60))
            await stakedToken.withdraw(withdrawAmount, sa.default.address, false)

            const afterData = await snapshotUserStakingData(sa.default)
            // expect(afterData.stakedBalance).to.eq(beforeData.stakedBalance.sub(withdrawAmount))
            // expect(afterData.votes).to.eq(beforeData.votes.sub(withdrawAmount))
            expect(afterData.rewardsBalance).to.eq(beforeData.rewardsBalance.add(withdrawAmount))
        })
        it("should not be possible after the unstake window", async () => {
            await stakedToken.startCooldown()
            await increaseTime(ONE_DAY.mul(9).add(60))
            await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false)).to.revertedWith("UNSTAKE_WINDOW_FINISHED")
        })
        it("should not reset the cooldown timer unless all is unstaked")
        it("should apply a redemption fee which is added to the pendingRewards from the rewards contract")
        it("should distribute these pendingAdditionalReward with the next notification")
    })

    context("updating lastAction timestamp", () => {
        it("should be triggered after every WRITE action on the contract")
    })
})
