/* eslint-disable no-nested-ternary */

import * as t from "types/generated";
import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { ONE_WEEK, ONE_DAY, FIVE_DAYS, fullScale } from "@utils/constants";
import envSetup from "@utils/env_setup";

import shouldBehaveLikeRecipient from "./RewardsDistributionRecipient.behaviour";

const MockERC20 = artifacts.require("MockERC20");
const StakingRewards = artifacts.require("StakingRewards");

const { expect } = envSetup.configure();

contract("StakingRewards", async (accounts) => {
    const recipientCtx: {
        recipient?: t.RewardsDistributionRecipientInstance;
    } = {};
    const moduleCtx: {
        module?: t.ModuleInstance;
    } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;

    const rewardsDistributor = sa.fundManager;
    let rewardToken: t.MockERC20Instance;
    let stakingToken: t.MockERC20Instance;
    let stakingRewards: t.StakingRewardsInstance;

    const redeployRewards = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.StakingRewardsInstance> => {
        rewardToken = await MockERC20.new("Reward", "RWD", 18, rewardsDistributor, 1000000);
        stakingToken = await MockERC20.new("Staking", "ST8k", 18, sa.default, 1000000);
        return StakingRewards.new(
            nexusAddress,
            stakingToken.address,
            rewardToken.address,
            rewardsDistributor,
        );
    };

    interface StakingData {
        totalSupply: BN;
        userStakingBalance: BN;
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

    const snapshotStakingData = async (
        sender = sa.default,
        beneficiary = sa.default,
    ): Promise<StakingData> => {
        return {
            totalSupply: await stakingRewards.totalSupply(),
            userStakingBalance: await stakingRewards.balanceOf(beneficiary),
            userRewardPerTokenPaid: await stakingRewards.userRewardPerTokenPaid(beneficiary),
            senderStakingTokenBalance: await stakingToken.balanceOf(sender),
            contractStakingTokenBalance: await stakingToken.balanceOf(stakingRewards.address),
            beneficiaryRewardsEarned: await stakingRewards.rewards(beneficiary),
            rewardPerTokenStored: await stakingRewards.rewardPerTokenStored(),
            rewardRate: await stakingRewards.rewardRate(),
            lastUpdateTime: await stakingRewards.lastUpdateTime(),
            lastTimeRewardApplicable: await stakingRewards.lastTimeRewardApplicable(),
            periodFinishTime: await stakingRewards.periodFinish(),
        };
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
        stakingRewards = await redeployRewards();
        recipientCtx.recipient = (stakingRewards as unknown) as t.RewardsDistributionRecipientInstance;
        moduleCtx.module = stakingRewards as t.ModuleInstance;
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
            stakingRewards = await redeployRewards();
        });
        it("should set all initial state", async () => {
            // Set in constructor
            expect(await stakingRewards.nexus(), systemMachine.nexus.address);
            expect(await stakingRewards.stakingToken(), stakingToken.address);
            expect(await stakingRewards.rewardsToken(), rewardToken.address);
            expect(await stakingRewards.rewardsDistributor(), rewardsDistributor);

            // Basic storage
            expect(await stakingRewards.totalSupply()).bignumber.eq(new BN(0));
            expect(await stakingRewards.periodFinish()).bignumber.eq(new BN(0));
            expect(await stakingRewards.rewardRate()).bignumber.eq(new BN(0));
            expect(await stakingRewards.lastUpdateTime()).bignumber.eq(new BN(0));
            expect(await stakingRewards.rewardPerTokenStored()).bignumber.eq(new BN(0));
            expect(await stakingRewards.lastTimeRewardApplicable()).bignumber.eq(new BN(0));
            expect(await stakingRewards.rewardPerToken()).bignumber.eq(new BN(0));
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
                : beforeData.rewardPerTokenStored.eqn(0) && beforeData.totalSupply.eqn(0)
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
        const increaseInRewardPerToken = beforeData.totalSupply.eq(new BN(0))
            ? new BN(0)
            : beforeData.rewardRate
                  .mul(timeApplicableToRewards)
                  .mul(fullScale)
                  .div(beforeData.totalSupply);
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
            const assignment = beforeData.userStakingBalance
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
        beneficiary = sa.default,
        confirmExistingStaker = false,
    ): Promise<void> => {
        // 1. Get data from the contract
        const senderIsBeneficiary = sender === beneficiary;
        const beforeData = await snapshotStakingData(sender, beneficiary);

        const isExistingStaker = beforeData.userStakingBalance.gt(new BN(0));
        if (confirmExistingStaker) {
            expect(isExistingStaker).eq(true);
        }
        // 2. Approve staking token spending and send the TX
        await stakingToken.approve(stakingRewards.address, stakeAmount, {
            from: sender,
        });
        const tx = await (senderIsBeneficiary
            ? stakingRewards.methods["stake(uint256)"](stakeAmount, {
                  from: sender,
              })
            : stakingRewards.methods["stake(address,uint256)"](beneficiary, stakeAmount, {
                  from: sender,
              }));
        expectEvent(tx.receipt, "Staked", {
            user: beneficiary,
            amount: stakeAmount,
            payer: sender,
        });

        // 3. Ensure rewards are accrued to the beneficiary
        const afterData = await snapshotStakingData(sender, beneficiary);
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker);

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.senderStakingTokenBalance.sub(stakeAmount)).bignumber.eq(
            afterData.senderStakingTokenBalance,
        );
        //    StakingToken balance of StakingRewards
        expect(beforeData.contractStakingTokenBalance.add(stakeAmount)).bignumber.eq(
            afterData.contractStakingTokenBalance,
        );
        //    TotalSupply of StakingRewards
        expect(beforeData.totalSupply.add(stakeAmount)).bignumber.eq(afterData.totalSupply);
    };

    /**
     * @dev Ensures a funding is successful, checking that it updates the rewardRate etc
     * @param rewardUnits Number of units to stake
     */
    const expectSuccesfulFunding = async (rewardUnits: BN): Promise<void> => {
        const beforeData = await snapshotStakingData();
        const tx = await stakingRewards.notifyRewardAmount(rewardUnits, {
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
     * @param withdrawAmount Exact amount to withdraw
     * @param sender User to execute the tx
     */
    const expectStakingWithdrawal = async (
        withdrawAmount: BN,
        sender = sa.default,
    ): Promise<void> => {
        // 1. Get data from the contract
        const beforeData = await snapshotStakingData(sender);
        const isExistingStaker = beforeData.userStakingBalance.gt(new BN(0));
        expect(isExistingStaker).eq(true);
        expect(withdrawAmount).bignumber.gte(beforeData.userStakingBalance as any);

        // 2. Send withdrawal tx
        const tx = await stakingRewards.withdraw(withdrawAmount, {
            from: sender,
        });
        expectEvent(tx.receipt, "Withdrawn", {
            user: sender,
            amount: withdrawAmount,
        });

        // 3. Expect Rewards to accrue to the beneficiary
        //    StakingToken balance of sender
        const afterData = await snapshotStakingData(sender);
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker);

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.senderStakingTokenBalance.add(withdrawAmount)).bignumber.eq(
            afterData.senderStakingTokenBalance,
        );
        //    Withdraws from the actual rewards wrapper token
        expect(beforeData.userStakingBalance.sub(withdrawAmount)).bignumber.eq(
            afterData.userStakingBalance,
        );
        //    Updates total supply
        expect(beforeData.totalSupply.sub(withdrawAmount)).bignumber.eq(afterData.totalSupply);
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
                const rewardRate = await stakingRewards.rewardRate();
                const stakeAmount = simpleToExactAmount(100, 18);
                await expectSuccessfulStake(stakeAmount);

                await time.increase(ONE_DAY);

                // This is the total reward per staked token, since the last update
                const rewardPerToken = await stakingRewards.rewardPerToken();
                const rewardPerSecond = new BN(1)
                    .mul(rewardRate)
                    .mul(fullScale)
                    .div(stakeAmount);
                assertBNClose(
                    rewardPerToken,
                    ONE_DAY.mul(rewardPerSecond),
                    rewardPerSecond.muln(10),
                );

                // Calc estimated unclaimed reward for the user
                // earned == balance * (rewardPerToken-userExistingReward)
                const earned = await stakingRewards.earned(sa.default);
                expect(stakeAmount.mul(rewardPerToken).div(fullScale)).bignumber.eq(earned);
            });
            it("should update stakers rewards after consequent stake", async () => {
                const stakeAmount = simpleToExactAmount(100, 18);
                // This checks resulting state after second stake
                await expectSuccessfulStake(stakeAmount, sa.default, sa.default, true);
            });

            it("should fail if stake amount is 0", async () => {
                await expectRevert(
                    stakingRewards.methods["stake(uint256)"](0, { from: sa.default }),
                    "Cannot stake 0",
                );
            });

            it("should fail if staker has insufficient balance", async () => {
                await stakingToken.approve(stakingRewards.address, 1, { from: sa.dummy2 });
                await expectRevert(
                    stakingRewards.methods["stake(uint256)"](1, { from: sa.dummy2 }),
                    "SafeERC20: low-level call failed",
                );
            });
        });
    });
    context("funding with too much rewards", () => {
        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("should fail", async () => {
            await expectRevert(
                stakingRewards.notifyRewardAmount(simpleToExactAmount(1, 25), {
                    from: sa.fundManager,
                }),
                "Cannot notify with more than a million units",
            );
        });
    });
    context("staking before rewards are added", () => {
        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("should assign no rewards", async () => {
            // Get data before
            const stakeAmount = simpleToExactAmount(100, 18);
            const beforeData = await snapshotStakingData();
            expect(beforeData.rewardRate).bignumber.eq(new BN(0));
            expect(beforeData.rewardPerTokenStored).bignumber.eq(new BN(0));
            expect(beforeData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
            expect(beforeData.totalSupply).bignumber.eq(new BN(0));
            expect(beforeData.lastTimeRewardApplicable).bignumber.eq(new BN(0));

            // Do the stake
            await expectSuccessfulStake(stakeAmount);

            // Wait a day
            await time.increase(ONE_DAY);

            // Do another stake
            await expectSuccessfulStake(stakeAmount);

            // Get end results
            const afterData = await snapshotStakingData();
            expect(afterData.rewardRate).bignumber.eq(new BN(0));
            expect(afterData.rewardPerTokenStored).bignumber.eq(new BN(0));
            expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
            expect(afterData.totalSupply).bignumber.eq(stakeAmount.muln(2));
            expect(afterData.lastTimeRewardApplicable).bignumber.eq(new BN(0));
        });
    });
    context("adding first stake days after funding", () => {
        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("should retrospectively assign rewards to the first staker", async () => {
            await expectSuccesfulFunding(simpleToExactAmount(100, 18));

            // Do the stake
            const rewardRate = await stakingRewards.rewardRate();

            await time.increase(FIVE_DAYS);

            const stakeAmount = simpleToExactAmount(100, 18);
            await expectSuccessfulStake(stakeAmount);

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await stakingRewards.rewardPerToken();

            const rewardPerSecond = new BN(1)
                .mul(rewardRate)
                .mul(fullScale)
                .div(stakeAmount);
            assertBNClose(rewardPerToken, FIVE_DAYS.mul(rewardPerSecond), rewardPerSecond.muln(4));

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await stakingRewards.earned(sa.default);
            expect(stakeAmount.mul(rewardPerToken).div(fullScale)).bignumber.eq(
                earnedAfterConsequentStake,
            );
        });
    });
    context("staking over multiple funded periods", () => {
        context("with a single staker", () => {
            before(async () => {
                stakingRewards = await redeployRewards();
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

                const earned = await stakingRewards.earned(sa.default);
                assertBNSlightlyGT(fundAmount1.add(fundAmount2), earned, new BN(1000000), false);
            });
        });
        context("with multiple stakers coming in and out", () => {
            const fundAmount1 = simpleToExactAmount(100, 21);
            const fundAmount2 = simpleToExactAmount(200, 21);
            const staker2 = sa.dummy1;
            const staker3 = sa.dummy2;
            const staker1Stake1 = simpleToExactAmount(100, 18);
            const staker1Stake2 = simpleToExactAmount(200, 18);
            const staker2Stake = simpleToExactAmount(100, 18);
            const staker3Stake = simpleToExactAmount(100, 18);

            before(async () => {
                stakingRewards = await redeployRewards();
                await stakingToken.transfer(staker2, staker2Stake);
                await stakingToken.transfer(staker3, staker3Stake);
            });
            it("should accrue rewards on a pro rata basis", async () => {
                /*
                 *  0               1               2   <-- Weeks
                 *   [ - - - - - - ] [ - - - - - - ]
                 * 100k            200k                 <-- Funding
                 * +100            +200                 <-- Staker 1
                 *        +100                          <-- Staker 2
                 * +100            -100                 <-- Staker 3
                 *
                 * Staker 1 gets 25k + 16.66k from week 1 + 150k from week 2 = 191.66k
                 * Staker 2 gets 16.66k from week 1 + 50k from week 2 = 66.66k
                 * Staker 3 gets 25k + 16.66k from week 1 + 0 from week 2 = 41.66k
                 */

                // WEEK 0-1 START
                await expectSuccessfulStake(staker1Stake1);
                await expectSuccessfulStake(staker3Stake, staker3, staker3);

                await expectSuccesfulFunding(fundAmount1);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                await expectSuccessfulStake(staker2Stake, staker2, staker2);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                // WEEK 1-2 START
                await expectSuccesfulFunding(fundAmount2);

                await stakingRewards.withdraw(staker3Stake, { from: staker3 });
                await expectSuccessfulStake(staker1Stake2, sa.default, sa.default, true);

                await time.increase(ONE_WEEK);

                // WEEK 2 FINISH
                const earned1 = await stakingRewards.earned(sa.default);
                assertBNClose(
                    earned1,
                    simpleToExactAmount("191.66", 21),
                    simpleToExactAmount(1, 19),
                );
                const earned2 = await stakingRewards.earned(staker2);
                assertBNClose(
                    earned2,
                    simpleToExactAmount("66.66", 21),
                    simpleToExactAmount(1, 19),
                );
                const earned3 = await stakingRewards.earned(staker3);
                assertBNClose(
                    earned3,
                    simpleToExactAmount("41.66", 21),
                    simpleToExactAmount(1, 19),
                );
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
            stakingRewards = await redeployRewards();
        });
        it("should stop accruing rewards after the period is over", async () => {
            await expectSuccessfulStake(simpleToExactAmount(1, 18));
            await expectSuccesfulFunding(fundAmount1);

            await time.increase(ONE_WEEK.addn(1));

            const earnedAfterWeek = await stakingRewards.earned(sa.default);

            await time.increase(ONE_WEEK.addn(1));
            const now = await time.latest();

            const earnedAfterTwoWeeks = await stakingRewards.earned(sa.default);

            expect(earnedAfterWeek).bignumber.eq(earnedAfterTwoWeeks);

            const lastTimeRewardApplicable = await stakingRewards.lastTimeRewardApplicable();
            assertBNClose(lastTimeRewardApplicable, now.sub(ONE_WEEK).subn(2), new BN(2));
        });
    });
    context("staking on behalf of a beneficiary", () => {
        const fundAmount = simpleToExactAmount(100, 21);
        const beneficiary = sa.dummy1;
        const stakeAmount = simpleToExactAmount(100, 18);

        before(async () => {
            stakingRewards = await redeployRewards();
            await expectSuccesfulFunding(fundAmount);
            await expectSuccessfulStake(stakeAmount, sa.default, beneficiary);
            await time.increase(10);
        });
        it("should update the beneficiaries reward details", async () => {
            const earned = await stakingRewards.earned(beneficiary);
            expect(earned).bignumber.gt(new BN(0) as any);

            const balance = await stakingRewards.balanceOf(beneficiary);
            expect(balance).bignumber.eq(stakeAmount);
        });
        it("should not update the senders details", async () => {
            const earned = await stakingRewards.earned(sa.default);
            expect(earned).bignumber.eq(new BN(0));

            const balance = await stakingRewards.balanceOf(sa.default);
            expect(balance).bignumber.eq(new BN(0));
        });
    });
    context("using staking / reward tokens with diff decimals", () => {
        before(async () => {
            rewardToken = await MockERC20.new("Reward", "RWD", 12, rewardsDistributor, 1000000);
            stakingToken = await MockERC20.new("Staking", "ST8k", 16, sa.default, 1000000);
            stakingRewards = await StakingRewards.new(
                systemMachine.nexus.address,
                stakingToken.address,
                rewardToken.address,
                rewardsDistributor,
            );
        });
        it("should not affect the pro rata payouts", async () => {
            // Add 100 reward tokens
            await expectSuccesfulFunding(simpleToExactAmount(100, 12));
            const rewardRate = await stakingRewards.rewardRate();

            // Do the stake
            const stakeAmount = simpleToExactAmount(100, 16);
            await expectSuccessfulStake(stakeAmount);

            await time.increase(ONE_WEEK.addn(1));

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await stakingRewards.rewardPerToken();
            assertBNClose(
                rewardPerToken,
                ONE_WEEK.mul(rewardRate)
                    .mul(fullScale)
                    .div(stakeAmount),
                new BN(1)
                    .mul(rewardRate)
                    .mul(fullScale)
                    .div(stakeAmount),
            );

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await stakingRewards.earned(sa.default);
            assertBNSlightlyGT(
                simpleToExactAmount(100, 12),
                earnedAfterConsequentStake,
                simpleToExactAmount(1, 9),
            );
        });
    });

    context("getting the reward token", () => {
        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("should simply return the rewards Token", async () => {
            const readToken = await stakingRewards.getRewardToken();
            expect(readToken).eq(rewardToken.address);
            expect(readToken).eq(await stakingRewards.rewardsToken());
        });
    });

    context("notifying new reward amount", () => {
        context("from someone other than the distributor", () => {
            before(async () => {
                stakingRewards = await redeployRewards();
            });
            it("should fail", async () => {
                await expectRevert(
                    stakingRewards.notifyRewardAmount(1, { from: sa.default }),
                    "Caller is not reward distributor",
                );
                await expectRevert(
                    stakingRewards.notifyRewardAmount(1, { from: sa.dummy1 }),
                    "Caller is not reward distributor",
                );
                await expectRevert(
                    stakingRewards.notifyRewardAmount(1, { from: sa.governor }),
                    "Caller is not reward distributor",
                );
            });
        });
        context("before current period finish", async () => {
            const funding1 = simpleToExactAmount(100, 18);
            const funding2 = simpleToExactAmount(200, 18);
            beforeEach(async () => {
                stakingRewards = await redeployRewards();
            });
            it("should factor in unspent units to the new rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1);
                const actualRewardRate = await stakingRewards.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);

                // Zoom forward half a week
                await time.increase(ONE_WEEK.divn(2));

                // Do the second funding, and factor in the unspent units
                const expectedLeftoverReward = funding1.divn(2);
                await expectSuccesfulFunding(funding2);
                const actualRewardRateAfter = await stakingRewards.rewardRate();
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
                const actualRewardRate = await stakingRewards.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);

                // Zoom forward half a week
                await time.increase(1);

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding2);
                const actualRewardRateAfter = await stakingRewards.rewardRate();
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
                stakingRewards = await redeployRewards();
            });
            it("should start a new period with the correct rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1);
                const actualRewardRate = await stakingRewards.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);

                // Zoom forward half a week
                await time.increase(ONE_WEEK.addn(1));

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding1.muln(2));
                const actualRewardRateAfter = await stakingRewards.rewardRate();
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
                stakingRewards = await redeployRewards();
                await expectSuccesfulFunding(fundAmount);
                await expectSuccessfulStake(stakeAmount);
                await time.increase(10);
            });
            it("should revert for a non-staker", async () => {
                await expectRevert(
                    stakingRewards.withdraw(1, { from: sa.dummy1 }),
                    "SafeMath: subtraction overflow",
                );
            });
            it("should revert if insufficient balance", async () => {
                await expectRevert(
                    stakingRewards.withdraw(stakeAmount.addn(1), { from: sa.default }),
                    "SafeMath: subtraction overflow",
                );
            });
            it("should fail if trying to withdraw 0", async () => {
                await expectRevert(
                    stakingRewards.withdraw(0, { from: sa.default }),
                    "Cannot withdraw 0",
                );
            });
            it("should withdraw the stake and update the existing reward accrual", async () => {
                // Check that the user has earned something
                const earnedBefore = await stakingRewards.earned(sa.default);
                expect(earnedBefore).bignumber.gt(new BN(0) as any);
                const rewardsBefore = await stakingRewards.rewards(sa.default);
                expect(rewardsBefore).bignumber.eq(new BN(0));

                // Execute the withdrawal
                await expectStakingWithdrawal(stakeAmount);

                // Ensure that the new awards are added + assigned to user
                const earnedAfter = await stakingRewards.earned(sa.default);
                expect(earnedAfter).bignumber.gte(earnedBefore as any);
                const rewardsAfter = await stakingRewards.rewards(sa.default);
                expect(rewardsAfter).bignumber.eq(earnedAfter);

                // Zoom forward now
                await time.increase(10);

                // Check that the user does not earn anything else
                const earnedEnd = await stakingRewards.earned(sa.default);
                expect(earnedEnd).bignumber.eq(earnedAfter);
                const rewardsEnd = await stakingRewards.rewards(sa.default);
                expect(rewardsEnd).bignumber.eq(rewardsAfter);

                // Cannot withdraw anything else
                await expectRevert(
                    stakingRewards.withdraw(stakeAmount.addn(1), { from: sa.default }),
                    "SafeMath: subtraction overflow",
                );
            });
        });
        context("claiming rewards", async () => {
            const fundAmount = simpleToExactAmount(100, 21);
            const stakeAmount = simpleToExactAmount(100, 18);

            before(async () => {
                stakingRewards = await redeployRewards();
                await expectSuccesfulFunding(fundAmount);
                await rewardToken.transfer(stakingRewards.address, fundAmount, {
                    from: rewardsDistributor,
                });
                await expectSuccessfulStake(stakeAmount, sa.default, sa.dummy2);
                await time.increase(ONE_WEEK.addn(1));
            });
            it("should do nothing for a non-staker", async () => {
                const beforeData = await snapshotStakingData(sa.dummy1, sa.dummy1);
                await stakingRewards.claimReward({ from: sa.dummy1 });

                const afterData = await snapshotStakingData(sa.dummy1, sa.dummy1);
                expect(beforeData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
                expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
                expect(afterData.senderStakingTokenBalance).bignumber.eq(new BN(0));
                expect(afterData.userRewardPerTokenPaid).bignumber.eq(
                    afterData.rewardPerTokenStored,
                );
            });
            it("should send all accrued rewards to the rewardee", async () => {
                const beforeData = await snapshotStakingData(sa.dummy2, sa.dummy2);
                const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.dummy2);
                expect(rewardeeBalanceBefore).bignumber.eq(new BN(0));
                const tx = await stakingRewards.claimReward({ from: sa.dummy2 });
                expectEvent(tx.receipt, "RewardPaid", {
                    user: sa.dummy2,
                });
                const afterData = await snapshotStakingData(sa.dummy2, sa.dummy2);
                await assertRewardsAssigned(beforeData, afterData, false, true);
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.dummy2);
                assertBNClose(rewardeeBalanceAfter, fundAmount, simpleToExactAmount(1, 16));

                // 'rewards' reset to 0
                expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
                // Paid up until the last block
                expect(afterData.userRewardPerTokenPaid).bignumber.eq(
                    afterData.rewardPerTokenStored,
                );
                // Token balances dont change
                expect(afterData.senderStakingTokenBalance).bignumber.eq(
                    beforeData.senderStakingTokenBalance,
                );
                expect(beforeData.userStakingBalance).bignumber.eq(afterData.userStakingBalance);
            });
        });
        context("completely 'exiting' the system", () => {
            const fundAmount = simpleToExactAmount(100, 21);
            const stakeAmount = simpleToExactAmount(100, 18);

            before(async () => {
                stakingRewards = await redeployRewards();
                await expectSuccesfulFunding(fundAmount);
                await rewardToken.transfer(stakingRewards.address, fundAmount, {
                    from: rewardsDistributor,
                });
                await expectSuccessfulStake(stakeAmount);
                await time.increase(ONE_WEEK.addn(1));
            });
            it("should fail if the sender has no stake", async () => {
                await expectRevert(stakingRewards.exit({ from: sa.dummy1 }), "Cannot withdraw 0");
            });
            it("should withdraw all senders stake and send outstanding rewards to the staker", async () => {
                const beforeData = await snapshotStakingData();
                const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.default);

                const tx = await stakingRewards.exit();
                expectEvent(tx.receipt, "Withdrawn", {
                    user: sa.default,
                    amount: stakeAmount,
                });
                expectEvent(tx.receipt, "RewardPaid", {
                    user: sa.default,
                });

                const afterData = await snapshotStakingData();
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.default);
                assertBNClose(
                    rewardeeBalanceAfter.sub(rewardeeBalanceBefore),
                    fundAmount,
                    simpleToExactAmount(1, 16),
                );

                // Expect Rewards to accrue to the beneficiary
                //    StakingToken balance of sender
                await assertRewardsAssigned(beforeData, afterData, false, true);

                // Expect token transfer
                //    StakingToken balance of sender
                expect(beforeData.senderStakingTokenBalance.add(stakeAmount)).bignumber.eq(
                    afterData.senderStakingTokenBalance,
                );
                //    Withdraws from the actual rewards wrapper token
                expect(beforeData.userStakingBalance.sub(stakeAmount)).bignumber.eq(
                    afterData.userStakingBalance,
                );
                //    Updates total supply
                expect(beforeData.totalSupply.sub(stakeAmount)).bignumber.eq(afterData.totalSupply);

                await expectRevert(stakingRewards.exit(), "Cannot withdraw 0");
            });
        });
    });
    context("running a full integration test", () => {
        const fundAmount = simpleToExactAmount(100, 21);
        const stakeAmount = simpleToExactAmount(100, 18);
        let period;

        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("1. should allow the rewardsDistributor to fund the pool", async () => {
            await rewardToken.transfer(stakingRewards.address, fundAmount, {
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
            const beneficiaryBalanceBefore = await rewardToken.balanceOf(sa.default);

            await stakingRewards.exit();

            const afterData = await snapshotStakingData();
            // Balance transferred to the rewardee
            const beneficiaryBalanceAfter = await rewardToken.balanceOf(sa.default);
            assertBNClose(
                beneficiaryBalanceAfter.sub(beneficiaryBalanceBefore),
                fundAmount,
                simpleToExactAmount(1, 16),
            );

            await assertRewardsAssigned(beforeData, afterData, false, true);
        });
    });
});
