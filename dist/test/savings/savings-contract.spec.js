"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const assertions_1 = require("@utils/assertions");
const machines_1 = require("@utils/machines");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
const Module_behaviour_1 = require("../shared/Module.behaviour");
const underlyingToCredits = (amount, exchangeRate) => math_1.BN.from(amount).mul(constants_1.fullScale).div(exchangeRate).add(1);
const creditsToUnderlying = (amount, exchangeRate) => amount.mul(exchangeRate).div(constants_1.fullScale);
const getData = async (contract, user) => {
    const mAsset = await (await new generated_1.MockERC20__factory(user.signer)).attach(await contract.underlying());
    const connectorAddress = await contract.connector();
    let connectorBalance = math_1.BN.from(0);
    if (connectorAddress !== constants_1.ZERO_ADDRESS) {
        const connector = await (await new generated_1.MockConnector__factory(user.signer)).attach(connectorAddress);
        connectorBalance = await connector.checkBalance();
    }
    return {
        balances: {
            totalCredits: await contract.totalSupply(),
            userCredits: await contract.balanceOf(user.address),
            user: await mAsset.balanceOf(user.address),
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
const getExpectedPoke = (data, withdrawCredits = math_1.BN.from(0)) => {
    const { balances, connector, exchangeRate } = data;
    const totalCollat = creditsToUnderlying(balances.totalCredits.sub(withdrawCredits), exchangeRate);
    const connectorDerived = balances.contract.gt(totalCollat) ? math_1.BN.from(0) : totalCollat.sub(balances.contract);
    const max = totalCollat.mul(connector.fraction.add(math_1.simpleToExactAmount(2, 17))).div(constants_1.fullScale);
    const ideal = totalCollat.mul(connector.fraction).div(constants_1.fullScale);
    return {
        aboveMax: connectorDerived.gt(max),
        type: connector.balance.eq(ideal) ? "none" : connector.balance.gt(ideal) ? "withdraw" : "deposit",
        amount: connector.balance.gte(ideal) ? connector.balance.sub(ideal) : ideal.sub(connector.balance),
        ideal,
    };
};
const getTimestamp = async () => (await hardhat_1.ethers.provider.getBlock(await hardhat_1.ethers.provider.getBlockNumber())).timestamp;
/**
 * @notice Returns bool to signify whether the total collateral held is redeemable
 */
const exchangeRateHolds = (data) => {
    const { balances, connector, exchangeRate } = data;
    const collateral = balances.contract.add(connector.balance);
    return collateral.gte(creditsToUnderlying(balances.totalCredits, exchangeRate));
};
describe("SavingsContract", async () => {
    let sa;
    let manager;
    let alice;
    let bob;
    const ctx = {};
    const initialExchangeRate = math_1.simpleToExactAmount(1, 17);
    let mAssetMachine;
    let savingsContract;
    let savingsFactory;
    let connectorFactory;
    let nexus;
    let masset;
    const createNewSavingsContract = async () => {
        // Use a mock Nexus so we can dictate addresses
        nexus = await (await new generated_1.MockNexus__factory(sa.default.signer)).deploy(sa.governor.address, manager.address, constants_1.DEAD_ADDRESS);
        // Use a mock mAsset so we can dictate the interest generated
        masset = await (await new generated_1.MockMasset__factory(sa.default.signer)).deploy("MOCK", "MOCK", 18, sa.default.address, 1000000000);
        savingsFactory = await new generated_1.SavingsContract__factory(sa.default.signer);
        const impl = await savingsFactory.deploy(nexus.address, masset.address);
        const data = impl.interface.encodeFunctionData("initialize", [sa.default.address, "Savings Credit", "imUSD"]);
        const proxy = await (await new generated_1.AssetProxy__factory(sa.default.signer)).deploy(impl.address, sa.dummy4.address, data);
        savingsContract = await savingsFactory.attach(proxy.address);
        // Use a mock SavingsManager so we don't need to run integrations
        const mockSavingsManager = await (await new generated_1.MockSavingsManager__factory(sa.default.signer)).deploy(savingsContract.address);
        await nexus.setSavingsManager(mockSavingsManager.address);
    };
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        manager = sa.dummy2;
        alice = sa.default;
        bob = sa.dummy3;
        connectorFactory = await new generated_1.MockConnector__factory(sa.default.signer);
        await createNewSavingsContract();
    });
    describe("behaviors", async () => {
        describe("behave like a Module", async () => {
            beforeEach(async () => {
                await createNewSavingsContract();
                ctx.module = savingsContract;
                ctx.sa = sa;
            });
            Module_behaviour_1.shouldBehaveLikeModule(ctx);
        });
    });
    describe("constructor", async () => {
        it("should fail when masset address is zero", async () => {
            await chai_1.expect(savingsFactory.deploy(nexus.address, constants_1.ZERO_ADDRESS)).to.be.revertedWith("mAsset address is zero");
            savingsContract = await savingsFactory.deploy(nexus.address, masset.address);
            await chai_1.expect(savingsContract.initialize(constants_1.ZERO_ADDRESS, "Savings Credit", "imUSD")).to.be.revertedWith("Invalid poker address");
        });
        it("should succeed and set valid parameters", async () => {
            await createNewSavingsContract();
            const nexusAddr = await savingsContract.nexus();
            chai_1.expect(nexus.address).to.equal(nexusAddr);
            const pokerAddr = await savingsContract.poker();
            chai_1.expect(sa.default.address).to.equal(pokerAddr);
            const { balances, exchangeRate, connector } = await getData(savingsContract, sa.default);
            chai_1.expect(math_1.simpleToExactAmount(2, 17)).to.equal(connector.fraction);
            const underlyingAddr = await savingsContract.underlying();
            chai_1.expect(masset.address).to.equal(underlyingAddr);
            chai_1.expect(constants_1.ZERO).to.equal(balances.totalCredits);
            chai_1.expect(constants_1.ZERO).to.equal(balances.contract);
            chai_1.expect(initialExchangeRate).to.equal(exchangeRate);
            const name = await savingsContract.name();
            chai_1.expect("Savings Credit").to.equal(name);
        });
    });
    describe("setting automateInterestCollection Flag", async () => {
        it("should fail when not called by governor", async () => {
            await chai_1.expect(savingsContract.connect(sa.default.signer).automateInterestCollectionFlag(true)).to.be.revertedWith("Only governor can execute");
        });
        it("should enable interest collection", async () => {
            const tx = savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(true);
            await chai_1.expect(tx).to.emit(savingsContract, "AutomaticInterestCollectionSwitched").withArgs(true);
        });
        it("should disable interest collection", async () => {
            const tx = savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(false);
            await chai_1.expect(tx).to.emit(savingsContract, "AutomaticInterestCollectionSwitched").withArgs(false);
        });
    });
    describe("depositing interest", async () => {
        let savingsManagerAccount;
        beforeEach(async () => {
            savingsManagerAccount = sa.dummy3;
            await createNewSavingsContract();
            await nexus.setSavingsManager(savingsManagerAccount.address);
            await masset.transfer(savingsManagerAccount.address, math_1.simpleToExactAmount(20, 18));
            await masset.connect(savingsManagerAccount.signer).approve(savingsContract.address, math_1.simpleToExactAmount(20, 18));
        });
        afterEach(async () => {
            const data = await getData(savingsContract, alice);
            chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
        });
        it("should fail when not called by savings manager", async () => {
            await chai_1.expect(savingsContract.connect(sa.other.signer).depositInterest(1)).to.be.revertedWith("Only savings manager can execute");
        });
        it("should fail when amount is zero", async () => {
            await chai_1.expect(savingsContract.connect(savingsManagerAccount.signer).depositInterest(constants_1.ZERO)).to.be.revertedWith("Must deposit something");
        });
        it("should deposit interest when no credits", async () => {
            const before = await getData(savingsContract, sa.default);
            const deposit = math_1.simpleToExactAmount(1, 18);
            await savingsContract.connect(savingsManagerAccount.signer).depositInterest(deposit);
            const after = await getData(savingsContract, sa.default);
            chai_1.expect(deposit).to.equal(after.balances.contract);
            chai_1.expect(before.balances.contract.add(deposit)).to.equal(after.balances.contract);
            // exchangeRate should not change
            chai_1.expect(before.exchangeRate).to.equal(after.exchangeRate);
        });
        it("should deposit interest when some credits exist", async () => {
            const interest = math_1.simpleToExactAmount(20, 18);
            const deposit = math_1.simpleToExactAmount(10, 18);
            // Deposit to SavingsContract
            await masset.approve(savingsContract.address, deposit);
            await savingsContract.preDeposit(deposit, sa.default.address);
            const balanceBefore = await masset.balanceOf(savingsContract.address);
            // Deposit Interest
            const tx = savingsContract.connect(savingsManagerAccount.signer).depositInterest(interest);
            // Expected rate = 1e17 + (20e18 / (100e18+1))
            // Expected rate = 1e17 + 2e17-1
            const expectedExchangeRate = math_1.simpleToExactAmount(3, 17);
            await chai_1.expect(tx).to.emit(savingsContract, "ExchangeRateUpdated").withArgs(expectedExchangeRate, interest);
            // await tx.wait()
            const dataAfter = await getData(savingsContract, sa.default);
            chai_1.expect(balanceBefore.add(interest)).to.equal(dataAfter.balances.contract);
            chai_1.expect(expectedExchangeRate).to.equal(dataAfter.exchangeRate);
        });
    });
    describe("depositing savings", async () => {
        context("using preDeposit", async () => {
            before(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
                // This amount should not be collected
                await masset.setAmountForCollectInterest(math_1.simpleToExactAmount(100, 18));
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should not collect interest or affect the exchangeRate", async () => {
                const dataBefore = await getData(savingsContract, sa.default);
                const deposit = math_1.simpleToExactAmount(10, 18);
                const tx = savingsContract.preDeposit(deposit, sa.default.address);
                await chai_1.expect(tx)
                    .to.emit(savingsContract, "SavingsDeposited")
                    .withArgs(sa.default.address, deposit, underlyingToCredits(deposit, dataBefore.exchangeRate));
                const dataAfter = await getData(savingsContract, sa.default);
                chai_1.expect(dataAfter.exchangeRate).eq(initialExchangeRate);
                chai_1.expect(dataAfter.balances.totalCredits).eq(underlyingToCredits(deposit, dataBefore.exchangeRate));
                // Should only receive the deposited, and not collect from the manager
                chai_1.expect(dataAfter.balances.contract).eq(deposit);
            });
            it("allows multiple preDeposits", async () => {
                await savingsContract.preDeposit(math_1.simpleToExactAmount(1, 18), sa.default.address);
                await savingsContract.preDeposit(math_1.simpleToExactAmount(1, 18), sa.default.address);
                await savingsContract.preDeposit(math_1.simpleToExactAmount(1, 18), sa.default.address);
                await savingsContract.preDeposit(math_1.simpleToExactAmount(1, 18), sa.default.address);
            });
            it("should fail after exchange rate updates", async () => {
                // 1. Now there is more collateral than credits
                await savingsContract["depositSavings(uint256)"](math_1.simpleToExactAmount(1, 18));
                await savingsContract.poke();
                const exchangeRate = await savingsContract.exchangeRate();
                chai_1.expect(exchangeRate).gt(initialExchangeRate);
                // 2. preDeposit should no longer work
                await chai_1.expect(savingsContract.preDeposit(math_1.BN.from(1), sa.default.address)).to.be.revertedWith("Can only use this method before streaming begins");
            });
        });
        context("using depositSavings", async () => {
            before(async () => {
                await createNewSavingsContract();
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should fail when amount is zero", async () => {
                await chai_1.expect(savingsContract["depositSavings(uint256)"](constants_1.ZERO)).to.be.revertedWith("Must deposit something");
            });
            it("should fail when beneficiary is 0", async () => {
                await chai_1.expect(savingsContract["depositSavings(uint256,address)"](1, constants_1.ZERO_ADDRESS)).to.be.revertedWith("Invalid beneficiary address");
            });
            it("should fail if the user has no balance", async () => {
                // Approve first
                await masset.connect(sa.dummy1.signer).approve(savingsContract.address, math_1.simpleToExactAmount(1, 18));
                // Deposit
                await chai_1.expect(savingsContract.connect(sa.dummy1.signer)["depositSavings(uint256)"](math_1.simpleToExactAmount(1, 18))).to.be.revertedWith("VM Exception");
            });
            it("should deposit the mUSD and assign credits to the saver", async () => {
                const dataBefore = await getData(savingsContract, sa.default);
                const depositAmount = math_1.simpleToExactAmount(1, 18);
                // 1. Approve the savings contract to spend mUSD
                await masset.approve(savingsContract.address, depositAmount);
                // 2. Deposit the mUSD
                const tx = savingsContract["depositSavings(uint256)"](depositAmount);
                const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate);
                await chai_1.expect(tx).to.emit(savingsContract, "SavingsDeposited").withArgs(sa.default.address, depositAmount, expectedCredits);
                const dataAfter = await getData(savingsContract, sa.default);
                chai_1.expect(dataAfter.balances.userCredits).eq(expectedCredits, "Must receive some savings credits");
                chai_1.expect(dataAfter.balances.totalCredits).eq(expectedCredits);
                chai_1.expect(dataAfter.balances.user).eq(dataBefore.balances.user.sub(depositAmount));
                chai_1.expect(dataAfter.balances.contract).eq(math_1.simpleToExactAmount(1, 18));
            });
            it("allows alice to deposit to beneficiary (bob.address)", async () => {
                const dataBefore = await getData(savingsContract, bob);
                const depositAmount = math_1.simpleToExactAmount(1, 18);
                await masset.approve(savingsContract.address, depositAmount);
                const tx = savingsContract.connect(alice.signer)["depositSavings(uint256,address)"](depositAmount, bob.address);
                const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate);
                await chai_1.expect(tx).to.emit(savingsContract, "SavingsDeposited").withArgs(bob.address, depositAmount, expectedCredits);
                const dataAfter = await getData(savingsContract, bob);
                chai_1.expect(dataAfter.balances.userCredits).eq(expectedCredits, "Must receive some savings credits");
                chai_1.expect(dataAfter.balances.totalCredits).eq(expectedCredits.mul(2));
                chai_1.expect(dataAfter.balances.user).eq(dataBefore.balances.user);
                chai_1.expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.add(math_1.simpleToExactAmount(1, 18)));
            });
            context("when there is some interest to collect from the manager", async () => {
                const deposit = math_1.simpleToExactAmount(10, 18);
                const interest = math_1.simpleToExactAmount(10, 18);
                before(async () => {
                    await createNewSavingsContract();
                    await masset.approve(savingsContract.address, deposit);
                });
                afterEach(async () => {
                    const data = await getData(savingsContract, alice);
                    chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
                });
                it("should collect the interest and update the exchange rate before issuance", async () => {
                    // Get the total balances
                    const stateBefore = await getData(savingsContract, alice);
                    chai_1.expect(stateBefore.exchangeRate).to.equal(initialExchangeRate);
                    // Deposit first to get some savings in the basket
                    await savingsContract["depositSavings(uint256)"](deposit);
                    const stateMiddle = await getData(savingsContract, alice);
                    chai_1.expect(stateMiddle.exchangeRate).to.equal(initialExchangeRate);
                    chai_1.expect(stateMiddle.balances.contract).to.equal(deposit);
                    chai_1.expect(stateMiddle.balances.totalCredits).to.equal(underlyingToCredits(deposit, initialExchangeRate));
                    // Set up the mAsset with some interest
                    await masset.setAmountForCollectInterest(interest);
                    await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
                    await hardhat_1.ethers.provider.send("evm_mine", []);
                    // Bob deposits into the contract
                    await masset.transfer(bob.address, deposit);
                    await masset.connect(bob.signer).approve(savingsContract.address, deposit);
                    const tx = savingsContract.connect(bob.signer)["depositSavings(uint256)"](deposit);
                    // Bob collects interest, to the benefit of Alice
                    // Expected rate = 1e17 + 1e17-1
                    const expectedExchangeRate = math_1.simpleToExactAmount(2, 17);
                    await chai_1.expect(tx).to.emit(savingsContract, "ExchangeRateUpdated").withArgs(expectedExchangeRate, interest);
                    // Alice gets the benefit of the new exchange rate
                    const stateEnd = await getData(savingsContract, alice);
                    chai_1.expect(stateEnd.exchangeRate).eq(expectedExchangeRate);
                    chai_1.expect(stateEnd.balances.contract).eq(deposit.mul(3));
                    const aliceBalance = await savingsContract.balanceOfUnderlying(alice.address);
                    chai_1.expect(math_1.simpleToExactAmount(20, 18)).eq(aliceBalance);
                    // Bob gets credits at the NEW exchange rate
                    const bobData = await getData(savingsContract, bob);
                    chai_1.expect(bobData.balances.userCredits).eq(underlyingToCredits(deposit, stateEnd.exchangeRate));
                    chai_1.expect(stateEnd.balances.totalCredits).eq(bobData.balances.userCredits.add(stateEnd.balances.userCredits));
                    const bobBalance = await savingsContract.balanceOfUnderlying(bob.address);
                    chai_1.expect(bobBalance).eq(deposit);
                    chai_1.expect(bobBalance.add(aliceBalance)).eq(deposit.mul(3), "Individual balances cannot exceed total");
                    chai_1.expect(exchangeRateHolds(stateEnd), "Exchange rate must hold");
                });
            });
        });
    });
    describe("checking the view methods", () => {
        const aliceCredits = math_1.simpleToExactAmount(100, 18).add(1);
        const aliceUnderlying = math_1.simpleToExactAmount(20, 18);
        const bobCredits = math_1.simpleToExactAmount(50, 18).add(1);
        const bobUnderlying = math_1.simpleToExactAmount(10, 18);
        let data;
        before(async () => {
            await createNewSavingsContract();
            await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
            await savingsContract.preDeposit(math_1.simpleToExactAmount(10, 18), alice.address);
            await masset.setAmountForCollectInterest(math_1.simpleToExactAmount(10, 18));
            await savingsContract["depositSavings(uint256,address)"](math_1.simpleToExactAmount(10, 18), bob.address);
            data = await getData(savingsContract, alice);
            const bobData = await getData(savingsContract, bob);
            chai_1.expect(data.balances.userCredits).eq(aliceCredits);
            chai_1.expect(creditsToUnderlying(aliceCredits, data.exchangeRate)).eq(aliceUnderlying);
            chai_1.expect(bobData.balances.userCredits).eq(bobCredits);
            chai_1.expect(creditsToUnderlying(bobCredits, bobData.exchangeRate)).eq(bobUnderlying);
        });
        it("should return correct balances as local checks", async () => {
            const aliceBoU = await savingsContract.balanceOfUnderlying(alice.address);
            chai_1.expect(aliceBoU).eq(aliceUnderlying);
            const bobBoU = await savingsContract.balanceOfUnderlying(bob.address);
            chai_1.expect(bobBoU).eq(bobUnderlying);
            const otherBoU = await savingsContract.balanceOfUnderlying(sa.other.address);
            chai_1.expect(otherBoU).eq(math_1.BN.from(0));
        });
        it("should return same result in balanceOfUnderlying and creditsToUnderlying(balanceOf(user))", async () => {
            const aliceBoU = await savingsContract.balanceOfUnderlying(alice.address);
            const aliceC = await savingsContract.creditsToUnderlying(await savingsContract.balanceOf(alice.address));
            chai_1.expect(aliceBoU).eq(aliceC);
            const bobBou = await savingsContract.balanceOfUnderlying(bob.address);
            const bobC = await savingsContract.creditsToUnderlying(await savingsContract.balanceOf(bob.address));
            chai_1.expect(bobBou).eq(bobC);
        });
        it("should return same result in creditBalances and balanceOf", async () => {
            const aliceCB = await savingsContract.creditBalances(alice.address);
            const aliceB = await savingsContract.balanceOf(alice.address);
            chai_1.expect(aliceCB).eq(aliceB);
            const bobCB = await savingsContract.creditBalances(bob.address);
            const bobB = await savingsContract.balanceOf(bob.address);
            chai_1.expect(bobCB).eq(bobB);
            const otherCB = await savingsContract.creditBalances(sa.other.address);
            const otherB = await savingsContract.balanceOf(sa.other.address);
            chai_1.expect(otherCB).eq(math_1.BN.from(0));
            chai_1.expect(otherB).eq(math_1.BN.from(0));
        });
        it("should calculate back and forth correctly", async () => {
            // underlyingToCredits
            const uToC = await savingsContract.underlyingToCredits(math_1.simpleToExactAmount(1, 18));
            chai_1.expect(uToC).eq(underlyingToCredits(math_1.simpleToExactAmount(1, 18), data.exchangeRate));
            chai_1.expect(await savingsContract.creditsToUnderlying(uToC)).eq(math_1.simpleToExactAmount(1, 18));
            const uToC2 = await savingsContract.underlyingToCredits(1);
            chai_1.expect(uToC2).eq(underlyingToCredits(1, data.exchangeRate));
            chai_1.expect(await savingsContract.creditsToUnderlying(uToC2)).eq(math_1.BN.from(1));
            const uToC3 = await savingsContract.underlyingToCredits(0);
            chai_1.expect(uToC3).eq(math_1.BN.from(1));
            chai_1.expect(await savingsContract.creditsToUnderlying(uToC3)).eq(math_1.BN.from(0));
            const uToC4 = await savingsContract.underlyingToCredits(12986123876);
            chai_1.expect(uToC4).eq(underlyingToCredits(12986123876, data.exchangeRate));
            chai_1.expect(await savingsContract.creditsToUnderlying(uToC4)).eq(math_1.BN.from(12986123876));
        });
    });
    describe("redeeming", async () => {
        before(async () => {
            await createNewSavingsContract();
        });
        it("should fail when input is zero", async () => {
            await chai_1.expect(savingsContract.redeem(constants_1.ZERO)).to.be.revertedWith("Must withdraw something");
            await chai_1.expect(savingsContract.redeemCredits(constants_1.ZERO)).to.be.revertedWith("Must withdraw something");
            await chai_1.expect(savingsContract.redeemUnderlying(constants_1.ZERO)).to.be.revertedWith("Must withdraw something");
        });
        it("should fail when user doesn't have credits", async () => {
            const amt = math_1.BN.from(10);
            await chai_1.expect(savingsContract.connect(sa.other.signer).redeem(amt)).to.be.revertedWith("VM Exception");
            await chai_1.expect(savingsContract.connect(sa.other.signer).redeemCredits(amt)).to.be.revertedWith("VM Exception");
            await chai_1.expect(savingsContract.connect(sa.other.signer).redeemUnderlying(amt)).to.be.revertedWith("VM Exception");
        });
        context("using redeemCredits", async () => {
            const deposit = math_1.simpleToExactAmount(10, 18);
            const credits = underlyingToCredits(deposit, initialExchangeRate);
            const interest = math_1.simpleToExactAmount(10, 18);
            beforeEach(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice.address);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            // test the balance calcs here.. credit to masset, and public calcs
            it("should redeem a specific amount of credits", async () => {
                // calculates underlying/credits
                const creditsToWithdraw = math_1.simpleToExactAmount(5, 18);
                const expectedWithdrawal = creditsToUnderlying(creditsToWithdraw, initialExchangeRate);
                const dataBefore = await getData(savingsContract, alice);
                const tx = savingsContract.redeemCredits(creditsToWithdraw);
                await chai_1.expect(tx).to.emit(savingsContract, "CreditsRedeemed").withArgs(alice.address, creditsToWithdraw, expectedWithdrawal);
                // await tx.wait()
                const dataAfter = await getData(savingsContract, alice);
                // burns credits from sender
                chai_1.expect(dataAfter.balances.userCredits).eq(dataBefore.balances.userCredits.sub(creditsToWithdraw));
                chai_1.expect(dataAfter.balances.totalCredits).eq(dataBefore.balances.totalCredits.sub(creditsToWithdraw));
                // transfers tokens to sender
                chai_1.expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(expectedWithdrawal));
                chai_1.expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.sub(expectedWithdrawal));
            });
            it("collects interest and credits to saver before redemption", async () => {
                const expectedExchangeRate = math_1.simpleToExactAmount(2, 17);
                await masset.setAmountForCollectInterest(interest);
                const dataBefore = await getData(savingsContract, alice);
                await savingsContract.redeemCredits(credits);
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.balances.totalCredits).eq(math_1.BN.from(0));
                // User receives their deposit back + interest
                assertions_1.assertBNClose(dataAfter.balances.user, dataBefore.balances.user.add(deposit).add(interest), 100);
                // Exchange rate updates
                chai_1.expect(dataAfter.exchangeRate).eq(expectedExchangeRate);
            });
        });
        context("using redeemUnderlying", async () => {
            const deposit = math_1.simpleToExactAmount(10, 18);
            const interest = math_1.simpleToExactAmount(10, 18);
            beforeEach(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice.address);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("allows full redemption immediately after deposit", async () => {
                await savingsContract.redeemUnderlying(deposit);
                const data = await getData(savingsContract, alice);
                chai_1.expect(data.balances.userCredits).eq(math_1.BN.from(0));
            });
            it("should redeem a specific amount of underlying", async () => {
                // calculates underlying/credits
                const underlying = math_1.simpleToExactAmount(5, 18);
                const expectedCredits = underlyingToCredits(underlying, initialExchangeRate);
                const dataBefore = await getData(savingsContract, alice);
                const tx = savingsContract.redeemUnderlying(underlying);
                await chai_1.expect(tx).to.emit(savingsContract, "CreditsRedeemed").withArgs(alice.address, expectedCredits, underlying);
                const dataAfter = await getData(savingsContract, alice);
                // burns credits from sender
                chai_1.expect(dataAfter.balances.userCredits).eq(dataBefore.balances.userCredits.sub(expectedCredits));
                chai_1.expect(dataAfter.balances.totalCredits).eq(dataBefore.balances.totalCredits.sub(expectedCredits));
                // transfers tokens to sender
                chai_1.expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(underlying));
                chai_1.expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.sub(underlying));
            });
            it("collects interest and credits to saver before redemption", async () => {
                const expectedExchangeRate = math_1.simpleToExactAmount(2, 17);
                await masset.setAmountForCollectInterest(interest);
                const dataBefore = await getData(savingsContract, alice);
                await savingsContract.redeemUnderlying(deposit);
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(deposit));
                // User is left with resulting credits due to exchange rate going up
                assertions_1.assertBNClose(dataAfter.balances.userCredits, dataBefore.balances.userCredits.div(2), 1000);
                // Exchange rate updates
                chai_1.expect(dataAfter.exchangeRate).eq(expectedExchangeRate);
            });
            it("skips interest collection if automate is turned off", async () => {
                await masset.setAmountForCollectInterest(interest);
                await savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(false);
                const dataBefore = await getData(savingsContract, alice);
                await savingsContract.redeemUnderlying(deposit);
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(deposit));
                chai_1.expect(dataAfter.balances.userCredits).eq(math_1.BN.from(0));
                chai_1.expect(dataAfter.exchangeRate).eq(dataBefore.exchangeRate);
            });
        });
        context("with a connector that surpasses limit", async () => {
            const deposit = math_1.simpleToExactAmount(100, 18);
            const redemption = underlyingToCredits(math_1.simpleToExactAmount(51, 18), initialExchangeRate);
            before(async () => {
                await createNewSavingsContract();
                const connector = await (await new generated_1.MockConnector__factory(sa.default.signer)).deploy(savingsContract.address, masset.address);
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice.address);
                await savingsContract.connect(sa.governor.signer).setConnector(connector.address);
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_HOUR.mul(4).add(1).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                chai_1.expect(data.connector.balance).eq(deposit.mul(data.connector.fraction).div(constants_1.fullScale));
                chai_1.expect(data.balances.contract).eq(deposit.sub(data.connector.balance));
                chai_1.expect(data.exchangeRate).eq(initialExchangeRate);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("triggers poke and deposits to connector if the threshold is hit", async () => {
                // in order to reach 40%, must redeem > 51
                const dataBefore = await getData(savingsContract, alice);
                const poke = await getExpectedPoke(dataBefore, redemption);
                const tx = savingsContract.redeemCredits(redemption);
                await chai_1.expect(tx)
                    .to.emit(savingsContract, "CreditsRedeemed")
                    .withArgs(alice.address, redemption, math_1.simpleToExactAmount(51, 18));
                // Remaining balance is 49, with 20 in the connector
                await chai_1.expect(tx).to.emit(savingsContract, "Poked").withArgs(dataBefore.connector.balance, poke.ideal, math_1.BN.from(0));
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.balances.contract).eq(math_1.simpleToExactAmount("39.2", 18));
            });
            it("errors if triggered again within 4h", async () => { });
        });
        context("using redeem (depcrecated)", async () => {
            beforeEach(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(10, 18));
                await savingsContract["depositSavings(uint256)"](math_1.simpleToExactAmount(1, 18));
            });
            it("should redeem when user has balance", async () => {
                const redemptionAmount = math_1.simpleToExactAmount(5, 18);
                const balancesBefore = await getData(savingsContract, sa.default);
                const tx = savingsContract.redeem(redemptionAmount);
                const exchangeRate = initialExchangeRate;
                const underlying = creditsToUnderlying(redemptionAmount, exchangeRate);
                await chai_1.expect(tx).to.emit(savingsContract, "CreditsRedeemed").withArgs(sa.default.address, redemptionAmount, underlying);
                const dataAfter = await getData(savingsContract, sa.default);
                chai_1.expect(balancesBefore.balances.contract.sub(underlying)).to.equal(dataAfter.balances.contract);
                chai_1.expect(balancesBefore.balances.user.add(underlying)).to.equal(dataAfter.balances.user);
            });
            it("should withdraw the mUSD and burn the credits", async () => {
                const redemptionAmount = math_1.simpleToExactAmount(1, 18);
                const creditsBefore = await savingsContract.creditBalances(sa.default.address);
                const mUSDBefore = await masset.balanceOf(sa.default.address);
                // Redeem all the credits
                await savingsContract.redeem(creditsBefore);
                const creditsAfter = await savingsContract.creditBalances(sa.default.address);
                const mUSDAfter = await masset.balanceOf(sa.default.address);
                chai_1.expect(creditsAfter, "Must burn all the credits").eq(math_1.BN.from(0));
                chai_1.expect(mUSDAfter, "Must receive back mUSD").eq(mUSDBefore.add(redemptionAmount));
            });
        });
    });
    describe("setting poker", () => {
        before(async () => {
            await createNewSavingsContract();
        });
        it("fails if not called by governor", async () => {
            await chai_1.expect(savingsContract.connect(sa.dummy1.signer).setPoker(sa.dummy1.address)).to.be.revertedWith("Only governor can execute");
        });
        it("fails if invalid poker address", async () => {
            await chai_1.expect(savingsContract.connect(sa.governor.signer).setPoker(sa.default.address)).to.be.revertedWith("Invalid poker");
        });
        it("allows governance to set a new poker", async () => {
            const tx = savingsContract.connect(sa.governor.signer).setPoker(sa.dummy1.address);
            await chai_1.expect(tx).to.emit(savingsContract, "PokerUpdated").withArgs(sa.dummy1.address);
            chai_1.expect(await savingsContract.poker()).eq(sa.dummy1.address);
        });
    });
    describe("setting fraction", () => {
        before(async () => {
            await createNewSavingsContract();
            await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 18));
            await savingsContract.preDeposit(math_1.simpleToExactAmount(1, 18), sa.default.address);
        });
        it("fails if not called by governor", async () => {
            await chai_1.expect(savingsContract.connect(sa.dummy1.signer).setFraction(math_1.simpleToExactAmount(1, 17))).to.be.revertedWith("Only governor can execute");
        });
        it("fails if over the threshold", async () => {
            await chai_1.expect(savingsContract.connect(sa.governor.signer).setFraction(math_1.simpleToExactAmount(55, 16))).to.be.revertedWith("Fraction must be <= 50%");
        });
        it("sets a new fraction and pokes", async () => {
            const tx = savingsContract.connect(sa.governor.signer).setFraction(math_1.simpleToExactAmount(1, 16));
            await chai_1.expect(tx).to.emit(savingsContract, "FractionUpdated").withArgs(math_1.simpleToExactAmount(1, 16));
            await chai_1.expect(tx).to.emit(savingsContract, "PokedRaw");
            chai_1.expect(await savingsContract.fraction()).eq(math_1.simpleToExactAmount(1, 16));
        });
    });
    describe("setting connector", () => {
        const deposit = math_1.simpleToExactAmount(100, 18);
        beforeEach(async () => {
            await createNewSavingsContract();
            const connector = await connectorFactory.deploy(savingsContract.address, masset.address);
            await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
            await savingsContract.preDeposit(deposit, alice.address);
            await savingsContract.connect(sa.governor.signer).setConnector(connector.address);
        });
        afterEach(async () => {
            const data = await getData(savingsContract, alice);
            chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
        });
        it("fails if not called by governor", async () => {
            await chai_1.expect(savingsContract.connect(sa.dummy1.signer).setConnector(sa.dummy1.address)).to.be.revertedWith("Only governor can execute");
        });
        it("updates the connector address, moving assets to new connector", async () => {
            const dataBefore = await getData(savingsContract, alice);
            chai_1.expect(dataBefore.connector.balance).eq(deposit.mul(dataBefore.connector.fraction).div(constants_1.fullScale));
            chai_1.expect(dataBefore.balances.contract).eq(deposit.sub(dataBefore.connector.balance));
            chai_1.expect(dataBefore.exchangeRate).eq(initialExchangeRate);
            const newConnector = await connectorFactory.deploy(savingsContract.address, masset.address);
            const tx = savingsContract.connect(sa.governor.signer).setConnector(newConnector.address);
            await chai_1.expect(tx).to.emit(savingsContract, "ConnectorUpdated").withArgs(newConnector.address);
            const dataAfter = await getData(savingsContract, alice);
            chai_1.expect(dataAfter.connector.address).eq(newConnector.address);
            chai_1.expect(dataAfter.connector.balance).eq(dataBefore.connector.balance);
            const oldConnector = await connectorFactory.attach(dataBefore.connector.address);
            chai_1.expect(await oldConnector.checkBalance()).eq(math_1.BN.from(0));
        });
        it("withdraws everything if connector is set to 0", async () => {
            const dataBefore = await getData(savingsContract, alice);
            const tx = savingsContract.connect(sa.governor.signer).setConnector(constants_1.ZERO_ADDRESS);
            await chai_1.expect(tx).to.emit(savingsContract, "ConnectorUpdated").withArgs(constants_1.ZERO_ADDRESS);
            const dataAfter = await getData(savingsContract, alice);
            chai_1.expect(dataAfter.connector.address).eq(constants_1.ZERO_ADDRESS);
            chai_1.expect(dataAfter.connector.balance).eq(math_1.BN.from(0));
            chai_1.expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.add(dataBefore.connector.balance));
        });
    });
    describe("poking", () => {
        const deposit = math_1.simpleToExactAmount(1, 20);
        before(async () => {
            await createNewSavingsContract();
        });
        it("allows only poker to poke", async () => {
            await chai_1.expect(savingsContract.connect(sa.governor.signer).poke()).to.be.revertedWith("Only poker can execute");
        });
        it("fails if there are no credits", async () => {
            const credits = await savingsContract.totalSupply();
            chai_1.expect(credits).eq(math_1.BN.from(0));
            await chai_1.expect(savingsContract.connect(sa.default.signer).poke()).to.be.revertedWith("Must have something to poke");
        });
        it("only allows pokes once every 4h", async () => {
            await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
            await savingsContract.preDeposit(deposit, alice.address);
            await savingsContract.poke();
            await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_HOUR.mul(3).toNumber()]);
            await hardhat_1.ethers.provider.send("evm_mine", []);
            await chai_1.expect(savingsContract.connect(sa.default.signer).poke()).to.be.revertedWith("Not enough time elapsed");
        });
        context("with an erroneous connector", () => {
            beforeEach(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice.address);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should fail if the raw balance goes down somehow", async () => {
                const connector = await (await new generated_1.MockErroneousConnector1__factory(sa.default.signer)).deploy(savingsContract.address, masset.address);
                await savingsContract.connect(sa.governor.signer).setConnector(connector.address);
                // Total collat goes down
                await savingsContract.redeemUnderlying(deposit.div(2));
                // Withdrawal is made but nothing comes back
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_HOUR.mul(6).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                await savingsContract.poke();
                // Try that again
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_HOUR.mul(12).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                await chai_1.expect(savingsContract.poke()).to.be.revertedWith("ExchangeRate must increase");
            });
            it("is protected by the system invariant", async () => {
                // connector returns invalid balance after withdrawal
                const connector = await (await new generated_1.MockErroneousConnector2__factory(sa.default.signer)).deploy(savingsContract.address, masset.address);
                await savingsContract.connect(sa.governor.signer).setConnector(connector.address);
                await savingsContract.redeemUnderlying(deposit.div(2));
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_HOUR.mul(4).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                await chai_1.expect(savingsContract.poke()).to.be.revertedWith("Enforce system invariant");
            });
            it("should fail if the balance has gone down", async () => {
                const connector = await (await new generated_1.MockErroneousConnector2__factory(sa.default.signer)).deploy(savingsContract.address, masset.address);
                await savingsContract.connect(sa.governor.signer).setConnector(connector.address);
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_HOUR.mul(4).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                await connector.poke();
                await chai_1.expect(savingsContract.poke()).to.be.revertedWith("Invalid yield");
            });
        });
        context("with a lending market connector", () => {
            let connector;
            before(async () => {
                await createNewSavingsContract();
                connector = await (await new generated_1.MockLendingConnector__factory(sa.default.signer)).deploy(savingsContract.address, masset.address);
                // Give mock some extra assets to allow inflation
                await masset.transfer(connector.address, math_1.simpleToExactAmount(100, 18));
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice.address);
                // Set up connector
                await savingsContract.connect(sa.governor.signer).setFraction(0);
                await savingsContract.connect(sa.governor.signer).setConnector(connector.address);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should do nothing if the fraction is 0", async () => {
                const data = await getData(savingsContract, alice);
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_HOUR.mul(4).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const tx = savingsContract.poke();
                await chai_1.expect(tx).to.emit(savingsContract, "Poked").withArgs(math_1.BN.from(0), math_1.BN.from(0), math_1.BN.from(0));
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.balances.contract).eq(data.balances.contract);
                chai_1.expect(dataAfter.exchangeRate).eq(data.exchangeRate);
            });
            it("should poke when fraction is set", async () => {
                const tx = savingsContract.connect(sa.governor.signer).setFraction(math_1.simpleToExactAmount(2, 17));
                await chai_1.expect(tx).to.emit(savingsContract, "Poked").withArgs(math_1.BN.from(0), math_1.simpleToExactAmount(2, 19), math_1.BN.from(0));
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.balances.contract).eq(math_1.simpleToExactAmount(8, 19));
                chai_1.expect(dataAfter.connector.balance).eq(math_1.simpleToExactAmount(2, 19));
            });
            it("should accrue interest and update exchange rate", async () => {
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                const ts = await getTimestamp();
                await connector.poke();
                const tx = savingsContract.poke();
                await chai_1.expect(tx).to.emit(savingsContract, "Poked");
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.exchangeRate).gt(data.exchangeRate);
                assertions_1.assertBNClose(dataAfter.connector.lastPoke, math_1.BN.from(ts), 5);
                chai_1.expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance);
            });
            it("should deposit to the connector if total supply increases", async () => {
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 20));
                await savingsContract["depositSavings(uint256)"](deposit);
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                const ts = await getTimestamp();
                await savingsContract.poke();
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.exchangeRate).gt(data.exchangeRate);
                assertions_1.assertBNClose(dataAfter.connector.lastPoke, math_1.BN.from(ts), 5);
                chai_1.expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance);
                assertions_1.assertBNClosePercent(dataAfter.balances.contract, math_1.simpleToExactAmount(16, 19), "2");
            });
            it("should withdraw from the connector if total supply lowers", async () => {
                await savingsContract.redeemUnderlying(math_1.simpleToExactAmount(1, 20));
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.mul(2).add(1).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                await savingsContract.poke();
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.exchangeRate).gte(data.exchangeRate);
                chai_1.expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance);
                assertions_1.assertBNClosePercent(dataAfter.balances.contract, math_1.simpleToExactAmount(8, 19), "2");
            });
            it("should continue to accrue interest", async () => {
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.mul(3).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                await savingsContract.poke();
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.exchangeRate).gte(data.exchangeRate);
                chai_1.expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance);
                assertions_1.assertBNClosePercent(dataAfter.balances.contract, math_1.simpleToExactAmount(8, 19), "2");
            });
            it("should fail if the APY is too high", async () => {
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_HOUR.mul(4).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                await chai_1.expect(savingsContract.poke()).to.be.revertedWith("Interest protected from inflating past maxAPY");
            });
        });
        context("with a vault connector", () => {
            let connector;
            before(async () => {
                await createNewSavingsContract();
                connector = await (await new generated_1.MockVaultConnector__factory(sa.default.signer)).deploy(savingsContract.address, masset.address);
                await masset.transfer(connector.address, math_1.simpleToExactAmount(100, 18));
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit, alice.address);
            });
            afterEach(async () => {
                const data = await getData(savingsContract, alice);
                chai_1.expect(exchangeRateHolds(data), "Exchange rate must hold");
            });
            it("should poke when fraction is set", async () => {
                const tx = savingsContract.connect(sa.governor.signer).setConnector(connector.address);
                await chai_1.expect(tx).to.emit(savingsContract, "Poked").withArgs(math_1.BN.from(0), math_1.simpleToExactAmount(2, 19), math_1.BN.from(0));
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.balances.contract).eq(math_1.simpleToExactAmount(8, 19));
                chai_1.expect(dataAfter.connector.balance).eq(math_1.simpleToExactAmount(2, 19));
            });
            // In this case, the slippage from the deposit has caused the connector
            // to be less than the original balance. Fortunately, the invariant for Connectors
            // protects against this case, and will return the deposited balance.
            it("should not accrue interest if there is still a deficit", async () => {
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_HOUR.mul(4).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                await savingsContract.poke();
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                const ts = await getTimestamp();
                await connector.poke();
                const tx = savingsContract.poke();
                await chai_1.expect(tx)
                    .to.emit(savingsContract, "Poked")
                    .withArgs(math_1.simpleToExactAmount(2, 19), math_1.simpleToExactAmount(2, 19), math_1.BN.from(0));
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.exchangeRate).eq(data.exchangeRate);
                assertions_1.assertBNClose(dataAfter.connector.lastPoke, math_1.BN.from(ts), 5);
                chai_1.expect(dataAfter.connector.balance).eq(dataAfter.connector.lastBalance);
            });
            it("should accrue interest if the balance goes positive", async () => {
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.mul(2).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                await connector.poke();
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                const connectorBalance = await connector.checkBalance();
                chai_1.expect(connectorBalance).gt(math_1.simpleToExactAmount(2, 19));
                await connector.poke();
                const tx = savingsContract.poke();
                await chai_1.expect(tx).to.emit(savingsContract, "Poked");
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.exchangeRate).gt(data.exchangeRate);
                chai_1.expect(connectorBalance).gt(dataAfter.connector.lastBalance);
            });
            it("should deposit to the connector if total supply increases", async () => {
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 20));
                await savingsContract["depositSavings(uint256)"](deposit);
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                const ts = await getTimestamp();
                await savingsContract.poke();
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.exchangeRate, "Exchange rate must be the same").eq(data.exchangeRate);
                assertions_1.assertBNClose(dataAfter.connector.lastPoke, math_1.BN.from(ts), 5);
                chai_1.expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance);
                assertions_1.assertBNClosePercent(dataAfter.balances.contract, math_1.simpleToExactAmount(16, 19), "2");
            });
            it("should withdraw from the connector if total supply lowers", async () => {
                await savingsContract.redeemUnderlying(math_1.simpleToExactAmount(1, 20));
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.mul(2).toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                await savingsContract.poke();
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.exchangeRate).gte(data.exchangeRate);
                chai_1.expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance);
                assertions_1.assertBNClosePercent(dataAfter.balances.contract, math_1.simpleToExactAmount(8, 19), "2");
            });
            it("should continue to accrue interest", async () => {
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const data = await getData(savingsContract, alice);
                await savingsContract.poke();
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.exchangeRate).gte(data.exchangeRate);
                chai_1.expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance);
                assertions_1.assertBNClosePercent(dataAfter.balances.contract, math_1.simpleToExactAmount(8, 19), "2");
            });
            it("allows the connector to be switched to a lending market", async () => {
                await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
                await hardhat_1.ethers.provider.send("evm_mine", []);
                const newConnector = await (await new generated_1.MockLendingConnector__factory(sa.default.signer)).deploy(savingsContract.address, masset.address);
                const data = await getData(savingsContract, alice);
                await savingsContract.connect(sa.governor.signer).setConnector(newConnector.address);
                const dataAfter = await getData(savingsContract, alice);
                chai_1.expect(dataAfter.connector.address).eq(newConnector.address);
                assertions_1.assertBNClosePercent(dataAfter.connector.lastBalance, creditsToUnderlying(dataAfter.balances.totalCredits, dataAfter.exchangeRate).div(5), "0.0001");
                chai_1.expect(dataAfter.balances.contract).gte(data.balances.contract);
            });
        });
        context("with no connector", () => {
            const deposit2 = math_1.simpleToExactAmount(100, 18);
            const airdrop = math_1.simpleToExactAmount(1, 18);
            beforeEach(async () => {
                await createNewSavingsContract();
                await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
                await savingsContract.preDeposit(deposit2, alice.address);
            });
            it("simply updates the exchangeRate using the raw balance", async () => {
                const dataBefore = await getData(savingsContract, alice);
                chai_1.expect(dataBefore.balances.userCredits).eq(underlyingToCredits(deposit2, initialExchangeRate));
                await masset.transfer(savingsContract.address, airdrop);
                const tx = savingsContract.poke();
                await chai_1.expect(tx)
                    .to.emit(savingsContract, "ExchangeRateUpdated")
                    .withArgs(deposit2.add(airdrop).mul(constants_1.fullScale).div(dataBefore.balances.userCredits.sub(1)), airdrop);
                await chai_1.expect(tx).to.emit(savingsContract, "PokedRaw");
                const balanceOfUnderlying = await savingsContract.balanceOfUnderlying(alice.address);
                chai_1.expect(balanceOfUnderlying).eq(deposit2.add(airdrop));
            });
        });
    });
    describe("testing emergency stop", () => {
        const deposit = math_1.simpleToExactAmount(100, 18);
        let dataBefore;
        const expectedRateAfter = initialExchangeRate.div(10).mul(9);
        before(async () => {
            await createNewSavingsContract();
            const connector = await connectorFactory.deploy(savingsContract.address, masset.address);
            await masset.transfer(bob.address, math_1.simpleToExactAmount(100, 18));
            await masset.approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
            await savingsContract.preDeposit(deposit, alice.address);
            await savingsContract.connect(sa.governor.signer).setConnector(connector.address);
            dataBefore = await getData(savingsContract, alice);
        });
        afterEach(async () => {
            const data = await getData(savingsContract, alice);
            chai_1.expect(exchangeRateHolds(data), "exchange rate must hold");
        });
        it("withdraws specific amount from the connector", async () => {
            chai_1.expect(dataBefore.connector.balance).eq(deposit.div(5));
            const tx = savingsContract.connect(sa.governor.signer).emergencyWithdraw(math_1.simpleToExactAmount(10, 18));
            await chai_1.expect(tx).to.emit(savingsContract, "ConnectorUpdated").withArgs(constants_1.ZERO_ADDRESS);
            await chai_1.expect(tx).to.emit(savingsContract, "FractionUpdated").withArgs(math_1.BN.from(0));
            await chai_1.expect(tx).to.emit(savingsContract, "EmergencyUpdate");
            chai_1.expect(tx).to.emit(savingsContract, "ExchangeRateUpdated").withArgs(expectedRateAfter, math_1.BN.from(0));
            const dataMiddle = await getData(savingsContract, alice);
            chai_1.expect(dataMiddle.balances.contract).eq(math_1.simpleToExactAmount(90, 18));
            chai_1.expect(dataMiddle.balances.totalCredits).eq(dataBefore.balances.totalCredits);
        });
        it("sets fraction and connector to 0", async () => {
            const fraction = await savingsContract.fraction();
            chai_1.expect(fraction).eq(math_1.BN.from(0));
            const connector = await savingsContract.connector();
            chai_1.expect(connector).eq(constants_1.ZERO_ADDRESS);
        });
        it("should lowers exchange rate if necessary", async () => {
            const data = await getData(savingsContract, alice);
            chai_1.expect(data.exchangeRate).eq(expectedRateAfter);
            const balanceOfUnderlying = await savingsContract.balanceOfUnderlying(alice.address);
            chai_1.expect(balanceOfUnderlying).eq(math_1.simpleToExactAmount(90, 18));
        });
        it("should still allow deposits and withdrawals to work", async () => {
            await masset.connect(bob.signer).approve(savingsContract.address, math_1.simpleToExactAmount(1, 21));
            await savingsContract.connect(bob.signer)["depositSavings(uint256)"](deposit);
            const data = await getData(savingsContract, bob);
            chai_1.expect(data.balances.userCredits).eq(underlyingToCredits(deposit, expectedRateAfter));
            const balanceOfUnderlying = await savingsContract.balanceOfUnderlying(bob.address);
            chai_1.expect(balanceOfUnderlying).eq(deposit);
            await savingsContract.connect(bob.signer).redeemCredits(data.balances.userCredits);
            const dataEnd = await getData(savingsContract, bob);
            chai_1.expect(dataEnd.balances.userCredits).eq(math_1.BN.from(0));
            chai_1.expect(dataEnd.balances.user).eq(data.balances.user.add(deposit));
        });
    });
    context("performing multiple operations from multiple addresses in sequence", async () => {
        beforeEach(async () => {
            await createNewSavingsContract();
        });
        it("should give existing savers the benefit of the increased exchange rate", async () => {
            const saver1 = sa.default;
            const saver2 = sa.dummy1;
            const saver3 = sa.dummy2;
            const saver4 = sa.dummy3;
            // Set up amounts
            // Each savers deposit will trigger some interest to be deposited
            const saver1deposit = math_1.simpleToExactAmount(1000, 18);
            const interestToReceive1 = math_1.simpleToExactAmount(100, 18);
            const saver2deposit = math_1.simpleToExactAmount(1000, 18);
            const interestToReceive2 = math_1.simpleToExactAmount(350, 18);
            const saver3deposit = math_1.simpleToExactAmount(1000, 18);
            const interestToReceive3 = math_1.simpleToExactAmount(80, 18);
            const saver4deposit = math_1.simpleToExactAmount(1000, 18);
            const interestToReceive4 = math_1.simpleToExactAmount(160, 18);
            // Ensure saver2 has some balances and do approvals
            await masset.transfer(saver2.address, saver2deposit);
            await masset.transfer(saver3.address, saver3deposit);
            await masset.transfer(saver4.address, saver4deposit);
            await masset.connect(saver1.signer).approve(savingsContract.address, constants_1.MAX_UINT256);
            await masset.connect(saver2.signer).approve(savingsContract.address, constants_1.MAX_UINT256);
            await masset.connect(saver3.signer).approve(savingsContract.address, constants_1.MAX_UINT256);
            await masset.connect(saver4.signer).approve(savingsContract.address, constants_1.MAX_UINT256);
            // Should be a fresh balance sheet
            const stateBefore = await getData(savingsContract, sa.default);
            chai_1.expect(stateBefore.exchangeRate).to.equal(initialExchangeRate);
            chai_1.expect(stateBefore.balances.contract).to.equal(math_1.BN.from(0));
            // 1.0 user 1 deposits
            // interest remains unassigned and exchange rate unmoved
            await masset.setAmountForCollectInterest(interestToReceive1);
            await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
            await hardhat_1.ethers.provider.send("evm_mine", []);
            await savingsContract.connect(saver1.signer)["depositSavings(uint256)"](saver1deposit);
            await savingsContract.poke();
            const state1 = await getData(savingsContract, saver1);
            // 2.0 user 2 deposits
            // interest rate benefits user 1 and issued user 2 less credits than desired
            await masset.setAmountForCollectInterest(interestToReceive2);
            await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
            await hardhat_1.ethers.provider.send("evm_mine", []);
            await savingsContract.connect(saver2.signer)["depositSavings(uint256)"](saver2deposit);
            const state2 = await getData(savingsContract, saver2);
            // 3.0 user 3 deposits
            // interest rate benefits users 1 and 2
            await masset.setAmountForCollectInterest(interestToReceive3);
            await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
            await hardhat_1.ethers.provider.send("evm_mine", []);
            await savingsContract.connect(saver3.signer)["depositSavings(uint256)"](saver3deposit);
            const state3 = await getData(savingsContract, saver3);
            // 4.0 user 1 withdraws all her credits
            await savingsContract.connect(saver1.signer).redeem(state1.balances.userCredits);
            const state4 = await getData(savingsContract, saver1);
            chai_1.expect(state4.balances.userCredits).eq(math_1.BN.from(0));
            chai_1.expect(state4.balances.totalCredits).eq(state3.balances.totalCredits.sub(state1.balances.userCredits));
            chai_1.expect(state4.exchangeRate).eq(state3.exchangeRate);
            assertions_1.assertBNClose(state4.balances.contract, creditsToUnderlying(state4.balances.totalCredits, state4.exchangeRate), math_1.BN.from(100000));
            // 5.0 user 4 deposits
            // interest rate benefits users 2 and 3
            await masset.setAmountForCollectInterest(interestToReceive4);
            await hardhat_1.ethers.provider.send("evm_increaseTime", [constants_1.ONE_DAY.toNumber()]);
            await hardhat_1.ethers.provider.send("evm_mine", []);
            await savingsContract.connect(saver4.signer)["depositSavings(uint256)"](saver4deposit);
            const state5 = await getData(savingsContract, saver4);
            // 6.0 users 2, 3, and 4 withdraw all their tokens
            await savingsContract.connect(saver2.signer).redeemCredits(state2.balances.userCredits);
            await savingsContract.connect(saver3.signer).redeemCredits(state3.balances.userCredits);
            await savingsContract.connect(saver4.signer).redeemCredits(state5.balances.userCredits);
        });
    });
});
//# sourceMappingURL=savings-contract.spec.js.map