/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable no-await-in-loop */

import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";

import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { BassetStatus } from "@utils/mstable-objects";
import { ZERO_ADDRESS, fullScale, ratioScale } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import { BasketComposition } from "../../types";

const { expect } = envSetup.configure();

const MockERC20 = artifacts.require("MockERC20");
const MockAToken = artifacts.require("MockAToken");
const MockAave = artifacts.require("MockAaveV2");
const AaveIntegration = artifacts.require("AaveIntegration");

interface SwapDetails {
    swapOutput: BN;
    feeRate: BN;
}

contract("Masset - Swap", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    /**
     * @dev (Re)Sets the local variables for this test file
     * @param seedBasket Should we add base layer liquidity to the vault?
     * @param enableUSDTFee Enable the bAssets with transfer fees?
     */
    const runSetup = async (seedBasket = true, enableUSDTFee = false): Promise<void> => {
        massetDetails = seedBasket
            ? await massetMachine.deployMassetAndSeedBasket(enableUSDTFee)
            : await massetMachine.deployMasset(enableUSDTFee);
        await assertBasketIsHealthy(massetMachine, massetDetails);
    };

    /**
     * @dev Asserts that both 'swap' and 'getSwapOutput' fail for a given reason
     * @param mAsset Masset instance upon which to call swap
     * @param inputBasset Basset to swap out of
     * @param outputAsset Asset to swap in to
     * @param amount Whole units to swap out of
     * @param expectedReason What is the failure response of the contract?
     * @param recipient Who should send the tx? Or default
     * @param recipient Who should receive the output? Or default
     * @param callSwapOutput Should this check be ran on 'getSwapOutput' too?
     * @param swapOutputRevertExpected Should 'getSwapOutput' revert? If so, set this to true
     */
    const assertFailedSwap = async (
        mAsset: t.MassetInstance,
        inputBasset: t.MockERC20Instance,
        outputAsset: t.MockERC20Instance,
        amount: string | BN | number,
        expectedReason: string,
        sender = sa.default,
        recipient = sa.default,
        callSwapOutput = true,
        swapOutputRevertExpected = false,
        inputAmountIsExact = false,
    ): Promise<void> => {
        const approval: BN = await massetMachine.approveMasset(
            inputBasset,
            mAsset,
            amount,
            sa.default,
            inputAmountIsExact,
        );

        // Expect the swap to revert
        await expectRevert(
            mAsset.swap(inputBasset.address, outputAsset.address, approval, recipient, {
                from: sender,
            }),
            expectedReason,
        );

        // If swap fails, then we would expect swap output to fail for the same reason,
        // instead of reverting, it generally returns a response
        if (callSwapOutput) {
            if (swapOutputRevertExpected) {
                await expectRevert(
                    mAsset.getSwapOutput(inputBasset.address, outputAsset.address, approval, {
                        from: sender,
                    }),
                    expectedReason,
                );
            } else {
                const swapOutputResponse = await mAsset.getSwapOutput(
                    inputBasset.address,
                    outputAsset.address,
                    approval,
                );
                const [valid, actualReason, output] = swapOutputResponse;
                expect(valid).eq(false);
                expect(actualReason).eq(expectedReason);
                expect(output).bignumber.eq(new BN(0));
            }
        }
    };

    /**
     * @dev Asserts that a swap meets the basic validation conditions, i.e. updates
     * state and affects actors balances in the correct manner
     * @param md Object containing relevant base level contract info on system
     * @param inputBasset Asset to use as input
     * @param outputAsset Asset to use as output
     * @param swapQuantity Whole units to swap out of
     * @param expectSwapFee Should this swap incur a fee?
     * @param recipient Specify a recipient if desired, else default
     * @param sender Specify a sender if desired, else default
     * @param ignoreHealthAssertions Ignore deep basket state validation?
     */
    const assertSwap = async (
        md: MassetDetails,
        inputBasset: t.MockERC20Instance,
        outputAsset: t.MockERC20Instance,
        swapQuantity: BN | number,
        expectSwapFee: boolean,
        recipient: string = sa.default,
        sender: string = sa.default,
        ignoreHealthAssertions = false,
        swapQuantityIsBaseUnits = false,
    ): Promise<SwapDetails> => {
        const { mAsset, basketManager } = md;

        // 1. Assert all state is currently valid and prepare objects
        //    Assert that the basket is in a healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
        //    Is this swap actually a single bAsset mint?
        const isMint = mAsset.address === outputAsset.address;

        //    Get basic before data about the actors balances
        const swapperInputBalBefore = await inputBasset.balanceOf(sender);
        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient);

        //    Get basic before data on the swap assets
        const inputBassetBefore = await massetMachine.getBasset(basketManager, inputBasset.address);
        const inputIntegratorBalBefore = await inputBassetBefore.contract.balanceOf(
            inputBassetBefore.integrator.address,
        );
        const outputBassetBefore = isMint
            ? null
            : await massetMachine.getBasset(basketManager, outputAsset.address);
        const outputIntegratorBalBefore = isMint
            ? new BN(0)
            : await outputBassetBefore.contract.balanceOf(outputBassetBefore.integrator.address);
        const surplusBefore = await mAsset.surplus();

        // 2. Do the necessary approvals and make the calls
        const approval0: BN = await massetMachine.approveMasset(
            inputBasset,
            mAsset,
            new BN(swapQuantity),
            sender,
            swapQuantityIsBaseUnits,
        );

        //    Call the swap output function to check if results match
        const swapOutputResponse = await mAsset.getSwapOutput(
            inputBasset.address,
            outputAsset.address,
            approval0,
            { from: sender },
        );

        // 3. Calculate expected responses
        const inputQuantityExact = swapQuantityIsBaseUnits
            ? new BN(swapQuantity)
            : simpleToExactAmount(swapQuantity, await inputBasset.decimals());
        const scaledInputQuantity = swapQuantityIsBaseUnits
            ? new BN(swapQuantity).mul(new BN(inputBassetBefore.ratio)).div(ratioScale)
            : simpleToExactAmount(swapQuantity, 18);
        const expectedOutputValue = isMint
            ? scaledInputQuantity
            : scaledInputQuantity.mul(ratioScale).div(new BN(outputBassetBefore.ratio));
        let fee = new BN(0);
        let scaledFee = new BN(0);
        let feeRate = new BN(0);
        //    If there is a fee expected, then deduct it from output
        if (expectSwapFee && !isMint) {
            feeRate = await mAsset.swapFee();
            expect(feeRate).bignumber.gt(new BN(0) as any);
            expect(feeRate).bignumber.lt(fullScale.div(new BN(50)) as any);
            fee = expectedOutputValue.mul(feeRate).div(fullScale);
            expect(fee).bignumber.gt(new BN(0) as any);
            scaledFee = fee.mul(new BN(outputBassetBefore.ratio)).div(ratioScale);
        }

        // Expect to be used in cache
        const platformInteraction_in = await massetMachine.getPlatformInteraction(
            mAsset,
            "deposit",
            approval0,
            inputIntegratorBalBefore,
            inputBassetBefore,
        );
        const platformInteraction_out = isMint
            ? null
            : await massetMachine.getPlatformInteraction(
                  mAsset,
                  "withdrawal",
                  expectedOutputValue.sub(fee),
                  outputIntegratorBalBefore,
                  outputBassetBefore,
              );

        const swapTx = await mAsset.swap(
            inputBasset.address,
            outputAsset.address,
            approval0,
            recipient,
            { from: sender },
        );

        // 4. Validate any basic events that should occur
        if (isMint) {
            await expectEvent(swapTx.receipt, "Minted", {
                minter: sender,
                recipient,
                mAssetQuantity: expectedOutputValue,
                bAsset: inputBasset.address,
                bAssetQuantity: inputQuantityExact,
            });
        } else {
            await expectEvent(swapTx.receipt, "Swapped", {
                swapper: sender,
                input: inputBasset.address,
                output: outputAsset.address,
                outputAmount: expectedOutputValue.sub(fee),
                recipient,
            });
            if (expectSwapFee) {
                await expectEvent(swapTx.receipt, "PaidFee", {
                    payer: sender,
                    asset: outputAsset.address,
                    feeQuantity: fee,
                });
            }

            await expectEvent(swapTx.receipt, "Transfer", {
                from: sender,
                to: await basketManager.getBassetIntegrator(inputBasset.address),
                value: inputQuantityExact,
            });
        }

        const inputIntegratorBalAfter = await inputBassetBefore.contract.balanceOf(
            inputBassetBefore.integrator.address,
        );
        expect(inputIntegratorBalAfter).bignumber.eq(platformInteraction_in.rawBalance);
        const outputIntegratorBalAfter = isMint
            ? new BN(0)
            : await outputBassetBefore.contract.balanceOf(outputBassetBefore.integrator.address);
        if (!isMint) {
            expect(outputIntegratorBalAfter).bignumber.eq(platformInteraction_out.rawBalance);
        }

        // 5. Validate output state
        //    Swap estimation should match up
        const [swapValid, swapReason, swapOutput] = swapOutputResponse;
        expect(swapValid).eq(true);
        expect(swapReason).eq("");
        expect(swapOutput).bignumber.eq(expectedOutputValue.sub(fee));

        //  Input
        //    Deposits into lending platform
        const emitter = await AaveIntegration.new();
        if (platformInteraction_in.expectInteraction) {
            await expectEvent.inTransaction(swapTx.tx, emitter, "Deposit", {
                _bAsset: inputBasset.address,
                _amount: platformInteraction_in.amount,
            });
        }
        //    Sender should have less input bAsset after
        const swapperBassetBalAfter = await inputBasset.balanceOf(sender);
        expect(swapperBassetBalAfter).bignumber.eq(swapperInputBalBefore.sub(inputQuantityExact));
        //    VaultBalance should update for input bAsset
        const inputBassetAfter = await basketManager.getBasset(inputBasset.address);
        expect(new BN(inputBassetAfter.vaultBalance)).bignumber.eq(
            new BN(inputBassetBefore.vaultBalance).add(inputQuantityExact),
        );

        //  Output
        //    Recipient should have output asset quantity after (minus fee)
        const recipientBalAfter = await outputAsset.balanceOf(recipient);
        expect(recipientBalAfter).bignumber.eq(
            recipientOutputBalBefore.add(expectedOutputValue.sub(fee)),
        );
        //    VaultBalance should update for output bAsset
        if (!isMint) {
            const outputBassetAfter = await basketManager.getBasset(outputAsset.address);
            //    Should deduct the FULL amount, including fee, from the vault balance
            expect(new BN(outputBassetAfter.vaultBalance)).bignumber.eq(
                new BN(outputBassetBefore.vaultBalance).sub(expectedOutputValue.sub(fee)),
            );

            if (platformInteraction_out.expectInteraction) {
                await expectEvent.inTransaction(swapTx.tx, emitter, "PlatformWithdrawal", {
                    bAsset: outputAsset.address,
                    totalAmount: platformInteraction_out.amount,
                    userAmount: expectedOutputValue.sub(fee),
                });
            } else {
                await expectEvent.inTransaction(swapTx.tx, emitter, "Withdrawal", {
                    _bAsset: outputAsset.address,
                    _amount: expectedOutputValue.sub(fee),
                });
            }
            const surplusAfter = await mAsset.surplus();
            expect(new BN(surplusAfter)).bignumber.eq(new BN(surplusBefore).add(scaledFee));
        }

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
        return {
            swapOutput,
            feeRate,
        };
    };

    /**
     * @dev Seeds the mAsset basket with custom weightings
     * @param md Masset details object containing all deployed contracts
     * @param weights Whole numbers of mAsset to mint for each given bAsset
     */
    const seedWithWeightings = async (md: MassetDetails, weights: Array<BN>): Promise<void> => {
        const { mAsset, bAssets } = md;
        const approvals = await Promise.all(
            bAssets.map((b, i) => massetMachine.approveMasset(b, mAsset, weights[i], sa.default)),
        );
        await mAsset.mintMulti(
            bAssets.map((b) => b.address),
            approvals,
            sa.default,
            { from: sa.default },
        );
    };

    before("Init mock machines", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);
    });

    describe("swapping assets", () => {
        context("when the weights are within the ForgeValidator limit", () => {
            context("and sending to a specific recipient", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should swap two bAssets", async () => {
                    const { bAssets } = massetDetails;
                    await assertSwap(massetDetails, bAssets[0], bAssets[1], 1, true, sa.dummy1);
                });
                it("should fail if recipient is 0x0", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    await assertFailedSwap(
                        mAsset,
                        bAssets[0],
                        bAssets[1],
                        1,
                        "Missing recipient address",
                        sa.default,
                        ZERO_ADDRESS,
                        false,
                    );
                });
                it("should swap out asset when recipient is a contract", async () => {
                    const { bAssets, basketManager } = massetDetails;
                    await assertSwap(
                        massetDetails,
                        bAssets[0],
                        bAssets[1],
                        1,
                        true,
                        basketManager.address,
                    );
                });
                it("should fail if there is insufficient liquidity", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    await assertFailedSwap(
                        mAsset,
                        bAssets[0],
                        bAssets[1],
                        1000,
                        "Not enough liquidity",
                    );
                });
            });
            context("and specifying one bAsset base unit", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should fail if output has less decimals", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const input = bAssets[0];
                    const output = bAssets[1];
                    expect(await input.decimals()).bignumber.eq(new BN(12));
                    expect(await output.decimals()).bignumber.eq(new BN(6));
                    await assertFailedSwap(
                        mAsset,
                        input,
                        output,
                        1,
                        "Must withdraw something",
                        sa.default,
                        sa.default,
                        false,
                        false,
                        true,
                    );
                });
                it("should swap a higher q of bAsset base units if output has more decimals", async () => {
                    const { bAssets } = massetDetails;
                    const input = bAssets[1];
                    const output = bAssets[0];
                    expect(await input.decimals()).bignumber.eq(new BN(6));
                    expect(await output.decimals()).bignumber.eq(new BN(12));
                    const swapDetails = await assertSwap(
                        massetDetails,
                        input,
                        output,
                        1,
                        true,
                        undefined,
                        undefined,
                        false,
                        true,
                    );
                    expect(swapDetails.swapOutput).bignumber.eq(
                        simpleToExactAmount(1, 6)
                            .mul(fullScale.sub(swapDetails.feeRate))
                            .div(fullScale),
                    );
                });
            });
            context("and using the mAsset as the output asset", async () => {
                it("should mint mAssets instead of swapping", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    await assertSwap(
                        massetDetails,
                        bAssets[0],
                        await MockERC20.at(mAsset.address),
                        1,
                        true,
                    );
                });
            });
            context("and using the mAsset as the input asset", async () => {
                it("should fail", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    await assertFailedSwap(
                        mAsset,
                        await MockERC20.at(mAsset.address),
                        bAssets[0],
                        1,
                        "Input asset does not exist",
                    );
                });
            });
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should revert when 0 quantity", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    await assertFailedSwap(
                        mAsset,
                        bAssets[0],
                        bAssets[1],
                        0,
                        "Invalid quantity",
                        sa.default,
                        sa.default,
                        false,
                    );
                    const swapOutputResponse = await mAsset.getSwapOutput(
                        bAssets[0].address,
                        bAssets[1].address,
                        0,
                    );
                    const [valid, , output] = swapOutputResponse;
                    expect(valid).eq(true);
                    expect(output).bignumber.eq(new BN(0));
                });
                it("should fail if sender doesn't have balance", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    await assertFailedSwap(
                        mAsset,
                        bAssets[0],
                        bAssets[1],
                        1,
                        "SafeERC20: low-level call failed",
                        sa.dummy1,
                        sa.default,
                        false,
                    );
                });
                it("should fail if sender doesn't give approval", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const input = bAssets[0];
                    const sender = sa.dummy2;
                    await input.transfer(sender, new BN(10000));
                    expect(await input.allowance(sender, mAsset.address)).bignumber.eq(new BN(0));
                    expect(await input.balanceOf(sender)).bignumber.eq(new BN(10000));
                    await expectRevert(
                        mAsset.swap(input.address, bAssets[1].address, new BN(100), sa.default, {
                            from: sender,
                        }),
                        "SafeERC20: low-level call failed",
                    );
                });
                it("should fail if *either* bAsset does not exist", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const realBasset = bAssets[0].address;
                    const fakeBasset = sa.dummy1;
                    const recipient = sa.dummy1;
                    await expectRevert(
                        mAsset.swap(fakeBasset, realBasset, new BN(1), recipient),
                        "Input asset does not exist",
                    );
                    await expectRevert(
                        mAsset.swap(realBasset, fakeBasset, new BN(1), recipient),
                        "Output asset does not exist",
                    );
                });
                it("should fail if *either* bAsset is ZERO", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const realBasset = bAssets[0];
                    const fakeBasset = ZERO_ADDRESS;
                    const expectedReason = "Invalid swap asset addresses";
                    await expectRevert(
                        mAsset.swap(realBasset.address, fakeBasset, new BN(1), sa.default),
                        expectedReason,
                    );
                    await expectRevert(
                        mAsset.getSwapOutput(realBasset.address, fakeBasset, new BN(1)),
                        expectedReason,
                    );
                    await expectRevert(
                        mAsset.swap(fakeBasset, realBasset.address, new BN(1), sa.default),
                        expectedReason,
                    );
                    await expectRevert(
                        mAsset.getSwapOutput(fakeBasset, realBasset.address, new BN(1)),
                        expectedReason,
                    );
                });
                it("should fail if given identical bAssets", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const input = bAssets[0];
                    const output = input;
                    await assertFailedSwap(
                        mAsset,
                        input,
                        output,
                        1,
                        "Cannot swap the same asset",
                        sa.default,
                        sa.default,
                        true,
                        true,
                    );
                });
            });
            context("using bAssets with transfer fees", async () => {
                // Fee is on USDT or bAssets[3]
                describe("when input has xfer fee", async () => {
                    before(async () => {
                        await runSetup(true, true);
                    });
                    it("should have lower input and proportionately lower output", async () => {
                        const { mAsset, basketManager, bAssets } = massetDetails;
                        const sender = sa.default;
                        const recipient = sa.default;
                        const inputBasset = bAssets[3];
                        const outputAsset = bAssets[0];
                        const swapQuantity = new BN(1);

                        await assertBasketIsHealthy(massetMachine, massetDetails);

                        // 1. Get basic before data about the actors balances
                        const swapperInputBalBefore = await inputBasset.balanceOf(sender);
                        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient);

                        //    Get basic before data on the swap assets
                        const inputBassetBefore = await basketManager.getBasset(
                            inputBasset.address,
                        );
                        const outputBassetBefore = await basketManager.getBasset(
                            outputAsset.address,
                        );

                        // 2. Do the necessary approvals and make the calls
                        const approval0: BN = await massetMachine.approveMasset(
                            inputBasset,
                            mAsset,
                            swapQuantity,
                            sender,
                        );
                        await mAsset.swap(
                            inputBasset.address,
                            outputAsset.address,
                            approval0,
                            recipient,
                            { from: sender },
                        );
                        // Senders balance goes down but vaultbalance goes up by less

                        // 3. Calculate expected responses
                        const inputQuantityExact = simpleToExactAmount(
                            swapQuantity,
                            await inputBasset.decimals(),
                        );
                        const scaledInputQuantity = simpleToExactAmount(swapQuantity, 18);
                        const expectedOutputValue = scaledInputQuantity
                            .mul(ratioScale)
                            .div(new BN(outputBassetBefore.ratio));

                        const feeRate = await mAsset.swapFee();
                        const fee = expectedOutputValue.mul(feeRate).div(fullScale);

                        //  Input
                        //    Sender should have less input bAsset after
                        const swapperBassetBalAfter = await inputBasset.balanceOf(sender);
                        expect(swapperBassetBalAfter).bignumber.eq(
                            swapperInputBalBefore.sub(inputQuantityExact),
                        );
                        //    VaultBalance should update for input bAsset
                        const inputBassetAfter = await basketManager.getBasset(inputBasset.address);
                        // Assert that only >99.7 && <100% of the asset got added to the vault
                        assertBNSlightlyGTPercent(
                            inputQuantityExact,
                            new BN(inputBassetAfter.vaultBalance).sub(
                                new BN(inputBassetBefore.vaultBalance),
                            ),
                            "0.3",
                            true,
                        );
                        //  Output
                        //    Recipient should have output asset quantity after (minus fee)
                        const recipientBalAfter = await outputAsset.balanceOf(recipient);
                        // Assert recipient only receives x amount
                        assertBNSlightlyGTPercent(
                            expectedOutputValue.sub(fee),
                            recipientBalAfter.sub(recipientOutputBalBefore),
                            "0.3",
                            true,
                        );

                        // Complete basket should remain in healthy state
                        await assertBasketIsHealthy(massetMachine, massetDetails);
                    });
                    it("should fail if the system doesn't know about the fee", async () => {
                        const { bAssets, mAsset, basketManager } = massetDetails;
                        await basketManager.setTransferFeesFlag(bAssets[3].address, false, {
                            from: sa.governor,
                        });
                        await assertFailedSwap(
                            mAsset,
                            bAssets[3],
                            bAssets[0],
                            1,
                            "Asset not fully transferred",
                            sa.default,
                            sa.default,
                            false,
                        );
                    });
                });
                describe("when output has xfer fee", async () => {
                    before(async () => {
                        await runSetup(true, true);
                    });
                    it("should have same input but lower physical output", async () => {
                        const { mAsset, basketManager, bAssets } = massetDetails;
                        const sender = sa.default;
                        const recipient = sa.default;
                        const inputBasset = bAssets[0];
                        const outputAsset = bAssets[3];
                        const swapQuantity = new BN(1);

                        await assertBasketIsHealthy(massetMachine, massetDetails);

                        // 1. Get basic before data about the actors balances
                        const swapperInputBalBefore = await inputBasset.balanceOf(sender);
                        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient);

                        //    Get basic before data on the swap assets
                        const inputBassetBefore = await basketManager.getBasset(
                            inputBasset.address,
                        );
                        const outputBassetBefore = await basketManager.getBasset(
                            outputAsset.address,
                        );

                        // 2. Do the necessary approvals and make the calls
                        const approval0: BN = await massetMachine.approveMasset(
                            inputBasset,
                            mAsset,
                            swapQuantity,
                            sender,
                        );
                        await mAsset.swap(
                            inputBasset.address,
                            outputAsset.address,
                            approval0,
                            recipient,
                            { from: sender },
                        );
                        // Senders balance goes down but vaultbalance goes up by less

                        // 3. Calculate expected responses
                        const inputQuantityExact = simpleToExactAmount(
                            swapQuantity,
                            await inputBasset.decimals(),
                        );
                        const scaledInputQuantity = simpleToExactAmount(swapQuantity, 18);
                        const expectedOutputValue = scaledInputQuantity
                            .mul(ratioScale)
                            .div(new BN(outputBassetBefore.ratio));

                        const feeRate = await mAsset.swapFee();
                        const fee = expectedOutputValue.mul(feeRate).div(fullScale);

                        //  Input
                        //    Sender should have less input bAsset after
                        const swapperBassetBalAfter = await inputBasset.balanceOf(sender);
                        expect(swapperBassetBalAfter).bignumber.eq(
                            swapperInputBalBefore.sub(inputQuantityExact),
                        );
                        //    VaultBalance should update for input bAsset
                        const inputBassetAfter = await basketManager.getBasset(inputBasset.address);
                        expect(new BN(inputBassetAfter.vaultBalance)).bignumber.eq(
                            new BN(inputBassetBefore.vaultBalance).add(inputQuantityExact),
                        );
                        //  Output
                        //    Recipient should have output asset quantity after (minus fee)
                        const recipientBalAfter = await outputAsset.balanceOf(recipient);
                        // Assert recipient only receives x amount
                        assertBNSlightlyGTPercent(
                            expectedOutputValue.sub(fee),
                            recipientBalAfter.sub(recipientOutputBalBefore),
                            "0.3",
                            true,
                        );

                        // Complete basket should remain in healthy state
                        await assertBasketIsHealthy(massetMachine, massetDetails);
                    });
                    it("should continue to pay out", async () => {
                        const { bAssets, mAsset, basketManager } = massetDetails;
                        const sender = sa.default;
                        const recipient = sa.dummy1;
                        const inputBasset = bAssets[0];
                        const outputAsset = bAssets[3];
                        const swapQuantity = new BN(1);
                        await basketManager.setTransferFeesFlag(outputAsset.address, false, {
                            from: sa.governor,
                        });

                        // 1. Get basic before data about the actors balances
                        const swapperInputBalBefore = await inputBasset.balanceOf(sender);
                        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient);

                        //    Get basic before data on the swap assets
                        const inputBassetBefore = await basketManager.getBasset(
                            inputBasset.address,
                        );
                        const outputBassetBefore = await basketManager.getBasset(
                            outputAsset.address,
                        );

                        // 2. Do the necessary approvals and make the calls
                        const approval0: BN = await massetMachine.approveMasset(
                            inputBasset,
                            mAsset,
                            swapQuantity,
                            sender,
                        );
                        await mAsset.swap(
                            inputBasset.address,
                            outputAsset.address,
                            approval0,
                            recipient,
                            { from: sender },
                        );
                        // Senders balance goes down but vaultbalance goes up by less

                        // 3. Calculate expected responses
                        const inputQuantityExact = simpleToExactAmount(
                            swapQuantity,
                            await inputBasset.decimals(),
                        );
                        const scaledInputQuantity = simpleToExactAmount(swapQuantity, 18);
                        const expectedOutputValue = scaledInputQuantity
                            .mul(ratioScale)
                            .div(new BN(outputBassetBefore.ratio));

                        const feeRate = await mAsset.swapFee();
                        const fee = expectedOutputValue.mul(feeRate).div(fullScale);

                        //  Input
                        //    Sender should have less input bAsset after
                        const swapperBassetBalAfter = await inputBasset.balanceOf(sender);
                        expect(swapperBassetBalAfter).bignumber.eq(
                            swapperInputBalBefore.sub(inputQuantityExact),
                        );
                        //    VaultBalance should update for input bAsset
                        const inputBassetAfter = await basketManager.getBasset(inputBasset.address);
                        expect(new BN(inputBassetAfter.vaultBalance)).bignumber.eq(
                            new BN(inputBassetBefore.vaultBalance).add(inputQuantityExact),
                        );
                        //  Output
                        //    Recipient should have output asset quantity after (minus fee)
                        const recipientBalAfter = await outputAsset.balanceOf(recipient);
                        // Assert recipient only receives x amount
                        assertBNSlightlyGTPercent(
                            expectedOutputValue.sub(fee),
                            recipientBalAfter.sub(recipientOutputBalBefore),
                            "0.3",
                            true,
                        );
                    });
                });
            });
            context("with an affected bAsset", async () => {
                beforeEach(async () => {
                    await runSetup();
                });
                it("should fail if input basset status is not Normal", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    const input = bAssets[0];
                    const output = bAssets[1];

                    await basketManager.handlePegLoss(input.address, true, {
                        from: sa.governor,
                    });
                    const inputBasset = await basketManager.getBasset(input.address);
                    expect(inputBasset.status).to.eq(BassetStatus.BrokenBelowPeg.toString());
                    const outputBasset = await basketManager.getBasset(output.address);
                    expect(outputBasset.status).to.eq(BassetStatus.Normal.toString());
                    await assertFailedSwap(mAsset, input, output, 1, "bAsset not allowed in swap");
                });
                it("should fail if output basset status is not Normal", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    const input = bAssets[0];
                    const output = bAssets[1];

                    await basketManager.handlePegLoss(output.address, true, {
                        from: sa.governor,
                    });
                    const inputBasset = await basketManager.getBasset(input.address);
                    expect(inputBasset.status).to.eq(BassetStatus.Normal.toString());
                    const outputBasset = await basketManager.getBasset(output.address);
                    expect(outputBasset.status).to.eq(BassetStatus.BrokenBelowPeg.toString());
                    await assertFailedSwap(mAsset, input, output, 1, "bAsset not allowed in swap");
                });
            });
            context("pushing the weighting beyond the maximum limit", async () => {
                before(async () => {
                    await runSetup(false, false);
                });
                it("should succeed so long as the input doesn't exceed max", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    const composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 100 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(
                        massetDetails,
                        composition.bAssets.map(() => new BN(25)),
                    );
                    // Set updated weightings
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(25, 16)),
                        {
                            from: sa.governor,
                        },
                    );

                    // Assert basket is still healthy with 25 weightings
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    // Should revert since we would be pushing above target
                    const input = bAssets[0];
                    const output = bAssets[1];
                    await assertFailedSwap(
                        mAsset,
                        input,
                        output,
                        1,
                        "Input must remain below max weighting",
                    );
                    await assertFailedSwap(
                        mAsset,
                        input,
                        mAsset as any,
                        1,
                        "bAssets used in mint cannot exceed their max weight",
                    );
                    // Set sufficient weightings allowance
                    await basketManager.setBasketWeights(
                        [input.address],
                        [simpleToExactAmount(27, 16)],
                        {
                            from: sa.governor,
                        },
                    );

                    // Swap should pass now
                    await assertSwap(massetDetails, input, output, 1, true);
                });
            });
        });
        context("with a fluctuating basket", async () => {
            describe("swapping when a bAsset has just been removed from the basket", async () => {
                before(async () => {
                    await runSetup(false);
                    const { bAssets, basketManager } = massetDetails;
                    await seedWithWeightings(massetDetails, [
                        new BN(50),
                        new BN(0),
                        new BN(50),
                        new BN(50),
                    ]);
                    // From [A, B, C, D], remove B, replacing it with D
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        [
                            simpleToExactAmount(50, 16),
                            new BN(0),
                            simpleToExactAmount(50, 16),
                            simpleToExactAmount(50, 16),
                        ],
                        { from: sa.governor },
                    );
                    await basketManager.removeBasset(bAssets[1].address, { from: sa.governor });
                });
                it("should still deposit to the right lending platform", async () => {
                    const { bAssets } = massetDetails;
                    const removedBasset = bAssets[1];
                    const input = bAssets[0];
                    const output = bAssets[3];
                    const removedBassetBalBefore = await removedBasset.balanceOf(sa.default);
                    await assertSwap(massetDetails, input, output, 1, true, sa.default);
                    const removedBassetBalAfter = await removedBasset.balanceOf(sa.default);
                    expect(removedBassetBalBefore).bignumber.eq(removedBassetBalAfter);
                });
                it("should not be possible to swap with the removed bAsset", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    await assertFailedSwap(
                        mAsset,
                        bAssets[1],
                        bAssets[0],
                        1,
                        "Input asset does not exist",
                    );
                });
            });
        });
        context("when the weights exceeds the ForgeValidator limit", async () => {
            let composition: BasketComposition;
            beforeEach(async () => {
                await runSetup(false, false);
                const { bAssets, basketManager } = massetDetails;
                composition = await massetMachine.getBasketComposition(massetDetails);
                // Expect 4 bAssets with 100 weightings
                composition.bAssets.forEach((b) => {
                    expect(b.vaultBalance).bignumber.eq(new BN(0));
                    expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                });
                // Mint 0, 50, 25, 25 of each bAsset, taking total to 100
                await seedWithWeightings(massetDetails, [
                    new BN(0),
                    new BN(50),
                    new BN(25),
                    new BN(25),
                ]);
                // Refactor the weightings to push some overweight
                await basketManager.setBasketWeights(
                    bAssets.map((b) => b.address),
                    bAssets.map(() => simpleToExactAmount(25, 16)),
                    {
                        from: sa.governor,
                    },
                );
            });
            it("should succeed if input bAsset is underweight", async () => {
                const { bAssets, mAsset } = massetDetails;
                // Assert bAssets are now classed as overweight/underweight
                composition = await massetMachine.getBasketComposition(massetDetails);
                expect(composition.bAssets[1].overweight).to.eq(true);
                // Should succeed since we would be pushing towards target
                const underweightAsset = bAssets[0];
                const output = bAssets[2];
                await assertSwap(
                    massetDetails,
                    underweightAsset,
                    output,
                    1,
                    true,
                    sa.default,
                    sa.default,
                    true,
                );
                // Should fail if we swap in something else that will go over
                expect(composition.bAssets[3].overweight).to.eq(false);
                const borderlineAsset = bAssets[3];
                await assertFailedSwap(
                    mAsset,
                    borderlineAsset,
                    output,
                    1,
                    "Input must remain below max weighting",
                );
            });
            it("should charge no swap fee if output asset is overweight", async () => {
                const { bAssets } = massetDetails;
                // Assert bAssets are now classed as overweight/underweight
                composition = await massetMachine.getBasketComposition(massetDetails);
                expect(composition.bAssets[1].overweight).to.eq(true);
                // Should succeed since we would be pushing towards target
                const underweightAsset = bAssets[0];
                const overweightAsset = bAssets[1];
                await assertSwap(
                    massetDetails,
                    underweightAsset,
                    overweightAsset,
                    1,
                    false,
                    sa.default,
                    sa.default,
                    true,
                );
            });
            it("should fail if input bAsset exceeds max", async () => {
                const { bAssets, mAsset } = massetDetails;
                // Assert bAssets are now classed as overweight/underweight
                composition = await massetMachine.getBasketComposition(massetDetails);
                expect(composition.bAssets[1].overweight).to.eq(true);
                // Should fail if we swap in something already overweight
                const bAsset1 = bAssets[1];
                await assertFailedSwap(
                    mAsset,
                    bAsset1,
                    bAssets[2],
                    1,
                    "Input must remain below max weighting",
                );
            });
        });
        context("when there are a large number of bAssets in the basket", async () => {
            // Create a basket filled with 16 bAssets, all hooked into the Mock intergation platform
            before(async () => {
                await runSetup(false);
                const { aaveIntegration, basketManager } = massetDetails;
                const aaveAddress = await aaveIntegration.platformAddress();
                const mockAave = await MockAave.at(aaveAddress);
                await seedWithWeightings(massetDetails, [
                    new BN(100),
                    new BN(0),
                    new BN(0),
                    new BN(0),
                ]);
                // Create 6 new bAssets
                for (let i = 0; i < 6; i += 1) {
                    const mockBasset = await MockERC20.new(
                        `MKI${i}`,
                        `MI${i}`,
                        18,
                        sa.default,
                        100000000,
                    );
                    const mockAToken = await MockAToken.new(aaveAddress, mockBasset.address);
                    // Add to the mock aave platform
                    await mockAave.addAToken(mockAToken.address, mockBasset.address);
                    // Add the pToken to our integration
                    await aaveIntegration.setPTokenAddress(mockBasset.address, mockAToken.address, {
                        from: sa.governor,
                    });
                    // Add the bAsset to the basket
                    await basketManager.addBasset(
                        mockBasset.address,
                        aaveIntegration.address,
                        false,
                        { from: sa.governor },
                    );
                }
            });
            it("should still perform with 10 bAssets in the basket", async () => {
                const { basketManager, mAsset } = massetDetails;
                // Assert that we have indeed 10 bAssets
                const onChainBassets = await massetMachine.getBassetsInMasset(massetDetails);
                expect(onChainBassets.length).to.eq(10);
                massetDetails.bAssets = onChainBassets.map((o) => o.contract);
                // Set equal basket weightings
                await basketManager.setBasketWeights(
                    onChainBassets.map((b) => b.addr),
                    onChainBassets.map(() => simpleToExactAmount(10, 16)),
                    { from: sa.governor },
                );
                const approvals = await Promise.all(
                    onChainBassets
                        .slice(1)
                        .map((b, i) =>
                            massetMachine.approveMasset(b.contract, mAsset, new BN(8), sa.default),
                        ),
                );
                await mAsset.mintMulti(
                    onChainBassets.slice(1).map((b) => b.contract.address),
                    approvals,
                    sa.default,
                    { from: sa.default },
                );
                for (let i = 1; i < onChainBassets.length - 1; i += 1) {
                    const input = onChainBassets[i].contract;
                    const output = onChainBassets[i + 1].contract;
                    const approval0: BN = await massetMachine.approveMasset(
                        input,
                        mAsset,
                        1,
                        sa.default,
                    );
                    await mAsset.swap(input.address, output.address, approval0, sa.default);
                }
            });
        });
        context("when the mAsset is undergoing change", () => {
            beforeEach(async () => {
                await runSetup(false);
            });
            describe("when basket has failed", async () => {
                it("should throw", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    await basketManager.setBasket(true, fullScale);
                    const input = bAssets[0];
                    const output = bAssets[1];
                    await assertFailedSwap(mAsset, input, output, 1, "Basket is undergoing change");
                });
            });
            describe("when basket is paused", async () => {
                it("should throw", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const input = bAssets[0];
                    const output = bAssets[1];
                    await basketManager.pause({ from: sa.governor });
                    expect(await basketManager.paused()).eq(true);
                    await assertFailedSwap(
                        mAsset,
                        input,
                        output,
                        1,
                        "Pausable: paused",
                        sa.default,
                        sa.default,
                        true,
                        true,
                    );
                });
            });
            describe("when basket undergoing recol", async () => {
                it("should throw", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    await basketManager.setRecol(true);
                    const input = bAssets[0];
                    const output = bAssets[1];
                    await assertFailedSwap(mAsset, input, output, 1, "Basket is undergoing change");
                });
            });
        });
    });
});
