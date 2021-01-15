/* eslint-disable @typescript-eslint/camelcase */

import { expectRevert, expectEvent, time } from "@openzeppelin/test-helpers";

import { simpleToExactAmount } from "@utils/math";
import { assertBNClose, assertBNClosePercent } from "@utils/assertions";
import { StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import { BN } from "@utils/tools";
import { fullScale, ZERO_ADDRESS, ZERO, MAX_UINT256, ONE_DAY, ONE_HOUR } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const { expect } = envSetup.configure();

const SavingsContract = artifacts.require("SavingsContract");
const MockNexus = artifacts.require("MockNexus");
const MockMasset = artifacts.require("MockMasset");
const MockConnector = artifacts.require("MockConnector");
const MockVaultConnector = artifacts.require("MockVaultConnector");
const MockLendingConnector = artifacts.require("MockLendingConnector");
const MockErroneousConnector1 = artifacts.require("MockErroneousConnector1");
const MockErroneousConnector2 = artifacts.require("MockErroneousConnector2");
const MockProxy = artifacts.require("MockProxy");
const MockERC20 = artifacts.require("MockERC20");
const MockSavingsManager = artifacts.require("MockSavingsManager");
const SavingsManager = artifacts.require("SavingsManager");
const MStableHelper = artifacts.require("MStableHelper");

interface Balances {
    totalCredits: BN;
    userCredits: BN;
    user: BN;
    contract: BN;
}

interface ConnectorData {
    lastPoke: BN;
    lastBalance: BN;
    fraction: BN;
    address: string;
    balance: BN;
}

interface Data {
    balances: Balances;
    exchangeRate: BN;
    connector: ConnectorData;
}

interface ExpectedPoke {
    aboveMax: boolean;
    type: "deposit" | "withdraw" | "none";
    amount: BN;
    ideal: BN;
}

const underlyingToCredits = (amount: BN | number, exchangeRate: BN): BN => {
    return new BN(amount)
        .mul(fullScale)
        .div(exchangeRate)
        .addn(1);
};
const creditsToUnderlying = (amount: BN, exchangeRate: BN): BN => {
    return amount.mul(exchangeRate).div(fullScale);
};

const getData = async (contract: t.SavingsContractInstance, user: string): Promise<Data> => {
    const mAsset = await MockERC20.at(await contract.underlying());
    const connectorAddress = await contract.connector();
    let connectorBalance = new BN(0);
    if (connectorAddress !== ZERO_ADDRESS) {
        const connector = await MockConnector.at(connectorAddress);
        connectorBalance = await connector.checkBalance();
    }
    return {
        balances: {
            totalCredits: await contract.totalSupply(),
            userCredits: await contract.balanceOf(user),
            user: await mAsset.balanceOf(user),
            contract: await mAsset.balanceOf(contract.address),
        },
        exchangeRate: await contract.exchangeRate(),
        connector: {
            lastPoke: await contract.lastPoke(),
            lastBalance: await contract.lastBalance(),
            fraction: await contract.fraction(),
            address: connectorAddress,
            balance: connectorBalance,
        },
    };
};

const getExpectedPoke = (data: Data, withdrawCredits: BN = new BN(0)): ExpectedPoke => {
    const { balances, connector, exchangeRate } = data;
    const totalCollat = creditsToUnderlying(
        balances.totalCredits.sub(withdrawCredits),
        exchangeRate,
    );
    const connectorDerived = balances.contract.gt(totalCollat)
        ? new BN(0)
        : totalCollat.sub(balances.contract);
    const max = totalCollat.mul(connector.fraction.add(simpleToExactAmount(2, 17))).div(fullScale);
    const ideal = totalCollat.mul(connector.fraction).div(fullScale);
    return {
        aboveMax: connectorDerived.gt(max),
        type: connector.balance.eq(ideal)
            ? "none"
            : connector.balance.gt(ideal)
            ? "withdraw"
            : "deposit",
        amount: connector.balance.gte(ideal)
            ? connector.balance.sub(ideal)
            : ideal.sub(connector.balance),
        ideal,
    };
};

/**
 * @notice Returns bool to signify whether the total collateral held is redeemable
 */
const exchangeRateHolds = (data: Data): boolean => {
    const { balances, connector, exchangeRate } = data;
    const collateral = balances.contract.add(connector.balance);
    return collateral.gte(creditsToUnderlying(balances.totalCredits, exchangeRate));
};

contract("SavingsContract", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const manager = sa.dummy2;
    const alice = sa.default;
    const bob = sa.dummy3;
    const ctx: { module?: t.ModuleInstance } = {};
    const initialExchangeRate = simpleToExactAmount(1, 17);

    let systemMachine: SystemMachine;
    let massetDetails: MassetDetails;

    let savingsContract: t.SavingsContractInstance;
    let nexus: t.MockNexusInstance;
    let masset: t.MockMassetInstance;
    let savingsManager: t.SavingsManagerInstance;
    let helper: t.MStableHelperInstance;

    const createNewSavingsContract = async (useMockSavingsManager = false): Promise<void> => {
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
            const { balances, exchangeRate, connector } = await getData(
                savingsContract,
                sa.default,
            );
            expect(simpleToExactAmount(2, 17)).to.bignumber.equal(connector.fraction);
            const underlyingAddr = await savingsContract.underlying();
            expect(masset.address).to.equal(underlyingAddr);
            expect(ZERO).to.bignumber.equal(balances.totalCredits);
            expect(ZERO).to.bignumber.equal(balances.contract);
            expect(initialExchangeRate).to.bignumber.equal(exchangeRate);
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
            await createNewSavingsContract(true);
            await nexus.setSavingsManager(savingsManagerAccount);
            await masset.transfer(savingsManagerAccount, simpleToExactAmount(20, 18));
            await masset.approve(savingsContract.address, simpleToExactAmount(20, 18), {
                from: savingsManagerAccount,
            });
        });
        afterEach(async () => {
            const data = await getData(savingsContract, alice);
            expect(exchangeRateHolds(data), "Exchange rate must hold");
        });
        it("should fail when not called by savings manager", async () => {
            await expectRevert(
                savingsContract.depositInterest(1, {
                    from: sa.other,
                }),
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
            const before = await getData(savingsContract, sa.default);
            const deposit = simpleToExactAmount(1, 18);
            await savingsContract.depositInterest(deposit, { from: savingsManagerAccount });

            const after = await getData(savingsContract, sa.default);
            expect(deposit).to.bignumber.equal(after.balances.contract);
            expect(before.balances.contract.add(deposit)).to.bignumber.equal(
                after.balances.contract,
            );
            // exchangeRate should not change
            expect(before.exchangeRate).to.bignumber.equal(after.exchangeRate);
        });
        it("should deposit interest when some credits exist", async () => {
            const interest = simpleToExactAmount(20, 18);
            const deposit = simpleToExactAmount(10, 18);

            // Deposit to SavingsContract
            await masset.approve(savingsContract.address, deposit);
            await savingsContract.preDeposit(deposit, sa.default);

            const balanceBefore = await masset.balanceOf(savingsContract.address);

            // Deposit Interest
            const tx = await savingsContract.depositInterest(interest, {
                from: savingsManagerAccount,
            });
            // Expected rate = 1e17 + (20e18 / (100e18+1))
            // Expected rate = 1e17 + 2e17-1
            const expectedExchangeRate = simpleToExactAmount(3, 17);
            expectEvent.inLogs(tx.logs, "ExchangeRateUpdated", {
                newExchangeRate: expectedExchangeRate,
                interestCollected: interest,
            });
            const dataAfter = await getData(savingsContract, sa.default);

            expect(balanceBefore.add(interest)).to.bignumber.equal(dataAfter.balances.contract);
            expect(expectedExchangeRate).to.bignumber.equal(dataAfter.exchangeRate);
        });
    });

    describe("depositing savings", async () => {
        context("using preDeposit", async () => {
            before(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
                // This amount should not be collected
                await masset.setAmountForCollectInterest(simpleToExactAmount(100, 18));
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should not collect interest or affect the exchangeRate", async () => {
                const dataBefore = await getData(savingsContract, sa.default);
                const deposit = simpleToExactAmount(10, 18);
                const tx = await savingsContract.preDeposit(deposit, sa.default);
                expectEvent(tx.receipt, "SavingsDeposited", {
                    saver: sa.default,
                    savingsDeposited: deposit,
                    creditsIssued: underlyingToCredits(deposit, dataBefore.exchangeRate),
                });
                const dataAfter = await getData(savingsContract, sa.default);
                expect(dataAfter.exchangeRate).bignumber.eq(initialExchangeRate);
                expect(dataAfter.balances.totalCredits).bignumber.eq(
                    underlyingToCredits(deposit, dataBefore.exchangeRate),
                );
                // Should only receive the deposited, and not collect from the manager
                expect(dataAfter.balances.contract).bignumber.eq(deposit);
            });
            it("allows multiple preDeposits", async () => {
                await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default);
                await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default);
                await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default);
                await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default);
            });
            it("should fail after exchange rate updates", async () => {
                // 1. Now there is more collateral than credits
                await savingsContract.methods["depositSavings(uint256)"](
                    simpleToExactAmount(1, 18),
                );
                await savingsContract.poke();
                const exchangeRate = await savingsContract.exchangeRate();
                expect(exchangeRate).bignumber.gt(initialExchangeRate);
                // 2. preDeposit should no longer work
                await expectRevert(
                    savingsContract.preDeposit(new BN(1), sa.default),
                    "Can only use this method before streaming begins",
                );
            });
        });

        context("using depositSavings", async () => {
            before(async () => {
                await createNewSavingsContract();
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should fail when amount is zero", async () => {
                await expectRevert(
                    savingsContract.methods["depositSavings(uint256)"](ZERO),
                    "Must deposit something",
                );
            });
            it("should fail when beneficiary is 0", async () => {
                await expectRevert(
                    savingsContract.methods["depositSavings(uint256,address)"](1, ZERO_ADDRESS),
                    "Invalid beneficiary address",
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
            it("should deposit the mUSD and assign credits to the saver", async () => {
                const dataBefore = await getData(savingsContract, sa.default);
                const depositAmount = simpleToExactAmount(1, 18);

                // 1. Approve the savings contract to spend mUSD
                await masset.approve(savingsContract.address, depositAmount, {
                    from: sa.default,
                });
                // 2. Deposit the mUSD
                const tx = await savingsContract.methods["depositSavings(uint256)"](depositAmount, {
                    from: sa.default,
                });
                const dataAfter = await getData(savingsContract, sa.default);
                const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate);
                expectEvent.inLogs(tx.logs, "SavingsDeposited", {
                    saver: sa.default,
                    savingsDeposited: depositAmount,
                    creditsIssued: expectedCredits,
                });
                expect(dataAfter.balances.userCredits).bignumber.eq(
                    expectedCredits,
                    "Must receive some savings credits",
                );
                expect(dataAfter.balances.totalCredits).bignumber.eq(expectedCredits);
                expect(dataAfter.balances.user).bignumber.eq(
                    dataBefore.balances.user.sub(depositAmount),
                );
                expect(dataAfter.balances.contract).bignumber.eq(simpleToExactAmount(1, 18));
            });
            it("allows alice to deposit to beneficiary (bob)", async () => {
                const dataBefore = await getData(savingsContract, bob);
                const depositAmount = simpleToExactAmount(1, 18);

                await masset.approve(savingsContract.address, depositAmount);

                const tx = await savingsContract.methods["depositSavings(uint256,address)"](
                    depositAmount,
                    bob,
                    {
                        from: alice,
                    },
                );
                const dataAfter = await getData(savingsContract, bob);
                const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate);
                expectEvent.inLogs(tx.logs, "SavingsDeposited", {
                    saver: bob,
                    savingsDeposited: depositAmount,
                    creditsIssued: expectedCredits,
                });
                expect(dataAfter.balances.userCredits).bignumber.eq(
                    expectedCredits,
                    "Must receive some savings credits",
                );
                expect(dataAfter.balances.totalCredits).bignumber.eq(expectedCredits.muln(2));
                expect(dataAfter.balances.user).bignumber.eq(dataBefore.balances.user);
                expect(dataAfter.balances.contract).bignumber.eq(
                    dataBefore.balances.contract.add(simpleToExactAmount(1, 18)),
                );
            });

            context("when there is some interest to collect from the manager", async () => {
                const deposit = simpleToExactAmount(10, 18);
                const interest = simpleToExactAmount(10, 18);
                before(async () => {
                    await createNewSavingsContract();
                    await masset.approve(savingsContract.address, deposit);
                });
                afterEach(async () => {
                    const data = await getData(savingsContract, alice);
                    expect(exchangeRateHolds(data), "Exchange rate must hold");
                });
                it("should collect the interest and update the exchange rate before issuance", async () => {
                    // Get the total balances
                    const stateBefore = await getData(savingsContract, alice);
                    expect(stateBefore.exchangeRate).to.bignumber.equal(initialExchangeRate);

                    // Deposit first to get some savings in the basket
                    await savingsContract.methods["depositSavings(uint256)"](deposit);

                    const stateMiddle = await getData(savingsContract, alice);
                    expect(stateMiddle.exchangeRate).to.bignumber.equal(initialExchangeRate);
                    expect(stateMiddle.balances.contract).to.bignumber.equal(deposit);
                    expect(stateMiddle.balances.totalCredits).to.bignumber.equal(
                        underlyingToCredits(deposit, initialExchangeRate),
                    );

                    // Set up the mAsset with some interest
                    await masset.setAmountForCollectInterest(interest);
                    await time.increase(ONE_DAY);

                    // Bob deposits into the contract
                    await masset.transfer(bob, deposit);
                    await masset.approve(savingsContract.address, deposit, { from: bob });
                    const tx = await savingsContract.methods["depositSavings(uint256)"](deposit, {
                        from: bob,
                    });
                    // Bob collects interest, to the benefit of Alice
                    // Expected rate = 1e17 + 1e17-1
                    const expectedExchangeRate = simpleToExactAmount(2, 17);
                    expectEvent.inLogs(tx.logs, "ExchangeRateUpdated", {
                        newExchangeRate: expectedExchangeRate,
                        interestCollected: interest,
                    });
                    // Alice gets the benefit of the new exchange rate
                    const stateEnd = await getData(savingsContract, alice);
                    expect(stateEnd.exchangeRate).bignumber.eq(expectedExchangeRate);
                    expect(stateEnd.balances.contract).bignumber.eq(deposit.muln(3));
                    const aliceBalance = await savingsContract.balanceOfUnderlying(alice);
                    expect(simpleToExactAmount(20, 18)).bignumber.eq(aliceBalance);

                    // Bob gets credits at the NEW exchange rate
                    const bobData = await getData(savingsContract, bob);
                    expect(bobData.balances.userCredits).bignumber.eq(
                        underlyingToCredits(deposit, stateEnd.exchangeRate),
                    );
                    expect(stateEnd.balances.totalCredits).bignumber.eq(
                        bobData.balances.userCredits.add(stateEnd.balances.userCredits),
                    );
                    const bobBalance = await savingsContract.balanceOfUnderlying(bob);
                    expect(bobBalance).bignumber.eq(deposit);
                    expect(bobBalance.add(aliceBalance)).bignumber.eq(
                        deposit.muln(3),
                        "Individual balances cannot exceed total",
                    );

                    expect(exchangeRateHolds(stateEnd), "Exchange rate must hold");
                });
            });
        });
    });
    describe("checking the view methods", () => {
        const aliceCredits = simpleToExactAmount(100, 18).addn(1);
        const aliceUnderlying = simpleToExactAmount(20, 18);
        const bobCredits = simpleToExactAmount(50, 18).addn(1);
        const bobUnderlying = simpleToExactAmount(10, 18);
        let data: Data;
        before(async () => {
            await createNewSavingsContract();
            await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
            await savingsContract.preDeposit(simpleToExactAmount(10, 18), alice);
            await masset.setAmountForCollectInterest(simpleToExactAmount(10, 18));
            await savingsContract.methods["depositSavings(uint256,address)"](
                simpleToExactAmount(10, 18),
                bob,
            );
            data = await getData(savingsContract, alice);
            const bobData = await getData(savingsContract, bob);
            expect(data.balances.userCredits).bignumber.eq(aliceCredits);
            expect(creditsToUnderlying(aliceCredits, data.exchangeRate)).bignumber.eq(
                aliceUnderlying,
            );
            expect(bobData.balances.userCredits).bignumber.eq(bobCredits);
            expect(creditsToUnderlying(bobCredits, bobData.exchangeRate)).bignumber.eq(
                bobUnderlying,
            );
        });
        it("should return correct balances as local checks", async () => {
            const aliceBoU = await savingsContract.balanceOfUnderlying(alice);
            expect(aliceBoU).bignumber.eq(aliceUnderlying);
            const bobBoU = await savingsContract.balanceOfUnderlying(bob);
            expect(bobBoU).bignumber.eq(bobUnderlying);
            const otherBoU = await savingsContract.balanceOfUnderlying(sa.other);
            expect(otherBoU).bignumber.eq(new BN(0));
        });
        it("should return same result in helper.getSaveBalance and balanceOfUnderlying", async () => {
            const aliceBoU = await savingsContract.balanceOfUnderlying(alice);
            const aliceB = await helper.getSaveBalance(savingsContract.address, alice);
            expect(aliceBoU).bignumber.eq(aliceB);

            const bobBoU = await savingsContract.balanceOfUnderlying(bob);
            const bobB = await helper.getSaveBalance(savingsContract.address, bob);
            expect(bobBoU).bignumber.eq(bobB);

            const otherBoU = await savingsContract.balanceOfUnderlying(sa.other);
            const otherB = await helper.getSaveBalance(savingsContract.address, sa.other);
            expect(otherBoU).bignumber.eq(new BN(0));
            expect(otherB).bignumber.eq(new BN(0));
        });
        it("should return same result in balanceOfUnderlying and creditsToUnderlying(balanceOf(user))", async () => {
            const aliceBoU = await savingsContract.balanceOfUnderlying(alice);
            const aliceC = await savingsContract.creditsToUnderlying(
                await savingsContract.balanceOf(alice),
            );
            expect(aliceBoU).bignumber.eq(aliceC);

            const bobBou = await savingsContract.balanceOfUnderlying(bob);
            const bobC = await savingsContract.creditsToUnderlying(
                await savingsContract.balanceOf(bob),
            );
            expect(bobBou).bignumber.eq(bobC);
        });
        it("should return same result in creditBalances and balanceOf", async () => {
            const aliceCB = await savingsContract.creditBalances(alice);
            const aliceB = await savingsContract.balanceOf(alice);
            expect(aliceCB).bignumber.eq(aliceB);

            const bobCB = await savingsContract.creditBalances(bob);
            const bobB = await savingsContract.balanceOf(bob);
            expect(bobCB).bignumber.eq(bobB);

            const otherCB = await savingsContract.creditBalances(sa.other);
            const otherB = await savingsContract.balanceOf(sa.other);
            expect(otherCB).bignumber.eq(new BN(0));
            expect(otherB).bignumber.eq(new BN(0));
        });
        it("should calculate back and forth correctly", async () => {
            // underlyingToCredits
            const uToC = await savingsContract.underlyingToCredits(simpleToExactAmount(1, 18));
            expect(uToC).bignumber.eq(
                underlyingToCredits(simpleToExactAmount(1, 18), data.exchangeRate),
            );
            expect(await savingsContract.creditsToUnderlying(uToC)).bignumber.eq(
                simpleToExactAmount(1, 18),
            );

            const uToC2 = await savingsContract.underlyingToCredits(1);
            expect(uToC2).bignumber.eq(underlyingToCredits(1, data.exchangeRate));
            expect(await savingsContract.creditsToUnderlying(uToC2)).bignumber.eq(new BN(1));

            const uToC3 = await savingsContract.underlyingToCredits(0);
            expect(uToC3).bignumber.eq(new BN(1));
            expect(await savingsContract.creditsToUnderlying(uToC3)).bignumber.eq(new BN(0));

            const uToC4 = await savingsContract.underlyingToCredits(12986123876);
            expect(uToC4).bignumber.eq(underlyingToCredits(12986123876, data.exchangeRate));
            expect(await savingsContract.creditsToUnderlying(uToC4)).bignumber.eq(
                new BN(12986123876),
            );
        });
    });

    describe("redeeming", async () => {
        before(async () => {
            await createNewSavingsContract();
        });
        it("should fail when input is zero", async () => {
            await expectRevert(savingsContract.redeem(ZERO), "Must withdraw something");
            await expectRevert(savingsContract.redeemCredits(ZERO), "Must withdraw something");
            await expectRevert(savingsContract.redeemUnderlying(ZERO), "Must withdraw something");
        });
        it("should fail when user doesn't have credits", async () => {
            const amt = new BN(10);
            await expectRevert(savingsContract.redeem(amt), "ERC20: burn amount exceeds balance", {
                from: sa.other,
            });
            await expectRevert(
                savingsContract.redeemCredits(amt),
                "ERC20: burn amount exceeds balance",
                {
                    from: sa.other,
                },
            );
            await expectRevert(
                savingsContract.redeemUnderlying(amt),
                "ERC20: burn amount exceeds balance",
                {
                    from: sa.other,
                },
            );
        });
        context("using redeemCredits", async () => {
            const deposit = simpleToExactAmount(10, 18);
            const credits = underlyingToCredits(deposit, initialExchangeRate);
            const interest = simpleToExactAmount(10, 18);
            beforeEach(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            // test the balance calcs here.. credit to masset, and public calcs
            it("should redeem a specific amount of credits", async () => {
                // calculates underlying/credits
                const creditsToWithdraw = simpleToExactAmount(5, 18);
                const expectedWithdrawal = creditsToUnderlying(
                    creditsToWithdraw,
                    initialExchangeRate,
                );
                const dataBefore = await getData(savingsContract, alice);
                const tx = await savingsContract.redeemCredits(creditsToWithdraw);
                const dataAfter = await getData(savingsContract, alice);
                expectEvent(tx.receipt, "CreditsRedeemed", {
                    redeemer: alice,
                    creditsRedeemed: creditsToWithdraw,
                    savingsCredited: expectedWithdrawal,
                });
                // burns credits from sender
                expect(dataAfter.balances.userCredits).bignumber.eq(
                    dataBefore.balances.userCredits.sub(creditsToWithdraw),
                );
                expect(dataAfter.balances.totalCredits).bignumber.eq(
                    dataBefore.balances.totalCredits.sub(creditsToWithdraw),
                );
                // transfers tokens to sender
                expect(dataAfter.balances.user).bignumber.eq(
                    dataBefore.balances.user.add(expectedWithdrawal),
                );
                expect(dataAfter.balances.contract).bignumber.eq(
                    dataBefore.balances.contract.sub(expectedWithdrawal),
                );
            });
            it("collects interest and credits to saver before redemption", async () => {
                const expectedExchangeRate = simpleToExactAmount(2, 17);
                await masset.setAmountForCollectInterest(interest);
                const dataBefore = await getData(savingsContract, alice);
                await savingsContract.redeemCredits(credits);
                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.balances.totalCredits).bignumber.eq(new BN(0));
                // User receives their deposit back + interest
                assertBNClose(
                    dataAfter.balances.user,
                    dataBefore.balances.user.add(deposit).add(interest),
                    100,
                );
                // Exchange rate updates
                expect(dataAfter.exchangeRate).bignumber.eq(expectedExchangeRate);
            });
        });
        context("using redeemUnderlying", async () => {
            const deposit = simpleToExactAmount(10, 18);
            const interest = simpleToExactAmount(10, 18);
            beforeEach(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("allows full redemption immediately after deposit", async () => {
                await savingsContract.redeemUnderlying(deposit);
                const data = await getData(savingsContract, alice);
                expect(data.balances.userCredits).bignumber.eq(new BN(0));
            });
            it("should redeem a specific amount of underlying", async () => {
                // calculates underlying/credits
                const underlying = simpleToExactAmount(5, 18);
                const expectedCredits = underlyingToCredits(underlying, initialExchangeRate);
                const dataBefore = await getData(savingsContract, alice);
                const tx = await savingsContract.redeemUnderlying(underlying);
                const dataAfter = await getData(savingsContract, alice);
                expectEvent(tx.receipt, "CreditsRedeemed", {
                    redeemer: alice,
                    creditsRedeemed: expectedCredits,
                    savingsCredited: underlying,
                });
                // burns credits from sender
                expect(dataAfter.balances.userCredits).bignumber.eq(
                    dataBefore.balances.userCredits.sub(expectedCredits),
                );
                expect(dataAfter.balances.totalCredits).bignumber.eq(
                    dataBefore.balances.totalCredits.sub(expectedCredits),
                );
                // transfers tokens to sender
                expect(dataAfter.balances.user).bignumber.eq(
                    dataBefore.balances.user.add(underlying),
                );
                expect(dataAfter.balances.contract).bignumber.eq(
                    dataBefore.balances.contract.sub(underlying),
                );
            });
            it("collects interest and credits to saver before redemption", async () => {
                const expectedExchangeRate = simpleToExactAmount(2, 17);
                await masset.setAmountForCollectInterest(interest);

                const dataBefore = await getData(savingsContract, alice);
                await savingsContract.redeemUnderlying(deposit);
                const dataAfter = await getData(savingsContract, alice);

                expect(dataAfter.balances.user).bignumber.eq(dataBefore.balances.user.add(deposit));
                // User is left with resulting credits due to exchange rate going up
                assertBNClose(
                    dataAfter.balances.userCredits,
                    dataBefore.balances.userCredits.divn(2),
                    1000,
                );
                // Exchange rate updates
                expect(dataAfter.exchangeRate).bignumber.eq(expectedExchangeRate);
            });
            it("skips interest collection if automate is turned off", async () => {
                await masset.setAmountForCollectInterest(interest);
                await savingsContract.automateInterestCollectionFlag(false, { from: sa.governor });

                const dataBefore = await getData(savingsContract, alice);
                await savingsContract.redeemUnderlying(deposit);
                const dataAfter = await getData(savingsContract, alice);

                expect(dataAfter.balances.user).bignumber.eq(dataBefore.balances.user.add(deposit));
                expect(dataAfter.balances.userCredits).bignumber.eq(new BN(0));
                expect(dataAfter.exchangeRate).bignumber.eq(dataBefore.exchangeRate);
            });
        });

        context("with a connector that surpasses limit", async () => {
            const deposit = simpleToExactAmount(100, 18);
            const redemption = underlyingToCredits(
                simpleToExactAmount(51, 18),
                initialExchangeRate,
            );
            before(async () => {
                await createNewSavingsContract();
                const connector = await MockConnector.new(savingsContract.address, masset.address);

                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice);

                await savingsContract.setConnector(connector.address, { from: sa.governor });
                await time.increase(ONE_HOUR.muln(4));

                const data = await getData(savingsContract, alice);
                expect(data.connector.balance).bignumber.eq(
                    deposit.mul(data.connector.fraction).div(fullScale),
                );
                expect(data.balances.contract).bignumber.eq(deposit.sub(data.connector.balance));
                expect(data.exchangeRate).bignumber.eq(initialExchangeRate);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("triggers poke and deposits to connector if the threshold is hit", async () => {
                // in order to reach 40%, must redeem > 51
                const dataBefore = await getData(savingsContract, alice);
                const poke = await getExpectedPoke(dataBefore, redemption);

                const tx = await savingsContract.redeemCredits(redemption);
                const dataAfter = await getData(savingsContract, alice);
                expectEvent(tx.receipt, "CreditsRedeemed", {
                    redeemer: alice,
                    creditsRedeemed: redemption,
                    savingsCredited: simpleToExactAmount(51, 18),
                });
                // Remaining balance is 49, with 20 in the connector
                expectEvent(tx.receipt, "Poked", {
                    oldBalance: dataBefore.connector.balance,
                    newBalance: poke.ideal,
                    interestDetected: new BN(0),
                });
                expect(dataAfter.balances.contract).bignumber.eq(simpleToExactAmount("39.2", 18));
            });
            it("errors if triggered again within 4h", async () => {});
        });

        context("using redeem (depcrecated)", async () => {
            beforeEach(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, simpleToExactAmount(10, 18));
                await savingsContract.methods["depositSavings(uint256)"](
                    simpleToExactAmount(1, 18),
                );
            });
            it("should redeem when user has balance", async () => {
                const redemptionAmount = simpleToExactAmount(5, 18);
                const balancesBefore = await getData(savingsContract, sa.default);

                const tx = await savingsContract.redeem(redemptionAmount);
                const exchangeRate = initialExchangeRate;
                const underlying = creditsToUnderlying(redemptionAmount, exchangeRate);
                expectEvent.inLogs(tx.logs, "CreditsRedeemed", {
                    redeemer: sa.default,
                    creditsRedeemed: redemptionAmount,
                    savingsCredited: underlying,
                });
                const dataAfter = await getData(savingsContract, sa.default);
                expect(balancesBefore.balances.contract.sub(underlying)).to.bignumber.equal(
                    dataAfter.balances.contract,
                );

                expect(balancesBefore.balances.user.add(underlying)).to.bignumber.equal(
                    dataAfter.balances.user,
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

    describe("using the helper to check balance and redeem", async () => {
        before(async () => {
            await createNewSavingsContract(false);
        });

        it("should deposit and withdraw", async () => {
            // Approve first
            const deposit = simpleToExactAmount(10, 18);
            await masset.approve(savingsContract.address, deposit);

            // Get the total balancesbalancesAfter
            const stateBefore = await getData(savingsContract, sa.default);
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

    describe("setting poker", () => {
        before(async () => {
            await createNewSavingsContract();
        });
        it("fails if not called by governor", async () => {
            await expectRevert(
                savingsContract.setPoker(sa.dummy1, { from: sa.dummy1 }),
                "Only governor can execute",
            );
        });
        it("fails if invalid poker address", async () => {
            await expectRevert(
                savingsContract.setPoker(sa.default, { from: sa.governor }),
                "Invalid poker",
            );
        });
        it("allows governance to set a new poker", async () => {
            const tx = await savingsContract.setPoker(sa.dummy1, { from: sa.governor });
            expectEvent(tx.receipt, "PokerUpdated", {
                poker: sa.dummy1,
            });
            expect(await savingsContract.poker()).eq(sa.dummy1);
        });
    });

    describe("setting fraction", () => {
        before(async () => {
            await createNewSavingsContract();
            await masset.approve(savingsContract.address, simpleToExactAmount(1, 18));
            await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default);
        });
        it("fails if not called by governor", async () => {
            await expectRevert(
                savingsContract.setFraction(simpleToExactAmount(1, 17), { from: sa.dummy1 }),
                "Only governor can execute",
            );
        });
        it("fails if over the threshold", async () => {
            await expectRevert(
                savingsContract.setFraction(simpleToExactAmount(55, 16), { from: sa.governor }),
                "Fraction must be <= 50%",
            );
        });
        it("sets a new fraction and pokes", async () => {
            const tx = await savingsContract.setFraction(simpleToExactAmount(1, 16), {
                from: sa.governor,
            });
            expectEvent(tx.receipt, "FractionUpdated", {
                fraction: simpleToExactAmount(1, 16),
            });
            expectEvent(tx.receipt, "PokedRaw");
            expect(await savingsContract.fraction()).bignumber.eq(simpleToExactAmount(1, 16));
        });
    });

    describe("setting connector", () => {
        const deposit = simpleToExactAmount(100, 18);

        beforeEach(async () => {
            await createNewSavingsContract();
            const connector = await MockConnector.new(savingsContract.address, masset.address);

            await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
            await savingsContract.preDeposit(deposit, alice);

            await savingsContract.setConnector(connector.address, { from: sa.governor });
        });
        afterEach(async () => {
            const data = await getData(savingsContract, alice);
            expect(exchangeRateHolds(data), "Exchange rate must hold");
        });
        it("fails if not called by governor", async () => {
            await expectRevert(
                savingsContract.setConnector(sa.dummy1, { from: sa.dummy1 }),
                "Only governor can execute",
            );
        });
        it("updates the connector address, moving assets to new connector", async () => {
            const dataBefore = await getData(savingsContract, alice);

            expect(dataBefore.connector.balance).bignumber.eq(
                deposit.mul(dataBefore.connector.fraction).div(fullScale),
            );
            expect(dataBefore.balances.contract).bignumber.eq(
                deposit.sub(dataBefore.connector.balance),
            );
            expect(dataBefore.exchangeRate).bignumber.eq(initialExchangeRate);

            const newConnector = await MockConnector.new(savingsContract.address, masset.address);

            const tx = await savingsContract.setConnector(newConnector.address, {
                from: sa.governor,
            });
            expectEvent(tx.receipt, "ConnectorUpdated", {
                connector: newConnector.address,
            });

            const dataAfter = await getData(savingsContract, alice);
            expect(dataAfter.connector.address).eq(newConnector.address);
            expect(dataAfter.connector.balance).bignumber.eq(dataBefore.connector.balance);
            const oldConnector = await MockConnector.at(dataBefore.connector.address);
            expect(await oldConnector.checkBalance()).bignumber.eq(new BN(0));
        });
        it("withdraws everything if connector is set to 0", async () => {
            const dataBefore = await getData(savingsContract, alice);
            const tx = await savingsContract.setConnector(ZERO_ADDRESS, {
                from: sa.governor,
            });
            expectEvent(tx.receipt, "ConnectorUpdated", {
                connector: ZERO_ADDRESS,
            });

            const dataAfter = await getData(savingsContract, alice);
            expect(dataAfter.connector.address).eq(ZERO_ADDRESS);
            expect(dataAfter.connector.balance).bignumber.eq(new BN(0));
            expect(dataAfter.balances.contract).bignumber.eq(
                dataBefore.balances.contract.add(dataBefore.connector.balance),
            );
        });
    });

    describe("poking", () => {
        const deposit = simpleToExactAmount(1, 20);
        before(async () => {
            await createNewSavingsContract();
        });
        it("allows only poker to poke", async () => {
            await expectRevert(
                savingsContract.poke({ from: sa.governor }),
                "Only poker can execute",
            );
        });
        it("fails if there are no credits", async () => {
            const credits = await savingsContract.totalSupply();
            expect(credits).bignumber.eq(new BN(0));
            await expectRevert(
                savingsContract.poke({ from: sa.default }),
                "Must have something to poke",
            );
        });
        it("only allows pokes once every 4h", async () => {
            await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
            await savingsContract.preDeposit(deposit, alice);
            await savingsContract.poke();
            await time.increase(ONE_HOUR.muln(3));
            await expectRevert(
                savingsContract.poke({ from: sa.default }),
                "Not enough time elapsed",
            );
        });
        context("with an erroneous connector", () => {
            beforeEach(async () => {
                await createNewSavingsContract();

                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should fail if the raw balance goes down somehow", async () => {
                const connector = await MockErroneousConnector1.new(
                    savingsContract.address,
                    masset.address,
                );
                await savingsContract.setConnector(connector.address, { from: sa.governor });
                // Total collat goes down
                await savingsContract.redeemUnderlying(deposit.divn(2));
                // Withdrawal is made but nothing comes back
                await time.increase(ONE_HOUR.muln(6));
                await savingsContract.poke();
                // Try that again
                await time.increase(ONE_HOUR.muln(12));
                await expectRevert(savingsContract.poke(), "ExchangeRate must increase");
            });
            it("is protected by the system invariant", async () => {
                // connector returns invalid balance after withdrawal
                const connector = await MockErroneousConnector2.new(
                    savingsContract.address,
                    masset.address,
                );
                await savingsContract.setConnector(connector.address, { from: sa.governor });
                await savingsContract.redeemUnderlying(deposit.divn(2));

                await time.increase(ONE_HOUR.muln(4));
                await expectRevert(savingsContract.poke(), "Enforce system invariant");
            });
            it("should fail if the balance has gone down", async () => {
                const connector = await MockErroneousConnector2.new(
                    savingsContract.address,
                    masset.address,
                );
                await savingsContract.setConnector(connector.address, { from: sa.governor });

                await time.increase(ONE_HOUR.muln(4));
                await connector.poke();
                await expectRevert(savingsContract.poke(), "Invalid yield");
            });
        });
        context("with a lending market connector", () => {
            let connector: t.MockLendingConnectorInstance;
            before(async () => {
                await createNewSavingsContract();
                connector = await MockLendingConnector.new(savingsContract.address, masset.address);
                // Give mock some extra assets to allow inflation
                await masset.transfer(connector.address, simpleToExactAmount(100, 18));

                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice);

                // Set up connector
                await savingsContract.setFraction(0, { from: sa.governor });
                await savingsContract.setConnector(connector.address, { from: sa.governor });
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should do nothing if the fraction is 0", async () => {
                const data = await getData(savingsContract, alice);
                await time.increase(ONE_HOUR.muln(4));
                const tx = await savingsContract.poke();
                expectEvent(tx.receipt, "Poked", {
                    oldBalance: new BN(0),
                    newBalance: new BN(0),
                    interestDetected: new BN(0),
                });
                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.balances.contract).bignumber.eq(data.balances.contract);
                expect(dataAfter.exchangeRate).bignumber.eq(data.exchangeRate);
            });
            it("should poke when fraction is set", async () => {
                const tx = await savingsContract.setFraction(simpleToExactAmount(2, 17), {
                    from: sa.governor,
                });

                expectEvent(tx.receipt, "Poked", {
                    oldBalance: new BN(0),
                    newBalance: simpleToExactAmount(2, 19),
                    interestDetected: new BN(0),
                });

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.balances.contract).bignumber.eq(simpleToExactAmount(8, 19));
                expect(dataAfter.connector.balance).bignumber.eq(simpleToExactAmount(2, 19));
            });
            it("should accrue interest and update exchange rate", async () => {
                await time.increase(ONE_DAY);
                const data = await getData(savingsContract, alice);

                const ts = await time.latest();
                await connector.poke();
                const tx = await savingsContract.poke();
                expectEvent(tx.receipt, "Poked", {
                    oldBalance: simpleToExactAmount(2, 19),
                });

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.exchangeRate).bignumber.gt(data.exchangeRate as any);
                assertBNClose(dataAfter.connector.lastPoke, ts, 5);
                expect(dataAfter.connector.balance).bignumber.gte(
                    dataAfter.connector.lastBalance as any,
                );
            });
            it("should deposit to the connector if total supply increases", async () => {
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 20));
                await savingsContract.methods["depositSavings(uint256)"](deposit);

                await time.increase(ONE_DAY);
                const data = await getData(savingsContract, alice);

                const ts = await time.latest();
                await savingsContract.poke();

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.exchangeRate).bignumber.gt(data.exchangeRate as any);
                assertBNClose(dataAfter.connector.lastPoke, ts, 5);
                expect(dataAfter.connector.balance).bignumber.gte(
                    dataAfter.connector.lastBalance as any,
                );
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(16, 19), "2");
            });
            it("should withdraw from the connector if total supply lowers", async () => {
                await savingsContract.redeemUnderlying(simpleToExactAmount(1, 20));

                await time.increase(ONE_DAY.muln(2));
                const data = await getData(savingsContract, alice);

                await savingsContract.poke();

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.exchangeRate).bignumber.gte(data.exchangeRate as any);
                expect(dataAfter.connector.balance).bignumber.gte(
                    dataAfter.connector.lastBalance as any,
                );
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(8, 19), "2");
            });
            it("should continue to accrue interest", async () => {
                await time.increase(ONE_DAY.muln(3));
                const data = await getData(savingsContract, alice);

                await savingsContract.poke();

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.exchangeRate).bignumber.gte(data.exchangeRate as any);
                expect(dataAfter.connector.balance).bignumber.gte(
                    dataAfter.connector.lastBalance as any,
                );
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(8, 19), "2");
            });
            it("should fail if the APY is too high", async () => {
                await time.increase(ONE_HOUR.muln(4));
                await expectRevert(
                    savingsContract.poke(),
                    "Interest protected from inflating past maxAPY",
                );
            });
        });
        context("with a vault connector", () => {
            let connector: t.MockVaultConnectorInstance;
            before(async () => {
                await createNewSavingsContract();
                connector = await MockVaultConnector.new(savingsContract.address, masset.address);

                await masset.transfer(connector.address, simpleToExactAmount(100, 18));
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should poke when fraction is set", async () => {
                const tx = await savingsContract.setConnector(connector.address, {
                    from: sa.governor,
                });

                expectEvent(tx.receipt, "Poked", {
                    oldBalance: new BN(0),
                    newBalance: simpleToExactAmount(2, 19),
                    interestDetected: new BN(0),
                });

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.balances.contract).bignumber.eq(simpleToExactAmount(8, 19));
                expect(dataAfter.connector.balance).bignumber.eq(simpleToExactAmount(2, 19));
            });
            // In this case, the slippage from the deposit has caused the connector
            // to be less than the original balance. Fortunately, the invariant for Connectors
            // protects against this case, and will return the deposited balance.
            it("should not accrue interest if there is still a deficit", async () => {
                await time.increase(ONE_HOUR.muln(4));
                await savingsContract.poke();

                await time.increase(ONE_DAY);
                const data = await getData(savingsContract, alice);

                const ts = await time.latest();
                await connector.poke();
                const tx = await savingsContract.poke();
                expectEvent(tx.receipt, "Poked", {
                    oldBalance: simpleToExactAmount(2, 19),
                    newBalance: simpleToExactAmount(2, 19),
                    interestDetected: new BN(0),
                });

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.exchangeRate).bignumber.eq(data.exchangeRate);
                assertBNClose(dataAfter.connector.lastPoke, ts, 5);
                expect(dataAfter.connector.balance).bignumber.eq(
                    dataAfter.connector.lastBalance as any,
                );
            });
            it("should accrue interest if the balance goes positive", async () => {
                await time.increase(ONE_DAY.muln(2));
                await connector.poke();

                await time.increase(ONE_DAY);
                const data = await getData(savingsContract, alice);

                const connectorBalance = await connector.checkBalance();
                expect(connectorBalance).bignumber.gt(simpleToExactAmount(2, 19) as any);

                await connector.poke();
                const tx = await savingsContract.poke();
                expectEvent(tx.receipt, "Poked", {
                    oldBalance: simpleToExactAmount(2, 19),
                });

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.exchangeRate).bignumber.gt(data.exchangeRate as any);
                expect(connectorBalance).bignumber.gt(dataAfter.connector.lastBalance as any);
            });
            it("should deposit to the connector if total supply increases", async () => {
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 20));
                await savingsContract.methods["depositSavings(uint256)"](deposit);

                await time.increase(ONE_DAY);
                const data = await getData(savingsContract, alice);

                const ts = await time.latest();
                await savingsContract.poke();

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.exchangeRate).bignumber.eq(data.exchangeRate as any);
                assertBNClose(dataAfter.connector.lastPoke, ts, 5);
                expect(dataAfter.connector.balance).bignumber.gte(
                    dataAfter.connector.lastBalance as any,
                );
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(16, 19), "2");
            });
            it("should withdraw from the connector if total supply lowers", async () => {
                await savingsContract.redeemUnderlying(simpleToExactAmount(1, 20));

                await time.increase(ONE_DAY.muln(2));
                const data = await getData(savingsContract, alice);

                await savingsContract.poke();

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.exchangeRate).bignumber.gte(data.exchangeRate as any);
                expect(dataAfter.connector.balance).bignumber.gte(
                    dataAfter.connector.lastBalance as any,
                );
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(8, 19), "2");
            });
            it("should continue to accrue interest", async () => {
                await time.increase(ONE_DAY);
                const data = await getData(savingsContract, alice);

                await savingsContract.poke();

                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.exchangeRate).bignumber.gte(data.exchangeRate as any);
                expect(dataAfter.connector.balance).bignumber.gte(
                    dataAfter.connector.lastBalance as any,
                );
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(8, 19), "2");
            });
            it("allows the connector to be switched to a lending market", async () => {
                await time.increase(ONE_DAY);
                const newConnector = await MockLendingConnector.new(
                    savingsContract.address,
                    masset.address,
                );
                const data = await getData(savingsContract, alice);
                await savingsContract.setConnector(newConnector.address, {
                    from: sa.governor,
                });
                const dataAfter = await getData(savingsContract, alice);
                expect(dataAfter.connector.address).eq(newConnector.address);
                assertBNClosePercent(
                    dataAfter.connector.lastBalance,
                    creditsToUnderlying(
                        dataAfter.balances.totalCredits,
                        dataAfter.exchangeRate,
                    ).divn(5),
                    "0.0001",
                );
                expect(dataAfter.balances.contract).bignumber.gte(data.balances.contract as any);
            });
        });
        context("with no connector", () => {
            const deposit2 = simpleToExactAmount(100, 18);
            const airdrop = simpleToExactAmount(1, 18);
            beforeEach(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit2, alice);
            });
            it("simply updates the exchangeRate using the raw balance", async () => {
                const dataBefore = await getData(savingsContract, alice);
                expect(dataBefore.balances.userCredits).bignumber.eq(
                    underlyingToCredits(deposit2, initialExchangeRate),
                );

                await masset.transfer(savingsContract.address, airdrop);
                const tx = await savingsContract.poke({ from: sa.default });
                expectEvent(tx.receipt, "ExchangeRateUpdated", {
                    newExchangeRate: deposit2
                        .add(airdrop)
                        .mul(fullScale)
                        .div(dataBefore.balances.userCredits.subn(1)),
                    interestCollected: airdrop,
                });
                expectEvent(tx.receipt, "PokedRaw");
                const balanceOfUnderlying = await savingsContract.balanceOfUnderlying(alice);
                expect(balanceOfUnderlying).bignumber.eq(deposit2.add(airdrop));
            });
        });
    });

    describe("testing emergency stop", () => {
        const deposit = simpleToExactAmount(100, 18);
        let dataBefore: Data;
        const expectedRateAfter = initialExchangeRate.divn(10).muln(9);
        before(async () => {
            await createNewSavingsContract();
            const connector = await MockConnector.new(savingsContract.address, masset.address);

            await masset.transfer(bob, simpleToExactAmount(100, 18));
            await masset.approve(savingsContract.address, simpleToExactAmount(1, 21));
            await savingsContract.preDeposit(deposit, alice);

            await savingsContract.setConnector(connector.address, { from: sa.governor });
            dataBefore = await getData(savingsContract, alice);
        });
        afterEach(async () => {
            const data = await getData(savingsContract, alice);
            expect(exchangeRateHolds(data), "exchange rate must hold");
        });
        it("withdraws specific amount from the connector", async () => {
            expect(dataBefore.connector.balance).bignumber.eq(deposit.divn(5));

            const tx = await savingsContract.emergencyWithdraw(simpleToExactAmount(10, 18), {
                from: sa.governor,
            });
            expectEvent(tx.receipt, "ConnectorUpdated", {
                connector: ZERO_ADDRESS,
            });
            expectEvent(tx.receipt, "FractionUpdated", {
                fraction: new BN(0),
            });
            expectEvent(tx.receipt, "EmergencyUpdate");
            expectEvent(tx.receipt, "ExchangeRateUpdated", {
                newExchangeRate: expectedRateAfter,
                interestCollected: new BN(0),
            });

            const dataMiddle = await getData(savingsContract, alice);
            expect(dataMiddle.balances.contract).bignumber.eq(simpleToExactAmount(90, 18));
            expect(dataMiddle.balances.totalCredits).bignumber.eq(dataBefore.balances.totalCredits);
        });
        it("sets fraction and connector to 0", async () => {
            const fraction = await savingsContract.fraction();
            expect(fraction).bignumber.eq(new BN(0));
            const connector = await savingsContract.connector();
            expect(connector).eq(ZERO_ADDRESS);
        });
        it("should lowers exchange rate if necessary", async () => {
            const data = await getData(savingsContract, alice);
            expect(data.exchangeRate).bignumber.eq(expectedRateAfter);

            const balanceOfUnderlying = await savingsContract.balanceOfUnderlying(alice);
            expect(balanceOfUnderlying).bignumber.eq(simpleToExactAmount(90, 18));
        });
        it("should still allow deposits and withdrawals to work", async () => {
            await masset.approve(savingsContract.address, simpleToExactAmount(1, 21), {
                from: bob,
            });
            await savingsContract.methods["depositSavings(uint256)"](deposit, { from: bob });
            const data = await getData(savingsContract, bob);
            expect(data.balances.userCredits).bignumber.eq(
                underlyingToCredits(deposit, expectedRateAfter),
            );

            const balanceOfUnderlying = await savingsContract.balanceOfUnderlying(bob);
            expect(balanceOfUnderlying).bignumber.eq(deposit);

            await savingsContract.redeemCredits(data.balances.userCredits, { from: bob });

            const dataEnd = await getData(savingsContract, bob);
            expect(dataEnd.balances.userCredits).bignumber.eq(new BN(0));
            expect(dataEnd.balances.user).bignumber.eq(data.balances.user.add(deposit));
        });
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
            const stateBefore = await getData(savingsContract, sa.default);
            expect(stateBefore.exchangeRate).to.bignumber.equal(initialExchangeRate);
            expect(stateBefore.balances.contract).to.bignumber.equal(new BN(0));

            // 1.0 user 1 deposits
            // interest remains unassigned and exchange rate unmoved
            await masset.setAmountForCollectInterest(interestToReceive1);
            await time.increase(ONE_DAY);
            await savingsContract.methods["depositSavings(uint256)"](saver1deposit, {
                from: saver1,
            });
            await savingsContract.poke();
            const state1 = await getData(savingsContract, saver1);
            // 2.0 user 2 deposits
            // interest rate benefits user 1 and issued user 2 less credits than desired
            await masset.setAmountForCollectInterest(interestToReceive2);
            await time.increase(ONE_DAY);
            await savingsContract.methods["depositSavings(uint256)"](saver2deposit, {
                from: saver2,
            });
            const state2 = await getData(savingsContract, saver2);
            // 3.0 user 3 deposits
            // interest rate benefits users 1 and 2
            await masset.setAmountForCollectInterest(interestToReceive3);
            await time.increase(ONE_DAY);
            await savingsContract.methods["depositSavings(uint256)"](saver3deposit, {
                from: saver3,
            });
            const state3 = await getData(savingsContract, saver3);
            // 4.0 user 1 withdraws all her credits
            await savingsContract.redeem(state1.balances.userCredits, { from: saver1 });
            const state4 = await getData(savingsContract, saver1);
            expect(state4.balances.userCredits).bignumber.eq(new BN(0));
            expect(state4.balances.totalCredits).bignumber.eq(
                state3.balances.totalCredits.sub(state1.balances.userCredits),
            );
            expect(state4.exchangeRate).bignumber.eq(state3.exchangeRate);
            assertBNClose(
                state4.balances.contract,
                creditsToUnderlying(state4.balances.totalCredits, state4.exchangeRate),
                new BN(100000),
            );
            // 5.0 user 4 deposits
            // interest rate benefits users 2 and 3
            await masset.setAmountForCollectInterest(interestToReceive4);
            await time.increase(ONE_DAY);
            await savingsContract.methods["depositSavings(uint256)"](saver4deposit, {
                from: saver4,
            });
            const state5 = await getData(savingsContract, saver4);
            // 6.0 users 2, 3, and 4 withdraw all their tokens
            await savingsContract.redeemCredits(state2.balances.userCredits, { from: saver2 });
            await savingsContract.redeemCredits(state3.balances.userCredits, { from: saver3 });
            await savingsContract.redeemCredits(state5.balances.userCredits, { from: saver4 });
        });
    });
});
