/* eslint-disable no-nested-ternary */

import * as t from "types/generated";
import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBNClose } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { ONE_WEEK, ZERO_ADDRESS } from "@utils/constants";
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
            before(async () => {
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
            it("should collect the tokens from sender", async () => {
                const sender = sa.default;
                const rewardees = [sa.dummy1, sa.dummy2];
                const amounts = [simpleToExactAmount(100, 18), simpleToExactAmount(50, 18)];

                const currentPeriod = await rewardsVault.getCurrentPeriod();
                const zoomWeeks = 3;
                const rewardsBefore = await Promise.all(
                    rewardees.map((r) => rewardsVault.getBalance(r, currentPeriod.addn(zoomWeeks))),
                );
                const senderBalBefore = await rewardToken.balanceOf(sender);
                const contractBalBefore = await rewardToken.balanceOf(rewardsVault.address);

                await time.increase(ONE_WEEK.muln(zoomWeeks).addn(1));
                const totalAmount = amounts.reduce((p, c) => p.add(c), new BN(0));
                await rewardToken.approve(rewardsVault.address, totalAmount, { from: sender });
                const tx = await rewardsVault.airdropRewards(rewardees, amounts, { from: sender });

                expectEvent(tx.receipt, "Deposited", {
                    rewardee: rewardees[0],
                    amount: amounts[0],
                    period: currentPeriod.addn(zoomWeeks),
                });

                expectEvent(tx.receipt, "Deposited", {
                    rewardee: rewardees[1],
                    amount: amounts[1],
                    period: currentPeriod.addn(zoomWeeks),
                });

                const senderBalAfter = await rewardToken.balanceOf(sender);
                expect(senderBalBefore.sub(totalAmount)).bignumber.eq(senderBalAfter);
                const contractBalAfter = await rewardToken.balanceOf(rewardsVault.address);
                expect(contractBalBefore.add(totalAmount)).bignumber.eq(contractBalAfter);

                const rewardsAfter = await Promise.all(
                    rewardees.map((r) => rewardsVault.getBalance(r, currentPeriod.addn(zoomWeeks))),
                );

                rewardsAfter.map((r, i) =>
                    expect(r).bignumber.eq(rewardsBefore[i].add(amounts[i])),
                );
            });

            it("should not allow immediate vesting", async () => {
                await expectRevert(
                    rewardsVault.vestRewards([0], { from: sa.dummy1 }),
                    "Period must be unlocked to vest",
                );
                await expectRevert(
                    rewardsVault.vestRewards([0, 1], { from: sa.dummy2 }),
                    "Period must be unlocked to vest",
                );
            });
            it("should handle duplicate rewardees", async () => {
                const sender = sa.default;
                const rewardees = [sa.dummy2, sa.dummy3, sa.dummy3];
                const amounts = [
                    simpleToExactAmount(100, 18),
                    simpleToExactAmount(50, 18),
                    simpleToExactAmount(25, 18),
                ];
                await time.increase(ONE_WEEK.addn(1));
                const currentPeriod = await rewardsVault.getCurrentPeriod();
                const rewardsBefore = await Promise.all(
                    rewardees.map((r) => rewardsVault.getBalance(r, currentPeriod)),
                );
                const senderBalBefore = await rewardToken.balanceOf(sender);
                const contractBalBefore = await rewardToken.balanceOf(rewardsVault.address);

                const totalAmount = amounts.reduce((p, c) => p.add(c), new BN(0));
                await rewardToken.approve(rewardsVault.address, totalAmount, { from: sender });
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
                expectEvent(tx.receipt, "Deposited", {
                    rewardee: sa.dummy3,
                    amount: amounts[2],
                    period: currentPeriod,
                });

                const senderBalAfter = await rewardToken.balanceOf(sender);
                expect(senderBalBefore.sub(totalAmount)).bignumber.eq(senderBalAfter);
                const contractBalAfter = await rewardToken.balanceOf(rewardsVault.address);
                expect(contractBalBefore.add(totalAmount)).bignumber.eq(contractBalAfter);

                const rewardsAfter = await Promise.all(
                    rewardees.map((r) => rewardsVault.getBalance(r, currentPeriod)),
                );

                expect(rewardsAfter[0]).bignumber.eq(rewardsBefore[0].add(amounts[0]));
                expect(rewardsAfter[1]).bignumber.eq(
                    rewardsBefore[1].add(amounts[1]).add(amounts[2]),
                );
            });
            it("should fail if sender doesnt have enough tokens", async () => {
                const sender = sa.dummy2;
                const amounts = [simpleToExactAmount(100, 18), simpleToExactAmount(50, 18)];
                await rewardToken.transfer(sender, amounts[0]);

                const senderBalBefore = await rewardToken.balanceOf(sender);
                expect(senderBalBefore).bignumber.eq(amounts[0]);

                await rewardToken.approve(rewardsVault.address, amounts[0].add(amounts[1]), {
                    from: sender,
                });
                await expectRevert(
                    rewardsVault.airdropRewards([sender, sender], amounts, { from: sender }),
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
                    rewardsVault.airdropRewards([sender], [amount], { from: sender }),
                    "SafeERC20: low-level call failed",
                );
            });
            it("should fail if the inputs are incorrect", async () => {
                // When empty addresses
                await expectRevert(
                    rewardsVault.airdropRewards([], [simpleToExactAmount(1, 18)]),
                    "Invalid input data",
                );
                // When mismatching lengths
                await expectRevert(
                    rewardsVault.airdropRewards(
                        [sa.dummy3, sa.dummy2],
                        [
                            simpleToExactAmount(1, 18),
                            simpleToExactAmount(1, 18),
                            simpleToExactAmount(1, 18),
                        ],
                    ),
                    "Invalid input data",
                );
                // When empty amounts
                await expectRevert(
                    rewardsVault.airdropRewards([sa.dummy3], []),
                    "Invalid input data",
                );
            });
        });
        context("while allRewardsUnlocked is true", () => {
            before(async () => {
                rewardsVault = await redeployVault();
                await rewardsVault.unlockAllRewards({ from: sa.governor });
            });
            it("should not log anything in the current period", async () => {
                const rewardee = sa.dummy1;
                const amount = simpleToExactAmount(100, 18);
                const rewardBefore = await rewardsVault.getBalance(rewardee, 0);
                await rewardToken.approve(rewardsVault.address, amount);
                const tx = await rewardsVault.lockupRewards(rewardee, amount);
                expectEvent(tx.receipt, "Vested", {
                    user: rewardee,
                    cumulative: amount,
                });
                const rewardAfter = await rewardsVault.getBalance(rewardee, 0);
                expect(rewardBefore).bignumber.eq(rewardAfter);
            });
            it("should just transfer the tokens straight to recipient", async () => {
                const sender = sa.default;
                const rewardee = sa.dummy1;
                const amount = simpleToExactAmount(100, 18);

                await time.increase(ONE_WEEK.addn(1));
                const currentPeriod = await rewardsVault.getCurrentPeriod();

                const senderBalBefore = await rewardToken.balanceOf(sender);
                const contractBalBefore = await rewardToken.balanceOf(rewardsVault.address);
                const rewardeeBalBefore = await rewardToken.balanceOf(rewardee);

                await rewardToken.approve(rewardsVault.address, amount, { from: sender });

                const tx = await rewardsVault.lockupRewards(rewardee, amount, { from: sender });

                expectEvent(tx.receipt, "Vested", {
                    user: rewardee,
                    cumulative: amount,
                    period: [currentPeriod],
                });
                const senderBalAfter = await rewardToken.balanceOf(sender);
                expect(senderBalBefore.sub(amount)).bignumber.eq(senderBalAfter);
                const contractBalAfter = await rewardToken.balanceOf(rewardsVault.address);
                expect(contractBalBefore).bignumber.eq(contractBalAfter);
                const rewardeeBalAfter = await rewardToken.balanceOf(rewardee);
                expect(rewardeeBalBefore.add(amount)).bignumber.eq(rewardeeBalAfter);
            });
            it("should not change behavior of airdrop", async () => {
                // Copied from the airdrop test [0]

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
        });
    });
    context("vesting rewards", () => {
        context("while lockup is active", () => {
            it("should always fail if input is empty", async () => {
                await expectRevert(rewardsVault.vestRewards([]), "Must vest some periods");
            });
            describe("vesting before lockup period is over", () => {
                const amount = simpleToExactAmount(1, 18);
                const rewardee = sa.dummy1;
                before(async () => {
                    rewardsVault = await redeployVault();
                    await rewardToken.approve(rewardsVault.address, amount.muln(100));

                    await rewardsVault.lockupRewards(rewardee, amount);
                    await time.increase(ONE_WEEK.addn(1));
                    await rewardsVault.lockupRewards(rewardee, amount);
                    await time.increase(ONE_WEEK.addn(1));
                    await rewardsVault.lockupRewards(rewardee, amount);
                    const reward0 = await rewardsVault.getBalance(rewardee, 0);
                    const reward1 = await rewardsVault.getBalance(rewardee, 1);
                    const reward2 = await rewardsVault.getBalance(rewardee, 2);
                    expect(reward0).bignumber.eq(amount);
                    expect(reward1).bignumber.eq(amount);
                    expect(reward2).bignumber.eq(amount);
                });
                it("should always fail if any period is not unlocked", async () => {
                    await expectRevert(
                        rewardsVault.vestRewards([0, 1, 2], { from: rewardee }),
                        "Period must be unlocked to vest",
                    );
                    const x = await rewardsVault.LOCKUP_PERIODS();
                    // Increase to period X
                    await time.increase(ONE_WEEK.mul(x.subn(2)));
                    // [0   -   1 -   2 -   3 ..... ] PERIODS
                    // [x+1 - x+2 - x+3 - x+4 ..... ] UNLOCK AT PERIOD
                    // e.g. 0, x = 26, unlocks at 26.
                    await expectRevert(
                        rewardsVault.vestRewards([0], { from: rewardee }),
                        "Period must be unlocked to vest",
                    );
                    await time.increase(ONE_WEEK.addn(1));

                    const tx = await rewardsVault.vestRewards([0], { from: rewardee });

                    expectEvent(tx.receipt, "Vested", {
                        user: rewardee,
                        cumulative: amount,
                    });
                });
            });
            describe("vesting after lockup period is over", () => {
                const amount0 = simpleToExactAmount(1, 18);
                const amount1 = new BN(0);
                const amount2 = simpleToExactAmount(50, 18);
                const rewardee = sa.dummy1;
                beforeEach(async () => {
                    rewardsVault = await redeployVault();
                    await rewardToken.approve(rewardsVault.address, simpleToExactAmount(100, 18));

                    await rewardsVault.lockupRewards(rewardee, amount0);
                    await time.increase(ONE_WEEK.addn(1));
                    await rewardsVault.lockupRewards(rewardee, amount1);
                    await time.increase(ONE_WEEK.addn(1));
                    await rewardsVault.lockupRewards(rewardee, amount2);
                    const reward0 = await rewardsVault.getBalance(rewardee, 0);
                    const reward1 = await rewardsVault.getBalance(rewardee, 1);
                    const reward2 = await rewardsVault.getBalance(rewardee, 2);
                    expect(reward0).bignumber.eq(amount0);
                    expect(reward1).bignumber.eq(amount1);
                    expect(reward2).bignumber.eq(amount2);
                });
                it("should send out the reward tokens", async () => {
                    const rewardeeBalBefore = await rewardToken.balanceOf(rewardee);
                    const contractBalBefore = await rewardToken.balanceOf(rewardsVault.address);

                    const x = await rewardsVault.LOCKUP_PERIODS();
                    // Increase to period X+2
                    await time.increase(ONE_WEEK.mul(x));
                    // [0   -   1 -   2 -   3 ..... ] PERIODS
                    // [x+1 - x+2 - x+3 - x+4 ..... ] UNLOCK AT PERIOD
                    // e.g. 0, x = 26, unlocks at 26.
                    await expectRevert(
                        rewardsVault.vestRewards([0, 1, 2], { from: rewardee }),
                        "Period must be unlocked to vest",
                    );
                    await time.increase(ONE_WEEK.addn(1));

                    const tx = await rewardsVault.vestRewards([0, 1, 2], { from: rewardee });

                    expectEvent(tx.receipt, "Vested", {
                        user: rewardee,
                        cumulative: simpleToExactAmount(51, 18),
                    });

                    // Sends out the tokens
                    // rewardeeBal
                    const rewardeeBalAfter = await rewardToken.balanceOf(rewardee);
                    expect(rewardeeBalAfter).bignumber.eq(
                        rewardeeBalBefore.add(simpleToExactAmount(51, 18)),
                    );
                    // contractBal
                    const contractBalAfter = await rewardToken.balanceOf(rewardsVault.address);
                    expect(contractBalAfter).bignumber.eq(
                        contractBalBefore.sub(simpleToExactAmount(51, 18)),
                    );

                    // Removes existing rewards
                    expect(await rewardsVault.getBalance(rewardee, 0)).bignumber.eq(new BN(0));
                    expect(await rewardsVault.getBalance(rewardee, 1)).bignumber.eq(new BN(0));
                    expect(await rewardsVault.getBalance(rewardee, 2)).bignumber.eq(new BN(0));
                });

                it("should not allow the same period to be credited twice in same tx", async () => {
                    const rewardeeBalBefore = await rewardToken.balanceOf(rewardee);
                    const contractBalBefore = await rewardToken.balanceOf(rewardsVault.address);

                    const x = await rewardsVault.LOCKUP_PERIODS();
                    // Increase to period X+3
                    await time.increase(ONE_WEEK.mul(x.addn(1)));

                    const tx = await rewardsVault.vestRewards([0, 0], { from: rewardee });

                    expectEvent(tx.receipt, "Vested", {
                        user: rewardee,
                        cumulative: simpleToExactAmount(1, 18),
                    });

                    // Sends out the tokens
                    // rewardeeBal
                    const rewardeeBalAfter = await rewardToken.balanceOf(rewardee);
                    expect(rewardeeBalAfter).bignumber.eq(
                        rewardeeBalBefore.add(simpleToExactAmount(1, 18)),
                    );
                    // contractBal
                    const contractBalAfter = await rewardToken.balanceOf(rewardsVault.address);
                    expect(contractBalAfter).bignumber.eq(
                        contractBalBefore.sub(simpleToExactAmount(1, 18)),
                    );

                    // Removes existing rewards
                    expect(await rewardsVault.getBalance(rewardee, 0)).bignumber.eq(new BN(0));
                    expect(await rewardsVault.getBalance(rewardee, 1)).bignumber.eq(new BN(0));
                    expect(await rewardsVault.getBalance(rewardee, 2)).bignumber.eq(
                        simpleToExactAmount(50, 18),
                    );
                });

                it("should not allow the same period to be credited twice in consequent tx", async () => {
                    const x = await rewardsVault.LOCKUP_PERIODS();
                    // Increase to period X+3
                    await time.increase(ONE_WEEK.mul(x.addn(3)));

                    await rewardsVault.vestRewards([0, 0], { from: rewardee });

                    await expectRevert(
                        rewardsVault.vestRewards([0], { from: rewardee }),
                        "Nothing in these periods to vest",
                    );
                });

                it("should fail if nothing to vest", async () => {
                    const x = await rewardsVault.LOCKUP_PERIODS();
                    // Increase to period X+2
                    await time.increase(ONE_WEEK.mul(x));
                    await expectRevert(
                        rewardsVault.vestRewards([0, 1, 2], { from: rewardee }),
                        "Period must be unlocked to vest",
                    );
                    await time.increase(ONE_WEEK.addn(1));

                    await expectRevert(
                        rewardsVault.vestRewards([1], { from: rewardee }),
                        "Nothing in these periods to vest",
                    );
                });
            });
        });
        context("while allRewardsUnlocked is true", () => {
            const amount0 = simpleToExactAmount(1, 18);
            const amount1 = new BN(0);
            const amount2 = simpleToExactAmount(50, 18);
            const rewardee = sa.dummy1;
            before(async () => {
                rewardsVault = await redeployVault();
                await rewardToken.approve(rewardsVault.address, simpleToExactAmount(100, 18));

                await rewardsVault.lockupRewards(rewardee, amount0);
                await time.increase(ONE_WEEK.addn(1));
                await rewardsVault.lockupRewards(rewardee, amount1);
                await time.increase(ONE_WEEK.addn(1));
                await rewardsVault.lockupRewards(rewardee, amount2);
                const reward0 = await rewardsVault.getBalance(rewardee, 0);
                const reward1 = await rewardsVault.getBalance(rewardee, 1);
                const reward2 = await rewardsVault.getBalance(rewardee, 2);
                expect(reward0).bignumber.eq(amount0);
                expect(reward1).bignumber.eq(amount1);
                expect(reward2).bignumber.eq(amount2);
            });
            it("should allow non vested rewards to be unlocked", async () => {
                await expectRevert(
                    rewardsVault.vestRewards([0, 1, 2], { from: rewardee }),
                    "Period must be unlocked to vest",
                );

                await rewardsVault.unlockAllRewards({ from: sa.governor });

                const tx = await rewardsVault.vestRewards([0, 1, 2], { from: rewardee });

                expectEvent(tx.receipt, "Vested", {
                    user: rewardee,
                    cumulative: simpleToExactAmount(51, 18),
                });
            });
        });
    });
    context("unlocking all rewards", () => {
        const amount0 = simpleToExactAmount(1, 18);
        const amount1 = new BN(0);
        const amount2 = simpleToExactAmount(50, 18);
        const rewardee = sa.dummy1;
        beforeEach(async () => {
            rewardsVault = await redeployVault();
            await rewardToken.approve(rewardsVault.address, simpleToExactAmount(100, 18));

            await rewardsVault.lockupRewards(rewardee, amount0);
            await time.increase(ONE_WEEK.addn(1));
            await rewardsVault.lockupRewards(rewardee, amount1);
            await time.increase(ONE_WEEK.addn(1));
            await rewardsVault.lockupRewards(rewardee, amount2);
            const reward0 = await rewardsVault.getBalance(rewardee, 0);
            const reward1 = await rewardsVault.getBalance(rewardee, 1);
            const reward2 = await rewardsVault.getBalance(rewardee, 2);
            expect(reward0).bignumber.eq(amount0);
            expect(reward1).bignumber.eq(amount1);
            expect(reward2).bignumber.eq(amount2);
        });
        it("should allow the governor to unlock all rewards", async () => {
            const tx = await rewardsVault.unlockAllRewards({ from: sa.governor });

            expectEvent(tx.receipt, "AllRewardsUnlocked");
        });
        it("should cause all locked rewards to be vested, even though time has not elapsed", async () => {
            await expectRevert(
                rewardsVault.vestRewards([0, 1, 2], { from: rewardee }),
                "Period must be unlocked to vest",
            );

            await rewardsVault.unlockAllRewards({ from: sa.governor });

            const tx = await rewardsVault.vestRewards([0, 1, 2], { from: rewardee });

            expectEvent(tx.receipt, "Vested", {
                user: rewardee,
                cumulative: simpleToExactAmount(51, 18),
            });
        });
        it("should not all non-governor to unlock", async () => {
            await expectRevert(rewardsVault.unlockAllRewards(), "Only governor can execute");
        });
        it("should fail if unlocked twice", async () => {
            await rewardsVault.unlockAllRewards({ from: sa.governor });

            await expectRevert(
                rewardsVault.unlockAllRewards({ from: sa.governor }),
                "Flag already set",
            );
        });
    });
});
