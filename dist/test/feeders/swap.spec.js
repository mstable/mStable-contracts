"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const machines_1 = require("@utils/machines");
const constants_1 = require("@utils/constants");
const assertions_1 = require("@utils/assertions");
describe("Feeder - Swap", () => {
    let sa;
    let feederMachine;
    let details;
    const runSetup = async (useLendingMarkets = false, useInterestValidator = false, feederWeights, mAssetWeights, use2dp = false) => {
        details = await feederMachine.deployFeeder(feederWeights, mAssetWeights, useLendingMarkets, useInterestValidator, use2dp);
    };
    before("Init contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        feederMachine = await new machines_1.FeederMachine(mAssetMachine);
        sa = mAssetMachine.sa;
    });
    /**
     * @dev Asserts that both 'swap' and 'getSwapOutput' fail for a given reason
     * @param expectedReason What is the failure response of the contract?
     * @param poolContract FeederPool instance upon which to call swap
     * @param inputAsset feeder, mStable or main pool asset to swap from sender and into the pool
     * @param outputAsset feeder, mStable or main pool asset to swap to sender and out of the pool
     * @param inputQuantity amount of the input asset.
     * @param minOutputQuantity minimum amount of the output asset
     * @param outputExpected expected amount of output assets
     * @param swapOutputRevertExpected Should 'getSwapOutput' revert? If so, set this to true
     * @param quantitiesAreExact false (default) if the input, min output and output expected quantities need to be converted to base units
     * @param sender Who should send the tx? Or default
     * @param recipient Who should receive the output? Or default
     * @param approvals true (default) if the swap sender has and approves the feeder pool to spend the amount the input asset
     */
    const assertFailedSwap = async (expectedReason, poolContract, inputAsset, outputAsset, inputQuantity, minOutputQuantity = 0, outputExpected = undefined, quantitiesAreExact = false, sender = sa.default.signer, recipient = sa.default.address, approval = true) => {
        const pool = poolContract.connect(sender);
        if (approval) {
            await feederMachine.approveFeeder(inputAsset, pool.address, inputQuantity, sender, quantitiesAreExact);
        }
        const inputAssetDecimals = await inputAsset.decimals();
        const inputQuantityExact = quantitiesAreExact ? math_1.BN.from(inputQuantity) : math_1.simpleToExactAmount(inputQuantity, inputAssetDecimals);
        const outputDecimals = await outputAsset.decimals();
        const minOutputQuantityExact = quantitiesAreExact
            ? math_1.BN.from(minOutputQuantity)
            : math_1.simpleToExactAmount(minOutputQuantity, outputDecimals);
        // Expect the swap to revert
        await chai_1.expect(pool.swap(inputAsset.address, outputAsset.address, inputQuantityExact, minOutputQuantityExact, recipient), `swap tx should revert with "${expectedReason}"`).to.be.revertedWith(expectedReason);
        if (outputExpected === undefined) {
            await chai_1.expect(pool.getSwapOutput(inputAsset.address, outputAsset.address, inputQuantityExact), `getSwapOutput call should revert with "${expectedReason}"`).to.be.revertedWith(expectedReason);
        }
        else {
            const outputExpectedExact = quantitiesAreExact ? math_1.BN.from(outputExpected) : math_1.simpleToExactAmount(outputExpected, outputDecimals);
            const output = await pool.getSwapOutput(inputAsset.address, outputAsset.address, inputQuantityExact);
            chai_1.expect(output, "getSwapOutput call output").eq(outputExpectedExact);
        }
    };
    /**
     * @dev Asserts that a swap meets the basic validation conditions, i.e. updates
     * state and affects actors balances in the correct manner
     * @param fd Object containing relevant base level contract info on system
     * @param poolContract FeederPool instance upon which to call swap
     * @param inputAsset feeder, mStable or main pool asset to swap from sender and into the pool
     * @param outputAsset feeder, mStable or main pool asset to swap to sender and out of the pool
     * @param inputQuantity amount of the input asset.
     * @param outputExpected expected amount of output assets
     * @param minOutputQuantity minimum amount of the output asset
     * @param quantitiesAreExact false (default) if the input, min output and output expected quantities need to be converted to base units
     * @param sender Who should send the tx? Or default
     * @param recipient Who should receive the output? Or default
     * @param expectSwapFee Should this swap incur a fee?
     */
    const assertSwap = async (fd, inputAsset, outputAsset, inputQuantity, outputExpected, minOutputQuantity = 0, quantitiesAreExact = true, recipient = sa.default.address, sender = sa.default, skipEmits = false, looseAmounts = false) => {
        const pool = fd.pool.connect(sender.signer);
        const inputAssetDecimals = await inputAsset.decimals();
        const inputQuantityExact = quantitiesAreExact ? math_1.BN.from(inputQuantity) : math_1.simpleToExactAmount(inputQuantity, inputAssetDecimals);
        const outputDecimals = await outputAsset.decimals();
        const outputExpectedExact = quantitiesAreExact ? math_1.BN.from(outputExpected) : math_1.simpleToExactAmount(outputExpected, outputDecimals);
        const minOutputQuantityExact = quantitiesAreExact
            ? math_1.BN.from(minOutputQuantity)
            : math_1.simpleToExactAmount(minOutputQuantity, outputDecimals);
        //    Get basic before data about the actors balances
        const swapperInputBalBefore = await inputAsset.balanceOf(sender.address);
        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient);
        //    Get basic before data on the swap assets
        const inputAssetBefore = await feederMachine.getAsset(details, inputAsset.address);
        const outputAssetBefore = await feederMachine.getAsset(details, outputAsset.address);
        // 2. Do the necessary approvals and make the calls
        await feederMachine.approveFeeder(inputAsset, pool.address, inputQuantityExact, sender.signer, true);
        //    Call the swap output function to check if results match
        const swapOutput = await pool.getSwapOutput(inputAsset.address, outputAsset.address, inputQuantityExact);
        if (looseAmounts) {
            assertions_1.assertBNClosePercent(swapOutput, outputExpectedExact, "0.1");
        }
        else {
            chai_1.expect(swapOutput, "swap output").to.eq(outputExpectedExact);
        }
        //     Expect to be used in cache
        const platformInteractionIn = await machines_1.FeederMachine.getPlatformInteraction(pool, "deposit", inputQuantityExact, inputAssetBefore);
        const platformInteractionOut = await machines_1.FeederMachine.getPlatformInteraction(pool, "withdrawal", swapOutput, outputAssetBefore);
        // FIXME can await when Waffle 3.2.2 is included in @nomiclabs/hardhat-waffle
        // https://github.com/EthWorks/Waffle/issues/119
        const swapTx = pool.swap(inputAsset.address, outputAsset.address, inputQuantityExact, minOutputQuantityExact, recipient);
        // 4. Validate any basic events that should occur
        if (!skipEmits) {
            await chai_1.expect(swapTx).to.emit(pool, "Swapped");
            // .withArgs(sender.address, inputAsset.address, outputAsset.address, outputExpectedExact, scaledFee, recipient)
            // Input Transfer event
            await chai_1.expect(swapTx, "Transfer event for input asset from sender to platform integration or mAsset")
                .to.emit(inputAsset, "Transfer")
                .withArgs(sender.address, inputAssetBefore.integrator ? inputAssetBefore.integratorAddr : pool.address, inputQuantityExact);
            await chai_1.expect(swapTx, "Transfer event for output asset from platform integration or mAsset to recipient")
                .to.emit(outputAsset, "Transfer")
                .withArgs(outputAssetBefore.integrator ? outputAssetBefore.integratorAddr : pool.address, recipient, swapOutput);
            await swapTx;
            const inputIntegratorBalAfter = await inputAssetBefore.contract.balanceOf(inputAssetBefore.integrator ? inputAssetBefore.integratorAddr : pool.address);
            chai_1.expect(inputIntegratorBalAfter, "Input destination raw balance").eq(platformInteractionIn.rawBalance);
            const outputIntegratorBalAfter = await outputAssetBefore.contract.balanceOf(outputAssetBefore.integrator ? outputAssetBefore.integratorAddr : pool.address);
            chai_1.expect(outputIntegratorBalAfter, "Output source raw balance").eq(platformInteractionOut.rawBalance);
        }
        else {
            await swapTx;
        }
        // 5. Validate output state
        //  Input
        //    Lending market
        // if (platformInteractionIn.expectInteraction) {
        //     await expect(swapTx)
        //         .to.emit(platform, "Deposit")
        //         .withArgs(inputAsset.address, inputAssetBefore.pToken, platformInteractionIn.amount)
        // }
        //    Sender should have less input bAsset after
        const swapperAssetBalAfter = await inputAsset.balanceOf(sender.address);
        chai_1.expect(swapperAssetBalAfter, "swapper input asset balance after").eq(swapperInputBalBefore.sub(inputQuantityExact));
        //    VaultBalance should update for input asset
        const inputAssetAfter = await feederMachine.getAsset(details, inputAsset.address);
        chai_1.expect(math_1.BN.from(inputAssetAfter.vaultBalance), "input asset balance after").eq(math_1.BN.from(inputAssetBefore.vaultBalance).add(inputQuantityExact));
        //  Output
        //    Lending market
        // if (platformInteractionOut.expectInteraction) {
        //     await expect(swapTx)
        //         .to.emit(platform, "PlatformWithdrawal")
        //         .withArgs(outputAsset.address, outputAssetBefore.pToken, platformInteractionOut.amount, expectedOutputValue)
        // } else if (platformInteractionOut.hasLendingMarket) {
        //     await expect(swapTx).to.emit(platform, "Withdrawal").withArgs(outputAsset.address, ZERO_ADDRESS, expectedOutputValue)
        // }
        //    Recipient should have output asset quantity after (minus fee)
        const recipientBalAfter = await outputAsset.balanceOf(recipient);
        chai_1.expect(recipientBalAfter, "recipientBalAfter").eq(recipientOutputBalBefore.add(swapOutput));
        //    Swap estimation should match up
        chai_1.expect(swapOutput, "expectedOutputValue").eq(recipientBalAfter.sub(recipientOutputBalBefore));
        //    VaultBalance should update for output asset
        const outputAssetAfter = await feederMachine.getAsset(details, outputAsset.address);
        chai_1.expect(math_1.BN.from(outputAssetAfter.vaultBalance), "output asset after").eq(math_1.BN.from(outputAssetBefore.vaultBalance).sub(swapOutput));
        return swapOutput;
    };
    describe("swapping assets", () => {
        context("when within the invariant validator limits", () => {
            context("and different quantities", () => {
                before(async () => {
                    await runSetup();
                });
                const inputQuantities = [1, 10, 14];
                const expectedOutputQuantities = ["999966887694077240", "9996015926097917665", "13983014602503729061"];
                inputQuantities.forEach((qty, i) => {
                    it(`should swap using ${qty} quantity`, async () => {
                        const { bAssets } = details;
                        await assertSwap(details, bAssets[1], bAssets[0], math_1.simpleToExactAmount(qty), expectedOutputQuantities[i]);
                    });
                });
            });
            context("swapping different assets", () => {
                beforeEach(async () => {
                    await runSetup();
                });
                it("should swap feeder asset for mStable asset", async () => {
                    const { fAsset, mAsset } = details;
                    await assertSwap(details, fAsset, mAsset, math_1.simpleToExactAmount(10), "9996681629683510749");
                });
                it("should swap mStable asset for feeder asset", async () => {
                    const { fAsset, mAsset } = details;
                    await assertSwap(details, mAsset, fAsset, math_1.simpleToExactAmount(10), "9988685002864007486");
                });
                it("should swap feeder asset for main pool asset with 18 decimals", async () => {
                    const { mAssetDetails, fAsset } = details;
                    await assertSwap(details, fAsset, mAssetDetails.bAssets[0], math_1.simpleToExactAmount(10), math_1.simpleToExactAmount(10), undefined, undefined, undefined, undefined, true, true);
                });
                it("should swap feeder asset for main pool asset with 6 decimals", async () => {
                    const { mAssetDetails, fAsset } = details;
                    await assertSwap(details, fAsset, mAssetDetails.bAssets[1], math_1.simpleToExactAmount(10), "9990535", undefined, undefined, undefined, undefined, true);
                });
            });
            context("with a bAsset with 2 dp", () => {
                beforeEach(async () => {
                    await runSetup(false, false, [50, 50], undefined, true);
                });
                it("should swap out 1e16 per 1 base unit", async () => {
                    await assertSwap(details, details.fAsset, details.mAsset, "1", "9999986754983904", "9999986754983904");
                });
                it("should swap out 1e18 per 1e2 base unit", async () => {
                    await assertSwap(details, details.fAsset, details.mAsset, "100", "999867514754849931", "999867514754849931");
                });
            });
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should fail if identical assets", async () => {
                    const { mAsset } = details;
                    await assertFailedSwap("Invalid pair", details.pool, mAsset, mAsset, 1);
                });
                it("should fail when 0 quantity", async () => {
                    const { fAsset, mAsset } = details;
                    await assertFailedSwap("Qty==0", details.pool, mAsset, fAsset, 0);
                });
                it("should fail when less than 1e6 input", async () => {
                    const { fAsset, mAsset } = details;
                    await assertFailedSwap("Must add > 1e6 units", details.pool, mAsset, fAsset, 100, undefined, undefined, true);
                });
                it("should fail if recipient is 0x0", async () => {
                    const { fAsset, mAsset } = details;
                    await assertFailedSwap("Invalid recipient", details.pool, mAsset, fAsset, math_1.simpleToExactAmount(1), 0, "999166920850836533", true, sa.default.signer, constants_1.ZERO_ADDRESS);
                });
                it("should fail if sender doesn't have sufficient liquidity", async () => {
                    const { fAsset, mAsset } = details;
                    await assertFailedSwap("ERC20: transfer amount exceeds balance", details.pool, mAsset, fAsset, math_1.simpleToExactAmount(1), 0, "999166920850836533", true, sa.dummy1.signer, sa.dummy1.address);
                });
                it("should fail if sender doesn't give approval", async () => {
                    const { bAssets, pool } = details;
                    const input = bAssets[0];
                    const sender = sa.dummy2;
                    await input.transfer(sender.address, 10000);
                    chai_1.expect(await input.allowance(sender.address, pool.address)).eq(0);
                    chai_1.expect(await input.balanceOf(sender.address)).eq(10000);
                    await assertFailedSwap("ERC20: transfer amount exceeds balance", pool, input, bAssets[1], math_1.simpleToExactAmount(1), 0, "999166920850836533", true, sender.signer, sender.address, false);
                });
                it("should fail to swap mStable asset for main pool asset", async () => {
                    await assertFailedSwap("Invalid pair", details.pool, details.mAsset, details.mAssetDetails.bAssets[0], 10);
                });
                it("should fail to swap main pool asset for mStable asset", async () => {
                    await assertFailedSwap("Invalid pair", details.pool, details.mAssetDetails.bAssets[0], details.mAsset, 10);
                });
                it("should fail if *either* bAsset does not exist", async () => {
                    const { bAssets, pool } = details;
                    const realBasset = bAssets[0];
                    const fakeBasset = await feederMachine.mAssetMachine.loadBassetProxy("Mock", "MKK", 18, sa.default.address, 1000);
                    await assertFailedSwap("Invalid pair", pool, fakeBasset, realBasset, 1);
                    await assertFailedSwap("Invalid pair", pool, realBasset, fakeBasset, 1);
                });
                it("should fail if min qty < output qty", async () => {
                    await assertFailedSwap("Output qty < minimum qty", details.pool, details.mAsset, details.fAsset, math_1.simpleToExactAmount(1), math_1.simpleToExactAmount(1), "999166920850836533", true);
                });
            });
        });
    });
});
//# sourceMappingURL=swap.spec.js.map