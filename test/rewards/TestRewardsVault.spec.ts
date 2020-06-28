/* eslint-disable no-nested-ternary */

import * as t from "types/generated";
import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { ONE_WEEK, ONE_DAY, FIVE_DAYS, fullScale, ZERO_ADDRESS } from "@utils/constants";
import envSetup from "@utils/env_setup";

import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const MockERC20 = artifacts.require("MockERC20");
const RewardsVault = artifacts.require("RewardsVault");

const { expect } = envSetup.configure();

contract("RewardsVault", async (accounts) => {
    const ctx: {
        module?: t.ModuleInstance;
    } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;

    let rewardToken: t.MockErc20Instance;
    let rewardsVault: t.RewardsVaultInstance;

    const redeployVault = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.RewardsVaultInstance> => {
        rewardToken = await MockERC20.new("Reward", "RWD", 18, sa.default, 1000000);
        return RewardsVault.new(nexusAddress, rewardToken.address);
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
        rewardsVault = await redeployVault();
        ctx.module = rewardsVault as t.ModuleInstance;
    });

    describe("implementing Module", async () => {
        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
    });

    describe("constructor & settings", async () => {
        it("should set the vesting token and start time", async () => {
            const actualVestingToken = await rewardsVault.vestingToken();
            expect(actualVestingToken).eq(rewardToken.address);

            const startTime = await rewardsVault.vaultStartTime();
            const curTime = await time.latest();
            assertBNClose(startTime, curTime, new BN(2));
        });
        it("should return correct period from getCurrentPeriod", async () => {
            const period = await rewardsVault.getCurrentPeriod();
            expect(period).bignumber.eq(new BN(0));

            await time.increase(ONE_WEEK.addn(1));

            const periodAfter = await rewardsVault.getCurrentPeriod();
            expect(periodAfter).bignumber.eq(new BN(1));

            await time.increase(ONE_WEEK.divn(2));

            const periodEnd = await rewardsVault.getCurrentPeriod();
            expect(periodEnd).bignumber.eq(new BN(1));
        });
    });
    context("locking up rewards", () => {
        context("while lockup is active", () => {
            before(async () => {
                rewardsVault = await redeployVault();
            });
            it("should add the reward to the current period", async () => {
                const rewardee = sa.dummy1;
                const amount = simpleToExactAmount(100, 18);
                const rewardBefore = await rewardsVault.getBalance(rewardee, 0);

                await rewardToken.approve(rewardsVault.address, amount);
                const tx = await rewardsVault.lockupRewards(rewardee, amount);

                expectEvent(tx.receipt, "Deposited", {
                    rewardee,
                    amount,
                    period: new BN(0),
                });

                const rewardAfter = await rewardsVault.getBalance(rewardee, 0);
                expect(rewardBefore.add(amount)).bignumber.eq(rewardAfter);
            });
            it("should collect the tokens from sender", async () => {
                const sender = sa.default;
                const amount = simpleToExactAmount(100, 18);

                const senderBalBefore = await rewardToken.balanceOf(sender);
                const rewardBefore = await rewardsVault.getBalance(sender, new BN(1));
                const contractBalBefore = await rewardToken.balanceOf(rewardsVault.address);

                await time.increase(ONE_WEEK.addn(1));

                await rewardToken.approve(rewardsVault.address, amount, { from: sender });
                const tx = await rewardsVault.lockupRewards(sender, amount, { from: sender });

                expectEvent(tx.receipt, "Deposited", {
                    rewardee: sender,
                    amount,
                    period: new BN(1),
                });

                const senderBalAfter = await rewardToken.balanceOf(sender);
                expect(senderBalBefore.sub(amount)).bignumber.eq(senderBalAfter);
                const contractBalAfter = await rewardToken.balanceOf(rewardsVault.address);
                expect(contractBalBefore.add(amount)).bignumber.eq(contractBalAfter);
                const rewardAfter = await rewardsVault.getBalance(sender, new BN(1));
                expect(rewardBefore.add(amount)).bignumber.eq(rewardAfter);
            });
            it("should not allow immediate vesting", async () => {
                await expectRevert(
                    rewardsVault.vestRewards([0], { from: sa.dummy1 }),
                    "Period must be unlocked to vest",
                );
                await expectRevert(
                    rewardsVault.vestRewards([1], { from: sa.default }),
                    "Period must be unlocked to vest",
                );
            });
            it("should fail if sender doesnt have enough tokens", async () => {
                const sender = sa.dummy2;
                const amount = simpleToExactAmount(100, 18);

                const senderBalBefore = await rewardToken.balanceOf(sender);
                expect(senderBalBefore).bignumber.lt(amount as any);

                await rewardToken.approve(rewardsVault.address, amount, { from: sender });
                await expectRevert(
                    rewardsVault.lockupRewards(sender, amount, { from: sender }),
                    "SafeERC20: low-level call failed",
                );
            });
            it("should fail if sender doesnt approve spending", async () => {
                const sender = sa.default;
                const amount = simpleToExactAmount(100, 18);

                const senderBalBefore = await rewardToken.balanceOf(sender);
                expect(senderBalBefore).bignumber.gte(amount as any);

                await rewardToken.approve(rewardsVault.address, 0, { from: sender });
                await expectRevert(
                    rewardsVault.lockupRewards(sender, amount, { from: sender }),
                    "SafeERC20: low-level call failed",
                );
            });
            it("should fail if rewardee is null", async () => {
                const sender = sa.default;
                const amount = simpleToExactAmount(100, 18);

                const senderBalBefore = await rewardToken.balanceOf(sender);
                expect(senderBalBefore).bignumber.gte(amount as any);

                await rewardToken.approve(rewardsVault.address, amount, { from: sender });
                await expectRevert(
                    rewardsVault.lockupRewards(ZERO_ADDRESS, amount, { from: sender }),
                    "Rewardee cannot be null",
                );
            });
        });
        context("airdropping multiple rewards", () => {
            beforeEach(async () => {
                rewardsVault = await redeployVault();
            });
            it("should add the reward to the current period", async () => {
                const sender = sa.default;
                const rewardees = [sa.dummy1, sa.dummy2];
                const amounts = [simpleToExactAmount(100, 18), simpleToExactAmount(50, 18)];

                const currentPeriod = await rewardsVault.getCurrentPeriod();
                const rewardsBefore = await Promise.all(
                    rewardees.map((r) => rewardsVault.getBalance(r, currentPeriod)),
                );

                await rewardToken.approve(
                    rewardsVault.address,
                    amounts.reduce((p, c) => p.add(c), new BN(0)),
                    { from: sender },
                );
                const tx = await rewardsVault.airdropRewards(rewardees, amounts, { from: sender });

                expectEvent(tx.receipt, "Deposited", {
                    rewardee: rewardees[0],
                    amount: amounts[0],
                    period: currentPeriod,
                });

                expectEvent(tx.receipt, "Deposited", {
                    rewardee: rewardees[1],
                    amount: amounts[1],
                    period: currentPeriod,
                });

                const rewardsAfter = await Promise.all(
                    rewardees.map((r) => rewardsVault.getBalance(r, currentPeriod)),
                );

                rewardsAfter.map((r, i) =>
                    expect(r).bignumber.eq(rewardsBefore[i].add(amounts[i])),
                );
            });
            it("should collect the tokens from sender");
            it("should not allow immediate vesting");
            it("should handle duplicate rewardees");
            it("should fail if sender doesnt have enough tokens");
            it("should fail if sender doesnt approve spending");
            it("should fail if the inputs are incorrect");
        });
        context("while allRewardsUnlocked is true", () => {
            it("should just transfer the tokens straight to recipient");
            it("should just transfer the tokens to recipient");
            it("should not change behavior of airdrop");
        });
    });
    context("vesting rewards", () => {
        context("while lockup is active", () => {
            it("should always fail if input is empty");
            describe("vesting before lockup period is over", () => {
                it("should always fail if any period is not unlocked");
            });
            describe("vesting after lockup period is over", () => {
                it("should send out the reward tokens");
                it("should not allow the same period to be credited twice in same tx");
                it("should not allow the same period to be credited twice in consequent tx");
                it("should fail if nothing to vest");
            });
        });
        context("while allRewardsUnlocked is true", () => {
            it("should allow non vested rewards to be unlocked");
        });
    });
    context("unlocking all rewards", () => {
        it("should allow the governor to unlock all rewards");
        it("should cause all locked rewards to be vested, even though time has not elapsed");
        it("should not all non-governor to unlock");
        it("should fail if unlocked twice");
    });
});
