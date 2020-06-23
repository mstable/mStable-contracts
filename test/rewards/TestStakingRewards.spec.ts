import * as t from "types/generated";
import { expectRevert, expectEvent, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { ONE_WEEK, ONE_DAY, fullScale } from "@utils/constants";
import envSetup from "@utils/env_setup";

import shouldBehaveLikeLockedUpRewards from "./LockedUpRewards.behaviour";

const MockERC20 = artifacts.require("MockERC20");
const StakingRewards = artifacts.require("StakingRewards");
const RewardsVault = artifacts.require("RewardsVault");

const { expect } = envSetup.configure();

// IDEAS
// Staking before rewards are added?
// Rewards added but no stakes? Do these tokens get lost?
// Lockup -> goes to vault
// onlyRewardsDistributor can notifyRewardAmount
// staking/reward tokens with diff decimals

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

    context("initialising and staking in a new pool", () => {
        describe("notifying the pool of reward", async () => {
            it("should begin a new period", async () => {
                const rewardUnits = simpleToExactAmount(1, 18);
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
            });
        });
        describe("staking in the new period", async () => {
            it("should assign rewards to the staker", async () => {
                const rewardRate = await stakingRewards.rewardRate();
                const stakeAmount = simpleToExactAmount(100, 18);
                await stakingToken.approve(stakingRewards.address, stakeAmount, {
                    from: sa.default,
                });

                await stakingRewards.methods["stake(uint256)"](stakeAmount, { from: sa.default });

                // Stakes the token
                const totalSupply = await stakingRewards.totalSupply();
                expect(stakeAmount).bignumber.eq(totalSupply);

                await time.increase(ONE_DAY);

                // This is the total reward per staked token, since the last update
                const rewardPerToken = await stakingRewards.rewardPerToken();
                expect(
                    ONE_DAY.mul(rewardRate)
                        .mul(fullScale)
                        .div(stakeAmount),
                ).bignumber.eq(rewardPerToken);
            });
        });
    });

    // describe("stake()", async () => {
    //     it("staking increases staking balance", async () => {
    //         const totalToStake = toUnit("100");
    //         await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
    //         await stakingToken.approve(stakingRewards.address, totalToStake, {
    //             from: stakingAccount1,
    //         });

    //         const initialStakeBal = await stakingRewards.balanceOf(stakingAccount1);
    //         const initialLpBal = await stakingToken.balanceOf(stakingAccount1);

    //         await stakingRewards.stake(totalToStake, { from: stakingAccount1 });

    //         const postStakeBal = await stakingRewards.balanceOf(stakingAccount1);
    //         const postLpBal = await stakingToken.balanceOf(stakingAccount1);

    //         assert.bnLt(postLpBal, initialLpBal);
    //         assert.bnGt(postStakeBal, initialStakeBal);
    //     });

    //     it("cannot stake 0", async () => {
    //         await assert.revert(stakingRewards.stake("0"), "Cannot stake 0");
    //     });
    // });

    // describe("earned()", async () => {
    //     it("should be 0 when not staking", async () => {
    //         assert.bnEqual(await stakingRewards.earned(stakingAccount1), ZERO_BN);
    //     });

    //     it("should be > 0 when staking", async () => {
    //         const totalToStake = toUnit("100");
    //         await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
    //         await stakingToken.approve(stakingRewards.address, totalToStake, {
    //             from: stakingAccount1,
    //         });
    //         await stakingRewards.stake(totalToStake, { from: stakingAccount1 });

    //         await stakingRewards.notifyRewardAmount(toUnit(5000.0), {
    //             from: mockRewardsDistributionAddress,
    //         });

    //         await fastForward(DAY);

    //         const earned = await stakingRewards.earned(stakingAccount1);

    //         assert.bnGt(earned, ZERO_BN);
    //     });

    //     it("rewardRate should increase if new rewards come before DURATION ends", async () => {
    //         const totalToDistribute = toUnit("5000");

    //         await rewardsToken.transfer(stakingRewards.address, totalToDistribute, { from: owner });
    //         await stakingRewards.notifyRewardAmount(totalToDistribute, {
    //             from: mockRewardsDistributionAddress,
    //         });

    //         const rewardRateInitial = await stakingRewards.rewardRate();

    //         await rewardsToken.transfer(stakingRewards.address, totalToDistribute, { from: owner });
    //         await stakingRewards.notifyRewardAmount(totalToDistribute, {
    //             from: mockRewardsDistributionAddress,
    //         });

    //         const rewardRateLater = await stakingRewards.rewardRate();

    //         assert.bnGt(rewardRateInitial, ZERO_BN);
    //         assert.bnGt(rewardRateLater, rewardRateInitial);
    //     });

    //     it("rewards token balance should rollover after DURATION", async () => {
    //         const totalToStake = toUnit("100");
    //         const totalToDistribute = toUnit("5000");

    //         await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
    //         await stakingToken.approve(stakingRewards.address, totalToStake, {
    //             from: stakingAccount1,
    //         });
    //         await stakingRewards.stake(totalToStake, { from: stakingAccount1 });

    //         await rewardsToken.transfer(stakingRewards.address, totalToDistribute, { from: owner });
    //         await stakingRewards.notifyRewardAmount(totalToDistribute, {
    //             from: mockRewardsDistributionAddress,
    //         });

    //         await fastForward(DAY * 7);
    //         const earnedFirst = await stakingRewards.earned(stakingAccount1);

    //         await setRewardsTokenExchangeRate();
    //         await rewardsToken.transfer(stakingRewards.address, totalToDistribute, { from: owner });
    //         await stakingRewards.notifyRewardAmount(totalToDistribute, {
    //             from: mockRewardsDistributionAddress,
    //         });

    //         await fastForward(DAY * 7);
    //         const earnedSecond = await stakingRewards.earned(stakingAccount1);

    //         assert.bnEqual(earnedSecond, earnedFirst.add(earnedFirst));
    //     });
    // });

    // describe("getReward()", async () => {
    //     it("should increase rewards token balance", async () => {
    //         const totalToStake = toUnit("100");
    //         const totalToDistribute = toUnit("5000");

    //         await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
    //         await stakingToken.approve(stakingRewards.address, totalToStake, {
    //             from: stakingAccount1,
    //         });
    //         await stakingRewards.stake(totalToStake, { from: stakingAccount1 });

    //         await rewardsToken.transfer(stakingRewards.address, totalToDistribute, { from: owner });
    //         await stakingRewards.notifyRewardAmount(totalToDistribute, {
    //             from: mockRewardsDistributionAddress,
    //         });

    //         await fastForward(DAY);

    //         const initialRewardBal = await rewardsToken.balanceOf(stakingAccount1);
    //         const initialEarnedBal = await stakingRewards.earned(stakingAccount1);
    //         await stakingRewards.getReward({ from: stakingAccount1 });
    //         const postRewardBal = await rewardsToken.balanceOf(stakingAccount1);
    //         const postEarnedBal = await stakingRewards.earned(stakingAccount1);

    //         assert.bnLt(postEarnedBal, initialEarnedBal);
    //         assert.bnGt(postRewardBal, initialRewardBal);
    //     });
    // });

    // describe("getRewardForDuration()", async () => {
    //     it("should increase rewards token balance", async () => {
    //         const totalToDistribute = toUnit("5000");

    //         await stakingRewards.notifyRewardAmount(totalToDistribute, {
    //             from: mockRewardsDistributionAddress,
    //         });

    //         const rewardForDuration = await stakingRewards.getRewardForDuration();

    //         const duration = await stakingRewards.DURATION();
    //         const rewardRate = await stakingRewards.rewardRate();

    //         assert.bnGt(rewardForDuration, ZERO_BN);
    //         assert.bnEqual(rewardForDuration, duration.mul(rewardRate));
    //     });
    // });

    // describe("withdraw()", async () => {
    //     it("cannot withdraw if nothing staked", async () => {
    //         await assert.revert(
    //             stakingRewards.withdraw(toUnit("100")),
    //             "SafeMath: subtraction overflow",
    //         );
    //     });

    //     it("should increases lp token balance and decreases staking balance", async () => {
    //         const totalToStake = toUnit("100");
    //         await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
    //         await stakingToken.approve(stakingRewards.address, totalToStake, {
    //             from: stakingAccount1,
    //         });
    //         await stakingRewards.stake(totalToStake, { from: stakingAccount1 });

    //         const initialStakingTokenBal = await stakingToken.balanceOf(stakingAccount1);
    //         const initialStakeBal = await stakingRewards.balanceOf(stakingAccount1);

    //         await stakingRewards.withdraw(totalToStake, { from: stakingAccount1 });

    //         const postStakingTokenBal = await stakingToken.balanceOf(stakingAccount1);
    //         const postStakeBal = await stakingRewards.balanceOf(stakingAccount1);

    //         assert.bnEqual(postStakeBal.add(toBN(totalToStake)), initialStakeBal);
    //         assert.bnEqual(initialStakingTokenBal.add(toBN(totalToStake)), postStakingTokenBal);
    //     });

    //     it("cannot withdraw 0", async () => {
    //         await assert.revert(stakingRewards.withdraw("0"), "Cannot withdraw 0");
    //     });
    // });

    // describe("exit()", async () => {
    //     it("should retrieve all earned and increase rewards bal", async () => {
    //         const totalToStake = toUnit("100");
    //         const totalToDistribute = toUnit("5000");

    //         await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });
    //         await stakingToken.approve(stakingRewards.address, totalToStake, {
    //             from: stakingAccount1,
    //         });
    //         await stakingRewards.stake(totalToStake, { from: stakingAccount1 });

    //         await rewardsToken.transfer(stakingRewards.address, totalToDistribute, { from: owner });
    //         await stakingRewards.notifyRewardAmount(toUnit(5000.0), {
    //             from: mockRewardsDistributionAddress,
    //         });

    //         await fastForward(DAY);

    //         const initialRewardBal = await rewardsToken.balanceOf(stakingAccount1);
    //         const initialEarnedBal = await stakingRewards.earned(stakingAccount1);
    //         await stakingRewards.exit({ from: stakingAccount1 });
    //         const postRewardBal = await rewardsToken.balanceOf(stakingAccount1);
    //         const postEarnedBal = await stakingRewards.earned(stakingAccount1);

    //         assert.bnLt(postEarnedBal, initialEarnedBal);
    //         assert.bnGt(postRewardBal, initialRewardBal);
    //         assert.bnEqual(postEarnedBal, ZERO_BN);
    //     });
    // });

    // describe("Integration Tests", async () => {
    //     before(async () => {
    //         // Set rewardDistribution address
    //         await stakingRewards.setRewardsDistribution(rewardsDistribution.address, {
    //             from: owner,
    //         });
    //         assert.equal(await stakingRewards.rewardsDistribution(), rewardsDistribution.address);

    //         await setRewardsTokenExchangeRate();
    //     });

    //     it("stake and claim", async () => {
    //         // Transfer some LP Tokens to user
    //         const totalToStake = toUnit("500");
    //         await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });

    //         // Stake LP Tokens
    //         await stakingToken.approve(stakingRewards.address, totalToStake, {
    //             from: stakingAccount1,
    //         });
    //         await stakingRewards.stake(totalToStake, { from: stakingAccount1 });

    //         // Distribute some rewards
    //         const totalToDistribute = toUnit("35000");
    //         assert.equal(await rewardsDistribution.distributionsLength(), 0);
    //         await rewardsDistribution.addRewardDistribution(
    //             stakingRewards.address,
    //             totalToDistribute,
    //             {
    //                 from: owner,
    //             },
    //         );
    //         assert.equal(await rewardsDistribution.distributionsLength(), 1);

    //         // Transfer Rewards to the RewardsDistribution contract address
    //         await rewardsToken.transfer(rewardsDistribution.address, totalToDistribute, {
    //             from: owner,
    //         });

    //         // Distribute Rewards called from Synthetix contract as the authority to distribute
    //         await rewardsDistribution.distributeRewards(totalToDistribute, {
    //             from: authority,
    //         });

    //         // Period finish should be ~7 days from now
    //         const periodFinish = await stakingRewards.periodFinish();
    //         const curTimestamp = await currentTime();
    //         assert.equal(parseInt(periodFinish.toString(), 10), curTimestamp + DAY * 7);

    //         // Reward duration is 7 days, so we'll
    //         // Fastforward time by 6 days to prevent expiration
    //         await fastForward(DAY * 6);

    //         // Reward rate and reward per token
    //         const rewardRate = await stakingRewards.rewardRate();
    //         assert.bnGt(rewardRate, ZERO_BN);

    //         const rewardPerToken = await stakingRewards.rewardPerToken();
    //         assert.bnGt(rewardPerToken, ZERO_BN);

    //         // Make sure we earned in proportion to reward per token
    //         const rewardRewardsEarned = await stakingRewards.earned(stakingAccount1);
    //         assert.bnEqual(rewardRewardsEarned, rewardPerToken.mul(totalToStake).div(toUnit(1)));

    //         // Make sure after withdrawing, we still have the ~amount of rewardRewards
    //         // The two values will be a bit different as time has "passed"
    //         const initialWithdraw = toUnit("100");
    //         await stakingRewards.withdraw(initialWithdraw, { from: stakingAccount1 });
    //         assert.bnEqual(initialWithdraw, await stakingToken.balanceOf(stakingAccount1));

    //         const rewardRewardsEarnedPostWithdraw = await stakingRewards.earned(stakingAccount1);
    //         assert.bnClose(rewardRewardsEarned, rewardRewardsEarnedPostWithdraw, toUnit("0.1"));

    //         // Get rewards
    //         const initialRewardBal = await rewardsToken.balanceOf(stakingAccount1);
    //         await stakingRewards.getReward({ from: stakingAccount1 });
    //         const postRewardRewardBal = await rewardsToken.balanceOf(stakingAccount1);

    //         assert.bnGt(postRewardRewardBal, initialRewardBal);

    //         // Exit
    //         const preExitLPBal = await stakingToken.balanceOf(stakingAccount1);
    //         await stakingRewards.exit({ from: stakingAccount1 });
    //         const postExitLPBal = await stakingToken.balanceOf(stakingAccount1);
    //         assert.bnGt(postExitLPBal, preExitLPBal);
    //     });
    // });
});
