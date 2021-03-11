import { Signer } from "ethers"
import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount, BN } from "@utils/math"
import { MassetDetails, MassetMachine, StandardAccounts, Account } from "@utils/machines"
import { Masset, MockERC20 } from "types/generated"
import { fullScale, ratioScale, ZERO_ADDRESS } from "@utils/constants"
import { assertBNSlightlyGTPercent, assertBasketIsHealthy } from "@utils/assertions"
import { BassetStatus } from "@utils/mstable-objects"

// (AS) - test cases to add:
//  - whenHealthy flag
//  - asserting swapoutput < min qty by setting `multiplier` on MockValidator
describe("Masset - Swap", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine

    let details: MassetDetails

    /**
     * @dev (Re)Sets the local variables for this test file
     * @param seedBasket mints 25 tokens for each bAsset
     * @param useTransferFees enables transfer fees on bAssets [2,3].
     */
    const runSetup = async (
        seedBasket = true,
        useTransferFees = false,
        useLendingMarkets = false,
        useMockValidator = true,
        weights: number[] = [25, 25, 25, 25],
    ): Promise<void> => {
        details = await mAssetMachine.deployMasset(useMockValidator, useLendingMarkets, useTransferFees)
        if (seedBasket) {
            await mAssetMachine.seedWithWeightings(details, weights)
        }
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        await runSetup()
    })

    /**
     * @dev Asserts that both 'swap' and 'getSwapOutput' fail for a given reason
     * @param mAsset Masset instance upon which to call swap
     * @param inputBasset Basset to swap out of
     * @param outputAsset Asset to swap in to
     * @param inputQuantity Whole units to swap out of
     * @param expectedReason What is the failure response of the contract?
     * @param sender Who should send the tx? Or default
     * @param recipient Who should receive the output? Or default
     * @param callSwapOutput Should this check be ran on 'getSwapOutput' too?
     * @param swapOutputRevertExpected Should 'getSwapOutput' revert? If so, set this to true
     * @param quantitiesAreExact false (default) if the input and min output quantities need to be converted to base units
     */
    const assertFailedSwap = async (
        mAssetContract: Masset,
        inputBasset: MockERC20,
        outputAsset: MockERC20,
        inputQuantity: string | BN | number,
        minOutputQuantity: string | BN | number,
        expectedReason: string,
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        callSwapOutput = true,
        swapOutputRevertExpected = false,
        swapOutputExpected: string | BN | number = 0,
        quantitiesAreExact = false,
    ): Promise<void> => {
        const mAsset = mAssetContract.connect(sender)
        const approval: BN = await mAssetMachine.approveMasset(inputBasset, mAsset, inputQuantity, sa.default.signer, quantitiesAreExact)

        const outputDecimals = await outputAsset.decimals()
        const minOutputQuantityExact = quantitiesAreExact
            ? BN.from(minOutputQuantity)
            : simpleToExactAmount(minOutputQuantity, outputDecimals)

        // Expect the swap to revert
        await expect(
            mAsset.swap(inputBasset.address, outputAsset.address, approval, minOutputQuantityExact, recipient),
            `swap tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)

        // If swap fails, then we would expect swap output to fail for the same reason,
        // instead of reverting, it generally returns a response
        if (callSwapOutput) {
            if (swapOutputRevertExpected) {
                await expect(
                    mAsset.getSwapOutput(inputBasset.address, outputAsset.address, approval),
                    `getSwapOutput call should revert with "${expectedReason}"`,
                ).to.be.revertedWith(expectedReason)
            } else {
                const swapOutputExpectedExact = quantitiesAreExact
                    ? BN.from(swapOutputExpected)
                    : simpleToExactAmount(swapOutputExpected, outputDecimals)
                const output = await mAsset.getSwapOutput(inputBasset.address, outputAsset.address, approval)
                expect(output, "getSwapOutput call output").eq(swapOutputExpectedExact)
            }
        }
    }

    /**
     * @dev Asserts that a swap meets the basic validation conditions, i.e. updates
     * state and affects actors balances in the correct manner
     * @param md Object containing relevant base level contract info on system
     * @param inputBasset Asset to use as input
     * @param outputAsset Asset to use as output
     * @param inputQuantity Whole units to swap out of
     * @param expectSwapFee Should this swap incur a fee?
     * @param recipient Specify a recipient if desired, else default
     * @param sender Specify a sender if desired, else default
     * @param ignoreHealthAssertions Ignore deep basket state validation?
     * @param swapQuantityIsExact true if the inputQuantity does not been to be converted to base units
     */
    const assertSwap = async (
        md: MassetDetails,
        inputBasset: MockERC20,
        outputAsset: MockERC20,
        inputQuantity: BN | number,
        expectSwapFee = true,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        ignoreHealthAssertions = false,
        swapQuantityIsExact = false,
        minOutputQuantity: BN | number = 1,
    ): Promise<BN> => {
        const { platform } = md
        const mAsset = md.mAsset.connect(sender.signer)

        // 1. Assert all state is currently valid and prepare objects
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

        //    Get basic before data about the actors balances
        const swapperInputBalBefore = await inputBasset.balanceOf(sender.address)
        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient)

        //    Get basic before data on the swap assets
        const inputBassetBefore = await mAssetMachine.getBasset(details, inputBasset.address)
        const outputBassetBefore = await mAssetMachine.getBasset(details, outputAsset.address)
        const surplusBefore = await mAsset.surplus()

        // 2. Do the necessary approvals and make the calls
        const approval0: BN = await mAssetMachine.approveMasset(
            inputBasset,
            mAsset,
            BN.from(inputQuantity),
            sender.signer,
            swapQuantityIsExact,
        )

        //    Call the swap output function to check if results match
        const expectedOutputValue = await mAsset.getSwapOutput(inputBasset.address, outputAsset.address, approval0)

        // 3. Calculate expected responses
        const inputQuantityExact = approval0

        let fee = BN.from(0)
        let scaledFee = BN.from(0)
        let feeRate = BN.from(0)
        //    If there is a fee expected, then deduct it from output
        if (expectSwapFee) {
            feeRate = await mAsset.swapFee()
            expect(feeRate, "fee rate > 0").gt(BN.from(0))
            expect(feeRate, "fee rate < fullScale / 50").lt(fullScale.div(BN.from(50)))
            fee = expectedOutputValue
                .mul(fullScale)
                .div(fullScale.sub(feeRate))
                .sub(expectedOutputValue)
            expect(fee, "fee > 0").gt(BN.from(0))
            scaledFee = fee.mul(BN.from(outputBassetBefore.ratio)).div(ratioScale)
        }
        //     Expect to be used in cache
        const platformInteractionIn = await mAssetMachine.getPlatformInteraction(mAsset, "deposit", approval0, inputBassetBefore)
        const platformInteractionOut = await mAssetMachine.getPlatformInteraction(
            mAsset,
            "withdrawal",
            expectedOutputValue,
            outputBassetBefore,
        )

        // FIXME can await when Waffle 3.2.2 is included in @nomiclabs/hardhat-waffle
        // https://github.com/EthWorks/Waffle/issues/119
        const swapTx = mAsset.swap(inputBasset.address, outputAsset.address, approval0, minOutputQuantity, recipient)
        // 4. Validate any basic events that should occur
        await expect(swapTx)
            .to.emit(mAsset, "Swapped")
            .withArgs(sender.address, inputBasset.address, outputAsset.address, expectedOutputValue, scaledFee, recipient)
        // Input Transfer event
        await expect(swapTx, "Transfer event for input bAsset from sender to platform integration or mAsset")
            .to.emit(inputBasset, "Transfer")
            .withArgs(sender.address, inputBassetBefore.integrator ? inputBassetBefore.integratorAddr : mAsset.address, inputQuantityExact)
        await expect(swapTx, "Transfer event for output bAsset from platform integration or mAsset to recipient")
            .to.emit(outputAsset, "Transfer")
            .withArgs(outputBassetBefore.integrator ? outputBassetBefore.integratorAddr : mAsset.address, recipient, expectedOutputValue)
        await swapTx

        const inputIntegratorBalAfter = await inputBassetBefore.contract.balanceOf(
            inputBassetBefore.integrator ? inputBassetBefore.integratorAddr : mAsset.address,
        )
        expect(inputIntegratorBalAfter, "Input destination raw balance").eq(platformInteractionIn.rawBalance)
        const outputIntegratorBalAfter = await outputBassetBefore.contract.balanceOf(
            outputBassetBefore.integrator ? outputBassetBefore.integratorAddr : mAsset.address,
        )
        expect(outputIntegratorBalAfter, "Output source raw balance").eq(platformInteractionOut.rawBalance)

        // 5. Validate output state
        //  Input
        //    Lending market
        if (platformInteractionIn.expectInteraction) {
            await expect(swapTx)
                .to.emit(platform, "Deposit")
                .withArgs(inputBasset.address, inputBassetBefore.pToken, platformInteractionIn.amount)
        }
        //    Sender should have less input bAsset after
        const swapperBassetBalAfter = await inputBasset.balanceOf(sender.address)
        expect(swapperBassetBalAfter, "swapperBassetBalAfter incorrect").eq(swapperInputBalBefore.sub(inputQuantityExact))
        //    VaultBalance should update for input bAsset
        const inputBassetAfter = await mAsset.getBasset(inputBasset.address)
        expect(BN.from(inputBassetAfter.data.vaultBalance), "inputBassetAfter incorrect").eq(
            BN.from(inputBassetBefore.vaultBalance).add(inputQuantityExact),
        )

        //  Output
        //    Lending market
        if (platformInteractionOut.expectInteraction) {
            await expect(swapTx)
                .to.emit(platform, "PlatformWithdrawal")
                .withArgs(outputAsset.address, outputBassetBefore.pToken, platformInteractionOut.amount, expectedOutputValue)
        } else if (platformInteractionOut.hasLendingMarket) {
            await expect(swapTx)
                .to.emit(platform, "Withdrawal")
                .withArgs(outputAsset.address, ZERO_ADDRESS, expectedOutputValue)
        }
        //    Recipient should have output asset quantity after (minus fee)
        const recipientBalAfter = await outputAsset.balanceOf(recipient)
        expect(recipientBalAfter, "recipientBalAfter incorrect").eq(recipientOutputBalBefore.add(expectedOutputValue))
        //    Swap estimation should match up
        expect(expectedOutputValue, "expectedOutputValue incorrect").eq(recipientBalAfter.sub(recipientOutputBalBefore))
        //    VaultBalance should update for output bAsset
        const outputBassetAfter = await mAsset.getBasset(outputAsset.address)
        expect(BN.from(outputBassetAfter.data.vaultBalance), "outputBassetAfter incorrect").eq(
            BN.from(outputBassetBefore.vaultBalance).sub(expectedOutputValue),
        )

        // Global
        //   Fees should accrue to surplus
        const surplusAfter = await mAsset.surplus()
        expect(BN.from(surplusAfter), "surplusAfter incorrect").eq(BN.from(surplusBefore).add(scaledFee))

        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

        return expectedOutputValue
    }

    describe("swapping assets", () => {
        context("when within the invariant validator limits", () => {
            context("and different quantities", () => {
                before(async () => {
                    await runSetup()
                })
                const testQuantities = [1, 10, 14]
                testQuantities.forEach((qty) => {
                    it(`should swap using ${qty} quantity`, async () => {
                        const { bAssets } = details
                        await assertSwap(details, bAssets[1], bAssets[0], qty)
                    })
                })
            })
            it("should swap using a different recipient to the sender", async () => {
                const { bAssets } = details
                await assertSwap(details, bAssets[0], bAssets[1], 2, true, sa.dummy1.address)
            })
            it("should swap out asset when recipient is a contract", async () => {
                const { bAssets } = details
                await assertSwap(details, bAssets[0], bAssets[1], 3, true, details.forgeValidator.address)
            })
            context("when bAssets have different decimals", () => {
                it("should swap 6 decimals bAsset for 12 decimal bAsset", async () => {
                    const { bAssets } = details
                    await assertSwap(details, bAssets[1], bAssets[2], 10, true, details.forgeValidator.address)
                })
                it("should swap 12 decimals bAsset for 6 decimal bAsset", async () => {
                    const { bAssets } = details
                    await assertSwap(details, bAssets[2], bAssets[1], 10, true, details.forgeValidator.address)
                })
                it("should swap 6 decimals bAsset for 18 decimal bAsset", async () => {
                    const { bAssets } = details
                    await assertSwap(details, bAssets[1], bAssets[3], 10, true, details.forgeValidator.address)
                })
                it("should swap 18 decimals bAsset for 18 decimal bAsset", async () => {
                    const { bAssets } = details
                    await assertSwap(details, bAssets[0], bAssets[3], 10, true, details.forgeValidator.address)
                })
            })
            it("should swap with min qty same as qty less swap fee", async () => {
                const { bAssets, mAsset } = details
                const inputBasset = bAssets[2] // wBTC 12 decimal places
                const outputBasset = bAssets[1] // sBTC 6 decimal places
                const inputQty = simpleToExactAmount(5, 12) // wBTC input qty
                const expectedOutputQty = simpleToExactAmount(4.997, 6) // min output qty = 0.06% of input
                const outputQty = await mAsset.getSwapOutput(inputBasset.address, outputBasset.address, inputQty)
                expect(outputQty, "incorrect swap output quantity").to.eq(expectedOutputQty)
                await assertSwap(
                    details,
                    inputBasset,
                    outputBasset,
                    inputQty,
                    true,
                    undefined,
                    undefined,
                    undefined,
                    true, // exact units
                    expectedOutputQty, // min output qty
                )
            })
            it("should fail if min qty < output qty", async () => {
                const { bAssets, mAsset } = details
                await assertFailedSwap(
                    mAsset,
                    bAssets[2], // wBTC 12 decimal places
                    bAssets[1], // sBTC 6 decimal places
                    simpleToExactAmount(5, 12), // sBTC input qty
                    simpleToExactAmount(4.9971, 6), // min output qty = 0.06% of input + a bit
                    "Output qty < minimum qty",
                    sa.default.signer,
                    sa.default.address,
                    false,
                    false,
                    undefined,
                    true, // exact units
                )
            })
            context("and specifying one bAsset base unit", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should fail if output has less decimals", async () => {
                    const { bAssets, mAsset } = details
                    const input = bAssets[0]
                    const output = bAssets[1]
                    expect(await input.decimals()).eq(18)
                    expect(await output.decimals()).eq(6)
                    const outputQuantity = await mAsset.getSwapOutput(input.address, output.address, 1)
                    expect(outputQuantity, "output quantity not zero").to.eq(0)
                    await assertFailedSwap(
                        mAsset,
                        input,
                        output,
                        1,
                        0,
                        "Zero output quantity",
                        sa.default.signer,
                        sa.default.address,
                        false,
                        false,
                        undefined,
                        true,
                    )
                })
                it("should swap a higher q of bAsset base units if output has more decimals", async () => {
                    const { bAssets } = details
                    const input = bAssets[1]
                    const output = bAssets[0]
                    expect(await input.decimals()).eq(6)
                    expect(await output.decimals()).eq(18)
                    await assertSwap(details, input, output, 1, true, undefined, undefined, false, true)
                })
            })
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should fail if identical bAssets", async () => {
                    const { bAssets, mAsset } = details
                    const input = bAssets[0]
                    const output = input
                    await assertFailedSwap(mAsset, input, output, 1, 0, "Invalid pair", sa.default.signer, sa.default.address, true, true)
                })
                it("should fail when 0 quantity", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedSwap(
                        mAsset,
                        bAssets[0],
                        bAssets[1],
                        0,
                        0,
                        "Invalid swap quantity",
                        sa.default.signer,
                        sa.default.address,
                        true,
                        true,
                    )
                })
                it("should fail if recipient is 0x0", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedSwap(
                        mAsset,
                        bAssets[0],
                        bAssets[1],
                        1,
                        0,
                        "Invalid recipient",
                        sa.default.signer,
                        ZERO_ADDRESS,
                        true,
                        false,
                        0.9994,
                    )
                })
                it("should fail if sender doesn't have sufficient liquidity", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedSwap(
                        mAsset,
                        bAssets[0],
                        bAssets[1],
                        1,
                        0,
                        "ERC20: transfer amount exceeds balance",
                        sa.dummy1.signer,
                        sa.dummy1.address,
                        true,
                        false,
                        0.9994,
                    )
                })
                it("should fail if sender doesn't give approval", async () => {
                    const { bAssets, mAsset } = details
                    const input = bAssets[0]
                    const sender = sa.dummy2
                    await input.transfer(sender.address, 10000)
                    expect(await input.allowance(sender.address, mAsset.address)).eq(0)
                    expect(await input.balanceOf(sender.address)).eq(10000)
                    await expect(
                        mAsset.connect(sender.signer).swap(input.address, bAssets[1].address, 5, 1, sa.default.address),
                    ).to.revertedWith("ERC20: transfer amount exceeds allowance")
                })
                it("should fail if *either* bAsset does not exist", async () => {
                    const { bAssets, mAsset } = details
                    const realBasset = bAssets[0].address
                    const fakeBasset = sa.dummy1.address
                    const recipient = sa.dummy2.address
                    const expectedReason = "Invalid asset"
                    await expect(mAsset.swap(fakeBasset, realBasset, 1, 0, recipient)).to.revertedWith(expectedReason)
                    await expect(mAsset.swap(realBasset, fakeBasset, 1, 0, recipient)).to.revertedWith(expectedReason)
                })
                it("should fail if *either* bAsset is ZERO", async () => {
                    const { bAssets, mAsset } = details
                    const realBasset = bAssets[0]
                    const fakeBasset = ZERO_ADDRESS
                    const recipient = sa.default.address
                    const expectedReason = "Invalid asset"
                    await expect(mAsset.swap(realBasset.address, fakeBasset, 1, 0, recipient)).to.revertedWith(expectedReason)
                    await expect(mAsset.getSwapOutput(realBasset.address, fakeBasset, 1)).to.revertedWith(expectedReason)
                    await expect(mAsset.swap(fakeBasset, realBasset.address, 1, 0, recipient)).to.revertedWith(expectedReason)
                    await expect(mAsset.getSwapOutput(fakeBasset, realBasset.address, 1)).to.revertedWith(expectedReason)
                })
                it("should fail using the mAsset as the input asset", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedSwap(mAsset, mAsset, bAssets[0], 1, 0, "Invalid asset", undefined, undefined, true, true)
                })
                it("should fail using an input asset not in the basket", async () => {
                    const { bAssets, mAsset } = details
                    const invalidBasset = await mAssetMachine.loadBassetProxy("Wrapped ETH", "WETH", 18)
                    await assertFailedSwap(mAsset, invalidBasset, bAssets[0], 1, 0, "Invalid asset", undefined, undefined, true, true)
                })
            })
            context("using bAssets with transfer fees", async () => {
                context("when no lending market", async () => {
                    before(async () => {
                        await runSetup(true, true)
                    })
                    context("and input has xfer fee", () => {
                        it("should have lower input and proportionately lower output", async () => {
                            const { mAsset, bAssets } = details
                            const sender = sa.default.address
                            const recipient = sa.default.address
                            const inputBasset = bAssets[3]
                            const outputAsset = bAssets[0]
                            const swapQuantity = 1

                            await assertBasketIsHealthy(mAssetMachine, details)

                            // 1. Get basic before data about the actors balances
                            const swapperInputBalBefore = await inputBasset.balanceOf(sender)
                            const recipientOutputBalBefore = await outputAsset.balanceOf(recipient)

                            //    Get basic before data on the swap assets
                            const inputBassetBefore = await mAsset.getBasset(inputBasset.address)
                            const outputBassetBefore = await mAsset.getBasset(outputAsset.address)

                            // 2. Do the necessary approvals and make the calls
                            const approval0: BN = await mAssetMachine.approveMasset(inputBasset, mAsset, swapQuantity, sa.default.signer)
                            await mAsset.swap(inputBasset.address, outputAsset.address, approval0, 0, recipient)
                            // Senders balance goes down but vaultbalance goes up by less

                            // 3. Calculate expected responses
                            const inputQuantityExact = simpleToExactAmount(swapQuantity, await inputBasset.decimals())
                            const scaledInputQuantity = simpleToExactAmount(swapQuantity, 18)
                            const expectedOutputValue = scaledInputQuantity.mul(ratioScale).div(outputBassetBefore.data.ratio)

                            const feeRate = await mAsset.swapFee()
                            const fee = expectedOutputValue.mul(feeRate).div(fullScale)

                            //  Input
                            //    Sender should have less input bAsset after
                            const swapperBassetBalAfter = await inputBasset.balanceOf(sender)
                            expect(swapperBassetBalAfter).eq(swapperInputBalBefore.sub(inputQuantityExact))
                            //    VaultBalance should update for input bAsset
                            const inputBassetAfter = await mAsset.getBasset(inputBasset.address)
                            // Assert that only >99.7 && <100% of the asset got added to the vault
                            assertBNSlightlyGTPercent(
                                inputQuantityExact,
                                BN.from(inputBassetAfter.data.vaultBalance).sub(inputBassetBefore.data.vaultBalance),
                                "0.3",
                                true,
                            )
                            //  Output
                            //    Recipient should have output asset quantity after (minus fee)
                            const recipientBalAfter = await outputAsset.balanceOf(recipient)
                            // Assert recipient only receives x amount
                            assertBNSlightlyGTPercent(
                                expectedOutputValue.sub(fee),
                                recipientBalAfter.sub(recipientOutputBalBefore),
                                "0.3",
                                true,
                            )

                            // Complete basket should remain in healthy state
                            await assertBasketIsHealthy(mAssetMachine, details)
                        })
                    })
                })
                context("when a lending market integration", async () => {
                    before(async () => {
                        await runSetup(true, true, true)
                    })
                    context("and input has xfer fee", () => {
                        it("should pass but return less output that input", async () => {
                            const { mAsset, bAssets } = details
                            const sender = sa.default.address
                            const recipient = sa.default.address
                            const inputBasset = bAssets[3]
                            const outputAsset = bAssets[0]
                            const swapQuantity = 1

                            await assertBasketIsHealthy(mAssetMachine, details)

                            // 1. Get basic before data about the actors balances
                            const swapperInputBalBefore = await inputBasset.balanceOf(sender)
                            const recipientOutputBalBefore = await outputAsset.balanceOf(recipient)

                            //    Get basic before data on the swap assets
                            const inputBassetBefore = await mAsset.getBasset(inputBasset.address)
                            const outputBassetBefore = await mAsset.getBasset(outputAsset.address)

                            // 2. Do the necessary approvals and make the calls
                            const approval0: BN = await mAssetMachine.approveMasset(inputBasset, mAsset, swapQuantity, sa.default.signer)
                            await mAsset.swap(inputBasset.address, outputAsset.address, approval0, 0, recipient)
                            // Senders balance goes down but vaultbalance goes up by less

                            // 3. Calculate expected responses
                            const inputQuantityExact = simpleToExactAmount(swapQuantity, await inputBasset.decimals())
                            const scaledInputQuantity = simpleToExactAmount(swapQuantity, 18)
                            const expectedOutputValue = scaledInputQuantity.mul(ratioScale).div(outputBassetBefore.data.ratio)

                            const feeRate = await mAsset.swapFee()
                            const fee = expectedOutputValue.mul(feeRate).div(fullScale)

                            //  Input
                            //    Sender should have less input bAsset after
                            const swapperBassetBalAfter = await inputBasset.balanceOf(sender)
                            expect(swapperBassetBalAfter).eq(swapperInputBalBefore.sub(inputQuantityExact))
                            //    VaultBalance should update for input bAsset
                            const inputBassetAfter = await mAsset.getBasset(inputBasset.address)
                            // Assert that only >99.7 && <100% of the asset got added to the vault
                            assertBNSlightlyGTPercent(
                                inputQuantityExact,
                                BN.from(inputBassetAfter.data.vaultBalance).sub(inputBassetBefore.data.vaultBalance),
                                "0.3",
                                true,
                            )
                            //  Output
                            //    Recipient should have output asset quantity after (minus fee)
                            const recipientBalAfter = await outputAsset.balanceOf(recipient)
                            // Assert recipient only receives x amount
                            assertBNSlightlyGTPercent(
                                expectedOutputValue.sub(fee),
                                recipientBalAfter.sub(recipientOutputBalBefore),
                                "0.3",
                                true,
                            )

                            // Complete basket should remain in healthy state
                            await assertBasketIsHealthy(mAssetMachine, details)
                        })
                        it("should fail if the system doesn't know about the fee", async () => {
                            const { bAssets, mAsset } = details
                            await mAsset.connect(sa.governor.signer).setTransferFeesFlag(bAssets[3].address, false)
                            await assertFailedSwap(
                                mAsset,
                                bAssets[3],
                                bAssets[0],
                                1,
                                0,
                                "Asset not fully transferred",
                                sa.default.signer,
                                sa.default.address,
                                false,
                            )
                        })
                    })
                })
                describe("when output has xfer fee", async () => {
                    before(async () => {
                        await runSetup(true, true)
                    })
                    it("should have same input but lower physical output", async () => {
                        const { mAsset, bAssets } = details
                        const sender = sa.default.address
                        const recipient = sa.default.address
                        const inputBasset = bAssets[0]
                        const outputAsset = bAssets[3]
                        const swapQuantity = 1

                        await assertBasketIsHealthy(mAssetMachine, details)

                        // 1. Get basic before data about the actors balances
                        const swapperInputBalBefore = await inputBasset.balanceOf(sender)
                        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient)

                        //    Get basic before data on the swap assets
                        const inputBassetBefore = await mAsset.getBasset(inputBasset.address)
                        const outputBassetBefore = await mAsset.getBasset(outputAsset.address)

                        // 2. Do the necessary approvals and make the calls
                        const approval0: BN = await mAssetMachine.approveMasset(inputBasset, mAsset, swapQuantity, sa.default.signer)
                        await mAsset.swap(inputBasset.address, outputAsset.address, approval0, 0, recipient)
                        // Senders balance goes down but vaultbalance goes up by less

                        // 3. Calculate expected responses
                        const inputQuantityExact = simpleToExactAmount(swapQuantity, await inputBasset.decimals())
                        const scaledInputQuantity = simpleToExactAmount(swapQuantity, 18)
                        const expectedOutputValue = scaledInputQuantity.mul(ratioScale).div(outputBassetBefore.data.ratio)

                        const feeRate = await mAsset.swapFee()
                        const fee = expectedOutputValue.mul(feeRate).div(fullScale)

                        //  Input
                        //    Sender should have less input bAsset after
                        const swapperBassetBalAfter = await inputBasset.balanceOf(sender)
                        expect(swapperBassetBalAfter).eq(swapperInputBalBefore.sub(inputQuantityExact))
                        //    VaultBalance should update for input bAsset
                        const inputBassetAfter = await mAsset.getBasset(inputBasset.address)
                        expect(BN.from(inputBassetAfter.data.vaultBalance)).eq(
                            BN.from(inputBassetBefore.data.vaultBalance).add(inputQuantityExact),
                        )
                        //  Output
                        //    Recipient should have output asset quantity after (minus fee)
                        const recipientBalAfter = await outputAsset.balanceOf(recipient)
                        // Assert recipient only receives x amount
                        assertBNSlightlyGTPercent(
                            expectedOutputValue.sub(fee),
                            recipientBalAfter.sub(recipientOutputBalBefore),
                            "0.3",
                            true,
                        )

                        // Complete basket should remain in healthy state
                        await assertBasketIsHealthy(mAssetMachine, details)
                    })
                    it("should continue to pay out", async () => {
                        const { bAssets, mAsset } = details
                        const sender = sa.default.address
                        const recipient = sa.dummy1.address
                        const inputBasset = bAssets[0]
                        const outputAsset = bAssets[3]
                        const swapQuantity = 1
                        await mAsset.connect(sa.governor.signer).setTransferFeesFlag(outputAsset.address, false)

                        // 1. Get basic before data about the actors balances
                        const swapperInputBalBefore = await inputBasset.balanceOf(sender)
                        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient)

                        //    Get basic before data on the swap assets
                        const inputBassetBefore = await mAsset.getBasset(inputBasset.address)
                        const outputBassetBefore = await mAsset.getBasset(outputAsset.address)

                        // 2. Do the necessary approvals and make the calls
                        const approval0: BN = await mAssetMachine.approveMasset(inputBasset, mAsset, swapQuantity, sa.default.signer)
                        await mAsset.swap(inputBasset.address, outputAsset.address, approval0, 0, recipient)
                        // Senders balance goes down but vaultbalance goes up by less

                        // 3. Calculate expected responses
                        const inputQuantityExact = simpleToExactAmount(swapQuantity, await inputBasset.decimals())
                        const scaledInputQuantity = simpleToExactAmount(swapQuantity, 18)
                        const expectedOutputValue = scaledInputQuantity.mul(ratioScale).div(outputBassetBefore.data.ratio)

                        const feeRate = await mAsset.swapFee()
                        const fee = expectedOutputValue.mul(feeRate).div(fullScale)

                        //  Input
                        //    Sender should have less input bAsset after
                        const swapperBassetBalAfter = await inputBasset.balanceOf(sender)
                        expect(swapperBassetBalAfter).eq(swapperInputBalBefore.sub(inputQuantityExact))
                        //    VaultBalance should update for input bAsset
                        const inputBassetAfter = await mAsset.getBasset(inputBasset.address)
                        expect(BN.from(inputBassetAfter.data.vaultBalance)).eq(
                            BN.from(inputBassetBefore.data.vaultBalance).add(inputQuantityExact),
                        )
                        //  Output
                        //    Recipient should have output asset quantity after (minus fee)
                        const recipientBalAfter = await outputAsset.balanceOf(recipient)
                        // Assert recipient only receives x amount
                        assertBNSlightlyGTPercent(
                            expectedOutputValue.sub(fee),
                            recipientBalAfter.sub(recipientOutputBalBefore),
                            "0.3",
                            true,
                        )
                    })
                })
            })
            context("with an affected bAsset", async () => {
                beforeEach(async () => {
                    await runSetup()
                })
                it("should fail if input basset has lost its peg", async () => {
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)

                    const input = bAssets[0]
                    const output = bAssets[1]

                    await mAsset.connect(sa.governor.signer).handlePegLoss(input.address, true)
                    const inputBasset = await mAsset.getBasset(input.address)
                    expect(inputBasset.personal.status).to.eq(BassetStatus.BrokenBelowPeg)
                    const outputBasset = await mAsset.getBasset(output.address)
                    expect(outputBasset.personal.status).to.eq(BassetStatus.Normal)
                    await assertFailedSwap(mAsset, input, output, 1, 0, "Unhealthy", undefined, undefined, true, false, 0.9994)
                })
                it("should fail if output basset has lost its peg", async () => {
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)

                    const input = bAssets[0]
                    const output = bAssets[1]

                    await mAsset.connect(sa.governor.signer).handlePegLoss(output.address, true)
                    const inputBasset = await mAsset.getBasset(input.address)
                    expect(inputBasset.personal.status).to.eq(BassetStatus.Normal)
                    const outputBasset = await mAsset.getBasset(output.address)
                    expect(outputBasset.personal.status).to.eq(BassetStatus.BrokenBelowPeg)
                    await assertFailedSwap(mAsset, input, output, 1, 0, "Unhealthy", undefined, undefined, true, false, 0.9994)
                })
            })
        })
        context("with assets connected to lending markets", async () => {
            before(async () => {
                await runSetup(true, false, true)
            })
            it("should deposit into and withdraw from the lending market", async () => {
                const { bAssets } = details
                const [input, output] = bAssets
                // On setup, 25 of each bAsset, none of which in lending markets
                // Calling seedWithWeightings will deposit 5 of each into lending market
                await mAssetMachine.seedWithWeightings(details, [1, 1, 1, 1])
                // Swap in 7 and out 7, and it will do a deposit into lending market, and withdrawal
                await assertSwap(details, input, output, 7)
                // Swap in 1 and out 1, and it will do no deposit, but simply withdrawRaw
                await assertSwap(details, input, output, 1)
            })
        })
    })
})
