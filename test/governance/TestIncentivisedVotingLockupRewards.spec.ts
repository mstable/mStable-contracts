/* eslint-disable no-nested-ternary */

import * as t from "types/generated";
import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBNClose, assertBNSlightlyGT, assertBNClosePercent } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { ONE_WEEK, ONE_DAY, FIVE_DAYS, fullScale } from "@utils/constants";
import envSetup from "@utils/env_setup";

import shouldBehaveLikeRecipient from "../rewards/RewardsDistributionRecipient.behaviour";

const MockERC20 = artifacts.require("MockERC20");
const VotingLockup = artifacts.require("IncentivisedVotingLockup");

const { expect } = envSetup.configure();

const goToNextUnixWeekStart = async () => {
    const unixWeekCount = (await time.latest()).div(ONE_WEEK);
    const nextUnixWeek = unixWeekCount.addn(1).mul(ONE_WEEK);
    await time.increaseTo(nextUnixWeek);
};

const oneWeekInAdvance = async (): Promise<BN> => {
    const now = await time.latest();
    return now.add(ONE_WEEK);
};

contract("IncentivisedVotingLockupRewards", async (accounts) => {
    const recipientCtx: {
        recipient?: t.RewardsDistributionRecipientInstance;
    } = {};
    const moduleCtx: {
        module?: t.ModuleInstance;
    } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;

    const rewardsDistributor = sa.fundManager;
    let stakingToken: t.MockERC20Instance;
    let votingLockup: t.IncentivisedVotingLockupInstance;

    const redeployRewards = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.IncentivisedVotingLockupInstance> => {
        stakingToken = await MockERC20.new("Staking", "ST8k", 18, sa.default, 10000000);
        await stakingToken.transfer(rewardsDistributor, simpleToExactAmount(1000, 21));
        return VotingLockup.new(
            stakingToken.address,
            "Voting MTA",
            "vMTA",
            nexusAddress,
            rewardsDistributor,
        );
    };

    interface LockedBalance {
        amount: BN;
        end: BN;
    }

    interface Point {
        bias: BN;
        slope: BN;
        ts: BN;
        blk?: BN;
    }

    interface StakingData {
        totalStaticWeight: BN;
        userStaticWeight: BN;
        userLocked: LockedBalance;
        userLastPoint: Point;
        senderStakingTokenBalance: BN;
        contractStakingTokenBalance: BN;
        userRewardPerTokenPaid: BN;
        beneficiaryRewardsEarned: BN;
        rewardPerTokenStored: BN;
        rewardRate: BN;
        lastUpdateTime: BN;
        lastTimeRewardApplicable: BN;
        periodFinishTime: BN;
    }

    const snapshotStakingData = async (sender = sa.default): Promise<StakingData> => {
        const locked = await votingLockup.locked(sender);
        const lastPoint = await votingLockup.getLastUserPoint(sender);
        return {
            totalStaticWeight: await votingLockup.totalStaticWeight(),
            userStaticWeight: await votingLockup.staticBalanceOf(sender),
            userLocked: {
                amount: locked[0],
                end: locked[1],
            },
            userLastPoint: {
                bias: lastPoint[0],
                slope: lastPoint[1],
                ts: lastPoint[2],
            },
            userRewardPerTokenPaid: await votingLockup.userRewardPerTokenPaid(sender),
            senderStakingTokenBalance: await stakingToken.balanceOf(sender),
            contractStakingTokenBalance: await stakingToken.balanceOf(votingLockup.address),
            beneficiaryRewardsEarned: await votingLockup.rewards(sender),
            rewardPerTokenStored: await votingLockup.rewardPerTokenStored(),
            rewardRate: await votingLockup.rewardRate(),
            lastUpdateTime: await votingLockup.lastUpdateTime(),
            lastTimeRewardApplicable: await votingLockup.lastTimeRewardApplicable(),
            periodFinishTime: await votingLockup.periodFinish(),
        };
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
        votingLockup = await redeployRewards();
        recipientCtx.recipient = (votingLockup as unknown) as t.RewardsDistributionRecipientInstance;
        moduleCtx.module = votingLockup as t.ModuleInstance;
    });

    describe("implementing rewardDistributionRecipient and Module", async () => {
        shouldBehaveLikeRecipient(
            recipientCtx as Required<typeof recipientCtx>,
            moduleCtx as Required<typeof moduleCtx>,
            sa,
        );
    });

    describe("constructor & settings", async () => {
        before(async () => {
            votingLockup = await redeployRewards();
        });
        it("should set all initial state", async () => {
            // Set in constructor
            expect(await votingLockup.nexus(), systemMachine.nexus.address);
            expect(await votingLockup.stakingToken(), stakingToken.address);
            expect(await votingLockup.rewardsDistributor(), rewardsDistributor);

            // Basic storage
            expect(await votingLockup.totalStaticWeight()).bignumber.eq(new BN(0));
            expect(await votingLockup.periodFinish()).bignumber.eq(new BN(0));
            expect(await votingLockup.rewardRate()).bignumber.eq(new BN(0));
            expect(await votingLockup.lastUpdateTime()).bignumber.eq(new BN(0));
            expect(await votingLockup.rewardPerTokenStored()).bignumber.eq(new BN(0));
            expect(await votingLockup.lastTimeRewardApplicable()).bignumber.eq(new BN(0));
            expect(await votingLockup.rewardPerToken()).bignumber.eq(new BN(0));
        });
    });

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
        const timeAfter = await time.latest();
        const periodIsFinished = new BN(timeAfter).gt(beforeData.periodFinishTime);

        //    LastUpdateTime
        expect(
            periodIsFinished
                ? beforeData.periodFinishTime
                : beforeData.rewardPerTokenStored.eqn(0) && beforeData.totalStaticWeight.eqn(0)
                ? beforeData.lastUpdateTime
                : timeAfter,
        ).bignumber.eq(afterData.lastUpdateTime);
        //    RewardRate doesnt change
        expect(beforeData.rewardRate).bignumber.eq(afterData.rewardRate);
        //    RewardPerTokenStored goes up
        expect(afterData.rewardPerTokenStored).bignumber.gte(
            beforeData.rewardPerTokenStored as any,
        );
        //      Calculate exact expected 'rewardPerToken' increase since last update
        const timeApplicableToRewards = periodIsFinished
            ? beforeData.periodFinishTime.sub(beforeData.lastUpdateTime)
            : timeAfter.sub(beforeData.lastUpdateTime);
        const increaseInRewardPerToken = beforeData.totalStaticWeight.eq(new BN(0))
            ? new BN(0)
            : beforeData.rewardRate
                  .mul(timeApplicableToRewards)
                  .mul(fullScale)
                  .div(beforeData.totalStaticWeight);
        expect(beforeData.rewardPerTokenStored.add(increaseInRewardPerToken)).bignumber.eq(
            afterData.rewardPerTokenStored,
        );

        // Expect updated personal state
        //    userRewardPerTokenPaid(beneficiary) should update
        expect(afterData.userRewardPerTokenPaid).bignumber.eq(afterData.rewardPerTokenStored);

        //    If existing staker, then rewards Should increase
        if (shouldResetRewards) {
            expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
        } else if (isExistingStaker) {
            // rewards(beneficiary) should update with previously accrued tokens
            const increaseInUserRewardPerToken = afterData.rewardPerTokenStored.sub(
                beforeData.userRewardPerTokenPaid,
            );
            const assignment = beforeData.userStaticWeight
                .mul(increaseInUserRewardPerToken)
                .div(fullScale);
            expect(beforeData.beneficiaryRewardsEarned.add(assignment)).bignumber.eq(
                afterData.beneficiaryRewardsEarned,
            );
        } else {
            // else `rewards` should stay the same
            expect(beforeData.beneficiaryRewardsEarned).bignumber.eq(
                afterData.beneficiaryRewardsEarned,
            );
        }
    };

    const calculateStaticBalance = async (lockupLength: BN, amount: BN): Promise<BN> => {
        const slope = amount.div(await votingLockup.MAXTIME());
        const s = slope.muln(10000).muln(Math.sqrt(lockupLength.toNumber()));
        return s;
    };

    /**
     * @dev Ensures a stake is successful, updates the rewards for the beneficiary and
     * collects the stake
     * @param stakeAmount Exact units to stake
     * @param sender Sender of the tx
     * @param beneficiary Beneficiary of the stake
     * @param confirmExistingStaker Expect the staker to be existing?
     */
    const expectSuccessfulStake = async (
        stakeAmount: BN,
        sender = sa.default,
        confirmExistingStaker = false,
        increaseTime = false,
        increaseAmount = false,
    ): Promise<void> => {
        // 1. Get data from the contract
        const beforeData = await snapshotStakingData(sender);

        const isExistingStaker = beforeData.userStaticWeight.gt(new BN(0));
        if (confirmExistingStaker) {
            expect(isExistingStaker).eq(true);
        }
        // 2. Approve staking token spending and send the TX
        await stakingToken.approve(votingLockup.address, stakeAmount, {
            from: sender,
        });
        const tx = increaseTime
            ? await votingLockup.increaseLockLength((await oneWeekInAdvance()).add(ONE_WEEK), {
                  from: sender,
              })
            : increaseAmount
            ? await votingLockup.increaseLockAmount(stakeAmount, { from: sender })
            : await votingLockup.createLock(stakeAmount, await oneWeekInAdvance(), {
                  from: sender,
              });
        expectEvent(tx.receipt, "Deposit", {
            provider: sender,
            value: increaseTime ? new BN(0) : stakeAmount,
        });

        // 3. Ensure rewards are accrued to the beneficiary
        const afterData = await snapshotStakingData(sender);
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker);

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(
            increaseTime
                ? beforeData.senderStakingTokenBalance
                : beforeData.senderStakingTokenBalance.sub(stakeAmount),
        ).bignumber.eq(afterData.senderStakingTokenBalance);
        //    StakingToken balance of votingLockup
        expect(
            increaseTime
                ? beforeData.contractStakingTokenBalance
                : beforeData.contractStakingTokenBalance.add(stakeAmount),
        ).bignumber.eq(afterData.contractStakingTokenBalance);
        //    totalStaticWeight of votingLockup
        expect(
            isExistingStaker
                ? beforeData.totalStaticWeight
                      .add(afterData.userStaticWeight)
                      .sub(beforeData.userStaticWeight)
                : beforeData.totalStaticWeight.add(afterData.userStaticWeight),
        ).bignumber.eq(afterData.totalStaticWeight);
    };

    /**
     * @dev Ensures a funding is successful, checking that it updates the rewardRate etc
     * @param rewardUnits Number of units to stake
     */
    const expectSuccesfulFunding = async (rewardUnits: BN): Promise<void> => {
        const beforeData = await snapshotStakingData();
        const tx = await votingLockup.notifyRewardAmount(rewardUnits, {
            from: rewardsDistributor,
        });
        expectEvent(tx.receipt, "RewardAdded", { reward: rewardUnits });

        const cur = new BN(await time.latest());
        const leftOverRewards = beforeData.rewardRate.mul(
            beforeData.periodFinishTime.sub(beforeData.lastTimeRewardApplicable),
        );
        const afterData = await snapshotStakingData();

        // Sets lastTimeRewardApplicable to latest
        expect(cur).bignumber.eq(afterData.lastTimeRewardApplicable);
        // Sets lastUpdateTime to latest
        expect(cur).bignumber.eq(afterData.lastUpdateTime);
        // Sets periodFinish to 1 week from now
        expect(cur.add(ONE_WEEK)).bignumber.eq(afterData.periodFinishTime);
        // Sets rewardRate to rewardUnits / ONE_WEEK
        if (leftOverRewards.gtn(0)) {
            const total = rewardUnits.add(leftOverRewards);
            assertBNClose(
                total.div(ONE_WEEK),
                afterData.rewardRate,
                beforeData.rewardRate.div(ONE_WEEK).muln(5), // the effect of 1 second on the future scale
            );
        } else {
            expect(rewardUnits.div(ONE_WEEK)).bignumber.eq(afterData.rewardRate);
        }
    };

    /**
     * @dev Makes a withdrawal from the contract, and ensures that resulting state is correct
     * and the rewards have been applied
     * @param sender User to execute the tx
     */
    const expectStakingWithdrawal = async (sender = sa.default): Promise<void> => {
        // 1. Get data from the contract
        const beforeData = await snapshotStakingData(sender);
        const isExistingStaker = beforeData.userStaticWeight.gt(new BN(0));
        expect(isExistingStaker).eq(true);
        // 2. Send withdrawal tx
        const tx = await votingLockup.withdraw({
            from: sender,
        });
        expectEvent(tx.receipt, "Withdraw", {
            provider: sender,
            value: beforeData.userLocked.amount,
        });

        // 3. Expect Rewards to accrue to the beneficiary
        //    StakingToken balance of sender
        const afterData = await snapshotStakingData(sender);
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker);

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.senderStakingTokenBalance.add(beforeData.userLocked.amount)).bignumber.eq(
            afterData.senderStakingTokenBalance,
        );
        //    Withdraws from the actual rewards wrapper token
        expect(afterData.userLocked.amount).bignumber.eq(new BN(0));
        expect(afterData.userLocked.end).bignumber.eq(new BN(0));
        expect(afterData.userStaticWeight).bignumber.eq(new BN(0));
        //    Updates total supply
        expect(beforeData.totalStaticWeight.sub(beforeData.userStaticWeight)).bignumber.eq(
            afterData.totalStaticWeight,
        );
    };

    context("initialising and staking in a new pool", () => {
        describe("notifying the pool of reward", () => {
            it("should begin a new period through", async () => {
                const rewardUnits = simpleToExactAmount(1, 18);
                await expectSuccesfulFunding(rewardUnits);
            });
        });
        describe("staking in the new period", () => {
            it("should assign rewards to the staker", async () => {
                // Do the stake
                const rewardRate = await votingLockup.rewardRate();
                const stakeAmount = simpleToExactAmount(100, 18);
                await expectSuccessfulStake(stakeAmount);

                await time.increase(ONE_DAY);

                // This is the total reward per staked token, since the last update
                const rewardPerToken = await votingLockup.rewardPerToken();
                const rewardPerSecond = new BN(1)
                    .mul(rewardRate)
                    .mul(fullScale)
                    .div(await votingLockup.staticBalanceOf(sa.default));
                assertBNClose(
                    rewardPerToken,
                    ONE_DAY.mul(rewardPerSecond),
                    rewardPerSecond.muln(10),
                );

                // Calc estimated unclaimed reward for the user
                // earned == balance * (rewardPerToken-userExistingReward)
                const earned = await votingLockup.earned(sa.default);
                expect(
                    (await votingLockup.staticBalanceOf(sa.default))
                        .mul(rewardPerToken)
                        .div(fullScale),
                ).bignumber.eq(earned);
            });
            it("should update stakers rewards after consequent stake", async () => {
                const stakeAmount = simpleToExactAmount(100, 18);
                // This checks resulting state after second stake
                await expectSuccessfulStake(stakeAmount, sa.default, true, true);
            });

            it("should fail if stake amount is 0", async () => {
                await expectRevert(
                    votingLockup.createLock(0, await oneWeekInAdvance(), { from: sa.default }),
                    "Must stake non zero amount",
                );
            });

            it("should fail if staker has insufficient balance", async () => {
                await stakingToken.approve(votingLockup.address, 1, { from: sa.dummy2 });
                await expectRevert(
                    votingLockup.createLock(1, await oneWeekInAdvance(), { from: sa.dummy2 }),
                    "SafeERC20: low-level call failed",
                );
            });
        });
    });
    context("staking before rewards are added", () => {
        before(async () => {
            votingLockup = await redeployRewards();
        });
        it("should assign no rewards", async () => {
            // Get data before
            const stakeAmount = simpleToExactAmount(100, 18);
            const beforeData = await snapshotStakingData();
            expect(beforeData.rewardRate).bignumber.eq(new BN(0));
            expect(beforeData.rewardPerTokenStored).bignumber.eq(new BN(0));
            expect(beforeData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
            expect(beforeData.totalStaticWeight).bignumber.eq(new BN(0));
            expect(beforeData.lastTimeRewardApplicable).bignumber.eq(new BN(0));

            await goToNextUnixWeekStart();
            // Do the stake
            await expectSuccessfulStake(stakeAmount);

            // Wait a day
            await time.increase(ONE_DAY);

            // Do another stake
            // await expectSuccessfulStake(stakeAmount);
            // Get end results
            const afterData = await snapshotStakingData();
            expect(afterData.rewardRate).bignumber.eq(new BN(0));
            expect(afterData.rewardPerTokenStored).bignumber.eq(new BN(0));
            expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
            assertBNClosePercent(
                afterData.totalStaticWeight,
                await calculateStaticBalance(ONE_WEEK, stakeAmount),
                "0.5",
            );
            expect(afterData.lastTimeRewardApplicable).bignumber.eq(new BN(0));
        });
    });
    context("adding first stake days after funding", () => {
        before(async () => {
            votingLockup = await redeployRewards();
        });
        it("should retrospectively assign rewards to the first staker", async () => {
            await expectSuccesfulFunding(simpleToExactAmount(100, 18));

            // Do the stake
            const rewardRate = await votingLockup.rewardRate();

            await time.increase(FIVE_DAYS);

            const stakeAmount = simpleToExactAmount(100, 18);
            await expectSuccessfulStake(stakeAmount);

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await votingLockup.rewardPerToken();

            const rewardPerSecond = new BN(1)
                .mul(rewardRate)
                .mul(fullScale)
                .div(await votingLockup.staticBalanceOf(sa.default));
            assertBNClose(rewardPerToken, FIVE_DAYS.mul(rewardPerSecond), rewardPerSecond.muln(4));

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await votingLockup.earned(sa.default);
            expect(
                (await votingLockup.staticBalanceOf(sa.default)).mul(rewardPerToken).div(fullScale),
            ).bignumber.eq(earnedAfterConsequentStake);
        });
    });
    context("staking over multiple funded periods", () => {
        context("with a single staker", () => {
            before(async () => {
                votingLockup = await redeployRewards();
            });
            it("should assign all the rewards from the periods", async () => {
                const fundAmount1 = simpleToExactAmount(100, 18);
                const fundAmount2 = simpleToExactAmount(200, 18);
                await expectSuccesfulFunding(fundAmount1);

                const stakeAmount = simpleToExactAmount(1, 18);
                await expectSuccessfulStake(stakeAmount);

                await time.increase(ONE_WEEK.muln(2));

                await expectSuccesfulFunding(fundAmount2);

                await time.increase(ONE_WEEK.muln(2));

                const earned = await votingLockup.earned(sa.default);
                assertBNSlightlyGT(fundAmount1.add(fundAmount2), earned, new BN(1000000), false);
            });
        });
        context("with multiple stakers coming in and out", () => {
            const fundAmount1 = simpleToExactAmount(10000, 19);
            const fundAmount2 = simpleToExactAmount(20000, 19);
            const staker2 = sa.dummy1;
            const staker3 = sa.dummy2;
            const staker1Stake1 = simpleToExactAmount(100, 18);
            const staker1Stake2 = simpleToExactAmount(200, 18);
            const staker2Stake = simpleToExactAmount(100, 18);
            const staker3Stake = simpleToExactAmount(100, 18);

            before(async () => {
                votingLockup = await redeployRewards();
                await stakingToken.transfer(staker2, staker2Stake);
                await stakingToken.transfer(staker3, staker3Stake);
            });
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

                const expectedStatic1 = await calculateStaticBalance(ONE_WEEK, staker1Stake1);
                const expectedStatic2 = await calculateStaticBalance(
                    ONE_WEEK.divn(2),
                    staker1Stake1,
                );
                const totalStaticp2 = expectedStatic1.muln(2).add(expectedStatic2);
                const expectedStatic3 = await calculateStaticBalance(ONE_WEEK, staker1Stake2);
                const totalStaticp3 = expectedStatic3.add(expectedStatic2);
                const staker1share = fundAmount1
                    .divn(2)
                    .divn(2)
                    .add(
                        fundAmount1
                            .divn(2)
                            .mul(expectedStatic1)
                            .div(totalStaticp2),
                    )
                    .add(fundAmount2.mul(expectedStatic3).div(totalStaticp3));
                const staker2share = fundAmount1
                    .divn(2)
                    .mul(expectedStatic2)
                    .div(totalStaticp2)
                    .add(fundAmount2.mul(expectedStatic2).div(totalStaticp3));
                const staker3share = fundAmount1
                    .divn(2)
                    .divn(2)
                    .add(
                        fundAmount1
                            .divn(2)
                            .mul(expectedStatic1)
                            .div(totalStaticp2),
                    );

                // WEEK 0-1 START
                await goToNextUnixWeekStart();
                await expectSuccessfulStake(staker1Stake1);
                await expectSuccessfulStake(staker3Stake, staker3);
                await expectSuccesfulFunding(fundAmount1);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                await expectSuccessfulStake(staker2Stake, staker2);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                // WEEK 1-2 START
                await expectSuccesfulFunding(fundAmount2);

                await votingLockup.eject(staker3);
                await votingLockup.withdraw({ from: sa.default });
                await expectSuccessfulStake(staker1Stake2, sa.default);

                await time.increase(ONE_WEEK);

                // WEEK 2 FINISH
                const earned1 = await votingLockup.earned(sa.default);
                const earned2 = await votingLockup.earned(staker2);
                const earned3 = await votingLockup.earned(staker3);
                assertBNClose(earned1, staker1share, simpleToExactAmount(5, 19));
                assertBNClose(earned2, staker2share, simpleToExactAmount(5, 19));
                assertBNClose(earned3, staker3share, simpleToExactAmount(5, 19));
                // Ensure that sum of earned rewards does not exceed funcing amount
                expect(fundAmount1.add(fundAmount2)).bignumber.gte(
                    earned1.add(earned2).add(earned3) as any,
                );
            });
        });
    });
    context("staking after period finish", () => {
        const fundAmount1 = simpleToExactAmount(100, 21);

        before(async () => {
            votingLockup = await redeployRewards();
        });
        it("should stop accruing rewards after the period is over", async () => {
            await expectSuccessfulStake(simpleToExactAmount(1, 18));
            await expectSuccesfulFunding(fundAmount1);

            await time.increase(ONE_WEEK.addn(1));

            const earnedAfterWeek = await votingLockup.earned(sa.default);

            await time.increase(ONE_WEEK.addn(1));
            const now = await time.latest();

            const earnedAfterTwoWeeks = await votingLockup.earned(sa.default);

            expect(earnedAfterWeek).bignumber.eq(earnedAfterTwoWeeks);

            const lastTimeRewardApplicable = await votingLockup.lastTimeRewardApplicable();
            assertBNClose(lastTimeRewardApplicable, now.sub(ONE_WEEK).subn(2), new BN(2));
        });
    });

    context("getting the reward token", () => {
        before(async () => {
            votingLockup = await redeployRewards();
        });
        it("should simply return the rewards Token", async () => {
            const readToken = await votingLockup.getRewardToken();
            expect(readToken).eq(stakingToken.address);
            expect(readToken).eq(await votingLockup.stakingToken());
        });
    });

    context("notifying new reward amount", () => {
        context("from someone other than the distributor", () => {
            before(async () => {
                votingLockup = await redeployRewards();
            });
            it("should fail", async () => {
                await expectRevert(
                    votingLockup.notifyRewardAmount(1, { from: sa.default }),
                    "Caller is not reward distributor",
                );
                await expectRevert(
                    votingLockup.notifyRewardAmount(1, { from: sa.dummy1 }),
                    "Caller is not reward distributor",
                );
                await expectRevert(
                    votingLockup.notifyRewardAmount(1, { from: sa.governor }),
                    "Caller is not reward distributor",
                );
            });
        });
        context("before current period finish", async () => {
            const funding1 = simpleToExactAmount(100, 18);
            const funding2 = simpleToExactAmount(200, 18);
            beforeEach(async () => {
                votingLockup = await redeployRewards();
            });
            it("should factor in unspent units to the new rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1);
                const actualRewardRate = await votingLockup.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);

                // Zoom forward half a week
                await time.increase(ONE_WEEK.divn(2));

                // Do the second funding, and factor in the unspent units
                const expectedLeftoverReward = funding1.divn(2);
                await expectSuccesfulFunding(funding2);
                const actualRewardRateAfter = await votingLockup.rewardRate();
                const totalRewardsForWeek = funding2.add(expectedLeftoverReward);
                const expectedRewardRateAfter = totalRewardsForWeek.div(ONE_WEEK);
                assertBNClose(
                    actualRewardRateAfter,
                    expectedRewardRateAfter,
                    actualRewardRate.div(ONE_WEEK).muln(20),
                );
            });
            it("should factor in unspent units to the new rewardRate if instant", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1);
                const actualRewardRate = await votingLockup.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);

                // Zoom forward half a week
                await time.increase(1);

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding2);
                const actualRewardRateAfter = await votingLockup.rewardRate();
                const expectedRewardRateAfter = funding1.add(funding2).div(ONE_WEEK);
                assertBNClose(
                    actualRewardRateAfter,
                    expectedRewardRateAfter,
                    actualRewardRate.div(ONE_WEEK).muln(20),
                );
            });
        });

        context("after current period finish", () => {
            const funding1 = simpleToExactAmount(100, 18);
            before(async () => {
                votingLockup = await redeployRewards();
            });
            it("should start a new period with the correct rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1);
                const actualRewardRate = await votingLockup.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);

                // Zoom forward half a week
                await time.increase(ONE_WEEK.addn(1));

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding1.muln(2));
                const actualRewardRateAfter = await votingLockup.rewardRate();
                const expectedRewardRateAfter = expectedRewardRate.muln(2);
                expect(actualRewardRateAfter).bignumber.eq(expectedRewardRateAfter);
            });
        });
    });

    context("withdrawing stake or rewards", () => {
        context("withdrawing a stake amount", () => {
            const fundAmount = simpleToExactAmount(100, 21);
            const stakeAmount = simpleToExactAmount(100, 18);

            before(async () => {
                votingLockup = await redeployRewards();
                await expectSuccessfulStake(stakeAmount);
                await time.increase(ONE_WEEK.divn(3).muln(2));
                await expectSuccesfulFunding(fundAmount);
                await time.increase(ONE_WEEK.divn(3).muln(2));
            });
            it("should revert for a non-staker", async () => {
                await expectRevert(
                    votingLockup.withdraw({ from: sa.dummy1 }),
                    "Must have something to withdraw",
                );
            });
            it("should withdraw the stake and update the existing reward accrual", async () => {
                // Check that the user has earned something
                const earnedBefore = await votingLockup.earned(sa.default);
                expect(earnedBefore).bignumber.gt(new BN(0) as any);
                const rewardsBefore = await votingLockup.rewards(sa.default);
                expect(rewardsBefore).bignumber.eq(new BN(0));

                // Execute the withdrawal
                await expectStakingWithdrawal();

                // Ensure that the new awards are added + assigned to user
                const earnedAfter = await votingLockup.earned(sa.default);
                expect(earnedAfter).bignumber.gte(earnedBefore as any);
                const rewardsAfter = await votingLockup.rewards(sa.default);
                expect(rewardsAfter).bignumber.eq(earnedAfter);

                // Zoom forward now
                await time.increase(10);

                // Check that the user does not earn anything else
                const earnedEnd = await votingLockup.earned(sa.default);
                expect(earnedEnd).bignumber.eq(earnedAfter);
                const rewardsEnd = await votingLockup.rewards(sa.default);
                expect(rewardsEnd).bignumber.eq(rewardsAfter);

                // Cannot withdraw anything else
                await expectRevert(
                    votingLockup.withdraw({ from: sa.default }),
                    "Must have something to withdraw",
                );
            });
        });
        context("claiming rewards", async () => {
            const fundAmount = simpleToExactAmount(100, 21);
            const stakeAmount = simpleToExactAmount(100, 18);

            before(async () => {
                votingLockup = await redeployRewards();
                await expectSuccesfulFunding(fundAmount);
                await stakingToken.transfer(votingLockup.address, fundAmount, {
                    from: rewardsDistributor,
                });
                await stakingToken.transfer(sa.dummy2, stakeAmount, {
                    from: rewardsDistributor,
                });
                await expectSuccessfulStake(stakeAmount, sa.dummy2);
                await time.increase(ONE_WEEK.addn(1));
            });
            it("should do nothing for a non-staker", async () => {
                const beforeData = await snapshotStakingData(sa.dummy1);
                await votingLockup.claimReward({ from: sa.dummy1 });

                const afterData = await snapshotStakingData(sa.dummy1);
                expect(beforeData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
                expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
                expect(afterData.senderStakingTokenBalance).bignumber.eq(new BN(0));
                expect(afterData.userRewardPerTokenPaid).bignumber.eq(
                    afterData.rewardPerTokenStored,
                );
            });
            it("should send all accrued rewards to the rewardee", async () => {
                const beforeData = await snapshotStakingData(sa.dummy2);

                const tx = await votingLockup.claimReward({ from: sa.dummy2 });
                expectEvent(tx.receipt, "RewardPaid", {
                    user: sa.dummy2,
                });
                const afterData = await snapshotStakingData(sa.dummy2);
                await assertRewardsAssigned(beforeData, afterData, false, true);
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await stakingToken.balanceOf(sa.dummy2);
                assertBNClose(rewardeeBalanceAfter, fundAmount, simpleToExactAmount(1, 16));

                // 'rewards' reset to 0
                expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0), "i1");
                // Paid up until the last block
                expect(afterData.userRewardPerTokenPaid).bignumber.eq(
                    afterData.rewardPerTokenStored,
                    "i2",
                );
                // Token balances dont change
                expect(afterData.senderStakingTokenBalance).bignumber.eq(
                    beforeData.senderStakingTokenBalance.add(
                        await votingLockup.rewardsPaid(sa.dummy2),
                    ),
                    "i3",
                );
                expect(beforeData.userStaticWeight).bignumber.eq(afterData.userStaticWeight, "i4");
            });
        });
        context("completely 'exiting' the system", () => {
            const fundAmount = simpleToExactAmount(100, 21);
            const stakeAmount = simpleToExactAmount(100, 18);

            before(async () => {
                votingLockup = await redeployRewards();
                await expectSuccesfulFunding(fundAmount);
                await stakingToken.transfer(votingLockup.address, fundAmount, {
                    from: rewardsDistributor,
                });
                await expectSuccessfulStake(stakeAmount);
                await time.increase(ONE_WEEK.addn(1));
            });
            it("should fail if the sender has no stake", async () => {
                await expectRevert(
                    votingLockup.exit({ from: sa.dummy1 }),
                    "Must have something to withdraw",
                );
            });
            it("should withdraw all senders stake and send outstanding rewards to the staker", async () => {
                const beforeData = await snapshotStakingData();
                const rewardeeBalanceBefore = await stakingToken.balanceOf(sa.default);

                const tx = await votingLockup.exit();
                expectEvent(tx.receipt, "Withdraw", {
                    provider: sa.default,
                    value: stakeAmount,
                });
                expectEvent(tx.receipt, "RewardPaid", {
                    user: sa.default,
                });

                const afterData = await snapshotStakingData();
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await stakingToken.balanceOf(sa.default);
                assertBNClose(
                    rewardeeBalanceAfter.sub(rewardeeBalanceBefore),
                    fundAmount.add(stakeAmount),
                    simpleToExactAmount(1, 16),
                );

                // Expect Rewards to accrue to the beneficiary
                //    StakingToken balance of sender
                await assertRewardsAssigned(beforeData, afterData, false, true);

                // Expect token transfer
                //    StakingToken balance of sender
                expect(
                    beforeData.senderStakingTokenBalance
                        .add(stakeAmount)
                        .add(await votingLockup.rewardsPaid(sa.default)),
                ).bignumber.eq(afterData.senderStakingTokenBalance);

                //    Withdraws from the actual rewards wrapper token
                expect(afterData.userStaticWeight).bignumber.eq(new BN(0));

                //    Updates total supply
                expect(beforeData.totalStaticWeight.sub(beforeData.userStaticWeight)).bignumber.eq(
                    afterData.totalStaticWeight,
                );

                await expectRevert(votingLockup.exit(), "Must have something to withdraw");
            });
        });
    });
    context("running a full integration test", () => {
        const fundAmount = simpleToExactAmount(100, 21);
        const stakeAmount = simpleToExactAmount(100, 18);
        let period;

        before(async () => {
            votingLockup = await redeployRewards();
        });
        it("1. should allow the rewardsDistributor to fund the pool", async () => {
            await stakingToken.transfer(votingLockup.address, fundAmount, {
                from: rewardsDistributor,
            });
            await expectSuccesfulFunding(fundAmount);
        });
        it("2. should allow stakers to stake and earn rewards", async () => {
            await expectSuccessfulStake(stakeAmount);
            await time.increase(ONE_WEEK.addn(1));
        });
        it("3. should credit earnings directly to beneficiary", async () => {
            const beforeData = await snapshotStakingData();
            const beneficiaryBalanceBefore = await stakingToken.balanceOf(sa.default);

            await votingLockup.exit();

            const afterData = await snapshotStakingData();
            // Balance transferred to the rewardee
            const beneficiaryBalanceAfter = await stakingToken.balanceOf(sa.default);
            assertBNClose(
                beneficiaryBalanceAfter.sub(beneficiaryBalanceBefore),
                fundAmount.add(stakeAmount),
                simpleToExactAmount(1, 16),
            );

            await assertRewardsAssigned(beforeData, afterData, false, true);
        });
    });
});
