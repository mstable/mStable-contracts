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
const MockConnector = artifacts.require("MockConnector");
const MockProxy = artifacts.require("MockProxy");
const MockERC20 = artifacts.require("MockERC20");
const MockSavingsManager = artifacts.require("MockSavingsManager");
const SavingsManager = artifacts.require("SavingsManager");
const MStableHelper = artifacts.require("MStableHelper");

interface SavingsBalances {
    totalCredits: BN;
    userCredits: BN;
    userBalance: BN;
    contractBalance: BN;
    exchangeRate: BN;
}

const getBalances = async (
    contract: t.SavingsContractInstance,
    user: string,
): Promise<SavingsBalances> => {
    const mAsset = await MockERC20.at(await contract.underlying());
    return {
        totalCredits: await contract.totalSupply(),
        userCredits: await contract.creditBalances(user),
        userBalance: await mAsset.balanceOf(user),
        contractBalance: await mAsset.balanceOf(contract.address),
        exchangeRate: await contract.exchangeRate(),
    };
};

const underlyingToCredits = (amount: BN, exchangeRate: BN): BN => {
    return amount
        .mul(fullScale)
        .div(exchangeRate)
        .addn(1);
};
const creditsToUnderlying = (amount: BN, exchangeRate: BN): BN => {
    return amount.mul(exchangeRate).div(fullScale);
};

contract("SavingsContract", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const manager = sa.dummy2;
    const ctx: { module?: t.ModuleInstance } = {};
    const initialExchangeRate = simpleToExactAmount(1, 17);

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
        masset = await MockMasset.new("MOCK", "MOCK", 18, sa.default, 1000000000);
        savingsContract = await SavingsContract.new();

        const proxy = await MockProxy.new();
        const impl = await SavingsContract.new();
        const data: string = impl.contract.methods
            .initialize(nexus.address, sa.default, masset.address, "Savings Credit", "imUSD")
            .encodeABI();
        await proxy.methods["initialize(address,address,bytes)"](impl.address, sa.dummy4, data);
        savingsContract = await SavingsContract.at(proxy.address);

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
                    "imUSD",
                ),
                "mAsset address is zero",
            );
            await expectRevert(
                savingsContract.initialize(
                    nexus.address,
                    ZERO_ADDRESS,
                    masset.address,
                    "Savings Credit",
                    "imUSD",
                ),
                "Invalid poker address",
            );
        });

        it("should succeed and set valid parameters", async () => {
            await createNewSavingsContract();
            const nexusAddr = await savingsContract.nexus();
            expect(nexus.address).to.equal(nexusAddr);
            const pokerAddr = await savingsContract.poker();
            expect(sa.default).to.equal(pokerAddr);
            const fraction = await savingsContract.fraction();
            expect(simpleToExactAmount(2, 17)).to.bignumber.equal(fraction);
            const underlyingAddr = await savingsContract.underlying();
            expect(masset.address).to.equal(underlyingAddr);
            const balances = await getBalances(savingsContract, sa.default);
            expect(ZERO).to.bignumber.equal(balances.totalCredits);
            expect(ZERO).to.bignumber.equal(balances.contractBalance);
            expect(initialExchangeRate).to.bignumber.equal(balances.exchangeRate);
            const name = await savingsContract.name();
            expect("Savings Credit").to.equal(name);
        });
    });

    describe("setting automateInterestCollection Flag", async () => {
        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsContract.automateInterestCollectionFlag(true, { from: sa.other }),
                "Only governor can execute",
            );
        });
        it("should enable interest collection", async () => {
            const tx = await savingsContract.automateInterestCollectionFlag(true, {
                from: sa.governor,
            });
            expectEvent.inLogs(tx.logs, "AutomaticInterestCollectionSwitched", {
                automationEnabled: true,
            });
        });
        it("should disable interest collection", async () => {
            const tx = await savingsContract.automateInterestCollectionFlag(false, {
                from: sa.governor,
            });
            expectEvent.inLogs(tx.logs, "AutomaticInterestCollectionSwitched", {
                automationEnabled: false,
            });
        });
    });

    describe("depositing interest", async () => {
        const savingsManagerAccount = sa.dummy3;
        beforeEach(async () => {
            await createNewSavingsContract();
            await nexus.setSavingsManager(savingsManagerAccount);
            await masset.transfer(savingsManagerAccount, simpleToExactAmount(10, 18));
            await masset.approve(savingsContract.address, simpleToExactAmount(10, 18), {
                from: savingsManagerAccount,
            });
        });
        context("when called by random address", async () => {
            it("should fail when not called by savings manager", async () => {
                await expectRevert(
                    savingsContract.depositInterest(1, {
                        from: sa.other,
                    }),
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
                const deposit = simpleToExactAmount(1, 18);
                await savingsContract.depositInterest(deposit, { from: savingsManagerAccount });

                const after = await getBalances(savingsContract, sa.default);
                expect(deposit).to.bignumber.equal(after.contractBalance);
                expect(before.contractBalance.add(deposit)).to.bignumber.equal(
                    after.contractBalance,
                );
                // exchangeRate should not change
                expect(before.exchangeRate).to.bignumber.equal(after.exchangeRate);
            });
            it("should deposit interest when some credits exist", async () => {
                const deposit = simpleToExactAmount(20, 18);

                // // Deposit to SavingsContract
                // await masset.approve(savingsContract.address, TEN_EXACT);
                // await savingsContract.preDeposit(TEN_EXACT, sa.default);

                // const balanceBefore = await masset.balanceOf(savingsContract.address);

                // // Deposit Interest
                // const tx = await savingsContract.depositInterest(TEN_EXACT, {
                //     from: savingsManagerAccount,
                // });
                // const expectedExchangeRate = TWENTY_TOKENS.mul(fullScale)
                //     .div(HUNDRED)
                //     .subn(1);
                // expectEvent.inLogs(tx.logs, "ExchangeRateUpdated", {
                //     newExchangeRate: expectedExchangeRate,
                //     interestCollected: TEN_EXACT,
                // });

                // const exchangeRateAfter = await savingsContract.exchangeRate();
                // const balanceAfter = await masset.balanceOf(savingsContract.address);
                // expect(balanceBefore.add(TEN_EXACT)).to.bignumber.equal(balanceAfter);

                // // exchangeRate should change
                // expect(expectedExchangeRate).to.bignumber.equal(exchangeRateAfter);
            });
        });
    });

    describe("depositing savings", async () => {
        context("using preDeposit", async () => {
            before(async () => {
                await createNewSavingsContract();
            });
            it("should not affect the exchangerate");
        });

        context("using depositSavings", async () => {
            before(async () => {
                await createNewSavingsContract();
            });
            it("should deposit the mUSD and assign credits to the saver", async () => {
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
                const tx = await savingsContract.methods["depositSavings(uint256)"](depositAmount, {
                    from: sa.default,
                });
                const balancesAfter = await getBalances(savingsContract, sa.default);
                const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate);
                expectEvent.inLogs(tx.logs, "SavingsDeposited", {
                    saver: sa.default,
                    savingsDeposited: depositAmount,
                    creditsIssued: expectedCredits,
                });
                expect(balancesAfter.userCredits, "Must receive some savings credits").bignumber.eq(
                    expectedCredits,
                );
                expect(
                    balancesAfter.totalCredits,
                    "Must deposit 1 full units of mUSD",
                ).bignumber.eq(credits_totalBefore.add(expectedCredits));
                expect(balancesAfter.userBalance, "Must deposit 1 full units of mUSD").bignumber.eq(
                    mUSD_balBefore.sub(depositAmount),
                );
                // const mUSD_totalAfter = await savingsContract.totalSavings();
                // expect(balancesAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                //     mUSD_totalBefore.add(simpleToExactAmount(1, 18)),
                // );
            });
            it("should fail when amount is zero", async () => {
                await expectRevert(
                    savingsContract.methods["depositSavings(uint256)"](ZERO),
                    "Must deposit something",
                );
            });
            it("should fail if the user has no balance", async () => {
                // Approve first
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 18), {
                    from: sa.dummy1,
                });

                // Deposit
                await expectRevert(
                    savingsContract.methods["depositSavings(uint256)"](simpleToExactAmount(1, 18), {
                        from: sa.dummy1,
                    }),
                    "ERC20: transfer amount exceeds balance",
                );
            });

            context("when there is some interest to collect from the manager", async () => {
                before(async () => {
                    await createNewSavingsContract(false);
                });

                it("should collect the interest and update the exchange rate before issuance", async () => {
                    // Approve first
                    const deposit = simpleToExactAmount(10, 18);
                    await masset.approve(savingsContract.address, deposit);

                    // Get the total balances
                    const stateBefore = await getBalances(savingsContract, sa.default);
                    expect(stateBefore.exchangeRate).to.bignumber.equal(initialExchangeRate);

                    // Deposit first to get some savings in the basket
                    await savingsContract.methods["depositSavings(uint256)"](deposit);

                    const stateMiddle = await getBalances(savingsContract, sa.default);
                    expect(stateMiddle.exchangeRate).to.bignumber.equal(initialExchangeRate);
                    expect(stateMiddle.contractBalance).to.bignumber.equal(deposit);
                    expect(stateMiddle.totalCredits).to.bignumber.equal(
                        underlyingToCredits(deposit, initialExchangeRate),
                    );

                    // Set up the mAsset with some interest
                    const interestCollected = simpleToExactAmount(10, 18);
                    await masset.setAmountForCollectInterest(interestCollected);
                    await time.increase(ONE_DAY.muln(10));

                    // Give dummy2 some tokens
                    await masset.transfer(sa.dummy2, deposit);
                    await masset.approve(savingsContract.address, deposit, { from: sa.dummy2 });

                    // Dummy 2 deposits into the contract
                    await savingsContract.methods["depositSavings(uint256)"](deposit, {
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
        });
    });
    describe("using the helper to check balance and redeem", async () => {
        before(async () => {
            await createNewSavingsContract(false);
        });

        it("should deposit and withdraw", async () => {
            // Approve first
            const deposit = simpleToExactAmount(10, 18);
            await masset.approve(savingsContract.address, deposit);

            // Get the total balancesbalancesAfter
            const stateBefore = await getBalances(savingsContract, sa.default);
            expect(stateBefore.exchangeRate).to.bignumber.equal(initialExchangeRate);

            // Deposit first to get some savings in the basket
            await savingsContract.methods["depositSavings(uint256)"](deposit);

            const bal = await helper.getSaveBalance(savingsContract.address, sa.default);
            expect(deposit).bignumber.eq(bal);

            // Set up the mAsset with some interest
            await masset.setAmountForCollectInterest(simpleToExactAmount(5, 18));
            await masset.transfer(sa.dummy2, deposit);
            await masset.approve(savingsContract.address, deposit, { from: sa.dummy2 });
            await savingsContract.methods["depositSavings(uint256)"](deposit, {
                from: sa.dummy2,
            });

            const redeemInput = await helper.getSaveRedeemInput(savingsContract.address, deposit);
            const balBefore = await masset.balanceOf(sa.default);
            await savingsContract.redeem(redeemInput);

            const balAfter = await masset.balanceOf(sa.default);
            expect(balAfter).bignumber.eq(balBefore.add(deposit));
        });
    });
    describe("chekcing the view methods", () => {
        // function balanceOfUnderlying(address _user)
        // function underlyingToCredits(uint256 _underlying)
        // function creditsToUnderlying(uint256 _credits)
        // function creditBalances(address _user)
        it("should return correct balances");
    });

    describe("redeeming credits", async () => {
        beforeEach(async () => {
            await createNewSavingsContract();
        });
        it("triggers poke and deposits to connector if the threshold is hit");
        context("using redeemCredits", async () => {
            // test the balance calcs here.. credit to masset, and public calcs
            it("should redeem a specific amount of credits");
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
        });
        context("using redeemUnderlying", async () => {
            // test the balance calcs here.. credit to masset, and public calcs
            it("should redeem a specific amount of underlying");
        });
        context("using redeem (depcrecated)", async () => {
            beforeEach(async () => {
                await masset.approve(savingsContract.address, simpleToExactAmount(10, 18));
                await savingsContract.methods["depositSavings(uint256)"](
                    simpleToExactAmount(1, 18),
                );
            });
            it("should redeem when user has balance", async () => {
                const redemptionAmount = simpleToExactAmount(5, 18);

                const balancesBefore = await getBalances(savingsContract, sa.default);

                // Redeem tokens
                const tx = await savingsContract.redeem(redemptionAmount);
                const exchangeRate = initialExchangeRate;
                const underlying = creditsToUnderlying(redemptionAmount, exchangeRate);
                expectEvent.inLogs(tx.logs, "CreditsRedeemed", {
                    redeemer: sa.default,
                    creditsRedeemed: redemptionAmount,
                    savingsCredited: underlying,
                });
                const balancesAfter = await getBalances(savingsContract, sa.default);
                expect(balancesBefore.contractBalance.sub(underlying)).to.bignumber.equal(
                    balancesAfter.contractBalance,
                );

                expect(balancesBefore.userBalance.add(underlying)).to.bignumber.equal(
                    balancesAfter.userBalance,
                );
            });
            it("should withdraw the mUSD and burn the credits", async () => {
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

    describe("setting poker", () => {
        it("allows governance to set a new poker");
    });

    describe("poking", () => {
        it("allows only poker to poke");
        it("only allows pokes once every 4h");
        context("after a connector has been added", () => {
            it("should deposit to the connector");
            it("should withdraw from the connector if total supply lowers");
            it("should update the exchange rate with new interest");
            it("should work correctly after changing from no connector to connector");
            it("should work correctly after changing fraction");
        });
        context("with no connector", () => {
            it("simply updates the exchangeRate with the new balance");
        });
    });

    describe("setting fraction", () => {
        it("allows governance to set a new fraction");
    });

    describe("setting connector", () => {
        it("updates the connector address");
        it("withdraws everything from old connector and adds it to new");
    });

    describe("testing emergency stop", () => {
        it("withdraws remainder from the connector");
        it("sets fraction and connector to 0");
        it("should factor in to the new exchange rate");
        it("should still allow deposits and withdrawals to work");
    });

    context("performing multiple operations from multiple addresses in sequence", async () => {
        beforeEach(async () => {
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
            expect(stateBefore.exchangeRate).to.bignumber.equal(initialExchangeRate);
            expect(stateBefore.contractBalance).to.bignumber.equal(new BN(0));

            // 1.0 user 1 deposits
            // interest remains unassigned and exchange rate unmoved
            await masset.setAmountForCollectInterest(interestToReceive1);
            await time.increase(ONE_DAY);
            await savingsContract.methods["depositSavings(uint256)"](saver1deposit, {
                from: saver1,
            });
            await savingsContract.poke();
            const state1 = await getBalances(savingsContract, saver1);
            // 2.0 user 2 deposits
            // interest rate benefits user 1 and issued user 2 less credits than desired
            await masset.setAmountForCollectInterest(interestToReceive2);
            await time.increase(ONE_DAY);
            await savingsContract.methods["depositSavings(uint256)"](saver2deposit, {
                from: saver2,
            });
            const state2 = await getBalances(savingsContract, saver2);
            // 3.0 user 3 deposits
            // interest rate benefits users 1 and 2
            await masset.setAmountForCollectInterest(interestToReceive3);
            await time.increase(ONE_DAY);
            await savingsContract.methods["depositSavings(uint256)"](saver3deposit, {
                from: saver3,
            });
            const state3 = await getBalances(savingsContract, saver3);
            // 4.0 user 1 withdraws all her credits
            await savingsContract.redeem(state1.userCredits, { from: saver1 });
            const state4 = await getBalances(savingsContract, saver1);
            expect(state4.userCredits).bignumber.eq(new BN(0));
            expect(state4.totalCredits).bignumber.eq(state3.totalCredits.sub(state1.userCredits));
            expect(state4.exchangeRate).bignumber.eq(state3.exchangeRate);
            assertBNClose(
                state4.contractBalance,
                creditsToUnderlying(state4.totalCredits, state4.exchangeRate),
                new BN(100000),
            );
            // 5.0 user 4 deposits
            // interest rate benefits users 2 and 3
            await masset.setAmountForCollectInterest(interestToReceive4);
            await time.increase(ONE_DAY);
            await savingsContract.methods["depositSavings(uint256)"](saver4deposit, {
                from: saver4,
            });
            const state5 = await getBalances(savingsContract, saver4);
            // 6.0 users 2, 3, and 4 withdraw all their tokens
            await savingsContract.redeemCredits(state2.userCredits, { from: saver2 });
            await savingsContract.redeemCredits(state3.userCredits, { from: saver3 });
            await savingsContract.redeemCredits(state5.userCredits, { from: saver4 });
        });
    });
});
