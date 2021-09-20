import { Signer } from "ethers"
import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount, BN } from "@utils/math"
import { MassetMachine, StandardAccounts, FeederMachine, FeederDetails } from "@utils/machines"
import { FeederPool, MockERC20 } from "types/generated"
import { ZERO_ADDRESS } from "@utils/constants"
import { assertBNClosePercent } from "@utils/assertions"
import { Account } from "types"

describe("Feeder - Swap", () => {
    let sa: StandardAccounts
    let feederMachine: FeederMachine
    let details: FeederDetails

    const runSetup = async (
        useLendingMarkets = false,
        useInterestValidator = false,
        feederWeights?: Array<BN | number>,
        mAssetWeights?: Array<BN | number>,
        use2dp = false,
        useRedemptionPrice = false,
    ): Promise<void> => {
        details = await feederMachine.deployFeeder(feederWeights, mAssetWeights, useLendingMarkets,
            useInterestValidator, use2dp, useRedemptionPrice)
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        feederMachine = await new FeederMachine(mAssetMachine)
        sa = mAssetMachine.sa
    })

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
    const assertFailedSwap = async (
        expectedReason: string,
        poolContract: FeederPool,
        inputAsset: MockERC20,
        outputAsset: MockERC20,
        inputQuantity: BN | number | string,
        minOutputQuantity: BN | number | string = 0,
        outputExpected: BN | number | string = undefined,
        quantitiesAreExact = false,
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        approval = true,
    ): Promise<void> => {
        const pool = poolContract.connect(sender)
        if (approval) {
            await feederMachine.approveFeeder(inputAsset, pool.address, inputQuantity, sender, quantitiesAreExact)
        }
        const inputAssetDecimals = await inputAsset.decimals()
        const inputQuantityExact = quantitiesAreExact ? BN.from(inputQuantity) : simpleToExactAmount(inputQuantity, inputAssetDecimals)
        const outputDecimals = await outputAsset.decimals()
        const minOutputQuantityExact = quantitiesAreExact
            ? BN.from(minOutputQuantity)
            : simpleToExactAmount(minOutputQuantity, outputDecimals)

        // Expect the swap to revert
        await expect(
            pool.swap(inputAsset.address, outputAsset.address, inputQuantityExact, minOutputQuantityExact, recipient),
            `swap tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)

        if (outputExpected === undefined) {
            await expect(
                pool.getSwapOutput(inputAsset.address, outputAsset.address, inputQuantityExact),
                `getSwapOutput call should revert with "${expectedReason}"`,
            ).to.be.revertedWith(expectedReason)
        } else {
            const outputExpectedExact = quantitiesAreExact ? BN.from(outputExpected) : simpleToExactAmount(outputExpected, outputDecimals)
            const output = await pool.getSwapOutput(inputAsset.address, outputAsset.address, inputQuantityExact)
            expect(output, "getSwapOutput call output").eq(outputExpectedExact)
        }
    }

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
    const assertSwap = async (
        fd: FeederDetails,
        inputAsset: MockERC20,
        outputAsset: MockERC20,
        inputQuantity: BN | number | string,
        outputExpected: BN | number | string,
        minOutputQuantity: BN | number | string = 0,
        quantitiesAreExact = true,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        skipEmits = false,
        looseAmounts = false,
    ): Promise<BN> => {
        const pool = fd.pool.connect(sender.signer)

        const inputAssetDecimals = await inputAsset.decimals()
        const inputQuantityExact = quantitiesAreExact ? BN.from(inputQuantity) : simpleToExactAmount(inputQuantity, inputAssetDecimals)
        const outputDecimals = await outputAsset.decimals()
        const outputExpectedExact = quantitiesAreExact ? BN.from(outputExpected) : simpleToExactAmount(outputExpected, outputDecimals)
        const minOutputQuantityExact = quantitiesAreExact
            ? BN.from(minOutputQuantity)
            : simpleToExactAmount(minOutputQuantity, outputDecimals)

        //    Get basic before data about the actors balances
        const swapperInputBalBefore = await inputAsset.balanceOf(sender.address)
        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient)

        //    Get basic before data on the swap assets
        const inputAssetBefore = await feederMachine.getAsset(details, inputAsset.address)
        const outputAssetBefore = await feederMachine.getAsset(details, outputAsset.address)

        // 2. Do the necessary approvals and make the calls
        await feederMachine.approveFeeder(inputAsset, pool.address, inputQuantityExact, sender.signer, true)

        //    Call the swap output function to check if results match
        const swapOutput = await pool.getSwapOutput(inputAsset.address, outputAsset.address, inputQuantityExact)
        if (looseAmounts) {
            assertBNClosePercent(swapOutput, outputExpectedExact, "0.1")
        } else {
            expect(swapOutput, "swap output").to.eq(outputExpectedExact)
        }

        //     Expect to be used in cache
        const platformInteractionIn = await FeederMachine.getPlatformInteraction(pool, "deposit", inputQuantityExact, inputAssetBefore)
        const platformInteractionOut = await FeederMachine.getPlatformInteraction(pool, "withdrawal", swapOutput, outputAssetBefore)

        // FIXME can await when Waffle 3.2.2 is included in @nomiclabs/hardhat-waffle
        // https://github.com/EthWorks/Waffle/issues/119
        const swapTx = pool.swap(inputAsset.address, outputAsset.address, inputQuantityExact, minOutputQuantityExact, recipient)
        // 4. Validate any basic events that should occur
        if (!skipEmits) {
            await expect(swapTx).to.emit(pool, "Swapped")
            // .withArgs(sender.address, inputAsset.address, outputAsset.address, outputExpectedExact, scaledFee, recipient)
            // Input Transfer event
            await expect(swapTx, "Transfer event for input asset from sender to platform integration or mAsset")
                .to.emit(inputAsset, "Transfer")
                .withArgs(sender.address, inputAssetBefore.integrator ? inputAssetBefore.integratorAddr : pool.address, inputQuantityExact)
            await expect(swapTx, "Transfer event for output asset from platform integration or mAsset to recipient")
                .to.emit(outputAsset, "Transfer")
                .withArgs(outputAssetBefore.integrator ? outputAssetBefore.integratorAddr : pool.address, recipient, swapOutput)
            await swapTx

            const inputIntegratorBalAfter = await inputAssetBefore.contract.balanceOf(
                inputAssetBefore.integrator ? inputAssetBefore.integratorAddr : pool.address,
            )
            expect(inputIntegratorBalAfter, "Input destination raw balance").eq(platformInteractionIn.rawBalance)
            const outputIntegratorBalAfter = await outputAssetBefore.contract.balanceOf(
                outputAssetBefore.integrator ? outputAssetBefore.integratorAddr : pool.address,
            )
            expect(outputIntegratorBalAfter, "Output source raw balance").eq(platformInteractionOut.rawBalance)
        } else {
            await swapTx
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
        const swapperAssetBalAfter = await inputAsset.balanceOf(sender.address)
        expect(swapperAssetBalAfter, "swapper input asset balance after").eq(swapperInputBalBefore.sub(inputQuantityExact))
        //    VaultBalance should update for input asset
        const inputAssetAfter = await feederMachine.getAsset(details, inputAsset.address)
        expect(BN.from(inputAssetAfter.vaultBalance), "input asset balance after").eq(
            BN.from(inputAssetBefore.vaultBalance).add(inputQuantityExact),
        )

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
        const recipientBalAfter = await outputAsset.balanceOf(recipient)
        expect(recipientBalAfter, "recipientBalAfter").eq(recipientOutputBalBefore.add(swapOutput))
        //    Swap estimation should match up
        expect(swapOutput, "expectedOutputValue").eq(recipientBalAfter.sub(recipientOutputBalBefore))
        //    VaultBalance should update for output asset
        const outputAssetAfter = await feederMachine.getAsset(details, outputAsset.address)
        expect(BN.from(outputAssetAfter.vaultBalance), "output asset after").eq(BN.from(outputAssetBefore.vaultBalance).sub(swapOutput))

        return swapOutput
    }

    describe("swapping assets", () => {
        context("when within the invariant validator limits", () => {
            context("and different quantities", () => {
                before(async () => {
                    await runSetup()
                })
                const inputQuantities = [1, 10, 14]
                const expectedOutputQuantities = ["999966887694077240", "9996015926097917665", "13983014602503729061"]
                inputQuantities.forEach((qty, i) => {
                    it(`should swap using ${qty} quantity`, async () => {
                        const { bAssets } = details
                        await assertSwap(details, bAssets[1], bAssets[0], simpleToExactAmount(qty), expectedOutputQuantities[i])
                    })
                })
            })
            context("and different RPs", () => {
                before(async () => {
                    await runSetup(undefined, undefined, undefined,
                        undefined, undefined, true)
                })
                it("swap with RP of 0.75", async () => {
                    const { bAssets, redemptionPriceSnap } = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("750000000000000000000000000")
                    // swapping less valuable fAsset for mAsset, expect input * redemption price, about 0.75
                    await assertSwap(details, bAssets[1], bAssets[0], simpleToExactAmount(10), "7512443560746939199")
                })
                it("swap with RP of 1.0", async () => {
                    const { bAssets, redemptionPriceSnap } = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("1000000000000000000000000000")
                    // should be close to 1:1 with slight difference from rounding and slippage.
                    await assertSwap(details, bAssets[1], bAssets[0], simpleToExactAmount(10), "9990856221919260167")
                })
                it("swap with RP of 1.2", async () => {
                    const { bAssets, redemptionPriceSnap } = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("1200000000000000000000000000")
                    // swapping more valuable fAsset for mAsset, expect input * redemption price, about 1.25
                    await assertSwap(details, bAssets[1], bAssets[0], simpleToExactAmount(10), "11963626285730206459")
                })
            })
            context("swapping different assets", () => {
                beforeEach(async () => {
                    await runSetup()
                })
                it("should swap feeder asset for mStable asset", async () => {
                    const { fAsset, mAsset } = details
                    await assertSwap(details, fAsset, mAsset, simpleToExactAmount(10), "9996681629683510749")
                })
                it("should swap mStable asset for feeder asset", async () => {
                    const { fAsset, mAsset } = details
                    await assertSwap(details, mAsset, fAsset, simpleToExactAmount(10), "9992683316421789840")
                })
                it("should swap feeder asset for main pool asset with 18 decimals", async () => {
                    const { mAssetDetails, fAsset } = details
                    await assertSwap(
                        details,
                        fAsset,
                        mAssetDetails.bAssets[0],
                        simpleToExactAmount(10),
                        simpleToExactAmount(10),
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        true,
                        true,
                    )
                })
                it("should swap feeder asset for main pool asset with 6 decimals", async () => {
                    const { mAssetDetails, fAsset } = details
                    await assertSwap(
                        details,
                        fAsset,
                        mAssetDetails.bAssets[1],
                        simpleToExactAmount(10),
                        "9990535",
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        true,
                    )
                })
            })
            context("swapping different assets using redemption price of 2", () => {
                beforeEach(async () => {
                    await runSetup(undefined, undefined, undefined,
                        undefined, undefined, true)
                    const { redemptionPriceSnap } = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("2000000000000000000000000000")
                })
                it("should swap feeder asset for mStable asset", async () => {
                    const { fAsset, mAsset } = details
                    await assertSwap(details, fAsset, mAsset, simpleToExactAmount(10), "19870781263316757727")
                })
                it("should swap mStable asset for feeder asset", async () => {
                    const { fAsset, mAsset } = details
                    await assertSwap(details, mAsset, fAsset, simpleToExactAmount(10), "5023929440671813130")
                })
                it("should swap feeder asset for main pool asset with 18 decimals", async () => {
                    const { mAssetDetails, fAsset } = details
                    await assertSwap(
                        details,
                        fAsset,
                        mAssetDetails.bAssets[0],
                        simpleToExactAmount(10),
                        "19858270000000000000",
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        true,
                        true,
                    )
                })
                it("should swap feeder asset for main pool asset with 6 decimals", async () => {
                    const { mAssetDetails, fAsset } = details
                    await assertSwap(
                        details,
                        fAsset,
                        mAssetDetails.bAssets[1],
                        simpleToExactAmount(10),
                        "19858270",
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        true,
                    )
                })
            })
            context("swapping different assets using redemption price of 0.5", () => {
                beforeEach(async () => {
                    await runSetup(undefined, undefined, undefined,
                        undefined, undefined, true)
                    const { redemptionPriceSnap } = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("500000000000000000000000000")
                })
                it("should swap feeder asset for mStable asset", async () => {
                    const { fAsset, mAsset } = details
                    await assertSwap(details, fAsset, mAsset, simpleToExactAmount(10), "5025939724942443350")
                })
                it("should swap mStable asset for feeder asset", async () => {
                    const { fAsset, mAsset } = details
                    await assertSwap(details, mAsset, fAsset, simpleToExactAmount(10), "19862836775669060034")
                })
                it("should swap feeder asset for main pool asset with 18 decimals", async () => {
                    const { mAssetDetails, fAsset } = details
                    await assertSwap(
                        details,
                        fAsset,
                        mAssetDetails.bAssets[0],
                        simpleToExactAmount(10),
                        "5023929440671813130",
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        true,
                        true,
                    )
                })
                it("should swap feeder asset for main pool asset with 6 decimals", async () => {
                    const { mAssetDetails, fAsset } = details
                    await assertSwap(
                        details,
                        fAsset,
                        mAssetDetails.bAssets[1],
                        simpleToExactAmount(10),
                        "5022886",
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        true,
                    )
                })
            })
            context("with a bAsset with 2 dp", () => {
                beforeEach(async () => {
                    await runSetup(false, false, [50, 50], undefined, true)
                })
                it("should swap out 1e16 per 1 base unit", async () => {
                    await assertSwap(details, details.fAsset, details.mAsset, "1", "9999986754983904", "9999986754983904")
                })
                it("should swap out 1e18 per 1e2 base unit", async () => {
                    await assertSwap(details, details.fAsset, details.mAsset, "100", "999867514754849931", "999867514754849931")
                })
            })
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should fail if identical assets", async () => {
                    const { mAsset } = details
                    await assertFailedSwap("Invalid pair", details.pool, mAsset, mAsset, 1)
                })
                it("should fail when 0 quantity", async () => {
                    const { fAsset, mAsset } = details
                    await assertFailedSwap("Qty==0", details.pool, mAsset, fAsset, 0)
                })
                it("should fail when less than 1e6 input", async () => {
                    const { fAsset, mAsset } = details
                    await assertFailedSwap("Must add > 1e6 units", details.pool, mAsset, fAsset, 100, undefined, undefined, true)
                })
                it("should fail if recipient is 0x0", async () => {
                    const { fAsset, mAsset } = details
                    await assertFailedSwap(
                        "Invalid recipient",
                        details.pool,
                        mAsset,
                        fAsset,
                        simpleToExactAmount(1),
                        0,
                        "999566904273794708",
                        true,
                        sa.default.signer,
                        ZERO_ADDRESS,
                    )
                })
                it("should fail if sender doesn't have sufficient liquidity", async () => {
                    const { fAsset, mAsset } = details
                    await assertFailedSwap(
                        "ERC20: transfer amount exceeds balance",
                        details.pool,
                        mAsset,
                        fAsset,
                        simpleToExactAmount(1),
                        0,
                        "999566904273794708",
                        true,
                        sa.dummy1.signer,
                        sa.dummy1.address,
                    )
                })
                it("should fail if sender doesn't give approval", async () => {
                    const { bAssets, pool } = details
                    const input = bAssets[0]
                    const sender = sa.dummy2
                    await input.transfer(sender.address, 10000)
                    expect(await input.allowance(sender.address, pool.address)).eq(0)
                    expect(await input.balanceOf(sender.address)).eq(10000)
                    await assertFailedSwap(
                        "ERC20: transfer amount exceeds balance",
                        pool,
                        input,
                        bAssets[1],
                        simpleToExactAmount(1),
                        0,
                        "999566904273794708",
                        true,
                        sender.signer,
                        sender.address,
                        false,
                    )
                })
                it("should fail to swap mStable asset for main pool asset", async () => {
                    await assertFailedSwap("Invalid pair", details.pool, details.mAsset, details.mAssetDetails.bAssets[0], 10)
                })
                it("should fail to swap main pool asset for mStable asset", async () => {
                    await assertFailedSwap("Invalid pair", details.pool, details.mAssetDetails.bAssets[0], details.mAsset, 10)
                })
                it("should fail if *either* bAsset does not exist", async () => {
                    const { bAssets, pool } = details
                    const realBasset = bAssets[0]
                    const fakeBasset = await feederMachine.mAssetMachine.loadBassetProxy("Mock", "MKK", 18, sa.default.address, 1000)
                    await assertFailedSwap("Invalid pair", pool, fakeBasset, realBasset, 1)
                    await assertFailedSwap("Invalid pair", pool, realBasset, fakeBasset, 1)
                })
                it("should fail if min qty < output qty", async () => {
                    await assertFailedSwap(
                        "Output qty < minimum qty",
                        details.pool,
                        details.mAsset,
                        details.fAsset,
                        simpleToExactAmount(1),
                        simpleToExactAmount(1),
                        "999566904273794708",
                        true,
                    )
                })
            })
        })
    })
})
