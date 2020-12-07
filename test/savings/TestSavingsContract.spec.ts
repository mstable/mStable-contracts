/* eslint-disable @typescript-eslint/camelcase */

import { expectRevert, expectEvent, time } from "@openzeppelin/test-helpers";

import { simpleToExactAmount } from "@utils/math";
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions";
import { StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import { BN } from "@utils/tools";
import { fullScale, ZERO_ADDRESS, ZERO, MAX_UINT256, ONE_DAY } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const { expect } = envSetup.configure();

const SavingsContract = artifacts.require("SavingsContract");
const MockNexus = artifacts.require("MockNexus");
const MockMasset = artifacts.require("MockMasset");
const MockERC20 = artifacts.require("MockERC20");
const MockSavingsManager = artifacts.require("MockSavingsManager");
const SavingsManager = artifacts.require("SavingsManager");
const MStableHelper = artifacts.require("MStableHelper");

interface SavingsBalances {
    totalSavings: BN;
    totalSupply: BN;
    userCredits: BN;
    userBalance: BN;
    exchangeRate: BN;
}

const getBalances = async (
    contract: t.SavingsContractInstance,
    user: string,
): Promise<SavingsBalances> => {
    const mAsset = await MockERC20.at(await contract.underlying());
    return {
        totalSavings: await mAsset.balanceOf(contract.address),
        totalSupply: await contract.totalSupply(),
        userCredits: await contract.creditBalances(user),
        userBalance: await mAsset.balanceOf(user),
        exchangeRate: await contract.exchangeRate(),
    };
};

contract("SavingsContract", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const manager = sa.dummy2;
    const ctx: { module?: t.ModuleInstance } = {};
    const HUNDRED = new BN(100).mul(fullScale);
    const TEN_EXACT = new BN(10).mul(fullScale);
    const ONE_EXACT = fullScale;
    const initialMint = new BN(1000000000);
    const initialExchangeRate = fullScale.divn(10);

    let systemMachine: SystemMachine;
    let massetDetails: MassetDetails;

    let savingsContract: t.SavingsContractInstance;
    let nexus: t.MockNexusInstance;
    let masset: t.MockMassetInstance;
    let savingsManager: t.SavingsManagerInstance;
    let helper: t.MStableHelperInstance;

    const createNewSavingsContract = async (useMockSavingsManager = true): Promise<void> => {
        // Use a mock Nexus so we can dictate addresses
        nexus = await MockNexus.new(sa.governor, governance, manager);
        // Use a mock mAsset so we can dictate the interest generated
        masset = await MockMasset.new("MOCK", "MOCK", 18, sa.default, initialMint);
        savingsContract = await SavingsContract.new();

        await savingsContract.initialize(
            nexus.address,
            sa.default,
            masset.address,
            "Savings Credit",
            "ymUSD",
        );
        helper = await MStableHelper.new();
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
    function underlyingToCredits(amount: BN, exchangeRate: BN): BN {
        return amount.mul(fullScale).div(exchangeRate).addn(1);
    }
    function creditsToUnderlying(amount: BN, exchangeRate: BN): BN {
        return amount.mul(exchangeRate).div(fullScale);
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
            savingsContract = await SavingsContract.new();
            await expectRevert(
                savingsContract.initialize(
                    nexus.address,
                    sa.default,
                    ZERO_ADDRESS,
                    "Savings Credit",
                    "ymUSD",
                ),
                "mAsset address is zero",
            );
        });

        it("should succeed when valid parameters", async () => {
            await createNewSavingsContract();
            const nexusAddr = await savingsContract.nexus();
            expect(nexus.address).to.equal(nexusAddr);
            const balances = await getBalances(savingsContract, sa.default);
            expect(ZERO).to.bignumber.equal(balances.totalSupply);
            expect(ZERO).to.bignumber.equal(balances.totalSavings);
            expect(initialExchangeRate).to.bignumber.equal(balances.exchangeRate);
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
                await masset.approve(savingsContract.address, TEN_EXACT);

                // Get the total balances
                const stateBefore = await getBalances(savingsContract, sa.default);
                expect(stateBefore.exchangeRate).to.bignumber.equal(initialExchangeRate);

                // Deposit first to get some savings in the basket
                await savingsContract.methods["depositSavings(uint256)"](TEN_EXACT);

                const stateMiddle = await getBalances(savingsContract, sa.default);
                expect(stateMiddle.exchangeRate).to.bignumber.equal(initialExchangeRate);
                expect(stateMiddle.totalSavings).to.bignumber.equal(TEN_EXACT);
                expect(stateMiddle.totalSupply).to.bignumber.equal(
                    underlyingToCredits(TEN_EXACT, initialExchangeRate),
                );

                // Set up the mAsset with some interest
                const interestCollected = simpleToExactAmount(10, 18);
                await masset.setAmountForCollectInterest(interestCollected);
                await time.increase(ONE_DAY.muln(10));

                // Give dummy2 some tokens
                await masset.transfer(sa.dummy2, TEN_EXACT);
                await masset.approve(savingsContract.address, TEN_EXACT, { from: sa.dummy2 });

                // Dummy 2 deposits into the contract
                await savingsContract.methods["depositSavings(uint256)"](TEN_EXACT, {
                    from: sa.dummy2,
                });

                const stateEnd = await getBalances(savingsContract, sa.default);
                assertBNClose(stateEnd.exchangeRate, initialExchangeRate.muln(2), 1);
                const dummyState = await getBalances(savingsContract, sa.dummy2);
                // expect(dummyState.userCredits).bignumber.eq(HUNDRED.divn(2));
                // expect(dummyState.totalSavings).bignumber.eq(TEN_EXACT.muln(3));
                // expect(dummyState.totalSupply).bignumber.eq(HUNDRED.muln(3).divn(2));
            });
        });

        context("with invalid args", async () => {
            before(async () => {
                await createNewSavingsContract();
            });
            it("should fail when amount is zero", async () => {
                await expectRevert(
                    savingsContract.methods["depositSavings(uint256)"](ZERO),
                    "Must deposit something",
                );
            });

            it("should fail if the user has no balance", async () => {
                // Approve first
                await masset.approve(savingsContract.address, TEN_EXACT, { from: sa.dummy1 });

                // Deposit
                await expectRevert(
                    savingsContract.methods["depositSavings(uint256)"](TEN_EXACT, {
                        from: sa.dummy1,
                    }),
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
                await masset.approve(savingsContract.address, TEN_EXACT);

                // Get the total balances
                const balancesBefore = await getBalances(savingsContract, sa.default);
                expect(initialExchangeRate).to.bignumber.equal(balancesBefore.exchangeRate);

                // Deposit
                const tx = await savingsContract.methods["depositSavings(uint256)"](TEN_EXACT);
                const calcCreditIssued = underlyingToCredits(TEN_EXACT, initialExchangeRate);
                expectEvent.inLogs(tx.logs, "SavingsDeposited", {
                    saver: sa.default,
                    savingsDeposited: TEN_EXACT,
                    creditsIssued: calcCreditIssued,
                });

                const balancesAfter = await getBalances(savingsContract, sa.default);

                expect(balancesBefore.totalSavings.add(TEN_EXACT)).to.bignumber.equal(
                    balancesAfter.totalSavings,
                );
                expect(balancesBefore.totalSupply.add(calcCreditIssued)).to.bignumber.equal(
                    balancesAfter.totalSupply,
                );
                expect(balancesBefore.userCredits.add(calcCreditIssued)).to.bignumber.equal(
                    balancesAfter.userCredits,
                );
                expect(initialExchangeRate).to.bignumber.equal(balancesAfter.exchangeRate);
            });
            it("should deposit when auto interest collection disabled", async () => {
                // Approve first
                await masset.approve(savingsContract.address, TEN_EXACT);

                await savingsContract.automateInterestCollectionFlag(false, { from: sa.governor });

                const before = await getBalances(savingsContract, sa.default);
                expect(initialExchangeRate).to.bignumber.equal(before.exchangeRate);

                // Deposit
                const tx = await savingsContract.methods["depositSavings(uint256)"](TEN_EXACT);
                const calcCreditIssued = underlyingToCredits(TEN_EXACT, initialExchangeRate);
                expectEvent.inLogs(tx.logs, "SavingsDeposited", {
                    saver: sa.default,
                    savingsDeposited: TEN_EXACT,
                    creditsIssued: calcCreditIssued,
                });

                const after = await getBalances(savingsContract, sa.default);

                expect(before.userBalance.sub(TEN_EXACT)).to.bignumber.equal(after.userBalance);
                expect(before.totalSavings.add(TEN_EXACT)).to.bignumber.equal(after.totalSavings);
                expect(before.totalSupply.add(calcCreditIssued)).to.bignumber.equal(
                    after.totalSupply,
                );
                expect(before.userCredits.add(calcCreditIssued)).to.bignumber.equal(
                    after.userCredits,
                );
                expect(initialExchangeRate).to.bignumber.equal(after.exchangeRate);
            });
        });
    });

    describe("using the helper", async () => {
        before(async () => {
            await createNewSavingsContract(false);
        });

        it("should deposit and withdraw", async () => {
            // Approve first
            await masset.approve(savingsContract.address, TEN_EXACT);

            // Get the total balancesbalancesAfter
            const stateBefore = await getBalances(savingsContract, sa.default);
            expect(stateBefore.exchangeRate).to.bignumber.equal(initialExchangeRate);

            // Deposit first to get some savings in the basket
            await savingsContract.methods["depositSavings(uint256)"](TEN_EXACT);

            const bal = await helper.getSaveBalance(savingsContract.address, sa.default);
            expect(TEN_EXACT).bignumber.eq(bal);

            // Set up the mAsset with some interest
            await masset.setAmountForCollectInterest(simpleToExactAmount(5, 18));
            await masset.transfer(sa.dummy2, TEN_EXACT);
            await masset.approve(savingsContract.address, TEN_EXACT, { from: sa.dummy2 });
            await savingsContract.methods["depositSavings(uint256)"](TEN_EXACT, {
                from: sa.dummy2,
            });

            const redeemInput = await helper.getSaveRedeemInput(savingsContract.address, TEN_EXACT);
            const balBefore = await masset.balanceOf(sa.default);
            await savingsContract.redeem(redeemInput);

            const balAfter = await masset.balanceOf(sa.default);
            expect(balAfter).bignumber.eq(balBefore.add(TEN_EXACT));
        });
    });

    describe("depositing interest", async () => {
        const savingsManagerAccount = sa.dummy4;

        beforeEach(async () => {
            await createNewSavingsContract();
            await nexus.setSavingsManager(savingsManagerAccount);
            await masset.transfer(savingsManagerAccount, TEN_EXACT);
            await masset.approve(savingsContract.address, TEN_EXACT, {
                from: savingsManagerAccount,
            });
        });

        context("when called by random address", async () => {
            it("should fail when not called by savings manager", async () => {
                await expectRevert(
                    savingsContract.depositInterest(TEN_EXACT, { from: sa.other }),
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
                const before = await getBalances(savingsContract, sa.default);

                await savingsContract.depositInterest(TEN_EXACT, { from: savingsManagerAccount });

                const after = await getBalances(savingsContract, sa.default);
                expect(TEN_EXACT).to.bignumber.equal(after.totalSavings);
                expect(before.totalSavings.add(TEN_EXACT)).to.bignumber.equal(after.totalSavings);
                // exchangeRate should not change
                expect(before.exchangeRate).to.bignumber.equal(after.exchangeRate);
            });

            // it("should deposit interest when some credits exist", async () => {
            //     const TWENTY_TOKENS = TEN_EXACT.muln(2));

            //     // Deposit to SavingsContract
            //     await masset.approve(savingsContract.address, TEN_EXACT);
            //     await savingsContract.automateInterestCollectionFlag(false, { from: sa.governor });
            //     await savingsContract.methods["depositSavings(uint256)"](TEN_EXACT);

            //     const balanceBefore = await masset.balanceOf(savingsContract.address);

            //     // Deposit Interest
            //     const tx = await savingsContract.depositInterest(TEN_EXACT, {
            //         from: savingsManagerAccount,
            //     });
            //     expectEvent.inLogs(tx.logs, "ExchangeRateUpdated", {
            //         newExchangeRate: TWENTY_TOKENS.mul(initialExchangeRate).div(TEN_EXACT),
            //         interestCollected: TEN_EXACT,
            //     });

            //     const exchangeRateAfter = await savingsContract.exchangeRate();
            //     const balanceAfter = await masset.balanceOf(savingsContract.address);
            //     expect(TWENTY_TOKENS).to.bignumber.equal(await savingsContract.totalSavings());
            //     expect(balanceBefore.add(TEN_EXACT)).to.bignumber.equal(balanceAfter);

            //     // exchangeRate should change
            //     const expectedExchangeRate = TWENTY_TOKENS.mul(initialExchangeRate).div(TEN_EXACT);
            //     expect(expectedExchangeRate).to.bignumber.equal(exchangeRateAfter);
            // });
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
                await expectRevert(
                    savingsContract.redeem(credits),
                    "ERC20: burn amount exceeds balance",
                    {
                        from: sa.other,
                    },
                );
            });
        });

        context("when the user has balance", async () => {
            it("should redeem when user has balance", async () => {
                const FIFTY_CREDITS = TEN_EXACT.muln(5);

                const balanceOfUserBefore = await masset.balanceOf(sa.default);

                // Approve tokens
                await masset.approve(savingsContract.address, TEN_EXACT);

                // Deposit tokens first
                const balanceBeforeDeposit = await masset.balanceOf(savingsContract.address);
                await savingsContract.methods["depositSavings(uint256)"](TEN_EXACT);
                const balanceAfterDeposit = await masset.balanceOf(savingsContract.address);
                expect(balanceBeforeDeposit.add(TEN_EXACT)).to.bignumber.equal(balanceAfterDeposit);

                // Redeem tokens
                const tx = await savingsContract.redeem(FIFTY_CREDITS);
                const exchangeRate = initialExchangeRate;
                const underlying = creditsToUnderlying(FIFTY_CREDITS, exchangeRate);
                expectEvent.inLogs(tx.logs, "CreditsRedeemed", {
                    redeemer: sa.default,
                    creditsRedeemed: FIFTY_CREDITS,
                    savingsCredited: underlying,
                });
                const balanceAfterRedeem = await masset.balanceOf(savingsContract.address);
                expect(balanceAfterDeposit.sub(underlying)).to.bignumber.equal(balanceAfterRedeem);

                const balanceOfUserAfter = await masset.balanceOf(sa.default);
                expect(balanceOfUserBefore.sub(underlying)).to.bignumber.equal(balanceOfUserAfter);
            });

            it("should redeem when user redeems all", async () => {
                const balanceOfUserBefore = await masset.balanceOf(sa.default);

                // Approve tokens
                await masset.approve(savingsContract.address, TEN_EXACT);

                // Deposit tokens first
                const balanceBeforeDeposit = await masset.balanceOf(savingsContract.address);
                await savingsContract.methods["depositSavings(uint256)"](TEN_EXACT);
                const balanceAfterDeposit = await masset.balanceOf(savingsContract.address);
                expect(balanceBeforeDeposit.add(TEN_EXACT)).to.bignumber.equal(balanceAfterDeposit);

                // Redeem tokens
                const tx = await savingsContract.redeem(HUNDRED);
                expectEvent.inLogs(tx.logs, "CreditsRedeemed", {
                    redeemer: sa.default,
                    creditsRedeemed: HUNDRED,
                    savingsCredited: TEN_EXACT,
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

            // it("should give existing savers the benefit of the increased exchange rate", async () => {
            //     const saver1 = sa.default;
            //     const saver2 = sa.dummy1;
            //     const saver3 = sa.dummy2;
            //     const saver4 = sa.dummy3;

            //     // Set up amounts
            //     // Each savers deposit will trigger some interest to be deposited
            //     const saver1deposit = simpleToExactAmount(1000, 18);
            //     const interestToReceive1 = simpleToExactAmount(100, 18);
            //     const saver2deposit = simpleToExactAmount(1000, 18);
            //     const interestToReceive2 = simpleToExactAmount(350, 18);
            //     const saver3deposit = simpleToExactAmount(1000, 18);
            //     const interestToReceive3 = simpleToExactAmount(80, 18);
            //     const saver4deposit = simpleToExactAmount(1000, 18);
            //     const interestToReceive4 = simpleToExactAmount(160, 18);

            //     // Ensure saver2 has some balances and do approvals
            //     await masset.transfer(saver2, saver2deposit);
            //     await masset.transfer(saver3, saver3deposit);
            //     await masset.transfer(saver4, saver4deposit);
            //     await masset.approve(savingsContract.address, MAX_UINT256, { from: saver1 });
            //     await masset.approve(savingsContract.address, MAX_UINT256, { from: saver2 });
            //     await masset.approve(savingsContract.address, MAX_UINT256, { from: saver3 });
            //     await masset.approve(savingsContract.address, MAX_UINT256, { from: saver4 });

            //     // Should be a fresh balance sheet
            //     const stateBefore = await getBalances(savingsContract, sa.default);
            //     expect(stateBefore.exchangeRate).to.bignumber.equal(initialExchangeRate);
            //     expect(stateBefore.totalSavings).to.bignumber.equal(new BN(0));

            //     // 1.0 user 1 deposits
            //     // interest remains unassigned and exchange rate unmoved
            //     await masset.setAmountForCollectInterest(interestToReceive1);
            //     await time.increase(ONE_DAY);
            //     await savingsContract.methods["depositSavings(uint256)"](saver1deposit, {
            //         from: saver1,
            //     });
            //     await savingsContract.poke();
            //     const state1 = await getBalances(savingsContract, saver1);
            //     // 2.0 user 2 deposits
            //     // interest rate benefits user 1 and issued user 2 less credits than desired
            //     await masset.setAmountForCollectInterest(interestToReceive2);
            //     await time.increase(ONE_DAY);
            //     await savingsContract.methods["depositSavings(uint256)"](saver2deposit, {
            //         from: saver2,
            //     });
            //     const state2 = await getBalances(savingsContract, saver2);
            //     // 3.0 user 3 deposits
            //     // interest rate benefits users 1 and 2
            //     await masset.setAmountForCollectInterest(interestToReceive3);
            //     await time.increase(ONE_DAY);
            //     await savingsContract.methods["depositSavings(uint256)"](saver3deposit, {
            //         from: saver3,
            //     });
            //     const state3 = await getBalances(savingsContract, saver3);
            //     // 4.0 user 1 withdraws all her credits
            //     await savingsContract.redeem(state1.userCredits, { from: saver1 });
            //     const state4 = await getBalances(savingsContract, saver1);
            //     expect(state4.userCredits).bignumber.eq(new BN(0));
            //     expect(state4.totalSupply).bignumber.eq(state3.totalSupply.sub(state1.userCredits));
            //     expect(state4.exchangeRate).bignumber.eq(state3.exchangeRate);
            //     assertBNClose(
            //         state4.totalSavings,
            //         creditsToUnderlying(state4.totalSupply, state4.exchangeRate),
            //         new BN(100000),
            //     );
            //     // 5.0 user 4 deposits
            //     // interest rate benefits users 2 and 3
            //     await masset.setAmountForCollectInterest(interestToReceive4);
            //     await time.increase(ONE_DAY);
            //     await savingsContract.methods["depositSavings(uint256)"](saver4deposit, {
            //         from: saver4,
            //     });
            //     const state5 = await getBalances(savingsContract, saver4);
            //     // 6.0 users 2, 3, and 4 withdraw all their tokens
            //     await savingsContract.redeem(state2.userCredits, { from: saver2 });
            //     await savingsContract.redeem(state3.userCredits, { from: saver3 });
            //     await savingsContract.redeem(state5.userCredits, { from: saver4 });
            // });
        });
    });

    describe("depositing and withdrawing", () => {
        before(async () => {
            await createNewSavingsContract();
        });
        describe("depositing mUSD into savings", () => {
            it("Should deposit the mUSD and assign credits to the saver", async () => {
                const depositAmount = simpleToExactAmount(1, 18);
                // const exchangeRate_before = await savingsContract.exchangeRate();
                const credits_totalBefore = await savingsContract.totalSupply();
                const mUSD_balBefore = await masset.balanceOf(sa.default);
                // const mUSD_totalBefore = await savingsContract.totalSavings();
                // 1. Approve the savings contract to spend mUSD
                await masset.approve(savingsContract.address, depositAmount, {
                    from: sa.default,
                });
                // 2. Deposit the mUSD
                await savingsContract.methods["depositSavings(uint256)"](depositAmount, {
                    from: sa.default,
                });
                const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate);
                const credits_balAfter = await savingsContract.creditBalances(sa.default);
                expect(credits_balAfter, "Must receive some savings credits").bignumber.eq(
                    expectedCredits,
                );
                const credits_totalAfter = await savingsContract.totalSupply();
                expect(credits_totalAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                    credits_totalBefore.add(expectedCredits),
                );
                const mUSD_balAfter = await masset.balanceOf(sa.default);
                expect(mUSD_balAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                    mUSD_balBefore.sub(depositAmount),
                );
                // const mUSD_totalAfter = await savingsContract.totalSavings();
                // expect(mUSD_totalAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                //     mUSD_totalBefore.add(simpleToExactAmount(1, 18)),
                // );
            });
        });
        describe("Withdrawing mUSD from savings", () => {
            it("Should withdraw the mUSD and burn the credits", async () => {
                const redemptionAmount = simpleToExactAmount(1, 18);
                const credits_balBefore = await savingsContract.creditBalances(sa.default);
                const mUSD_balBefore = await masset.balanceOf(sa.default);
                // Redeem all the credits
                await savingsContract.redeem(credits_balBefore, { from: sa.default });

                const credits_balAfter = await savingsContract.creditBalances(sa.default);
                const mUSD_balAfter = await masset.balanceOf(sa.default);
                expect(credits_balAfter, "Must burn all the credits").bignumber.eq(new BN(0));
                expect(mUSD_balAfter, "Must receive back mUSD").bignumber.eq(
                    mUSD_balBefore.add(redemptionAmount),
                );
            });
        });
    });
});
