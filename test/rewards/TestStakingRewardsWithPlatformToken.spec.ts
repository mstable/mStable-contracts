/* eslint-disable no-nested-ternary */

import * as t from "types/generated";
import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import {
    ONE_WEEK,
    ONE_DAY,
    FIVE_DAYS,
    fullScale,
    MAX_UINT256,
    ZERO_ADDRESS,
} from "@utils/constants";
import envSetup from "@utils/env_setup";

import shouldBehaveLikeRecipient from "./RewardsDistributionRecipient.behaviour";

const MockERC20 = artifacts.require("MockERC20");
const StakingRewardsWithPlatformToken = artifacts.require("StakingRewardsWithPlatformToken");
const PlatformTokenVendor = artifacts.require("PlatformTokenVendor");

const { expect } = envSetup.configure();

contract("StakingRewardsWithPlatformToken", async (accounts) => {
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
    let platformToken: t.MockERC20Instance;
    let stakingToken: t.MockERC20Instance;
    let stakingRewards: t.StakingRewardsWithPlatformTokenInstance;

    const redeployRewards = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.StakingRewardsWithPlatformTokenInstance> => {
        rewardToken = await MockERC20.new("Reward", "RWD", 18, rewardsDistributor, 1000000);
        platformToken = await MockERC20.new("PLAT4M", "PLAT", 18, rewardsDistributor, 1000000);
        stakingToken = await MockERC20.new("Staking", "ST8k", 18, sa.default, 1000000);
        return StakingRewardsWithPlatformToken.new(
            nexusAddress,
            stakingToken.address,
            rewardToken.address,
            platformToken.address,
            rewardsDistributor,
        );
    };

    interface StakingData {
        totalSupply: BN;
        userStakingBalance: BN;
        senderStakingTokenBalance: BN;
        contractStakingTokenBalance: BN;
        userRewardPerTokenPaid: BN;
        userPlatformRewardPerTokenPaid: BN;
        beneficiaryRewardsEarned: BN;
        beneficiaryPlatformRewardsEarned: BN;
        rewardPerTokenStored: BN;
        platformRewardPerTokenStored: BN;
        rewardRate: BN;
        platformRewardRate: BN;
        lastUpdateTime: BN;
        lastTimeRewardApplicable: BN;
        periodFinishTime: BN;
        platformTokenVendor: string;
        platformTokenBalanceVendor: BN;
        platformTokenBalanceStakingRewards: BN;
    }

    const snapshotStakingData = async (
        sender = sa.default,
        beneficiary = sa.default,
    ): Promise<StakingData> => {
        const platformTokenVendor = await stakingRewards.platformTokenVendor();
        return {
            totalSupply: await stakingRewards.totalSupply(),
            userStakingBalance: await stakingRewards.balanceOf(beneficiary),
            senderStakingTokenBalance: await stakingToken.balanceOf(sender),
            contractStakingTokenBalance: await stakingToken.balanceOf(stakingRewards.address),
            userRewardPerTokenPaid: await stakingRewards.userRewardPerTokenPaid(beneficiary),
            userPlatformRewardPerTokenPaid: await stakingRewards.userPlatformRewardPerTokenPaid(
                beneficiary,
            ),
            beneficiaryRewardsEarned: await stakingRewards.rewards(beneficiary),
            beneficiaryPlatformRewardsEarned: await stakingRewards.platformRewards(beneficiary),
            rewardPerTokenStored: await stakingRewards.rewardPerTokenStored(),
            platformRewardPerTokenStored: await stakingRewards.platformRewardPerTokenStored(),
            rewardRate: await stakingRewards.rewardRate(),
            platformRewardRate: await stakingRewards.platformRewardRate(),
            lastUpdateTime: await stakingRewards.lastUpdateTime(),
            lastTimeRewardApplicable: await stakingRewards.lastTimeRewardApplicable(),
            periodFinishTime: await stakingRewards.periodFinish(),
            platformTokenVendor,
            platformTokenBalanceVendor: await platformToken.balanceOf(platformTokenVendor),
            platformTokenBalanceStakingRewards: await platformToken.balanceOf(
                stakingRewards.address,
            ),
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
            expect(await stakingRewards.platformToken(), platformToken.address);
            expect(await stakingRewards.platformTokenVendor()).not.eq(ZERO_ADDRESS);
            expect(await stakingRewards.rewardsDistributor(), rewardsDistributor);

            // Basic storage
            expect(await stakingRewards.totalSupply()).bignumber.eq(new BN(0));
            expect(await stakingRewards.periodFinish()).bignumber.eq(new BN(0));
            expect(await stakingRewards.rewardRate()).bignumber.eq(new BN(0));
            expect(await stakingRewards.platformRewardRate()).bignumber.eq(new BN(0));
            expect(await stakingRewards.lastUpdateTime()).bignumber.eq(new BN(0));
            expect(await stakingRewards.rewardPerTokenStored()).bignumber.eq(new BN(0));
            expect(await stakingRewards.platformRewardPerTokenStored()).bignumber.eq(new BN(0));
            expect(await stakingRewards.lastTimeRewardApplicable()).bignumber.eq(new BN(0));
            expect((await stakingRewards.rewardPerToken())[0]).bignumber.eq(new BN(0));
            expect((await stakingRewards.rewardPerToken())[1]).bignumber.eq(new BN(0));
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
        shouldResetPlatformRewards = false,
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
        expect(beforeData.platformRewardRate).bignumber.eq(afterData.platformRewardRate);
        //    RewardPerTokenStored goes up
        expect(afterData.rewardPerTokenStored).bignumber.gte(
            beforeData.rewardPerTokenStored as any,
        );
        expect(afterData.platformRewardPerTokenStored).bignumber.gte(
            beforeData.platformRewardPerTokenStored as any,
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
        const increaseInPlatformRewardPerToken = beforeData.totalSupply.eq(new BN(0))
            ? new BN(0)
            : beforeData.platformRewardRate
                  .mul(timeApplicableToRewards)
                  .mul(fullScale)
                  .div(beforeData.totalSupply);

        expect(beforeData.rewardPerTokenStored.add(increaseInRewardPerToken)).bignumber.eq(
            afterData.rewardPerTokenStored,
        );
        expect(
            beforeData.platformRewardPerTokenStored.add(increaseInPlatformRewardPerToken),
        ).bignumber.eq(afterData.platformRewardPerTokenStored);

        // Expect updated personal state
        //    userRewardPerTokenPaid(beneficiary) should update
        expect(afterData.userRewardPerTokenPaid).bignumber.eq(afterData.rewardPerTokenStored);
        expect(afterData.userPlatformRewardPerTokenPaid).bignumber.eq(
            afterData.platformRewardPerTokenStored,
        );

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

        //    If existing staker, then platform rewards Should increase
        if (shouldResetPlatformRewards) {
            expect(afterData.beneficiaryPlatformRewardsEarned).bignumber.eq(new BN(0));
        } else if (isExistingStaker) {
            // rewards(beneficiary) should update with previously accrued tokens
            const increaseInUserPlatformRewardPerToken = afterData.platformRewardPerTokenStored.sub(
                beforeData.userPlatformRewardPerTokenPaid,
            );
            const assignment = beforeData.userStakingBalance
                .mul(increaseInUserPlatformRewardPerToken)
                .div(fullScale);
            expect(beforeData.beneficiaryPlatformRewardsEarned.add(assignment)).bignumber.eq(
                afterData.beneficiaryPlatformRewardsEarned,
            );
        } else {
            // else `rewards` should stay the same
            expect(beforeData.beneficiaryPlatformRewardsEarned).bignumber.eq(
                afterData.beneficiaryPlatformRewardsEarned,
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

        //    StakingToken balance of StakingRewardsWithPlatformToken
        expect(beforeData.contractStakingTokenBalance.add(stakeAmount)).bignumber.eq(
            afterData.contractStakingTokenBalance,
        );

        //    TotalSupply of StakingRewardsWithPlatformToken
        expect(beforeData.totalSupply.add(stakeAmount)).bignumber.eq(afterData.totalSupply);
    };

    /**
     * @dev Ensures a funding is successful, checking that it updates the rewardRate etc
     * @param rewardUnits Number of units to stake
     */
    const expectSuccesfulFunding = async (
        rewardUnits: BN,
        platformUnitsExpected = new BN(0),
    ): Promise<void> => {
        const beforeData = await snapshotStakingData();
        expect(beforeData.platformTokenBalanceStakingRewards).bignumber.gte(
            platformUnitsExpected as any,
        );

        const tx = await stakingRewards.notifyRewardAmount(rewardUnits, {
            from: rewardsDistributor,
        });
        expectEvent(tx.receipt, "RewardAdded", {
            reward: rewardUnits,
            platformReward: platformUnitsExpected,
        });

        const cur = new BN(await time.latest());
        const leftOverRewards = beforeData.rewardRate.mul(
            beforeData.periodFinishTime.sub(beforeData.lastTimeRewardApplicable),
        );
        const leftOverPlatformRewards = beforeData.platformRewardRate.mul(
            beforeData.periodFinishTime.sub(beforeData.lastTimeRewardApplicable),
        );

        const afterData = await snapshotStakingData();

        // Expect the tokens to be transferred to the vendor
        expect(afterData.platformTokenBalanceStakingRewards).bignumber.eq(new BN(0));
        expect(afterData.platformTokenBalanceVendor).bignumber.eq(
            beforeData.platformTokenBalanceVendor.add(
                beforeData.platformTokenBalanceStakingRewards,
            ),
        );

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
                beforeData.rewardRate.div(ONE_WEEK).muln(10), // the effect of 10 second on the future scale
            );
        } else {
            expect(rewardUnits.div(ONE_WEEK)).bignumber.eq(afterData.rewardRate);
        }

        // Sets platformRewardRate to rewardUnits / ONE_WEEK
        if (leftOverPlatformRewards.gtn(0)) {
            const total = platformUnitsExpected.add(leftOverRewards);
            assertBNClose(
                total.div(ONE_WEEK),
                afterData.platformRewardRate,
                beforeData.platformRewardRate.div(ONE_WEEK).muln(10), // the effect of 10 second on the future scale
            );
        } else {
            expect(platformUnitsExpected.div(ONE_WEEK)).bignumber.eq(afterData.platformRewardRate);
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
                const airdropAmount = simpleToExactAmount(100, 18);
                await platformToken.transfer(stakingRewards.address, airdropAmount, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(rewardUnits, airdropAmount);
            });
        });
        describe("staking in the new period", () => {
            it("should assign rewards to the staker", async () => {
                // Do the stake
                const rewardRate = await stakingRewards.rewardRate();
                const platformRewardRate = await stakingRewards.platformRewardRate();
                const stakeAmount = simpleToExactAmount(100, 18);
                await expectSuccessfulStake(stakeAmount);

                await time.increase(ONE_DAY);

                // This is the total reward per staked token, since the last update
                const [
                    rewardPerToken,
                    platformRewardPerToken,
                ] = await stakingRewards.rewardPerToken();
                expect(rewardPerToken).bignumber.gt(new BN(0) as any);
                expect(platformRewardPerToken).bignumber.gt(new BN(0) as any);
                const rewardPerSecond = new BN(1)
                    .mul(rewardRate)
                    .mul(fullScale)
                    .div(stakeAmount);
                assertBNClose(
                    rewardPerToken,
                    ONE_DAY.mul(rewardPerSecond),
                    rewardPerSecond.muln(10),
                );
                const platformRewardPerSecond = new BN(1)
                    .mul(platformRewardRate)
                    .mul(fullScale)
                    .div(stakeAmount);
                assertBNClose(
                    platformRewardPerToken,
                    ONE_DAY.mul(platformRewardPerSecond),
                    platformRewardPerSecond.muln(10),
                );
                // Calc estimated unclaimed reward for the user
                // earned == balance * (rewardPerToken-userExistingReward)
                const [earned, platformEarned] = await stakingRewards.earned(sa.default);
                expect(stakeAmount.mul(rewardPerToken).div(fullScale)).bignumber.eq(earned);
                expect(stakeAmount.mul(platformRewardPerToken).div(fullScale)).bignumber.eq(
                    platformEarned,
                );
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
            expect(beforeData.platformRewardRate).bignumber.eq(new BN(0));
            expect(beforeData.platformRewardPerTokenStored).bignumber.eq(new BN(0));
            expect(beforeData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
            expect(beforeData.beneficiaryPlatformRewardsEarned).bignumber.eq(new BN(0));
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
            expect(afterData.platformRewardRate).bignumber.eq(new BN(0));
            expect(afterData.platformRewardPerTokenStored).bignumber.eq(new BN(0));
            expect(afterData.beneficiaryPlatformRewardsEarned).bignumber.eq(new BN(0));
            expect(afterData.totalSupply).bignumber.eq(stakeAmount.muln(2));
            expect(afterData.lastTimeRewardApplicable).bignumber.eq(new BN(0));
        });
    });
    context("adding first stake days after funding", () => {
        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("should retrospectively assign rewards to the first staker", async () => {
            const airdropAmount = simpleToExactAmount(100, 18);
            await platformToken.transfer(stakingRewards.address, airdropAmount, {
                from: rewardsDistributor,
            });
            await expectSuccesfulFunding(simpleToExactAmount(100, 18), airdropAmount);

            // Do the stake
            const rewardRate = await stakingRewards.rewardRate();
            const platformRewardRate = await stakingRewards.platformRewardRate();

            await time.increase(FIVE_DAYS);

            const stakeAmount = simpleToExactAmount(100, 18);
            await expectSuccessfulStake(stakeAmount);

            // This is the total reward per staked token, since the last update
            const [rewardPerToken, platformRewardPerToken] = await stakingRewards.rewardPerToken();

            const rewardPerSecond = new BN(1)
                .mul(rewardRate)
                .mul(fullScale)
                .div(stakeAmount);
            assertBNClose(rewardPerToken, FIVE_DAYS.mul(rewardPerSecond), rewardPerSecond.muln(4));

            const platformRewardPerSecond = new BN(1)
                .mul(platformRewardRate)
                .mul(fullScale)
                .div(stakeAmount);
            assertBNClose(
                platformRewardPerToken,
                FIVE_DAYS.mul(platformRewardPerSecond),
                platformRewardPerSecond.muln(4),
            );

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const [
                earnedAfterConsequentStake,
                platformEarnedAfterConsequentStake,
            ] = await stakingRewards.earned(sa.default);
            expect(stakeAmount.mul(rewardPerToken).div(fullScale)).bignumber.eq(
                earnedAfterConsequentStake,
            );
            expect(stakeAmount.mul(platformRewardPerToken).div(fullScale)).bignumber.eq(
                platformEarnedAfterConsequentStake,
            );
        });
    });
    context("staking over multiple funded periods", () => {
        context("with a single staker", () => {
            before(async () => {
                stakingRewards = await redeployRewards();
            });
            it("should assign all the rewards from the periods", async () => {
                const airdropAmount1 = simpleToExactAmount(100, 18);
                const fundAmount1 = simpleToExactAmount(100, 18);
                const fundAmount2 = simpleToExactAmount(200, 18);
                await expectSuccesfulFunding(fundAmount1);

                const stakeAmount = simpleToExactAmount(1, 18);
                await expectSuccessfulStake(stakeAmount);

                await time.increase(ONE_WEEK.muln(2));

                await platformToken.transfer(stakingRewards.address, airdropAmount1, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(fundAmount2, airdropAmount1);

                await time.increase(ONE_WEEK.muln(2));

                const [earned, platformEarned] = await stakingRewards.earned(sa.default);
                assertBNSlightlyGT(fundAmount1.add(fundAmount2), earned, new BN(1000000), false);
                assertBNSlightlyGT(airdropAmount1, platformEarned, new BN(1000000), false);
            });
        });
        context("with multiple stakers coming in and out", () => {
            beforeEach(async () => {
                stakingRewards = await redeployRewards();
            });
            it("should accrue rewards on a pro rata basis", async () => {
                const airdropAmount = simpleToExactAmount(100, 21);
                const fundAmount1 = simpleToExactAmount(100, 21);
                const fundAmount2 = simpleToExactAmount(200, 21);
                const staker2 = sa.dummy1;
                const staker3 = sa.dummy2;
                const staker1Stake1 = simpleToExactAmount(100, 18);
                const staker1Stake2 = simpleToExactAmount(200, 18);
                const staker2Stake = simpleToExactAmount(100, 18);
                const staker3Stake = simpleToExactAmount(100, 18);

                await stakingToken.transfer(staker2, staker2Stake);
                await stakingToken.transfer(staker3, staker3Stake);

                /*
                 *  0               1               2   <-- Weeks
                 *   [ - - - - - - ] [ - - - - - - ]
                 * 100k            200k                 <-- Funding
                 *                 100k                 <-- Airdrop
                 * +100            +200                 <-- Staker 1
                 *        +100                          <-- Staker 2
                 * +100            -100                 <-- Staker 3
                 *
                 * Staker 1 gets 25k + 16.66k from week 1 n 150k = 191.66k
                 *          gets 75k
                 * Staker 2 gets 16.66k from week 1 n 50k from week 2 = 66.66k
                 *          gets 25k
                 * Staker 3 gets 25k + 16.66k from week 1 n 0 from week 2 = 41.66k
                 *          gets 0
                 */

                // WEEK 0-1 START
                await expectSuccessfulStake(staker1Stake1);
                await expectSuccessfulStake(staker3Stake, staker3, staker3);

                await expectSuccesfulFunding(fundAmount1);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                await expectSuccessfulStake(staker2Stake, staker2, staker2);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                // WEEK 1-2 START
                await stakingRewards.withdraw(staker3Stake, { from: staker3 });
                await expectSuccessfulStake(staker1Stake2, sa.default, sa.default, true);
                await platformToken.transfer(stakingRewards.address, airdropAmount, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(fundAmount2, airdropAmount);

                await time.increase(ONE_WEEK);

                // WEEK 2 FINISH
                const [earned1, platformEarned1] = await stakingRewards.earned(sa.default);
                assertBNClose(
                    earned1,
                    simpleToExactAmount("191.66", 21),
                    simpleToExactAmount(1, 19),
                );
                assertBNClose(
                    platformEarned1,
                    simpleToExactAmount(75, 21),
                    simpleToExactAmount(1, 19),
                );
                const [earned2, platformEarned2] = await stakingRewards.earned(staker2);
                assertBNClose(
                    earned2,
                    simpleToExactAmount("66.66", 21),
                    simpleToExactAmount(1, 19),
                );
                assertBNClose(
                    platformEarned2,
                    simpleToExactAmount(25, 21),
                    simpleToExactAmount(1, 19),
                );
                const [earned3, platformEarned3] = await stakingRewards.earned(staker3);
                assertBNClose(
                    earned3,
                    simpleToExactAmount("41.66", 21),
                    simpleToExactAmount(1, 19),
                );
                expect(platformEarned3).bignumber.eq(new BN(0));
                // Ensure that sum of earned rewards does not exceed funcing amount
                expect(fundAmount1.add(fundAmount2)).bignumber.gte(
                    earned1.add(earned2).add(earned3) as any,
                );
                expect(airdropAmount).bignumber.gte(
                    platformEarned1.add(platformEarned2).add(platformEarned3) as any,
                );
            });
            it("should accrue rewards on a pro rata basis 2", async () => {
                const airdropAmount1 = simpleToExactAmount(50, 21);
                const airdropAmount2 = simpleToExactAmount(100, 21);
                const fundAmount1 = simpleToExactAmount(50, 21);
                const fundAmount2 = simpleToExactAmount(200, 21);
                const staker2 = sa.dummy1;
                const staker3 = sa.dummy2;
                const staker1Stake1 = simpleToExactAmount(100, 18);
                const staker1Stake2 = simpleToExactAmount(100, 18);
                const staker2Stake = simpleToExactAmount(100, 18);
                const staker3Stake = simpleToExactAmount(100, 18);

                await stakingToken.transfer(staker2, staker2Stake);
                await stakingToken.transfer(staker3, staker3Stake);

                /*
                 *  0               1               2   <-- Weeks
                 *   [ - - - - - - ] [ - - - - - - ]
                 *  50k            200k                 <-- Funding
                 *  50k            100k                 <-- Airdrop
                 * +100            +100                 <-- Staker 1
                 *        +100                          <-- Staker 2
                 *        +100            -100          <-- Staker 3
                 *
                 * Staker 1 gets 25k + 8.33 from week 1 n 50k + 66.66 = 150k
                 *          gets 25k + 8.33 from week 1 n 25k + 33.33 = 91.66k
                 * Staker 2 gets 8.33 from week 1 n 25k + 33.33 = 66.66k
                 *          gets 8.33 from week 1 n 12.5 + 16.67 = 37.5k
                 * Staker 3 gets 8.33 from week 1 n 25k = 33.33
                 *          gets 8.33 from week 1 n 12.5k = 20.83
                 */

                // WEEK 0-1 START
                await expectSuccessfulStake(staker1Stake1);

                await platformToken.transfer(stakingRewards.address, airdropAmount1, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(fundAmount1, airdropAmount1);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                await expectSuccessfulStake(staker2Stake, staker2, staker2);
                await expectSuccessfulStake(staker3Stake, staker3, staker3);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                // WEEK 1-2 START
                await platformToken.transfer(stakingRewards.address, airdropAmount2, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(fundAmount2, airdropAmount2);

                await expectSuccessfulStake(staker1Stake2, sa.default, sa.default, true);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                await stakingRewards.withdraw(staker3Stake, { from: staker3 });

                await time.increase(ONE_WEEK.divn(2).addn(1));

                // WEEK 2 FINISH
                const [earned1, platformEarned1] = await stakingRewards.earned(sa.default);
                assertBNClose(earned1, simpleToExactAmount(150, 21), simpleToExactAmount(1, 19));
                assertBNClose(
                    platformEarned1,
                    simpleToExactAmount("91.66", 21),
                    simpleToExactAmount(1, 19),
                );
                const [earned2, platformEarned2] = await stakingRewards.earned(staker2);
                assertBNClose(
                    earned2,
                    simpleToExactAmount("66.66", 21),
                    simpleToExactAmount(1, 19),
                );
                assertBNClose(
                    platformEarned2,
                    simpleToExactAmount("37.5", 21),
                    simpleToExactAmount(1, 19),
                );
                const [earned3, platformEarned3] = await stakingRewards.earned(staker3);
                assertBNClose(
                    earned3,
                    simpleToExactAmount("33.33", 21),
                    simpleToExactAmount(1, 19),
                );
                assertBNClose(
                    platformEarned3,
                    simpleToExactAmount("20.83", 21),
                    simpleToExactAmount(1, 19),
                );
                // Ensure that sum of earned rewards does not exceed funcing amount
                expect(fundAmount1.add(fundAmount2)).bignumber.gte(
                    earned1.add(earned2).add(earned3) as any,
                );
                expect(airdropAmount1.add(airdropAmount2)).bignumber.gte(
                    platformEarned1.add(platformEarned2).add(platformEarned3) as any,
                );
            });
        });
    });
    context("staking after period finish", () => {
        const airdropAmount1 = simpleToExactAmount(100, 21);
        const fundAmount1 = simpleToExactAmount(100, 21);

        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("should stop accruing rewards after the period is over", async () => {
            await expectSuccessfulStake(simpleToExactAmount(1, 18));
            await platformToken.transfer(stakingRewards.address, airdropAmount1, {
                from: rewardsDistributor,
            });
            await expectSuccesfulFunding(fundAmount1, airdropAmount1);

            await time.increase(ONE_WEEK.addn(1));

            const [earnedAfterWeek, platformEarnedAfterWeek] = await stakingRewards.earned(
                sa.default,
            );

            await time.increase(ONE_WEEK.addn(1));
            const now = await time.latest();

            const [earnedAfterTwoWeeks, platformEarnedAfterTwoWeeks] = await stakingRewards.earned(
                sa.default,
            );

            expect(earnedAfterWeek).bignumber.eq(earnedAfterTwoWeeks);
            expect(platformEarnedAfterWeek).bignumber.eq(platformEarnedAfterTwoWeeks);

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
            expect(earned[0]).bignumber.gt(new BN(0) as any);

            const balance = await stakingRewards.balanceOf(beneficiary);
            expect(balance).bignumber.eq(stakeAmount);
        });
        it("should not update the senders details", async () => {
            const earned = await stakingRewards.earned(sa.default);
            expect(earned[0]).bignumber.eq(new BN(0));

            const balance = await stakingRewards.balanceOf(sa.default);
            expect(balance).bignumber.eq(new BN(0));
        });
    });
    context("using staking / reward tokens with diff decimals", () => {
        before(async () => {
            rewardToken = await MockERC20.new("Reward", "RWD", 12, rewardsDistributor, 1000000);
            platformToken = await MockERC20.new("PLATF4M", "PLAT", 14, rewardsDistributor, 1000000);
            stakingToken = await MockERC20.new("Staking", "ST8k", 16, sa.default, 1000000);
            stakingRewards = await StakingRewardsWithPlatformToken.new(
                systemMachine.nexus.address,
                stakingToken.address,
                rewardToken.address,
                platformToken.address,
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
            const [rewardPerToken, platformRewardPerToken] = await stakingRewards.rewardPerToken();
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
            expect(platformRewardPerToken).bignumber.eq(new BN(0));

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const [earnedAfterConsequentStake, platformEarned] = await stakingRewards.earned(
                sa.default,
            );
            assertBNSlightlyGT(
                simpleToExactAmount(100, 12),
                earnedAfterConsequentStake,
                simpleToExactAmount(1, 9),
            );
            expect(platformEarned).bignumber.eq(new BN(0));
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
            expect(platformToken.address).eq(await stakingRewards.platformToken());
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
            const airdrop1 = simpleToExactAmount(100, 18);
            const airdrop2 = simpleToExactAmount(200, 18);
            const funding1 = simpleToExactAmount(100, 18);
            const funding2 = simpleToExactAmount(200, 18);
            beforeEach(async () => {
                stakingRewards = await redeployRewards();
            });
            it("should factor in unspent units to the new rewardRate", async () => {
                // Do the initial funding
                await platformToken.transfer(stakingRewards.address, airdrop1, {
                    from: rewardsDistributor,
                });

                await expectSuccesfulFunding(funding1, airdrop1);
                const actualRewardRate = await stakingRewards.rewardRate();
                const actualPlatformRewardRate = await stakingRewards.platformRewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);
                expect(expectedRewardRate).bignumber.eq(actualPlatformRewardRate);

                // Zoom forward half a week
                await time.increase(ONE_WEEK.divn(2));

                // Do the second funding, and factor in the unspent units
                const expectedLeftoverReward = funding1.divn(2);
                await platformToken.transfer(stakingRewards.address, airdrop2, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(funding2, airdrop2);
                const actualRewardRateAfter = await stakingRewards.rewardRate();
                const actualPlatformRewardRateAfter = await stakingRewards.platformRewardRate();
                const totalRewardsForWeek = funding2.add(expectedLeftoverReward);
                const expectedRewardRateAfter = totalRewardsForWeek.div(ONE_WEEK);

                assertBNClose(
                    actualRewardRateAfter,
                    expectedRewardRateAfter,
                    actualRewardRate.divn(1000),
                );

                assertBNClose(
                    actualPlatformRewardRateAfter,
                    expectedRewardRateAfter,
                    actualRewardRate.divn(1000),
                );
            });

            it("should factor in unspent units to the new rewardRate if instant", async () => {
                // Do the initial funding
                await platformToken.transfer(stakingRewards.address, airdrop1, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(funding1, airdrop1);
                const actualRewardRate = await stakingRewards.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);
                const actualPlatformRewardRate = await stakingRewards.platformRewardRate();
                const expectedPlatformRewardRate = airdrop1.div(ONE_WEEK);
                expect(expectedPlatformRewardRate).bignumber.eq(actualPlatformRewardRate);

                // Zoom forward 1 second
                await time.increase(1);

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding2);
                const actualRewardRateAfter = await stakingRewards.rewardRate();
                const expectedRewardRateAfter = funding1.add(funding2).div(ONE_WEEK);
                assertBNClose(
                    actualRewardRateAfter,
                    expectedRewardRateAfter,
                    actualRewardRate.divn(1000),
                );

                const actualPlatformRewardRateAfter = await stakingRewards.platformRewardRate();
                assertBNClose(
                    actualPlatformRewardRateAfter,
                    actualPlatformRewardRate,
                    actualPlatformRewardRate.divn(1000),
                );
            });
        });

        context("after current period finish", () => {
            const airdrop1 = simpleToExactAmount(1, 18);
            const funding1 = simpleToExactAmount(100, 18);
            before(async () => {
                stakingRewards = await redeployRewards();
            });
            it("should start a new period with the correct rewardRate", async () => {
                // Do the initial funding
                await platformToken.transfer(stakingRewards.address, airdrop1, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(funding1, airdrop1);
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

                const actualPlatformRewardRateAfter = await stakingRewards.platformRewardRate();
                expect(actualPlatformRewardRateAfter).bignumber.eq(new BN(0));
            });
        });
    });

    context("withdrawing stake or rewards", () => {
        context("withdrawing a stake amount", () => {
            const fundAmount = simpleToExactAmount(100, 21);
            const stakeAmount = simpleToExactAmount(100, 18);

            before(async () => {
                stakingRewards = await redeployRewards();
                await platformToken.transfer(stakingRewards.address, fundAmount, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(fundAmount, fundAmount);
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
                expect(earnedBefore[0]).bignumber.gt(new BN(0) as any);
                expect(earnedBefore[1]).bignumber.gt(new BN(0) as any);
                const rewardsBefore = await stakingRewards.rewards(sa.default);
                expect(rewardsBefore).bignumber.eq(new BN(0));

                // Execute the withdrawal
                await expectStakingWithdrawal(stakeAmount);

                // Ensure that the new awards are added + assigned to user
                const earnedAfter = await stakingRewards.earned(sa.default);
                expect(earnedAfter[0]).bignumber.gte(earnedBefore[0] as any);
                expect(earnedAfter[1]).bignumber.gte(earnedBefore[1] as any);
                const rewardsAfter = await stakingRewards.rewards(sa.default);
                expect(rewardsAfter).bignumber.eq(earnedAfter[0]);

                // Zoom forward now
                await time.increase(10);

                // Check that the user does not earn anything else
                const earnedEnd = await stakingRewards.earned(sa.default);
                expect(earnedEnd[0]).bignumber.eq(earnedAfter[0]);
                expect(earnedEnd[1]).bignumber.eq(earnedAfter[1]);
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
            const airdropAmount = simpleToExactAmount(100, 21);
            const fundAmount = simpleToExactAmount(100, 21);
            const stakeAmount = simpleToExactAmount(100, 18);

            before(async () => {
                stakingRewards = await redeployRewards();
                await platformToken.transfer(stakingRewards.address, airdropAmount, {
                    from: rewardsDistributor,
                });
                await rewardToken.transfer(stakingRewards.address, fundAmount, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(fundAmount, airdropAmount);
                await expectSuccessfulStake(stakeAmount, sa.default, sa.dummy2);
                await time.increase(ONE_WEEK.addn(1));
            });
            it("should do nothing for a non-staker", async () => {
                const beforeData = await snapshotStakingData(sa.dummy1, sa.dummy1);
                await stakingRewards.claimReward({ from: sa.dummy1 });

                const afterData = await snapshotStakingData(sa.dummy1, sa.dummy1);
                expect(beforeData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
                expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
                expect(afterData.beneficiaryPlatformRewardsEarned).bignumber.eq(new BN(0));
                expect(afterData.senderStakingTokenBalance).bignumber.eq(new BN(0));
                expect(afterData.userRewardPerTokenPaid).bignumber.eq(
                    afterData.rewardPerTokenStored,
                );
                expect(afterData.userPlatformRewardPerTokenPaid).bignumber.eq(
                    afterData.platformRewardPerTokenStored,
                );
            });
            it("should send all accrued rewards to the rewardee and withdraw platform token", async () => {
                const beforeData = await snapshotStakingData(sa.dummy2, sa.dummy2);
                const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.dummy2);
                expect(rewardeeBalanceBefore).bignumber.eq(new BN(0));
                // Expect no platform rewards before
                const platformBalanceBefore = await platformToken.balanceOf(sa.dummy2);
                expect(platformBalanceBefore).bignumber.eq(new BN(0));

                const tx = await stakingRewards.claimReward({ from: sa.dummy2 });
                const afterData = await snapshotStakingData(sa.dummy2, sa.dummy2);

                await assertRewardsAssigned(beforeData, afterData, false, true, true);

                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.dummy2);
                assertBNClose(rewardeeBalanceAfter, fundAmount, simpleToExactAmount(1, 16));
                // Expect the platform rewards to send out
                const platformBalanceAfter = await platformToken.balanceOf(sa.dummy2);
                assertBNClose(platformBalanceAfter, airdropAmount, simpleToExactAmount(1, 16));
                expect(afterData.platformTokenBalanceVendor).bignumber.eq(
                    beforeData.platformTokenBalanceVendor.sub(platformBalanceAfter),
                );

                expectEvent(tx.receipt, "RewardPaid", {
                    user: sa.dummy2,
                    reward: rewardeeBalanceAfter.sub(rewardeeBalanceBefore),
                    platformReward: beforeData.platformTokenBalanceVendor.sub(
                        afterData.platformTokenBalanceVendor,
                    ),
                });
                // 'rewards' reset to 0
                expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));

                expect(afterData.beneficiaryPlatformRewardsEarned).bignumber.eq(new BN(0));
                // Paid up until the last block
                expect(afterData.userRewardPerTokenPaid).bignumber.eq(
                    afterData.rewardPerTokenStored,
                );

                expect(afterData.userPlatformRewardPerTokenPaid).bignumber.eq(
                    afterData.platformRewardPerTokenStored,
                );
                // Token balances dont change
                expect(afterData.senderStakingTokenBalance).bignumber.eq(
                    beforeData.senderStakingTokenBalance,
                );

                expect(beforeData.userStakingBalance).bignumber.eq(afterData.userStakingBalance);
            });
        });
        context("claiming rewards only", async () => {
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
            it("should do nothing for a non-staker", async () => {
                const beforeData = await snapshotStakingData(sa.dummy1, sa.dummy1);
                await stakingRewards.claimRewardOnly({ from: sa.dummy1 });

                const afterData = await snapshotStakingData(sa.dummy1, sa.dummy1);
                expect(beforeData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
                expect(afterData.beneficiaryRewardsEarned).bignumber.eq(new BN(0));
                expect(afterData.senderStakingTokenBalance).bignumber.eq(new BN(0));
                expect(afterData.userRewardPerTokenPaid).bignumber.eq(
                    afterData.rewardPerTokenStored,
                );
            });
            it("should send all accrued rewards to the rewardee", async () => {
                const beforeData = await snapshotStakingData();
                const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.default);

                const tx = await stakingRewards.claimRewardOnly();
                const afterData = await snapshotStakingData();
                await assertRewardsAssigned(beforeData, afterData, false, true);
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.default);
                expectEvent(tx.receipt, "RewardPaid", {
                    user: sa.default,
                    reward: rewardeeBalanceAfter.sub(rewardeeBalanceBefore),
                    platformReward: new BN(0),
                });
                assertBNClose(
                    rewardeeBalanceAfter.sub(rewardeeBalanceBefore),
                    fundAmount,
                    simpleToExactAmount(1, 16),
                );

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
            it("should withdraw all senders stake and send oustanding rewards to the staker", async () => {
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
    context("testing platformTokenVendor", () => {
        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("should re-approve spending of the platformToken", async () => {
            const beforeData = await snapshotStakingData();
            const maxApproval = await platformToken.allowance(
                beforeData.platformTokenVendor,
                stakingRewards.address,
            );
            expect(maxApproval).bignumber.eq(MAX_UINT256);

            const fundAmount = simpleToExactAmount(1, 18);
            await rewardToken.transfer(stakingRewards.address, fundAmount, {
                from: rewardsDistributor,
            });
            await platformToken.transfer(stakingRewards.address, fundAmount, {
                from: rewardsDistributor,
            });
            await expectSuccesfulFunding(fundAmount, fundAmount);
            await expectSuccessfulStake(fundAmount);
            await time.increase(ONE_WEEK.addn(1));
            await stakingRewards.exit();

            const approvalAfter = await platformToken.allowance(
                beforeData.platformTokenVendor,
                stakingRewards.address,
            );
            expect(approvalAfter).bignumber.lt(MAX_UINT256 as any);

            const vendor = await PlatformTokenVendor.at(beforeData.platformTokenVendor);
            await vendor.reApproveOwner();

            const approvalEnd = await platformToken.allowance(
                beforeData.platformTokenVendor,
                stakingRewards.address,
            );
            expect(approvalEnd).bignumber.eq(MAX_UINT256);
        });
    });
    context("running a full integration test", () => {
        const airdropAmount = simpleToExactAmount(200, 21);
        const fundAmount = simpleToExactAmount(100, 21);
        const stakeAmount = simpleToExactAmount(100, 18);
        let period;

        before(async () => {
            stakingRewards = await redeployRewards();
        });
        it("1. should allow the rewardsDistributor to fund the pool", async () => {
            await platformToken.transfer(stakingRewards.address, airdropAmount, {
                from: rewardsDistributor,
            });
            await rewardToken.transfer(stakingRewards.address, fundAmount, {
                from: rewardsDistributor,
            });
            await expectSuccesfulFunding(fundAmount, airdropAmount);
        });
        it("2. should allow stakers to stake and earn rewards", async () => {
            await expectSuccessfulStake(stakeAmount);
            await time.increase(ONE_WEEK.addn(1));
        });
        it("3. should deposit earnings to the beneficiary", async () => {
            const beforeData = await snapshotStakingData();

            const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.default);

            await stakingRewards.exit();

            const afterData = await snapshotStakingData();
            // Balance transferred to the beneficiary
            const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.default);
            assertBNClose(
                rewardeeBalanceAfter.sub(rewardeeBalanceBefore),
                fundAmount,
                simpleToExactAmount(1, 16),
            );

            const platformBalanceAfter = await platformToken.balanceOf(sa.default);
            assertBNClose(platformBalanceAfter, airdropAmount, simpleToExactAmount(1, 16));

            await assertRewardsAssigned(beforeData, afterData, false, true, true);
        });
    });
});
