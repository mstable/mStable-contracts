import { getTimestamp, increaseTime, increaseTimeTo } from "@utils/time"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { assertBNClose, assertBNSlightlyGT, assertBNClosePercent } from "@utils/assertions"
import { BN, simpleToExactAmount, sqrt } from "@utils/math"
import { ONE_WEEK, ONE_DAY, FIVE_DAYS, fullScale, DEFAULT_DECIMALS } from "@utils/constants"
import {
    IncentivisedVotingLockup,
    IncentivisedVotingLockup__factory,
    Nexus,
    Nexus__factory,
    MockERC20,
    MockERC20__factory,
} from "types/generated"
import { ethers } from "hardhat"
import { expect } from "chai"
import { ContractTransaction } from "ethers"
import { Account } from "types"

const goToNextUnixWeekStart = async () => {
    const unixWeekCount = (await getTimestamp()).div(ONE_WEEK)
    const nextUnixWeek = unixWeekCount.add(1).mul(ONE_WEEK)
    await increaseTimeTo(nextUnixWeek)
}

const oneWeekInAdvance = async (): Promise<BN> => {
    const now = await getTimestamp()
    return now.add(ONE_WEEK)
}

describe("IncentivisedVotingLockupRewards", () => {
    let mAssetMachine: MassetMachine
    let nexus: Nexus
    let rewardsDistributor: Account
    let stakingToken: MockERC20
    let sa: StandardAccounts
    let votingLockup: IncentivisedVotingLockup

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        nexus = await new Nexus__factory(sa.default.signer).deploy(sa.governor.address)
        rewardsDistributor = sa.fundManager
    })

    const redeployRewards = async (
        nexusAddress = nexus.address,
        rewardsDistributorAddress = rewardsDistributor.address,
        rewardDecimals = DEFAULT_DECIMALS,
    ): Promise<IncentivisedVotingLockup> => {
        const deployer = sa.default.signer
        stakingToken = await new MockERC20__factory(deployer).deploy("Staking", "ST8k", rewardDecimals, sa.default.address, 10000000)
        await stakingToken.transfer(rewardsDistributorAddress, simpleToExactAmount(1000, 21))
        return new IncentivisedVotingLockup__factory(deployer).deploy(
            stakingToken.address,
            "Voting MTA",
            "vMTA",
            nexusAddress,
            rewardsDistributorAddress,
        )
    }

    interface LockedBalance {
        amount: BN
        end: BN
    }

    interface Point {
        bias: BN
        slope: BN
        ts: BN
        blk?: BN
    }

    interface StakingData {
        totalStaticWeight: BN
        userStaticWeight: BN
        userLocked: LockedBalance
        userLastPoint: Point
        senderStakingTokenBalance: BN
        contractStakingTokenBalance: BN
        userRewardPerTokenPaid: BN
        beneficiaryRewardsEarned: BN
        beneficiaryRewardsUnClaimed: BN
        rewardPerTokenStored: BN
        rewardRate: BN
        lastUpdateTime: BN
        lastTimeRewardApplicable: BN
        periodFinishTime: BN
    }

    const snapshotStakingData = async (sender = sa.default): Promise<StakingData> => {
        const locked = await votingLockup.locked(sender.address)
        const lastPoint = await votingLockup.getLastUserPoint(sender.address)
        return {
            totalStaticWeight: await votingLockup.totalStaticWeight(),
            userStaticWeight: await votingLockup.staticBalanceOf(sender.address),
            userLocked: {
                amount: locked[0],
                end: locked[1],
            },
            userLastPoint: {
                bias: lastPoint[0],
                slope: lastPoint[1],
                ts: lastPoint[2],
            },
            userRewardPerTokenPaid: await votingLockup.userRewardPerTokenPaid(sender.address),
            senderStakingTokenBalance: await stakingToken.balanceOf(sender.address),
            contractStakingTokenBalance: await stakingToken.balanceOf(votingLockup.address),
            beneficiaryRewardsEarned: await votingLockup.rewards(sender.address),
            beneficiaryRewardsUnClaimed: await votingLockup.earned(sender.address),
            rewardPerTokenStored: await votingLockup.rewardPerTokenStored(),
            rewardRate: await votingLockup.rewardRate(),
            lastUpdateTime: await votingLockup.lastUpdateTime(),
            lastTimeRewardApplicable: await votingLockup.lastTimeRewardApplicable(),
            periodFinishTime: await votingLockup.periodFinish(),
        }
    }

    before(async () => {
        votingLockup = await redeployRewards()
    })

    describe("constructor & settings", async () => {
        before(async () => {
            votingLockup = await redeployRewards()
        })
        it("should set all initial state", async () => {
            // Set in constructor
            expect(await votingLockup.nexus(), nexus.address)
            expect(await votingLockup.stakingToken(), stakingToken.address)
            expect(await votingLockup.rewardsDistributor(), rewardsDistributor.address)

            // Basic storage
            expect(await votingLockup.totalStaticWeight()).eq(BN.from(0))
            expect(await votingLockup.periodFinish()).eq(BN.from(0))
            expect(await votingLockup.rewardRate()).eq(BN.from(0))
            expect(await votingLockup.lastUpdateTime()).eq(BN.from(0))
            expect(await votingLockup.rewardPerTokenStored()).eq(BN.from(0))
            expect(await votingLockup.lastTimeRewardApplicable()).eq(BN.from(0))
            expect(await votingLockup.rewardPerToken()).eq(BN.from(0))
        })
    })

    /**
     * @dev Ensures the reward units are assigned correctly, based on the last update time, etc
     * @param beforeData Snapshot after the tx
     * @param afterData Snapshot after the tx
     * @param isExistingStaker Expect the staker to be existing?
     */
    const assertRewardsAssigned = async (
        beforeData: StakingData,
        afterData: StakingData,
        isExistingStaker: boolean,
        shouldResetRewards = false,
    ): Promise<void> => {
        const timeAfter = await getTimestamp()
        const periodIsFinished = BN.from(timeAfter).gt(beforeData.periodFinishTime)

        //    LastUpdateTime
        expect(
            periodIsFinished
                ? beforeData.periodFinishTime
                : beforeData.rewardPerTokenStored.eq(0) && beforeData.totalStaticWeight.eq(0)
                ? beforeData.lastUpdateTime
                : timeAfter,
        ).eq(afterData.lastUpdateTime)
        //    RewardRate doesnt change
        expect(beforeData.rewardRate).eq(afterData.rewardRate)
        //    RewardPerTokenStored goes up
        expect(afterData.rewardPerTokenStored).gte(beforeData.rewardPerTokenStored)
        //      Calculate exact expected 'rewardPerToken' increase since last update
        const timeApplicableToRewards = periodIsFinished
            ? beforeData.periodFinishTime.sub(beforeData.lastUpdateTime)
            : timeAfter.sub(beforeData.lastUpdateTime)
        const increaseInRewardPerToken = beforeData.totalStaticWeight.eq(BN.from(0))
            ? BN.from(0)
            : beforeData.rewardRate.mul(timeApplicableToRewards).mul(fullScale).div(beforeData.totalStaticWeight)
        expect(beforeData.rewardPerTokenStored.add(increaseInRewardPerToken)).eq(afterData.rewardPerTokenStored)

        // Expect updated personal state
        //    userRewardPerTokenPaid(beneficiary) should update
        expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored)

        //    If existing staker, then rewards Should increase
        if (shouldResetRewards) {
            expect(afterData.beneficiaryRewardsEarned).eq(BN.from(0))
        } else if (isExistingStaker) {
            // rewards(beneficiary) should update with previously accrued tokens
            const increaseInUserRewardPerToken = afterData.rewardPerTokenStored.sub(beforeData.userRewardPerTokenPaid)
            const assignment = beforeData.userStaticWeight.mul(increaseInUserRewardPerToken).div(fullScale)
            expect(beforeData.beneficiaryRewardsEarned.add(assignment)).eq(afterData.beneficiaryRewardsEarned)
        } else {
            // else `rewards` should stay the same
            expect(beforeData.beneficiaryRewardsEarned).eq(afterData.beneficiaryRewardsEarned)
        }
    }

    const calculateStaticBalance = async (lockupLength: BN, amount: BN): Promise<BN> => {
        const slope = amount.div(await votingLockup.MAXTIME())
        const s = slope.mul(10000).mul(sqrt(lockupLength))
        return s
    }

    /**
     * @dev Ensures a stake is successful, updates the rewards for the beneficiary and
     * collects the stake
     * @param stakeAmount Exact units to stake
     * @param sender Sender of the tx
     * @param confirmExistingStaker Expect the staker to be existing?
     * @param shouldIncreaseTime Expect the staker to be increase the time?
     * @param increaseAmount Expect the staker to increase the amount?
     */
    const expectSuccessfulStake = async (
        stakeAmount: BN,
        sender = sa.default,
        confirmExistingStaker = false,
        shouldIncreaseTime = false,
        increaseAmount = false,
    ): Promise<void> => {
        // 1. Get data from the contract
        const beforeData = await snapshotStakingData(sender)

        const isExistingStaker = beforeData.userStaticWeight.gt(BN.from(0))
        if (confirmExistingStaker) {
            expect(isExistingStaker).eq(true)
        }
        // 2. Approve staking token spending and send the TX
        await stakingToken.connect(sender.signer).approve(votingLockup.address, stakeAmount)
        const currentTime = await getTimestamp()

        const oneWeek = await oneWeekInAdvance()
        let tx: ContractTransaction
        let expectedAmount: BN
        let expectedLocktime: BN
        let expectedAction: number
        if (shouldIncreaseTime) {
            tx = await votingLockup.connect(sender.signer).increaseLockLength(oneWeek.add(ONE_WEEK))
            expectedAmount = BN.from(0)
            expectedLocktime = BN.from(Math.trunc(Math.trunc(oneWeek.add(ONE_WEEK).toNumber() / ONE_WEEK.toNumber()) * ONE_WEEK.toNumber()))
            expectedAction = 2 // "CREATE_LOCK"
        } else if (increaseAmount) {
            tx = await votingLockup.connect(sender.signer).increaseLockAmount(stakeAmount)
            expectedAmount = stakeAmount
            expectedLocktime = oneWeek
            expectedAction = 1 // "INCREASE_LOCK_AMOUNT"
        } else {
            tx = await votingLockup.connect(sender.signer).createLock(stakeAmount, oneWeek)
            expectedAmount = stakeAmount
            expectedLocktime = BN.from(Math.trunc(Math.trunc(oneWeek.toNumber() / ONE_WEEK.toNumber()) * ONE_WEEK.toNumber()))
            expectedAction = 0 // "INCREASE_LOCK_TIME"
        }
        await expect(tx)
            .to.emit(votingLockup, "Deposit")
            .withArgs(sender.address, expectedAmount, expectedLocktime, expectedAction, currentTime.add(1))

        // 3. Ensure rewards are accrued to the beneficiary
        const afterData = await snapshotStakingData(sender)
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker)

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(shouldIncreaseTime ? beforeData.senderStakingTokenBalance : beforeData.senderStakingTokenBalance.sub(stakeAmount)).eq(
            afterData.senderStakingTokenBalance,
        )
        //    StakingToken balance of votingLockup
        expect(shouldIncreaseTime ? beforeData.contractStakingTokenBalance : beforeData.contractStakingTokenBalance.add(stakeAmount)).eq(
            afterData.contractStakingTokenBalance,
        )
        //    totalStaticWeight of votingLockup
        expect(
            isExistingStaker
                ? beforeData.totalStaticWeight.add(afterData.userStaticWeight).sub(beforeData.userStaticWeight)
                : beforeData.totalStaticWeight.add(afterData.userStaticWeight),
        ).eq(afterData.totalStaticWeight)
    }

    /**
     * @dev Ensures a funding is successful, checking that it updates the rewardRate etc
     * @param rewardUnits Number of units to stake
     */
    const expectSuccesfulFunding = async (rewardUnits: BN): Promise<void> => {
        const beforeData = await snapshotStakingData()
        const tx = await votingLockup.connect(rewardsDistributor.signer).notifyRewardAmount(rewardUnits)
        await expect(tx).to.emit(votingLockup, "RewardAdded").withArgs(rewardUnits)

        const cur = BN.from(await getTimestamp())
        const leftOverRewards = beforeData.rewardRate.mul(beforeData.periodFinishTime.sub(beforeData.lastTimeRewardApplicable))
        const afterData = await snapshotStakingData()

        // Sets lastTimeRewardApplicable to latest
        expect(cur).eq(afterData.lastTimeRewardApplicable)
        // Sets lastUpdateTime to latest
        expect(cur).eq(afterData.lastUpdateTime)
        // Sets periodFinish to 1 week from now
        expect(cur.add(ONE_WEEK)).eq(afterData.periodFinishTime)
        // Sets rewardRate to rewardUnits / ONE_WEEK
        if (leftOverRewards.gt(0)) {
            const total = rewardUnits.add(leftOverRewards)
            assertBNClose(
                total.div(ONE_WEEK),
                afterData.rewardRate,
                beforeData.rewardRate.div(ONE_WEEK).mul(5), // the effect of 1 second on the future scale
            )
        } else {
            expect(rewardUnits.div(ONE_WEEK)).eq(afterData.rewardRate)
        }
    }

    /**
     * @dev Makes a withdrawal from the contract, and ensures that resulting state is correct
     * and the rewards have been applied
     * @param sender User to execute the tx
     */
    const expectStakingWithdrawal = async (sender = sa.default): Promise<void> => {
        // 1. Get data from the contract
        const beforeData = await snapshotStakingData(sender)
        const isExistingStaker = beforeData.userStaticWeight.gt(BN.from(0))
        expect(isExistingStaker).eq(true)
        // 2. Send withdrawal tx
        const currentTime = await getTimestamp()
        const tx = await votingLockup.connect(sender.signer).withdraw()
        await expect(tx).to.emit(votingLockup, "Withdraw").withArgs(sender.address, beforeData.userLocked.amount, currentTime.add(1))

        // 3. Expect Rewards to accrue to the beneficiary
        //    StakingToken balance of sender
        const afterData = await snapshotStakingData(sender)
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker)

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.senderStakingTokenBalance.add(beforeData.userLocked.amount)).eq(afterData.senderStakingTokenBalance)
        //    Withdraws from the actual rewards wrapper token
        expect(afterData.userLocked.amount).eq(BN.from(0))
        expect(afterData.userLocked.end).eq(BN.from(0))
        expect(afterData.userStaticWeight).eq(BN.from(0))
        //    Updates total supply
        expect(beforeData.totalStaticWeight.sub(beforeData.userStaticWeight)).eq(afterData.totalStaticWeight)
    }

    context("initialising and staking in a new pool", () => {
        describe("notifying the pool of reward", () => {
            it("should begin a new period through", async () => {
                const rewardUnits = simpleToExactAmount(1, DEFAULT_DECIMALS)
                await expectSuccesfulFunding(rewardUnits)
            })
        })
        describe("staking in the new period", () => {
            it("should assign rewards to the staker", async () => {
                // Do the stake
                const rewardRate = await votingLockup.rewardRate()
                const stakeAmount = simpleToExactAmount(100, DEFAULT_DECIMALS)
                await expectSuccessfulStake(stakeAmount)

                await increaseTime(ONE_DAY)

                // This is the total reward per staked token, since the last update
                const rewardPerToken = await votingLockup.rewardPerToken()
                const rewardPerSecond = BN.from(1)
                    .mul(rewardRate)
                    .mul(fullScale)
                    .div(await votingLockup.staticBalanceOf(sa.default.address))
                assertBNClose(rewardPerToken, ONE_DAY.mul(rewardPerSecond), rewardPerSecond.mul(10))

                // Calc estimated unclaimed reward for the user
                // earned == balance * (rewardPerToken-userExistingReward)
                const earned = await votingLockup.earned(sa.default.address)
                expect((await votingLockup.staticBalanceOf(sa.default.address)).mul(rewardPerToken).div(fullScale)).eq(earned)
            })
            it("should update stakers rewards after consequent stake", async () => {
                const stakeAmount = simpleToExactAmount(100, DEFAULT_DECIMALS)
                // This checks resulting state after second stake
                await expectSuccessfulStake(stakeAmount, sa.default, true, true)
            })

            it("should fail if stake amount is 0", async () => {
                await expect(votingLockup.connect(sa.default.signer).createLock(0, await oneWeekInAdvance())).to.be.revertedWith(
                    "Must stake non zero amount",
                )
            })

            it("should fail if staker has insufficient balance", async () => {
                const expectedReason = "ERC20: transfer amount exceeds balance"
                await stakingToken.connect(sa.dummy2.signer).approve(votingLockup.address, 1)
                await expect(
                    votingLockup.connect(sa.dummy2.signer).createLock(1, await oneWeekInAdvance()),
                    `voting create lock tx should revert with "${expectedReason}"`,
                ).to.be.revertedWith(expectedReason)
            })
        })
    })
    context("staking before rewards are added", () => {
        before(async () => {
            votingLockup = await redeployRewards()
        })
        it("should assign no rewards", async () => {
            // Get data before
            const stakeAmount = simpleToExactAmount(100, DEFAULT_DECIMALS)
            const beforeData = await snapshotStakingData()
            expect(beforeData.rewardRate).eq(BN.from(0))
            expect(beforeData.rewardPerTokenStored).eq(BN.from(0))
            expect(beforeData.beneficiaryRewardsEarned).eq(BN.from(0))
            expect(beforeData.totalStaticWeight).eq(BN.from(0))
            expect(beforeData.lastTimeRewardApplicable).eq(BN.from(0))

            await goToNextUnixWeekStart()
            // Do the stake
            await expectSuccessfulStake(stakeAmount)

            // Wait a day
            await increaseTime(ONE_DAY)

            // Do another stake
            // await expectSuccessfulStake(stakeAmount);
            // Get end results
            const afterData = await snapshotStakingData()
            expect(afterData.rewardRate).eq(BN.from(0))
            expect(afterData.rewardPerTokenStored).eq(BN.from(0))
            expect(afterData.beneficiaryRewardsEarned).eq(BN.from(0))
            assertBNClosePercent(afterData.totalStaticWeight, await calculateStaticBalance(ONE_WEEK, stakeAmount), "0.5")
            expect(afterData.lastTimeRewardApplicable).eq(BN.from(0))
        })
    })
    context("adding first stake days after funding", () => {
        before(async () => {
            votingLockup = await redeployRewards()
        })
        it("should retrospectively assign rewards to the first staker", async () => {
            await expectSuccesfulFunding(simpleToExactAmount(100, DEFAULT_DECIMALS))

            // Do the stake
            const rewardRate = await votingLockup.rewardRate()

            await increaseTime(FIVE_DAYS)

            const stakeAmount = simpleToExactAmount(100, DEFAULT_DECIMALS)
            await expectSuccessfulStake(stakeAmount)

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await votingLockup.rewardPerToken()

            const rewardPerSecond = BN.from(1)
                .mul(rewardRate)
                .mul(fullScale)
                .div(await votingLockup.staticBalanceOf(sa.default.address))
            assertBNClose(rewardPerToken, FIVE_DAYS.mul(rewardPerSecond), rewardPerSecond.mul(4))

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await votingLockup.earned(sa.default.address)
            expect((await votingLockup.staticBalanceOf(sa.default.address)).mul(rewardPerToken).div(fullScale)).eq(
                earnedAfterConsequentStake,
            )
        })
    })
    context("staking over multiple funded periods", () => {
        context("with a single staker", () => {
            before(async () => {
                votingLockup = await redeployRewards()
            })
            it("should assign all the rewards from the periods", async () => {
                const fundAmount1 = simpleToExactAmount(100, DEFAULT_DECIMALS)
                const fundAmount2 = simpleToExactAmount(200, DEFAULT_DECIMALS)
                await expectSuccesfulFunding(fundAmount1)

                const stakeAmount = simpleToExactAmount(1, DEFAULT_DECIMALS)
                await expectSuccessfulStake(stakeAmount)

                await increaseTime(ONE_WEEK.mul(2))

                await expectSuccesfulFunding(fundAmount2)

                await increaseTime(ONE_WEEK.mul(2))

                const earned = await votingLockup.earned(sa.default.address)
                assertBNSlightlyGT(fundAmount1.add(fundAmount2), earned, BN.from(1000000), false)
            })
        })
        context("with multiple stakers coming in and out", () => {
            const fundAmount1 = simpleToExactAmount(10000, 19)
            const fundAmount2 = simpleToExactAmount(20000, 19)
            const staker1Stake1 = simpleToExactAmount(100, DEFAULT_DECIMALS)
            const staker1Stake2 = simpleToExactAmount(200, DEFAULT_DECIMALS)
            const staker2Stake = simpleToExactAmount(100, DEFAULT_DECIMALS)
            const staker3Stake = simpleToExactAmount(100, DEFAULT_DECIMALS)
            let staker2: Account
            let staker3: Account

            before(async () => {
                staker2 = sa.dummy1
                staker3 = sa.dummy2
                votingLockup = await redeployRewards()
                await stakingToken.transfer(staker2.address, staker2Stake)
                await stakingToken.transfer(staker3.address, staker3Stake)
            })
            it("should accrue rewards on a pro rata basis", async () => {
                /*
                 *  0               1               2   <-- Weeks
                 *   [ - - - - - - ] [ - - - - - - ]
                 * 100k            200k                 <-- Funding
                 * +100            +200                 <-- Staker 1
                 *        +100      |             >|    <-- Staker 2
                 * +100            -100                 <-- Staker 3
                 *
                 * Staker 1 gets 25k + 16.66k from week 1 + 150k from week 2 = 191.66k
                 * Staker 2 gets 16.66k from week 1 + 50k from week 2 = 66.66k
                 * Staker 3 gets 25k + 16.66k from week 1 + 0 from week 2 = 41.66k
                 */

                const expectedStatic1 = await calculateStaticBalance(ONE_WEEK, staker1Stake1)
                const expectedStatic2 = await calculateStaticBalance(ONE_WEEK.div(2), staker1Stake1)
                const totalStaticp2 = expectedStatic1.mul(2).add(expectedStatic2)
                const expectedStatic3 = await calculateStaticBalance(ONE_WEEK, staker1Stake2)
                const totalStaticp3 = expectedStatic3.add(expectedStatic2)
                const staker1share = fundAmount1
                    .div(2)
                    .div(2)
                    .add(fundAmount1.div(2).mul(expectedStatic1).div(totalStaticp2))
                    .add(fundAmount2.mul(expectedStatic3).div(totalStaticp3))
                const staker2share = fundAmount1
                    .div(2)
                    .mul(expectedStatic2)
                    .div(totalStaticp2)
                    .add(fundAmount2.mul(expectedStatic2).div(totalStaticp3))
                const staker3share = fundAmount1.div(2).div(2).add(fundAmount1.div(2).mul(expectedStatic1).div(totalStaticp2))

                // WEEK 0-1 START
                await goToNextUnixWeekStart()
                await expectSuccessfulStake(staker1Stake1)
                await expectSuccessfulStake(staker3Stake, staker3)
                await expectSuccesfulFunding(fundAmount1)

                await increaseTime(ONE_WEEK.div(2).add(1))

                await expectSuccessfulStake(staker2Stake, staker2)

                await increaseTime(ONE_WEEK.div(2).add(1))

                // WEEK 1-2 START
                await expectSuccesfulFunding(fundAmount2)

                await votingLockup.eject(staker3.address)
                await votingLockup.connect(sa.default.signer).withdraw()
                await expectSuccessfulStake(staker1Stake2, sa.default)

                await increaseTime(ONE_WEEK)

                // WEEK 2 FINISH
                const earned1 = await votingLockup.earned(sa.default.address)
                const earned2 = await votingLockup.earned(staker2.address)
                const earned3 = await votingLockup.earned(staker3.address)
                assertBNClose(earned1, staker1share, simpleToExactAmount(5, 19))
                assertBNClose(earned2, staker2share, simpleToExactAmount(5, 19))
                assertBNClose(earned3, staker3share, simpleToExactAmount(5, 19))
                // Ensure that sum of earned rewards does not exceed funcing amount
                expect(fundAmount1.add(fundAmount2)).gte(earned1.add(earned2).add(earned3))
            })
        })
    })
    context("staking after period finish", () => {
        const fundAmount1 = simpleToExactAmount(100, 21)

        before(async () => {
            votingLockup = await redeployRewards()
        })
        it("should stop accruing rewards after the period is over", async () => {
            await expectSuccessfulStake(simpleToExactAmount(1, DEFAULT_DECIMALS))
            await expectSuccesfulFunding(fundAmount1)

            await increaseTime(ONE_WEEK.add(1))

            const earnedAfterWeek = await votingLockup.earned(sa.default.address)

            await increaseTime(ONE_WEEK.add(1))
            const now = await getTimestamp()

            const earnedAfterTwoWeeks = await votingLockup.earned(sa.default.address)

            expect(earnedAfterWeek).eq(earnedAfterTwoWeeks)

            const lastTimeRewardApplicable = await votingLockup.lastTimeRewardApplicable()
            assertBNClose(lastTimeRewardApplicable, now.sub(ONE_WEEK).sub(2), BN.from(2))
        })
    })

    context("getting the reward token", () => {
        before(async () => {
            votingLockup = await redeployRewards()
        })
        it("should simply return the rewards Token", async () => {
            const readToken = await votingLockup.getRewardToken()
            expect(readToken).eq(stakingToken.address)
            expect(readToken).eq(await votingLockup.stakingToken())
        })
    })

    context("notifying new reward amount", () => {
        context("from someone other than the distributor", () => {
            before(async () => {
                votingLockup = await redeployRewards()
            })
            it("should fail", async () => {
                await expect(votingLockup.connect(sa.default.signer).notifyRewardAmount(1)).to.be.revertedWith(
                    "Caller is not reward distributor",
                )
                await expect(votingLockup.connect(sa.dummy1.signer).notifyRewardAmount(1)).to.be.revertedWith(
                    "Caller is not reward distributor",
                )
                await expect(votingLockup.connect(sa.governor.signer).notifyRewardAmount(1)).to.be.revertedWith(
                    "Caller is not reward distributor",
                )
            })
        })
        context("before current period finish", async () => {
            const funding1 = simpleToExactAmount(100, DEFAULT_DECIMALS)
            const funding2 = simpleToExactAmount(200, DEFAULT_DECIMALS)
            beforeEach(async () => {
                votingLockup = await redeployRewards()
            })
            it("should factor in unspent units to the new rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1)
                const actualRewardRate = await votingLockup.rewardRate()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(ONE_WEEK.div(2))

                // Do the second funding, and factor in the unspent units
                const expectedLeftoverReward = funding1.div(2)
                await expectSuccesfulFunding(funding2)
                const actualRewardRateAfter = await votingLockup.rewardRate()
                const totalRewardsForWeek = funding2.add(expectedLeftoverReward)
                const expectedRewardRateAfter = totalRewardsForWeek.div(ONE_WEEK)
                assertBNClose(actualRewardRateAfter, expectedRewardRateAfter, actualRewardRate.div(ONE_WEEK).mul(20))
            })
            it("should factor in unspent units to the new rewardRate if instant", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1)
                const actualRewardRate = await votingLockup.rewardRate()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(1)

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding2)
                const actualRewardRateAfter = await votingLockup.rewardRate()
                const expectedRewardRateAfter = funding1.add(funding2).div(ONE_WEEK)
                assertBNClose(actualRewardRateAfter, expectedRewardRateAfter, actualRewardRate.div(ONE_WEEK).mul(20))
            })
        })

        context("after current period finish", () => {
            const funding1 = simpleToExactAmount(100, DEFAULT_DECIMALS)
            before(async () => {
                votingLockup = await redeployRewards()
            })
            it("should start a new period with the correct rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1)
                const actualRewardRate = await votingLockup.rewardRate()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(ONE_WEEK.add(1))

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding1.mul(2))
                const actualRewardRateAfter = await votingLockup.rewardRate()
                const expectedRewardRateAfter = expectedRewardRate.mul(2)
                expect(actualRewardRateAfter).eq(expectedRewardRateAfter)
            })
        })
    })

    context("withdrawing stake or rewards", () => {
        context("withdrawing a stake amount", () => {
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, DEFAULT_DECIMALS)

            before(async () => {
                votingLockup = await redeployRewards()
                await expectSuccessfulStake(stakeAmount)
                await increaseTime(ONE_WEEK.div(3).mul(2))
                await expectSuccesfulFunding(fundAmount)
                await increaseTime(ONE_WEEK.div(3).mul(2))
            })
            it("should revert for a non-staker", async () => {
                await expect(votingLockup.connect(sa.dummy1.signer).withdraw()).to.be.revertedWith("Must have something to withdraw")
            })
            it("should withdraw the stake and update the existing reward accrual", async () => {
                // Check that the user has earned something
                const earnedBefore = await votingLockup.earned(sa.default.address)
                expect(earnedBefore).gt(BN.from(0))
                const rewardsBefore = await votingLockup.rewards(sa.default.address)
                expect(rewardsBefore).eq(BN.from(0))

                // Execute the withdrawal
                await expectStakingWithdrawal()

                // Ensure that the new awards are added + assigned to user
                const earnedAfter = await votingLockup.earned(sa.default.address)
                expect(earnedAfter).gte(earnedBefore)
                const rewardsAfter = await votingLockup.rewards(sa.default.address)
                expect(rewardsAfter).eq(earnedAfter)

                // Zoom forward now
                await increaseTime(10)

                // Check that the user does not earn anything else
                const earnedEnd = await votingLockup.earned(sa.default.address)
                expect(earnedEnd).eq(earnedAfter)
                const rewardsEnd = await votingLockup.rewards(sa.default.address)
                expect(rewardsEnd).eq(rewardsAfter)

                // Cannot withdraw anything else
                await expect(votingLockup.connect(sa.default.signer).withdraw()).to.be.revertedWith("Must have something to withdraw")
            })
        })
        context("claiming rewards", async () => {
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, DEFAULT_DECIMALS)

            before(async () => {
                votingLockup = await redeployRewards()
                await expectSuccesfulFunding(fundAmount)
                await stakingToken.connect(rewardsDistributor.signer).transfer(votingLockup.address, fundAmount)
                await stakingToken.connect(rewardsDistributor.signer).transfer(sa.dummy2.address, stakeAmount)
                await expectSuccessfulStake(stakeAmount, sa.dummy2)
                await increaseTime(ONE_WEEK.add(1))
            })
            it("should do nothing for a non-staker", async () => {
                const beforeData = await snapshotStakingData(sa.dummy1)
                await votingLockup.connect(sa.dummy1.signer).claimReward()

                const afterData = await snapshotStakingData(sa.dummy1)
                expect(beforeData.beneficiaryRewardsEarned).eq(BN.from(0))
                expect(afterData.beneficiaryRewardsEarned).eq(BN.from(0))
                expect(afterData.senderStakingTokenBalance).eq(BN.from(0))
                expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored)
            })
            it("should send all accrued rewards to the rewardee", async () => {
                const beforeData = await snapshotStakingData(sa.dummy2)

                const tx = await votingLockup.connect(sa.dummy2.signer).claimReward()
                await expect(tx).to.emit(votingLockup, "RewardPaid").withArgs(sa.dummy2.address, beforeData.beneficiaryRewardsUnClaimed)
                const afterData = await snapshotStakingData(sa.dummy2)
                await assertRewardsAssigned(beforeData, afterData, false, true)
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await stakingToken.balanceOf(sa.dummy2.address)
                assertBNClose(rewardeeBalanceAfter, fundAmount, simpleToExactAmount(1, 16))

                // 'rewards' reset to 0
                expect(afterData.beneficiaryRewardsEarned).eq(BN.from(0), "i1")
                // Paid up until the last block
                expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored, "i2")
                // Token balances dont change
                expect(afterData.senderStakingTokenBalance).eq(
                    beforeData.senderStakingTokenBalance.add(await votingLockup.rewardsPaid(sa.dummy2.address)),
                    "i3",
                )
                expect(beforeData.userStaticWeight).eq(afterData.userStaticWeight, "i4")
            })
        })
        context("completely 'exiting' the system", () => {
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, DEFAULT_DECIMALS)

            before(async () => {
                votingLockup = await redeployRewards()
                await expectSuccesfulFunding(fundAmount)
                await stakingToken.connect(rewardsDistributor.signer).transfer(votingLockup.address, fundAmount)
                await expectSuccessfulStake(stakeAmount)
                await increaseTime(ONE_WEEK.add(1))
            })
            it("should fail if the sender has no stake", async () => {
                await expect(votingLockup.connect(sa.dummy1.signer).exit()).to.be.revertedWith("Must have something to withdraw")
            })
            it("should withdraw all senders stake and send outstanding rewards to the staker", async () => {
                const beforeData = await snapshotStakingData()
                const rewardeeBalanceBefore = await stakingToken.balanceOf(sa.default.address)
                const currentTime = await getTimestamp()
                const tx = await votingLockup.exit()

                await expect(tx).to.emit(votingLockup, "Withdraw").withArgs(sa.default.address, stakeAmount, currentTime.add(1))
                await expect(tx).to.emit(votingLockup, "RewardPaid").withArgs(sa.default.address, beforeData.beneficiaryRewardsUnClaimed)

                const afterData = await snapshotStakingData()
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await stakingToken.balanceOf(sa.default.address)
                assertBNClose(rewardeeBalanceAfter.sub(rewardeeBalanceBefore), fundAmount.add(stakeAmount), simpleToExactAmount(1, 16))

                // Expect Rewards to accrue to the beneficiary
                //    StakingToken balance of sender
                await assertRewardsAssigned(beforeData, afterData, false, true)

                // Expect token transfer
                //    StakingToken balance of sender
                expect(beforeData.senderStakingTokenBalance.add(stakeAmount).add(await votingLockup.rewardsPaid(sa.default.address))).eq(
                    afterData.senderStakingTokenBalance,
                )

                //    Withdraws from the actual rewards wrapper token
                expect(afterData.userStaticWeight).eq(BN.from(0))

                //    Updates total supply
                expect(beforeData.totalStaticWeight.sub(beforeData.userStaticWeight)).eq(afterData.totalStaticWeight)

                await expect(votingLockup.exit()).to.be.revertedWith("Must have something to withdraw")
            })
        })
    })
    context("running a full integration test", () => {
        const fundAmount = simpleToExactAmount(100, 21)
        const stakeAmount = simpleToExactAmount(100, DEFAULT_DECIMALS)

        before(async () => {
            votingLockup = await redeployRewards()
        })
        it("1. should allow the rewardsDistributor to fund the pool", async () => {
            await stakingToken.connect(rewardsDistributor.signer).transfer(votingLockup.address, fundAmount)
            await expectSuccesfulFunding(fundAmount)
        })
        it("2. should allow stakers to stake and earn rewards", async () => {
            await expectSuccessfulStake(stakeAmount)
            await increaseTime(ONE_WEEK.add(1))
        })
        it("3. should credit earnings directly to beneficiary", async () => {
            const beforeData = await snapshotStakingData()
            const beneficiaryBalanceBefore = await stakingToken.balanceOf(sa.default.address)

            await votingLockup.exit()

            const afterData = await snapshotStakingData()
            // Balance transferred to the rewardee
            const beneficiaryBalanceAfter = await stakingToken.balanceOf(sa.default.address)
            assertBNClose(beneficiaryBalanceAfter.sub(beneficiaryBalanceBefore), fundAmount.add(stakeAmount), simpleToExactAmount(1, 16))

            await assertRewardsAssigned(beforeData, afterData, false, true)
        })
    })
})
