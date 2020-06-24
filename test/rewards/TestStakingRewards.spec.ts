/* eslint-disable no-nested-ternary */

import * as t from "types/generated";
import { expectEvent, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { ONE_WEEK, ONE_DAY, FIVE_DAYS, fullScale } from "@utils/constants";
import envSetup from "@utils/env_setup";

import shouldBehaveLikeLockedUpRewards from "./LockedUpRewards.behaviour";

const MockERC20 = artifacts.require("MockERC20");
const StakingRewards = artifacts.require("StakingRewards");
const RewardsVault = artifacts.require("RewardsVault");

const { expect } = envSetup.configure();

contract("StakingRewards", async (accounts) => {
    const ctx: {
        lockup?: t.LockedUpRewardsInstance;
    } = {};
    const recipientCtx: {
        recipient?: t.RewardsDistributionRecipientInstance;
    } = {};
    const moduleCtx: {
        module?: t.ModuleInstance;
    } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;

    const rewardsDistributor = sa.fundManager;
    let rewardToken: t.MockErc20Instance;
    let stakingToken: t.MockErc20Instance;
    let rewardsVault: t.RewardsVaultInstance;
    let stakingRewards: t.StakingRewardsInstance;

    const redeployRewards = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.StakingRewardsInstance> => {
        rewardToken = await MockERC20.new("Reward", "RWD", 18, rewardsDistributor, 1000000);
        stakingToken = await MockERC20.new("Staking", "ST8k", 18, sa.default, 1000000);
        rewardsVault = await RewardsVault.new(rewardToken.address);
        return StakingRewards.new(
            nexusAddress,
            stakingToken.address,
            rewardToken.address,
            rewardsVault.address,
            rewardsDistributor,
        );
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
        stakingRewards = await redeployRewards();
        ctx.lockup = stakingRewards as t.LockedUpRewardsInstance;
        recipientCtx.recipient = (stakingRewards as unknown) as t.RewardsDistributionRecipientInstance;
        moduleCtx.module = stakingRewards as t.ModuleInstance;
    });

    describe("implementing lockedUpRewards, rewardDistributionRecipient and Module", async () => {
        shouldBehaveLikeLockedUpRewards(
            ctx as Required<typeof ctx>,
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
            expect(await stakingRewards.rewardsVault(), rewardsVault.address);
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

    const expectSuccessfulStake = async (
        stakeAmount: BN,
        sender = sa.default,
        beneficiary = sa.default,
        confirmExistingStaker = false,
    ): Promise<void> => {
        // 1. Get data from the contract
        const senderIsBeneficiary = sender === beneficiary;
        const totalSupplyBefore = await stakingRewards.totalSupply();
        const stakeBalBefore = await stakingRewards.balanceOf(beneficiary);
        const userRewardPerTokenPaidBefore = await stakingRewards.userRewardPerTokenPaid(
            beneficiary,
        );
        const stakeTokenBalBefore = await stakingToken.balanceOf(sender);
        const beneficiaryRewardsEarnedBefore = await stakingRewards.rewards(beneficiary);
        const stakeTokenBalContractBefore = await stakingToken.balanceOf(stakingRewards.address);
        const rewardPerTokenStoredBefore = await stakingRewards.rewardPerTokenStored();
        const rewardRateBefore = await stakingRewards.rewardRate();
        const lastUpdateTimeBefore = await stakingRewards.lastUpdateTime();
        const periodFinishTime = await stakingRewards.periodFinish();

        const isExistingStaker = stakeBalBefore.gt(new BN(0));
        if (confirmExistingStaker) {
            expect(isExistingStaker).eq(true);
        }
        console.log("1");
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
        const timeAfter = await time.latest();
        const periodIsFinished = new BN(timeAfter).gt(periodFinishTime);
        expectEvent(tx.receipt, "Staked", {
            user: beneficiary,
            amount: stakeAmount,
            payer: sender,
        });

        console.log("2");
        // 3. Expect token transfer
        //    StakingToken balance of sender
        const stakeTokenBalAfter = await stakingToken.balanceOf(sender);
        expect(stakeTokenBalBefore.sub(stakeAmount)).bignumber.eq(stakeTokenBalAfter);
        //    StakingToken balance of StakingRewards
        const stakeTokenBalContractAfter = await stakingToken.balanceOf(stakingRewards.address);
        expect(stakeTokenBalContractBefore.add(stakeAmount)).bignumber.eq(
            stakeTokenBalContractAfter,
        );

        console.log("3");
        // 4. Expect updated global state
        //    TotalSupply of StakingRewards
        const totalSupplyAfter = await stakingRewards.totalSupply();
        expect(totalSupplyBefore.add(stakeAmount)).bignumber.eq(totalSupplyAfter);
        console.log("3.1");
        //    LastUpdateTime
        const lastUpdateTimeAfter = await stakingRewards.lastUpdateTime();
        expect(
            periodIsFinished
                ? periodFinishTime
                : rewardPerTokenStoredBefore.eqn(0) && totalSupplyBefore.eqn(0)
                ? lastUpdateTimeBefore
                : timeAfter,
        ).bignumber.eq(lastUpdateTimeAfter);
        console.log("3.2");
        //    RewardRate doesnt change
        const rewardRateAfter = await stakingRewards.rewardRate();
        expect(rewardRateBefore).bignumber.eq(rewardRateAfter);
        console.log("3.3");
        //    RewardPerTokenStored goes up
        const rewardPerTokenStoredAfter = await stakingRewards.rewardPerTokenStored();
        expect(rewardPerTokenStoredAfter).bignumber.gte(rewardPerTokenStoredBefore as any);
        console.log("3.4");
        //      Calculate exact expected 'rewardPerToken' increase since last update
        const timeApplicableToRewards = periodIsFinished
            ? periodFinishTime.sub(lastUpdateTimeBefore)
            : timeAfter.sub(lastUpdateTimeBefore);
        const increaseInRewardPerToken = totalSupplyBefore.eq(new BN(0))
            ? new BN(0)
            : rewardRateBefore
                  .mul(timeApplicableToRewards)
                  .mul(fullScale)
                  .div(totalSupplyBefore);
        console.log("3.5");
        expect(rewardPerTokenStoredBefore.add(increaseInRewardPerToken)).bignumber.eq(
            rewardPerTokenStoredAfter,
        );

        console.log("4");
        // 5. Expect updated personal state
        //    StakingRewards balance of beneficiary
        const stakeBalAfter = await stakingRewards.balanceOf(beneficiary);
        expect(stakeBalBefore.add(stakeAmount)).bignumber.eq(stakeBalAfter);
        console.log("4.1");
        //    userRewardPerTokenPaid(beneficiary) should update
        const beneficiaryRewardPerTokenPaidAfter = await stakingRewards.userRewardPerTokenPaid(
            beneficiary,
        );
        expect(beneficiaryRewardPerTokenPaidAfter).bignumber.eq(rewardPerTokenStoredAfter);

        console.log("4.2");
        const beneficiaryRewardsEarnedAfter = await stakingRewards.rewards(beneficiary);
        //    If existing staker, then rewards Should increase
        if (isExistingStaker) {
            console.log("4.2.1");
            // rewards(beneficiary) should update with previously accrued tokens
            const increaseInUserRewardPerToken = rewardPerTokenStoredAfter.sub(
                userRewardPerTokenPaidBefore,
            );
            const assignment = stakeBalBefore.mul(increaseInUserRewardPerToken).div(fullScale);
            expect(beneficiaryRewardsEarnedBefore.add(assignment)).bignumber.eq(
                beneficiaryRewardsEarnedAfter,
            );
        } else {
            console.log("4.2.2");
            // else `rewards` should stay the same
            expect(beneficiaryRewardsEarnedBefore).bignumber.eq(beneficiaryRewardsEarnedAfter);
        }
    };

    const expectSuccesfulFunding = async (rewardUnits: BN): Promise<void> => {
        const tx = await stakingRewards.notifyRewardAmount(rewardUnits, {
            from: rewardsDistributor,
        });
        expectEvent(tx.receipt, "RewardAdded", { reward: rewardUnits });

        const cur = new BN(await time.latest());

        // Sets lastTimeRewardApplicable to latest
        const lastTimeReward = await stakingRewards.lastTimeRewardApplicable();
        expect(cur).bignumber.eq(lastTimeReward);

        // Sets lastUpdateTime to latest
        const lastUpdateTime = await stakingRewards.lastUpdateTime();
        expect(cur).bignumber.eq(lastUpdateTime);

        // Sets periodFinish to 1 week from now
        const periodFinish = await stakingRewards.periodFinish();
        expect(cur.add(ONE_WEEK)).bignumber.eq(periodFinish);

        // Sets rewardRate to rewardUnits / ONE_WEEK
        const rewardRate = await stakingRewards.rewardRate();
        expect(rewardUnits.div(ONE_WEEK)).bignumber.eq(rewardRate);
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
                assertBNClose(
                    rewardPerToken,
                    ONE_DAY.mul(rewardRate)
                        .mul(fullScale)
                        .div(stakeAmount),
                    new BN(1)
                        .mul(rewardRate)
                        .mul(fullScale)
                        .div(stakeAmount),
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
        });
    });
    context("staking before rewards are added", () => {
        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("should assign no rewards", async () => {
            // Get data before
            const stakeAmount = simpleToExactAmount(100, 18);
            const sender = sa.default;
            const rewardRateBefore = await stakingRewards.rewardRate();
            expect(rewardRateBefore).bignumber.eq(new BN(0));
            const rewardPerTokenBefore = await stakingRewards.rewardRate();
            expect(rewardPerTokenBefore).bignumber.eq(new BN(0));
            const earnedBefore = await stakingRewards.earned(sender);
            expect(earnedBefore).bignumber.eq(new BN(0));
            const totalSupplyBefore = await stakingRewards.earned(sender);
            expect(totalSupplyBefore).bignumber.eq(new BN(0));
            const rewardApplicableBefore = await stakingRewards.lastTimeRewardApplicable();
            expect(rewardApplicableBefore).bignumber.eq(new BN(0));

            // Do the stake
            await expectSuccessfulStake(stakeAmount);

            // Wait a day
            await time.increase(ONE_DAY);

            // Do another stake
            await expectSuccessfulStake(stakeAmount);

            // Get end results
            const rewardRateAfter = await stakingRewards.rewardRate();
            expect(rewardRateAfter).bignumber.eq(new BN(0));
            const rewardPerTokenAfter = await stakingRewards.rewardRate();
            expect(rewardPerTokenAfter).bignumber.eq(new BN(0));
            const earnedAfter = await stakingRewards.earned(sender);
            expect(earnedAfter).bignumber.eq(new BN(0));
            const totalSupplyAfter = await stakingRewards.totalSupply();
            expect(totalSupplyAfter).bignumber.eq(stakeAmount.muln(2));
            const rewardApplicableAfter = await stakingRewards.lastTimeRewardApplicable();
            expect(rewardApplicableAfter).bignumber.eq(new BN(0));
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
            assertBNClose(
                rewardPerToken,
                FIVE_DAYS.mul(rewardRate)
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

            const earnedAfterTwoWeeks = await stakingRewards.earned(sa.default);

            expect(earnedAfterWeek).bignumber.eq(earnedAfterTwoWeeks);

            const lastTimeRewardApplicable = await stakingRewards.lastTimeRewardApplicable();
            const now = await time.latest();
            expect(lastTimeRewardApplicable).bignumber.eq(now.sub(ONE_WEEK).subn(2));
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
    context("withdrawing stake or rewards", () => {
        context("completely 'exiting' the system", () => {
            it("should retrieve all earned and increase rewards bal");
            it("should withdraw all senders stake");
            it("should send any outstanding rewards to the vault");
            it("should fail if the sender has no stake");
        });
        context("withdrawing a stake amount", () => {
            it("should do nothing for a non-staker");
            it("should update the existing reward accrual");
            it("should withdraw the stake");
            it("should fail if insufficient balance");
            it("should fail if trying to withdraw 0");
        });
        context("claiming rewards", async () => {
            it("should do nothing for a non-staker");
            it("should send all accrued rewards to the vault");
            it("should update all the stored data");
            it("should do nothing if the outstanding rewards are 0");
        });
    });
    context("using staking / reward tokens with diff decimals", () => {
        it("should not affect the pro rata payouts");
    });
    context("getting the reward token", () => {
        it("should simply return the rewards Token");
    });
    context("notifying new reward amount", () => {
        context("before current period finish", async () => {
            it("rewardRate should factor in the unspent units");
        });
        context("after current period finish", () => {
            it("should start a new period with the correct rewardRate");
        });
    });
    context("running integration tests", () => {
        it("should allow the rewardsDistributor to fund the pool");
        it("should allow stakers to stake and earn rewards");
        it("should deposit earnings into the rewardsVault");
        it("should allow users to vest after the vesting period");
    });
});
