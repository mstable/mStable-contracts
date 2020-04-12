/* eslint-disable @typescript-eslint/camelcase */
import * as t from "types/generated";
import { createMultiple, simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import { expectRevert, expectEvent } from "@openzeppelin/test-helpers";
import { MassetMachine, StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import { aToH, BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { MockERC20Instance, MassetInstance } from "types/generated";
import { fullScale, ZERO_ADDRESS, ZERO } from "@utils/constants";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const { expect, assert } = envSetup.configure();

const SavingsContract: t.SavingsContractContract = artifacts.require("SavingsContract");
const MockNexus: t.MockNexusContract = artifacts.require("MockNexus");
const MockMasset: t.MockMassetContract = artifacts.require("MockMasset");
const MockSavingsManager: t.MockSavingsManagerContract = artifacts.require("MockSavingsManager");

contract("SavingsContract", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const manager = sa.dummy2;
    const ctx: { module?: t.ModuleInstance } = {};
    const TEN_TOKENS = new BN(10).mul(new BN(10).pow(new BN(18)));

    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    let savingsContract: t.SavingsContractInstance;
    let nexus: t.MockNexusInstance;
    let masset: t.MockMassetInstance;
    let mockSavingManager: t.MockSavingsManagerInstance;

    async function createNewSavingsContract(): Promise<t.SavingsContractInstance> {
        nexus = await MockNexus.new(sa.governor, governance, manager);
        masset = await MockMasset.new("MOCK", "MOCK", 18, sa.default, new BN(1000));
        mockSavingManager = await MockSavingsManager.new();
        await nexus.setSavingsManager(mockSavingManager.address);
        return SavingsContract.new(nexus.address, masset.address);
    }

    function calculateCreditIssued(amount: BN, exchangeRate: BN): BN {
        return amount.mul(fullScale).div(exchangeRate);
    }

    before(async () => {
        savingsContract = await createNewSavingsContract();
    });

    describe("behaviors", async () => {
        describe("behave like a Module", async () => {
            beforeEach(async () => {
                savingsContract = await createNewSavingsContract();
                ctx.module = savingsContract;
            });
            shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
        });
    });

    describe("constructor", async () => {
        it("should fail when masset address is zero", async () => {
            await expectRevert(
                SavingsContract.new(nexus.address, ZERO_ADDRESS),
                "mAsset address is zero",
            );
        });

        it("should succeed when valid parameters", async () => {
            const nexusAddr = await savingsContract.nexus();
            expect(nexus.address).to.equal(nexusAddr);
            expect(ZERO).to.bignumber.equal(await savingsContract.totalCredits());
            expect(ZERO).to.bignumber.equal(await savingsContract.totalSavings());
            expect(fullScale).to.bignumber.equal(await savingsContract.exchangeRate());
        });
    });

    describe("automateInterestCollectionFlag()", async () => {
        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsContract.automateInterestCollectionFlag(true, { from: sa.other }),
                "Only governor can execute",
            );
        });

        it("should enable", async () => {
            const tx = await savingsContract.automateInterestCollectionFlag(true, {
                from: sa.governor,
            });
            expectEvent.inLogs(tx.logs, "AutomaticInterestCollectionSwitched", {
                automationEnabled: true,
            });
        });

        it("should disable", async () => {
            const tx = await savingsContract.automateInterestCollectionFlag(false, {
                from: sa.governor,
            });
            expectEvent.inLogs(tx.logs, "AutomaticInterestCollectionSwitched", {
                automationEnabled: false,
            });
        });
    });

    describe("depositSavings()", async () => {
        it("should fail when amount is zero", async () => {
            await expectRevert(savingsContract.depositSavings(ZERO), "Must deposit something");
        });

        it("should deposit some amount", async () => {
            // Approve first
            await masset.approve(savingsContract.address, TEN_TOKENS);

            const totalSavingsBefore = await savingsContract.totalSavings();
            const totalCreditsBefore = await savingsContract.totalCredits();
            const creditBalBefore = await savingsContract.creditBalances(sa.default);
            const exchangeRateBefore = await savingsContract.exchangeRate();
            expect(fullScale).to.bignumber.equal(exchangeRateBefore);

            // Deposit
            const tx = await savingsContract.depositSavings(TEN_TOKENS);
            const calcCreditIssued = calculateCreditIssued(TEN_TOKENS, exchangeRateBefore);
            expectEvent.inLogs(tx.logs, "SavingsDeposited", {
                saver: sa.default,
                savingsDeposited: TEN_TOKENS,
                creditsIssued: calcCreditIssued,
            });

            const totalSavingsAfter = await savingsContract.totalSavings();
            const totalCreditsAfter = await savingsContract.totalCredits();
            const creditBalAfter = await savingsContract.creditBalances(sa.default);
            const exchangeRateAfter = await savingsContract.exchangeRate();

            expect(totalSavingsBefore.add(TEN_TOKENS)).to.bignumber.equal(totalSavingsAfter);
            expect(totalCreditsBefore.add(calcCreditIssued)).to.bignumber.equal(totalCreditsAfter);
            expect(creditBalBefore.add(TEN_TOKENS)).to.bignumber.equal(creditBalAfter);
            expect(fullScale).to.bignumber.equal(exchangeRateAfter);
        });

        it("should deposit when auto interest collection enabled", async () => {
            // Approve first
            await masset.approve(savingsContract.address, TEN_TOKENS);

            await savingsContract.automateInterestCollectionFlag(true, { from: sa.governor });

            const balanceOfUserBefore = await masset.balanceOf(sa.default);
            const balanceBefore = await masset.balanceOf(savingsContract.address);
            const totalSavingsBefore = await savingsContract.totalSavings();
            const totalCreditsBefore = await savingsContract.totalCredits();
            const creditBalBefore = await savingsContract.creditBalances(sa.default);
            const exchangeRateBefore = await savingsContract.exchangeRate();
            expect(fullScale).to.bignumber.equal(exchangeRateBefore);

            // Deposit
            const tx = await savingsContract.depositSavings(TEN_TOKENS);
            expectEvent.inLogs(tx.logs, "SavingsDeposited", {
                saver: sa.default,
                savingsDeposited: TEN_TOKENS,
                creditsIssued: TEN_TOKENS,
            });

            const balanceOfUserAfter = await masset.balanceOf(sa.default);
            const balanceAfter = await masset.balanceOf(savingsContract.address);
            const totalSavingsAfter = await savingsContract.totalSavings();
            const totalCreditsAfter = await savingsContract.totalCredits();
            const creditBalAfter = await savingsContract.creditBalances(sa.default);
            const exchangeRateAfter = await savingsContract.exchangeRate();

            expect(balanceOfUserBefore.sub(TEN_TOKENS)).to.bignumber.equal(balanceOfUserAfter);
            expect(balanceBefore.add(TEN_TOKENS)).to.bignumber.equal(balanceAfter);
            expect(totalSavingsBefore.add(TEN_TOKENS)).to.bignumber.equal(totalSavingsAfter);
            expect(totalCreditsBefore.add(TEN_TOKENS)).to.bignumber.equal(totalCreditsAfter);
            expect(creditBalBefore.add(TEN_TOKENS)).to.bignumber.equal(creditBalAfter);
            expect(fullScale).to.bignumber.equal(exchangeRateAfter);
        });
    });

    describe("depositInterest()", async () => {
        const savingsManagerAccount = sa.dummy4;

        beforeEach(async () => {
            savingsContract = await createNewSavingsContract();
            await nexus.setSavingsManager(savingsManagerAccount);
            await masset.transfer(savingsManagerAccount, TEN_TOKENS);
            await masset.approve(savingsContract.address, TEN_TOKENS, {
                from: savingsManagerAccount,
            });
        });

        it("should fail when not called by savings manager", async () => {
            await expectRevert(
                savingsContract.depositInterest(TEN_TOKENS, { from: sa.other }),
                "Only savings manager can execute",
            );
        });

        it("should fail when amount is zero", async () => {
            await expectRevert(
                savingsContract.depositInterest(ZERO, { from: savingsManagerAccount }),
                "Must deposit something",
            );
        });

        it("should deposit interest when no credits", async () => {
            const balanceBefore = await masset.balanceOf(savingsContract.address);
            const exchangeRateBefore = await savingsContract.exchangeRate();

            await savingsContract.depositInterest(TEN_TOKENS, { from: savingsManagerAccount });

            const exchangeRateAfter = await savingsContract.exchangeRate();
            const balanceAfter = await masset.balanceOf(savingsContract.address);
            expect(TEN_TOKENS).to.bignumber.equal(await savingsContract.totalSavings());
            expect(balanceBefore.add(TEN_TOKENS)).to.bignumber.equal(balanceAfter);
            // exchangeRate should not change
            expect(exchangeRateBefore).to.bignumber.equal(exchangeRateAfter);
        });

        it("should deposit interest when some credits exist", async () => {
            const TWENTY_TOKENS = TEN_TOKENS.mul(new BN(2));

            // Deposit to SavingsContract
            await masset.approve(savingsContract.address, TEN_TOKENS);
            await savingsContract.automateInterestCollectionFlag(false, { from: sa.governor });
            await savingsContract.depositSavings(TEN_TOKENS);

            const balanceBefore = await masset.balanceOf(savingsContract.address);
            const exchangeRateBefore = await savingsContract.exchangeRate();

            // Deposit Interest
            const tx = await savingsContract.depositInterest(TEN_TOKENS, {
                from: savingsManagerAccount,
            });
            expectEvent.inLogs(tx.logs, "ExchangeRateUpdated", {
                newExchangeRate: TWENTY_TOKENS.mul(fullScale).div(TEN_TOKENS),
                interestCollected: TEN_TOKENS,
            });

            const exchangeRateAfter = await savingsContract.exchangeRate();
            const balanceAfter = await masset.balanceOf(savingsContract.address);
            expect(TWENTY_TOKENS).to.bignumber.equal(await savingsContract.totalSavings());
            expect(balanceBefore.add(TEN_TOKENS)).to.bignumber.equal(balanceAfter);

            // exchangeRate should change
            const expectedExchangeRate = TWENTY_TOKENS.mul(fullScale).div(TEN_TOKENS);
            expect(expectedExchangeRate).to.bignumber.equal(exchangeRateAfter);
        });
    });

    describe("redeem()", async () => {
        beforeEach(async () => {
            savingsContract = await createNewSavingsContract();
        });

        it("should fail when credits is zero", async () => {
            await expectRevert(savingsContract.redeem(ZERO), "Must withdraw something");
        });

        it("should fail when user don't have credits", async () => {
            const credits = new BN(10);
            await expectRevert(savingsContract.redeem(credits), "Saver has no credits", {
                from: sa.other,
            });
        });

        it("should redeem when user has balance", async () => {
            const FIVE_TOKENS = TEN_TOKENS.div(new BN(2));

            const balanceOfUserBefore = await masset.balanceOf(sa.default);

            // Approve tokens
            await masset.approve(savingsContract.address, TEN_TOKENS);

            // Deposit tokens first
            const balanceBeforeDeposit = await masset.balanceOf(savingsContract.address);
            await savingsContract.depositSavings(TEN_TOKENS);
            const balanceAfterDeposit = await masset.balanceOf(savingsContract.address);
            expect(balanceBeforeDeposit.add(TEN_TOKENS)).to.bignumber.equal(balanceAfterDeposit);

            // Redeem tokens
            const tx = await savingsContract.redeem(FIVE_TOKENS);
            const exchangeRate = fullScale;
            expectEvent.inLogs(tx.logs, "CreditsRedeemed", {
                redeemer: sa.default,
                creditsRedeemed: FIVE_TOKENS,
                savingsCredited: calculateCreditIssued(FIVE_TOKENS, exchangeRate),
            });
            const balanceAfterRedeem = await masset.balanceOf(savingsContract.address);
            expect(balanceAfterDeposit.sub(FIVE_TOKENS)).to.bignumber.equal(balanceAfterRedeem);

            const balanceOfUserAfter = await masset.balanceOf(sa.default);
            expect(balanceOfUserBefore.sub(FIVE_TOKENS)).to.bignumber.equal(balanceOfUserAfter);
        });

        it("should redeem when user redeems all", async () => {
            const balanceOfUserBefore = await masset.balanceOf(sa.default);

            // Approve tokens
            await masset.approve(savingsContract.address, TEN_TOKENS);

            // Deposit tokens first
            const balanceBeforeDeposit = await masset.balanceOf(savingsContract.address);
            await savingsContract.depositSavings(TEN_TOKENS);
            const balanceAfterDeposit = await masset.balanceOf(savingsContract.address);
            expect(balanceBeforeDeposit.add(TEN_TOKENS)).to.bignumber.equal(balanceAfterDeposit);

            // Redeem tokens
            const tx = await savingsContract.redeem(TEN_TOKENS);
            const exchangeRate = fullScale;
            expectEvent.inLogs(tx.logs, "CreditsRedeemed", {
                redeemer: sa.default,
                creditsRedeemed: TEN_TOKENS,
                savingsCredited: calculateCreditIssued(TEN_TOKENS, exchangeRate),
            });
            const balanceAfterRedeem = await masset.balanceOf(savingsContract.address);
            expect(ZERO).to.bignumber.equal(balanceAfterRedeem);

            const balanceOfUserAfter = await masset.balanceOf(sa.default);
            expect(balanceOfUserBefore).to.bignumber.equal(balanceOfUserAfter);
        });
    });

    describe("Simply depositing and withdrawing", () => {
        before("Init contract", async () => {
            // Create the system Mock machines
            systemMachine = new SystemMachine(sa.all);
            await systemMachine.initialiseMocks(true);
            massetMachine = systemMachine.massetMachine;
            massetDetails = systemMachine.mUSD;
        });
        describe("depositing mUSD into savings", () => {
            it("Should deposit the mUSD and assign credits to the saver", async () => {
                const depositAmount = simpleToExactAmount(1, 18);
                // const exchangeRate_before = await systemMachine.savingsContract.exchangeRate();
                const credits_balBefore = await systemMachine.savingsContract.creditBalances(
                    sa.default,
                );
                const credits_totalBefore = await systemMachine.savingsContract.totalCredits();
                const mUSD_balBefore = await massetDetails.mAsset.balanceOf(sa.default);
                const mUSD_totalBefore = await systemMachine.savingsContract.totalSavings();
                // 1. Approve the savings contract to spend mUSD
                await massetDetails.mAsset.approve(
                    systemMachine.savingsContract.address,
                    depositAmount,
                    { from: sa.default },
                );
                // 2. Deposit the mUSD
                await systemMachine.savingsContract.depositSavings(depositAmount, {
                    from: sa.default,
                });
                const credits_balAfter = await systemMachine.savingsContract.creditBalances(
                    sa.default,
                );
                expect(credits_balAfter, "Must receive some savings credits").bignumber.eq(
                    simpleToExactAmount(1, 18),
                );
                const credits_totalAfter = await systemMachine.savingsContract.totalCredits();
                expect(credits_totalAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                    credits_totalBefore.add(simpleToExactAmount(1, 18)),
                );
                const mUSD_balAfter = await massetDetails.mAsset.balanceOf(sa.default);
                expect(mUSD_balAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                    mUSD_balBefore.sub(depositAmount),
                );
                const mUSD_totalAfter = await systemMachine.savingsContract.totalSavings();
                expect(mUSD_totalAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                    mUSD_totalBefore.add(simpleToExactAmount(1, 18)),
                );
            });
        });
        describe("Withdrawing mUSD from savings", () => {
            it("Should withdraw the mUSD and burn the credits", async () => {
                const redemptionAmount = simpleToExactAmount(1, 18);
                const credits_balBefore = await systemMachine.savingsContract.creditBalances(
                    sa.default,
                );
                const mUSD_balBefore = await massetDetails.mAsset.balanceOf(sa.default);
                // Redeem all the credits
                await systemMachine.savingsContract.redeem(credits_balBefore, { from: sa.default });

                const credits_balAfter = await systemMachine.savingsContract.creditBalances(
                    sa.default,
                );
                const mUSD_balAfter = await massetDetails.mAsset.balanceOf(sa.default);
                expect(credits_balAfter, "Must burn all the credits").bignumber.eq(new BN(0));
                expect(mUSD_balAfter, "Must receive back mUSD").bignumber.eq(
                    mUSD_balBefore.add(redemptionAmount),
                );
            });
        });
    });
});
