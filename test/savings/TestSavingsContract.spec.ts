import { assertBNClose } from "./../../test-utils/assertions";
/* eslint-disable @typescript-eslint/camelcase */
import * as t from "types/generated";
import { expectRevert, expectEvent, time } from "@openzeppelin/test-helpers";

import { simpleToExactAmount } from "@utils/math";
import { StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import { BN } from "@utils/tools";
import { fullScale, ZERO_ADDRESS, ZERO, MAX_UINT256, ONE_DAY } from "@utils/constants";
import envSetup from "@utils/env_setup";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const { expect } = envSetup.configure();

const SavingsContract: t.SavingsContractContract = artifacts.require("SavingsContract");
const MockNexus: t.MockNexusContract = artifacts.require("MockNexus");
const MockMasset: t.MockMassetContract = artifacts.require("MockMasset");
const MockSavingsManager: t.MockSavingsManagerContract = artifacts.require("MockSavingsManager");
const SavingsManager: t.SavingsManagerContract = artifacts.require("SavingsManager");

interface SavingsBalances {
    totalSavings: BN;
    totalCredits: BN;
    userCredits: BN;
    exchangeRate: BN;
}

const getBalances = async (
    contract: t.SavingsContractInstance,
    user: string,
): Promise<SavingsBalances> => {
    return {
        totalSavings: await contract.totalSavings(),
        totalCredits: await contract.totalCredits(),
        userCredits: await contract.creditBalances(user),
        exchangeRate: await contract.exchangeRate(),
    };
};

contract("SavingsContract", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const manager = sa.dummy2;
    const ctx: { module?: t.ModuleInstance } = {};
    const TEN_TOKENS = new BN(10).mul(fullScale);
    const initialMint = new BN(1000000000);

    let systemMachine: SystemMachine;
    let massetDetails: MassetDetails;

    let savingsContract: t.SavingsContractInstance;
    let nexus: t.MockNexusInstance;
    let masset: t.MockMassetInstance;
    let savingsManager: t.SavingsManagerInstance;

    const createNewSavingsContract = async (useMockSavingsManager = true): Promise<void> => {
        // Use a mock Nexus so we can dictate addresses
        nexus = await MockNexus.new(sa.governor, governance, manager);
        // Use a mock mAsset so we can dictate the interest generated
        masset = await MockMasset.new("MOCK", "MOCK", 18, sa.default, initialMint);
        savingsContract = await SavingsContract.new(nexus.address, masset.address);
        // Use a mock SavingsManager so we don't need to run integrations
        if (useMockSavingsManager) {
            const mockSavingsManager = await MockSavingsManager.new();
            await nexus.setSavingsManager(mockSavingsManager.address);
        } else {
            savingsManager = await SavingsManager.new(
                nexus.address,
                masset.address,
                savingsContract.address,
            );
            await nexus.setSavingsManager(savingsManager.address);
        }
    };

    /** Credits issued based on ever increasing exchange rate */
    function calculateCreditIssued(amount: BN, exchangeRate: BN): BN {
        return amount.mul(fullScale).div(exchangeRate);
    }

    before(async () => {
        await createNewSavingsContract();
    });

    describe("behaviors", async () => {
        describe("behave like a Module", async () => {
            beforeEach(async () => {
                await createNewSavingsContract();
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

    describe("setting automateInterestCollection Flag", async () => {
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

    describe("depositing savings", async () => {
        context("when there is some interest to collect from the manager", async () => {
            before(async () => {
                await createNewSavingsContract(false);
            });

            it("should collect the interest and update the exchange rate before issuance", async () => {
                // Approve first
                await masset.approve(savingsContract.address, TEN_TOKENS);

                // Get the total balances
                const stateBefore = await getBalances(savingsContract, sa.default);
                expect(stateBefore.exchangeRate).to.bignumber.equal(fullScale);

                // Deposit first to get some savings in the basket
                await savingsContract.depositSavings(TEN_TOKENS);

                const stateMiddle = await getBalances(savingsContract, sa.default);
                expect(stateMiddle.exchangeRate).to.bignumber.equal(fullScale);
                expect(stateMiddle.totalSavings).to.bignumber.equal(TEN_TOKENS);
                expect(stateMiddle.totalCredits).to.bignumber.equal(TEN_TOKENS);

                // Set up the mAsset with some interest
                const interestCollected = simpleToExactAmount(10, 18);
                await masset.setAmountForCollectInterest(interestCollected);
                await time.increase(ONE_DAY.mul(new BN(10)));

                // Give dummy2 some tokens
                await masset.transfer(sa.dummy2, TEN_TOKENS);
                await masset.approve(savingsContract.address, TEN_TOKENS, { from: sa.dummy2 });

                // Dummy 2 deposits into the contract
                await savingsContract.depositSavings(TEN_TOKENS, { from: sa.dummy2 });

                const stateEnd = await getBalances(savingsContract, sa.default);
                expect(stateEnd.exchangeRate).bignumber.eq(fullScale.mul(new BN(2)));
                const dummyState = await getBalances(savingsContract, sa.dummy2);
                expect(dummyState.userCredits).bignumber.eq(TEN_TOKENS.div(new BN(2)));
                expect(dummyState.totalSavings).bignumber.eq(TEN_TOKENS.mul(new BN(3)));
                expect(dummyState.totalCredits).bignumber.eq(
                    TEN_TOKENS.mul(new BN(3)).div(new BN(2)),
                );
            });
        });

        context("with invalid args", async () => {
            before(async () => {
                await createNewSavingsContract();
            });
            it("should fail when amount is zero", async () => {
                await expectRevert(savingsContract.depositSavings(ZERO), "Must deposit something");
            });

            it("should fail if the user has no balance", async () => {
                // Approve first
                await masset.approve(savingsContract.address, TEN_TOKENS, { from: sa.dummy1 });

                // Deposit
                await expectRevert(
                    savingsContract.depositSavings(TEN_TOKENS, { from: sa.dummy1 }),
                    "ERC20: transfer amount exceeds balance",
                );
            });
        });

        context("when user has balance", async () => {
            before(async () => {
                await createNewSavingsContract();
            });
            it("should deposit some amount and issue credits", async () => {
                // Approve first
                await masset.approve(savingsContract.address, TEN_TOKENS);

                // Get the total balances
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
                expect(totalCreditsBefore.add(calcCreditIssued)).to.bignumber.equal(
                    totalCreditsAfter,
                );
                expect(creditBalBefore.add(TEN_TOKENS)).to.bignumber.equal(creditBalAfter);
                expect(fullScale).to.bignumber.equal(exchangeRateAfter);
            });
            it("should deposit when auto interest collection disabled", async () => {
                // Approve first
                await masset.approve(savingsContract.address, TEN_TOKENS);

                await savingsContract.automateInterestCollectionFlag(false, { from: sa.governor });

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
    });

    describe("depositing interest", async () => {
        const savingsManagerAccount = sa.dummy4;

        beforeEach(async () => {
            await createNewSavingsContract();
            await nexus.setSavingsManager(savingsManagerAccount);
            await masset.transfer(savingsManagerAccount, TEN_TOKENS);
            await masset.approve(savingsContract.address, TEN_TOKENS, {
                from: savingsManagerAccount,
            });
        });

        context("when called by random address", async () => {
            it("should fail when not called by savings manager", async () => {
                await expectRevert(
                    savingsContract.depositInterest(TEN_TOKENS, { from: sa.other }),
                    "Only savings manager can execute",
                );
            });
        });

        context("when called with incorrect args", async () => {
            it("should fail when amount is zero", async () => {
                await expectRevert(
                    savingsContract.depositInterest(ZERO, { from: savingsManagerAccount }),
                    "Must deposit something",
                );
            });
        });

        context("in a valid situation", async () => {
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
    });

    describe("redeeming credits", async () => {
        beforeEach(async () => {
            await createNewSavingsContract();
        });

        context("with invalid args", async () => {
            it("should fail when credits is zero", async () => {
                await expectRevert(savingsContract.redeem(ZERO), "Must withdraw something");
            });

            it("should fail when user doesn't have credits", async () => {
                const credits = new BN(10);
                await expectRevert(savingsContract.redeem(credits), "Saver has no credits", {
                    from: sa.other,
                });
            });
        });

        context("when the user has balance", async () => {
            it("should redeem when user has balance", async () => {
                const FIVE_TOKENS = TEN_TOKENS.div(new BN(2));

                const balanceOfUserBefore = await masset.balanceOf(sa.default);

                // Approve tokens
                await masset.approve(savingsContract.address, TEN_TOKENS);

                // Deposit tokens first
                const balanceBeforeDeposit = await masset.balanceOf(savingsContract.address);
                await savingsContract.depositSavings(TEN_TOKENS);
                const balanceAfterDeposit = await masset.balanceOf(savingsContract.address);
                expect(balanceBeforeDeposit.add(TEN_TOKENS)).to.bignumber.equal(
                    balanceAfterDeposit,
                );

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
                expect(balanceBeforeDeposit.add(TEN_TOKENS)).to.bignumber.equal(
                    balanceAfterDeposit,
                );

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
    });

    context("performing multiple operations from multiple addresses in sequence", async () => {
        describe("depositing, collecting interest and then depositing/withdrawing", async () => {
            before(async () => {
                await createNewSavingsContract(false);
            });

            it("should give existing savers the benefit of the increased exchange rate", async () => {
                const saver1 = sa.default;
                const saver2 = sa.dummy1;
                const saver3 = sa.dummy2;
                const saver4 = sa.dummy3;

                // Set up amounts
                // Each savers deposit will trigger some interest to be deposited
                const saver1deposit = simpleToExactAmount(1000, 18);
                const interestToReceive1 = simpleToExactAmount(100, 18);
                const saver2deposit = simpleToExactAmount(1000, 18);
                const interestToReceive2 = simpleToExactAmount(350, 18);
                const saver3deposit = simpleToExactAmount(1000, 18);
                const interestToReceive3 = simpleToExactAmount(80, 18);
                const saver4deposit = simpleToExactAmount(1000, 18);
                const interestToReceive4 = simpleToExactAmount(160, 18);

                // Ensure saver2 has some balances and do approvals
                await masset.transfer(saver2, saver2deposit);
                await masset.transfer(saver3, saver3deposit);
                await masset.transfer(saver4, saver4deposit);
                await masset.approve(savingsContract.address, MAX_UINT256, { from: saver1 });
                await masset.approve(savingsContract.address, MAX_UINT256, { from: saver2 });
                await masset.approve(savingsContract.address, MAX_UINT256, { from: saver3 });
                await masset.approve(savingsContract.address, MAX_UINT256, { from: saver4 });

                // Should be a fresh balance sheet
                const stateBefore = await getBalances(savingsContract, sa.default);
                expect(stateBefore.exchangeRate).to.bignumber.equal(fullScale);
                expect(stateBefore.totalSavings).to.bignumber.equal(new BN(0));

                // 1.0 user 1 deposits
                // interest remains unassigned and exchange rate unmoved
                await masset.setAmountForCollectInterest(interestToReceive1);
                await time.increase(ONE_DAY);
                await savingsContract.depositSavings(saver1deposit, { from: saver1 });
                const state1 = await getBalances(savingsContract, saver1);
                // 2.0 user 2 deposits
                // interest rate benefits user 1 and issued user 2 less credits than desired
                await masset.setAmountForCollectInterest(interestToReceive2);
                await time.increase(ONE_DAY);
                await savingsContract.depositSavings(saver2deposit, { from: saver2 });
                const state2 = await getBalances(savingsContract, saver2);
                // 3.0 user 3 deposits
                // interest rate benefits users 1 and 2
                await masset.setAmountForCollectInterest(interestToReceive3);
                await time.increase(ONE_DAY);
                await savingsContract.depositSavings(saver3deposit, { from: saver3 });
                const state3 = await getBalances(savingsContract, saver3);
                // 4.0 user 1 withdraws all her credits
                await savingsContract.redeem(state1.userCredits, { from: saver1 });
                const state4 = await getBalances(savingsContract, saver1);
                expect(state4.userCredits).bignumber.eq(new BN(0));
                expect(state4.totalCredits).bignumber.eq(
                    state3.totalCredits.sub(state1.userCredits),
                );
                expect(state4.exchangeRate).bignumber.eq(state3.exchangeRate);
                assertBNClose(
                    state4.totalSavings,
                    state4.totalCredits.mul(state4.exchangeRate).div(fullScale),
                    new BN(1000),
                );
                // 5.0 user 4 deposits
                // interest rate benefits users 2 and 3
                await masset.setAmountForCollectInterest(interestToReceive4);
                await time.increase(ONE_DAY);
                await savingsContract.depositSavings(saver4deposit, { from: saver4 });
                const state5 = await getBalances(savingsContract, saver4);
                // 6.0 users 2, 3, and 4 withdraw all their tokens
                await savingsContract.redeem(state2.userCredits, { from: saver2 });
                await savingsContract.redeem(state3.userCredits, { from: saver3 });
                await savingsContract.redeem(state5.userCredits, { from: saver4 });
            });
        });
    });

    describe("depositing and withdrawing", () => {
        before(async () => {
            // Create the system Mock machines
            systemMachine = new SystemMachine(sa.all);
            await systemMachine.initialiseMocks(true);
            massetDetails = systemMachine.mUSD;
        });
        describe("depositing mUSD into savings", () => {
            it("Should deposit the mUSD and assign credits to the saver", async () => {
                const depositAmount = simpleToExactAmount(1, 18);
                // const exchangeRate_before = await systemMachine.savingsContract.exchangeRate();
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
