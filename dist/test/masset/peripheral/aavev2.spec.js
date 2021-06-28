"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const assertions_1 = require("@utils/assertions");
const math_1 = require("@utils/math");
const time_1 = require("@utils/time");
const machines_1 = require("@utils/machines");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
const Module_behaviour_1 = require("../../shared/Module.behaviour");
describe("AaveIntegration", async () => {
    let sa;
    let mAssetMachine;
    let nexus;
    let mAsset;
    let integrationDetails;
    let aaveIntegration;
    const ctx = {};
    const runSetup = async (enableUSDTFee = false, simulateMint = false, skipInit = false) => {
        // SETUP
        // ======
        nexus = await new generated_1.MockNexus__factory(sa.default.signer).deploy(sa.governor.address, sa.mockSavingsManager.address, sa.mockInterestValidator.address);
        // Load network specific integration data
        integrationDetails = await mAssetMachine.loadBassetsLocal(true, enableUSDTFee, mAsset.address);
        // Initialize the proxy
        aaveIntegration = await new generated_1.AaveV2Integration__factory(sa.default.signer).deploy(nexus.address, mAsset.address, integrationDetails.aavePlatformAddress, constants_1.DEAD_ADDRESS);
        if (!skipInit) {
            await Promise.all(integrationDetails.aTokens.map((a) => aaveIntegration.connect(sa.governor.signer).setPTokenAddress(a.bAsset, a.aToken)));
            if (simulateMint) {
                await Promise.all(integrationDetails.aTokens.map(async ({ bAsset }) => {
                    // Step 0. Choose tokens
                    const b1 = await new generated_1.MockERC20__factory(mAsset.signer).attach(bAsset);
                    const decimals = math_1.BN.from(await b1.decimals());
                    const amount = math_1.BN.from(enableUSDTFee ? 101 : 100).mul(math_1.BN.from(10).pow(decimals.sub(math_1.BN.from(1))));
                    const amountD = math_1.BN.from(100).mul(math_1.BN.from(10).pow(decimals.sub(math_1.BN.from(1))));
                    // Step 1. xfer tokens to integration
                    await b1.transfer(aaveIntegration.address, amount.toString());
                    // Step 2. call deposit
                    return aaveIntegration.connect(mAsset.signer).deposit(bAsset, amountD.toString(), true);
                }));
            }
        }
    };
    before("Init contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        mAsset = sa.default;
        await runSetup();
    });
    describe("AaveIntegration constructor", async () => {
        describe("behave like a Module", async () => {
            beforeEach(async () => {
                await runSetup();
                ctx.module = aaveIntegration;
                ctx.sa = sa;
            });
            Module_behaviour_1.shouldBehaveLikeModule(ctx);
        });
        it("should properly store valid arguments", async () => {
            // Check for nexus addr
            chai_1.expect(await aaveIntegration.nexus()).eq(nexus.address);
            chai_1.expect(await aaveIntegration.lpAddress()).eq(mAsset.address);
            // check for platform addr
            chai_1.expect(await aaveIntegration.platformAddress()).eq(integrationDetails.aavePlatformAddress); // check for pTokens added & events
            chai_1.expect(integrationDetails.aTokens[0].aToken).eq(await aaveIntegration.bAssetToPToken(integrationDetails.aTokens[0].bAsset));
            chai_1.expect(integrationDetails.aTokens[1].aToken).eq(await aaveIntegration.bAssetToPToken(integrationDetails.aTokens[1].bAsset));
        });
        it("should fail when mAsset address invalid", async () => {
            await chai_1.expect(new generated_1.AaveV2Integration__factory(sa.default.signer).deploy(nexus.address, constants_1.ZERO_ADDRESS, sa.mockSavingsManager.address, constants_1.DEAD_ADDRESS)).to.be.revertedWith("Invalid LP address");
        });
        it("should approve spending of the passed bAssets", async () => {
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const addressProvider = await generated_1.ILendingPoolAddressesProviderV2__factory.connect(integrationDetails.aavePlatformAddress, sa.default.signer);
            const approvedAddress = await addressProvider.getLendingPool();
            const balance = await bAsset.allowance(aaveIntegration.address, approvedAddress);
            chai_1.expect(balance).eq(constants_1.MAX_UINT256);
        });
        it("should fail if passed incorrect data", async () => {
            await chai_1.expect(new generated_1.AaveV2Integration__factory(sa.default.signer).deploy(nexus.address, mAsset.address, constants_1.ZERO_ADDRESS, constants_1.DEAD_ADDRESS)).to.be.revertedWith("Invalid platform address");
        });
    });
    describe("calling initialize", async () => {
        beforeEach(async () => {
            await runSetup(false, false, true);
        });
        it("should properly store valid arguments", async () => {
            const { aTokens } = integrationDetails;
            await aaveIntegration.initialize([aTokens[0].bAsset], [aTokens[0].aToken]);
            chai_1.expect(integrationDetails.aTokens[0].aToken).eq(await aaveIntegration.bAssetToPToken(integrationDetails.aTokens[0].bAsset));
        });
        it("should approve spending of the passed bAssets", async () => {
            const { aTokens } = integrationDetails;
            await aaveIntegration.initialize([aTokens[0].bAsset], [aTokens[0].aToken]);
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(aTokens[0].bAsset);
            const addressProvider = await generated_1.ILendingPoolAddressesProviderV2__factory.connect(integrationDetails.aavePlatformAddress, sa.default.signer);
            const approvedAddress = await addressProvider.getLendingPool();
            const balance = await bAsset.allowance(aaveIntegration.address, approvedAddress);
            chai_1.expect(balance).eq(constants_1.MAX_UINT256);
        });
        it("should fail when called again", async () => {
            const { aTokens } = integrationDetails;
            await aaveIntegration.initialize([aTokens[0].bAsset], [aTokens[0].aToken]);
            await chai_1.expect(aaveIntegration.initialize([aTokens[0].bAsset], [aTokens[0].aToken])).to.be.revertedWith("Initializable: contract is already initialized");
        });
        it("should fail if passed incorrect data", async () => {
            const { aTokens } = integrationDetails;
            // bAsset and pToken array length are different
            await chai_1.expect(aaveIntegration.initialize([aTokens[1].bAsset, sa.dummy1.address], [aTokens[1].aToken])).to.be.revertedWith("Invalid inputs");
            // pToken address is zero
            await chai_1.expect(aaveIntegration.initialize([aTokens[1].bAsset], [constants_1.ZERO_ADDRESS])).to.be.revertedWith("Invalid addresses");
            // duplicate pToken or bAsset
            await chai_1.expect(aaveIntegration.initialize([aTokens[0].bAsset, aTokens[0].bAsset], [aTokens[1].aToken, aTokens[1].aToken])).to.be.revertedWith("pToken already set");
            // invalid bAsset addresses
            await chai_1.expect(aaveIntegration.initialize([constants_1.ZERO_ADDRESS], [aTokens[0].aToken])).to.be.reverted;
        });
    });
    describe("setting P Token Address", async () => {
        let erc20Mock;
        let aTokenMock;
        beforeEach("init mocks", async () => {
            erc20Mock = await new generated_1.MockERC20__factory(sa.default.signer).deploy("TMP", "TMP", 18, sa.default.address, "1000000");
            aTokenMock = await new generated_1.MockATokenV2__factory(sa.default.signer).deploy(sa.other.address, erc20Mock.address);
            await runSetup();
        });
        it("should pass only when function called by the Governor", async () => {
            await chai_1.expect(aaveIntegration.setPTokenAddress(erc20Mock.address, aTokenMock.address)).to.be.revertedWith("Only governor can execute");
            await aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, aTokenMock.address);
            chai_1.expect(aTokenMock.address).eq(await aaveIntegration.bAssetToPToken(erc20Mock.address));
        });
        it("should approve the spending of the bAsset correctly and emit event", async () => {
            await aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, aTokenMock.address);
            chai_1.expect(aTokenMock.address).eq(await aaveIntegration.bAssetToPToken(erc20Mock.address));
            const addressProvider = await generated_1.ILendingPoolAddressesProviderV2__factory.connect(integrationDetails.aavePlatformAddress, sa.default.signer);
            const approvedAddress = await addressProvider.getLendingPool();
            const balance = await erc20Mock.allowance(aaveIntegration.address, approvedAddress);
            chai_1.expect(balance).eq(constants_1.MAX_UINT256);
        });
        it("should fail when passed invalid args", async () => {
            // bAsset address is zero
            await chai_1.expect(aaveIntegration.connect(sa.governor.signer).setPTokenAddress(constants_1.ZERO_ADDRESS, aTokenMock.address)).to.be.revertedWith("Invalid addresses");
            // pToken address is zero
            await chai_1.expect(aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, constants_1.ZERO_ADDRESS)).to.be.revertedWith("Invalid addresses");
            // pToken address already assigned for a bAsset
            await aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, aTokenMock.address);
            await chai_1.expect(aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, sa.default.address)).to.be.revertedWith("pToken already set");
        });
    });
    describe("calling deposit", async () => {
        beforeEach("init mocks", async () => {
            await runSetup();
        });
        it("should deposit tokens to Aave", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.BN.from(10).pow(bAssetDecimals);
            const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken);
            // 0.1 Get balance before
            const addressProvider = await generated_1.ILendingPoolAddressesProviderV2__factory.connect(integrationDetails.aavePlatformAddress, sa.default.signer);
            const bAssetRecipient = await addressProvider.getLendingPool();
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address);
            // Cross that match with the `checkBalance` call
            let directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            chai_1.expect(directBalance).eq(aaveIntegrationBalBefore);
            // Step 1. xfer tokens to integration
            await bAsset.transfer(aaveIntegration.address, amount.toString());
            // Step 2. call deposit
            const tx = aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amount.toString(), false);
            // Step 3. Check for things:
            // 3.0 Check that return value is cool (via event)
            await chai_1.expect(tx).to.emit(aaveIntegration, "Deposit").withArgs(bAsset.address, aToken.address, amount);
            await (await tx).wait();
            // 3.1 Check that lending pool has bAssets
            chai_1.expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(amount));
            // 3.2 Check that aave integration has aTokens
            const expectedBalance = aaveIntegrationBalBefore.add(amount);
            const actualBalance = await aToken.balanceOf(aaveIntegration.address);
            assertions_1.assertBNSlightlyGTPercent(actualBalance, expectedBalance);
            // Cross that match with the `checkBalance` call
            directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            chai_1.expect(directBalance).eq(actualBalance);
            // Assert that Balance goes up over time
            await time_1.increaseTime(constants_1.TEN_MINS);
            const newBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            assertions_1.assertBNSlightlyGTPercent(newBalance, directBalance, "0.0001", false);
        });
        it("should handle the fee calculations", async () => {
            // Step 0. Choose tokens and set up env
            await runSetup(true);
            const addressProvider = await generated_1.ILendingPoolAddressesProviderV2__factory.connect(integrationDetails.aavePlatformAddress, sa.default.signer);
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[2].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.BN.from(10).pow(bAssetDecimals);
            const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[2].aToken);
            // 0.1 Get balance before
            const bAssetRecipient = await addressProvider.getLendingPool();
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address);
            // Cross that match with the `checkBalance` call
            let directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            chai_1.expect(directBalance).eq(aaveIntegrationBalBefore);
            // Step 1. xfer tokens to integration
            const bal1 = await bAsset.balanceOf(aaveIntegration.address);
            await bAsset.transfer(aaveIntegration.address, amount.toString());
            const bal2 = await bAsset.balanceOf(aaveIntegration.address);
            const receivedAmount = bal2.sub(bal1);
            // Ensure fee is being deducted
            chai_1.expect(receivedAmount).lt(amount);
            // fee = initialAmount - receivedAmount
            const fee = amount.sub(receivedAmount);
            // feeRate = fee/amount (base 1e18)
            const feeRate = fee.mul(math_1.simpleToExactAmount(1)).div(amount);
            // expectedDepoit = receivedAmount - (receivedAmount*feeRate)
            const expectedDeposit = receivedAmount.sub(receivedAmount.mul(feeRate).div(math_1.simpleToExactAmount(1)));
            // Step 2. call deposit
            const tx = await aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, receivedAmount.toString(), true);
            // Step 3. Check for things:
            const aaveIntegrationBalAfter = await aToken.balanceOf(aaveIntegration.address);
            // 3.1 Check that lending pool has bAssets
            chai_1.expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(expectedDeposit));
            // 3.2 Check that aave integration has aTokens
            assertions_1.assertBNClose(aaveIntegrationBalAfter, aaveIntegrationBalBefore.add(expectedDeposit), fee);
            // Cross that match with the `checkBalance` call
            directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            chai_1.expect(directBalance).eq(aaveIntegrationBalAfter);
        });
        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset);
            const amount = math_1.BN.from(10).pow(math_1.BN.from(12));
            // Step 1. call deposit
            await chai_1.expect(aaveIntegration.connect(sa.dummy1.signer).deposit(bAsset.address, amount.toString(), false)).to.be.revertedWith("Only the LP can execute");
        });
        it("should fail if the bAsset is not supported", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).deploy("MK1", "MK", 12, sa.default.address, 100000);
            const amount = math_1.BN.from(10).pow(math_1.BN.from(12));
            // Step 1. call deposit
            await chai_1.expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amount.toString(), false)).to.be.revertedWith("aToken does not exist");
        });
        it("should fail if we do not first pass the required bAsset", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const amount = math_1.BN.from(10).pow(math_1.BN.from(12));
            const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken);
            // Step 2. call deposit
            await chai_1.expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amount.toString(), false)).to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });
        it("should fail if we try to deposit too much", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.BN.from(10).mul(math_1.BN.from(10).pow(bAssetDecimals));
            const amountHigh = math_1.BN.from(11).mul(math_1.BN.from(10).pow(bAssetDecimals));
            const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[1].aToken);
            // Step 1. xfer low tokens to integration
            await bAsset.transfer(aaveIntegration.address, amount.toString());
            chai_1.expect(await bAsset.balanceOf(aaveIntegration.address)).lte(amount);
            // Step 2. call deposit with high tokens
            await chai_1.expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amountHigh.toString(), false)).to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });
        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.BN.from(10).pow(bAssetDecimals);
            const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken);
            // 0.1 Get balance before
            const addressProvider = await generated_1.ILendingPoolAddressesProviderV2__factory.connect(integrationDetails.aavePlatformAddress, sa.default.signer);
            const bAssetRecipient = await addressProvider.getLendingPool();
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address);
            // Step 1. xfer low tokens to integration
            await bAsset.transfer(aaveIntegration.address, amount.toString());
            // Fails with ZERO bAsset Address
            await chai_1.expect(aaveIntegration.connect(mAsset.signer).deposit(constants_1.ZERO_ADDRESS, amount.toString(), false)).to.be.revertedWith("aToken does not exist");
            // Fails with ZERO Amount
            await chai_1.expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, "0", false)).to.be.revertedWith("Must deposit something");
            // Succeeds with Incorrect bool (defaults to false)
            const tx = await aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amount.toString(), undefined);
            // Step 3. Check for things:
            // 3.1 Check that lending pool has bAssets
            chai_1.expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(amount));
            // 3.2 Check that aave integration has aTokens
            const newBal = await aToken.balanceOf(aaveIntegration.address);
            assertions_1.assertBNSlightlyGT(newBal, aaveIntegrationBalBefore.add(amount), math_1.BN.from("1000"));
            // Cross that match with the `checkBalance` call
            const directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            chai_1.expect(directBalance).eq(newBal);
            // 3.3 Check that return value is cool (via event)
            // expectEvent(tx.receipt, "Deposit", { _amount: amount })
        });
        it("should fail if lending pool does not exist", async () => {
            // Can only run on local, due to constraints from Aave
            const mockAave = await new generated_1.MockAaveV2__factory(sa.default.signer).attach(integrationDetails.aavePlatformAddress);
            await mockAave.breakLendingPools();
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset);
            await bAsset.transfer(aaveIntegration.address, "1");
            // Fails with ZERO Amount
            await chai_1.expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, "1", false)).to.be.revertedWith("Lending pool does not exist");
        });
    });
    describe("withdraw", async () => {
        beforeEach("init mocks", async () => {
            await runSetup(false, true);
        });
        it("should withdraw tokens from Aave", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.BN.from(10).pow(bAssetDecimals);
            const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken);
            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1.address;
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address);
            // Step 1. call withdraw
            const tx = await aaveIntegration["withdraw(address,address,uint256,bool)"](bAssetRecipient, bAsset.address, amount.toString(), false);
            // Step 2. Check for things:
            // 2.1 Check that the recipient receives the tokens
            chai_1.expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(amount));
            // 2.2 Check that integration aToken balance has gone down
            const actualBalance = await aToken.balanceOf(aaveIntegration.address);
            const expectedBalance = aaveIntegrationBalBefore.sub(amount);
            assertions_1.assertBNSlightlyGTPercent(actualBalance, expectedBalance, "0.001", false);
            // Cross that match with the `checkBalance` call
            const directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            chai_1.expect(directBalance).eq(actualBalance);
            // Assert that Balance goes up over time
            await time_1.increaseTime(constants_1.TEN_MINS);
            const newBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            assertions_1.assertBNSlightlyGTPercent(newBalance, directBalance, "0.001", false);
            // 2.3 Should give accurate return value
            // expectEvent(tx.receipt, "PlatformWithdrawal", {
            //     bAsset: bAsset.address,
            //     totalAmount: amount,
            //     userAmount: amount,
            // })
        });
        it("should handle the fee calculations", async () => {
            await runSetup(true, true);
            // should deduct the transfer fee from the return value
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.BN.from(10).pow(bAssetDecimals);
            const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[1].aToken);
            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1.address;
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address);
            // Step 1. call withdraw
            const tx = await aaveIntegration["withdraw(address,address,uint256,bool)"](bAssetRecipient, bAsset.address, amount.toString(), true);
            const bAssetRecipientBalAfter = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegrationBalAfter = await aToken.balanceOf(aaveIntegration.address);
            // 99% of amt
            const scale = math_1.simpleToExactAmount("0.99", 18);
            const amountScaled = amount.mul(scale);
            const expectedAmount = amountScaled.div(math_1.simpleToExactAmount(1));
            // Step 2. Validate recipient
            chai_1.expect(bAssetRecipientBalAfter).gte(bAssetRecipientBalBefore.add(expectedAmount));
            chai_1.expect(bAssetRecipientBalAfter).lte(bAssetRecipientBalBefore.add(amount));
            chai_1.expect(aaveIntegrationBalAfter).eq(aaveIntegrationBalBefore.sub(amount));
            const expectedBalance = aaveIntegrationBalBefore.sub(amount);
            assertions_1.assertBNSlightlyGT(aaveIntegrationBalAfter, expectedBalance, math_1.BN.from("100"));
            // Cross that match with the `checkBalance` call
            const directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            chai_1.expect(directBalance).eq(expectedBalance);
        });
        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.BN.from(10).pow(bAssetDecimals);
            // Step 1. call deposit
            await chai_1.expect(aaveIntegration
                .connect(sa.dummy1.signer)["withdraw(address,address,uint256,bool)"](sa.dummy1.address, bAsset.address, amount.toString(), false)).to.be.revertedWith("Only the LP can execute");
        });
        it("should fail if there is insufficient balance", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.BN.from(1000).mul(math_1.BN.from(10).pow(bAssetDecimals));
            // Step 1. call deposit
            await chai_1.expect(aaveIntegration["withdraw(address,address,uint256,bool)"](sa.default.address, bAsset.address, amount.toString(), false)).to.be.revertedWith("ERC20: burn amount exceeds balance");
        });
        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.BN.from(10).pow(bAssetDecimals);
            const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken);
            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1.address;
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address);
            // Fails with ZERO bAsset Address
            await chai_1.expect(aaveIntegration["withdraw(address,address,uint256,bool)"](sa.dummy1.address, constants_1.ZERO_ADDRESS, amount.toString(), false)).to.be.revertedWith("aToken does not exist");
            // Fails with ZERO recipient address
            await chai_1.expect(aaveIntegration["withdraw(address,address,uint256,bool)"](constants_1.ZERO_ADDRESS, bAsset.address, math_1.BN.from(1), false)).to.be
                .reverted;
            // Fails with ZERO Amount
            await chai_1.expect(aaveIntegration["withdraw(address,address,uint256,bool)"](sa.dummy1.address, bAsset.address, "0", false)).to.be.revertedWith("Must withdraw something");
            // Succeeds with Incorrect bool (defaults to false)
            const tx = await aaveIntegration["withdraw(address,address,uint256,bool)"](sa.dummy1.address, bAsset.address, amount.toString(), undefined);
            // 2.1 Check that the recipient receives the tokens
            chai_1.expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(amount));
            // 2.2 Check that integration aToken balance has gone down
            const currentBalance = await aToken.balanceOf(aaveIntegration.address);
            assertions_1.assertBNSlightlyGTPercent(currentBalance, aaveIntegrationBalBefore.sub(amount), "0.0001", false);
            // 2.3 Should give accurate return value
            // expectEvent(tx.receipt, "PlatformWithdrawal", {
            //     bAsset: bAsset.address,
            //     totalAmount: amount,
            //     userAmount: amount,
            // })
        });
        it("should fail if the bAsset is not supported", async () => {
            // Step 0. Choose tokens
            const bAsset = await mAssetMachine.loadBassetProxy("MK", "MK", 12);
            const amount = math_1.BN.from(10).pow(math_1.BN.from(12));
            // Step 1. call withdraw
            await chai_1.expect(aaveIntegration["withdraw(address,address,uint256,bool)"](sa.dummy1.address, bAsset.address, amount.toString(), false)).to.be.revertedWith("aToken does not exist");
        });
    });
    describe("withdraw specific amount", async () => {
        describe("and the token does not have transfer fee", async () => {
            beforeEach("init mocks", async () => {
                await runSetup(false, true);
            });
            it("should allow withdrawal of X and give Y to the caller", async () => {
                // Step 0. Choose tokens
                const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
                const bAssetDecimals = await bAsset.decimals();
                const amount = math_1.simpleToExactAmount(5, bAssetDecimals);
                const totalAmount = amount.mul(2);
                const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken);
                // 0.1 Get balance before
                const bAssetRecipient = sa.dummy1.address;
                const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient);
                const aaveIntegrationBalBefore = await bAsset.balanceOf(aaveIntegration.address);
                const aaveBalanceBefore = await aaveIntegration.callStatic.checkBalance(bAsset.address);
                // fail if called by non Bm or mAsset
                await chai_1.expect(aaveIntegration
                    .connect(sa.dummy1.signer)["withdraw(address,address,uint256,uint256,bool)"](bAssetRecipient, bAsset.address, amount, totalAmount, false)).to.be.revertedWith("Only the LP can execute");
                // send the amount
                const tx = await aaveIntegration["withdraw(address,address,uint256,uint256,bool)"](bAssetRecipient, bAsset.address, amount, totalAmount, false);
                const bAssetRecipientBalAfter = await bAsset.balanceOf(bAssetRecipient);
                const aaveIntegrationBalAfter = await bAsset.balanceOf(aaveIntegration.address);
                const aaveBalanceAfter = await aaveIntegration.callStatic.checkBalance(bAsset.address);
                chai_1.expect(bAssetRecipientBalAfter).eq(bAssetRecipientBalBefore.add(amount));
                chai_1.expect(aaveIntegrationBalAfter).eq(aaveIntegrationBalBefore.add(totalAmount.sub(amount)));
                chai_1.expect(aaveBalanceAfter).eq(aaveBalanceBefore.sub(totalAmount));
                // emit the event
                // expectEvent(tx.receipt, "PlatformWithdrawal", {
                //     bAsset: bAsset.address,
                //     pToken: aToken.address,
                //     totalAmount: totalAmount,
                //     userAmount: amount,
                // })
            });
        });
        describe("and the token has transfer fees", async () => {
            beforeEach("init mocks", async () => {
                await runSetup(true, true);
            });
            it("should fail if totalAmount != userAmount", async () => {
                const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset);
                const bAssetDecimals = await bAsset.decimals();
                const amount = math_1.simpleToExactAmount(5, bAssetDecimals);
                const totalAmount = amount.mul(2);
                await chai_1.expect(aaveIntegration["withdraw(address,address,uint256,uint256,bool)"](sa.dummy1.address, bAsset.address, amount, totalAmount, true)).to.be.revertedWith("Cache inactive for assets with fee");
            });
        });
    });
    describe("withdrawRaw", async () => {
        beforeEach("init mocks", async () => {
            await runSetup(false, true);
        });
        it("should fail if caller is not whitelisetd", async () => {
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            await chai_1.expect(aaveIntegration.connect(sa.dummy1.signer).withdrawRaw(sa.dummy3.address, bAsset.address, math_1.BN.from(1))).to.be.revertedWith("Only the LP can execute");
        });
        it("should allow the mAsset or BM to withdraw a given bAsset", async () => {
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const bAssetDecimals = await bAsset.decimals();
            const amount = math_1.simpleToExactAmount(5, bAssetDecimals);
            await bAsset.transfer(aaveIntegration.address, amount);
            const bAssetRecipient = sa.dummy1.address;
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegrationBalBefore = await bAsset.balanceOf(aaveIntegration.address);
            const aaveBalanceBefore = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            const tx = await aaveIntegration.connect(mAsset.signer).withdrawRaw(bAssetRecipient, bAsset.address, amount);
            const bAssetRecipientBalAfter = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegrationBalAfter = await bAsset.balanceOf(aaveIntegration.address);
            const aaveBalanceAfter = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            // Balances remain the same
            chai_1.expect(bAssetRecipientBalAfter).eq(bAssetRecipientBalBefore.add(amount));
            chai_1.expect(aaveIntegrationBalAfter).eq(aaveIntegrationBalBefore.sub(amount));
            chai_1.expect(aaveBalanceAfter).eq(aaveBalanceBefore);
            // Emits expected event
            // expectEvent(tx.receipt, "Withdrawal", {
            //     _bAsset: bAsset.address,
            //     _pToken: ZERO_ADDRESS,
            //     _amount: amount,
            // })
        });
        it("should fail if there is no balance in a given asset", async () => {
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            await chai_1.expect(aaveIntegration.connect(mAsset.signer).withdrawRaw(sa.dummy3.address, bAsset.address, math_1.BN.from(1))).to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });
        it("should fail if specified a 0 amount", async () => {
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            await chai_1.expect(aaveIntegration.connect(mAsset.signer).withdrawRaw(sa.dummy3.address, bAsset.address, math_1.BN.from(0))).to.be.revertedWith("Must withdraw something");
        });
    });
    // See deposit and withdraw tests for basic balance checking
    describe("checkBalance", async () => {
        it("should return balance for any caller when supported token address passed", async () => {
            const bAsset = await new generated_1.MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset);
            const aToken = await new generated_1.MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken);
            const aaveIntegrationBal = await aToken.balanceOf(aaveIntegration.address);
            // Cross that match with the `checkBalance` call
            const directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address);
            chai_1.expect(directBalance).eq(aaveIntegrationBal);
        });
        it("should fail if called with inactive token", async () => {
            const bAsset = await mAssetMachine.loadBassetProxy("MK", "MK1", 12);
            await chai_1.expect(aaveIntegration.checkBalance(bAsset.address)).to.be.revertedWith("aToken does not exist");
        });
    });
});
//# sourceMappingURL=aavev2.spec.js.map