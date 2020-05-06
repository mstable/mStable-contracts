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

const MockBasketManager1 = artifacts.require("MockBasketManager1");
const MockBasketManager2 = artifacts.require("MockBasketManager2");
const MockERC20 = artifacts.require("MockERC20");
const MockAToken = artifacts.require("MockAToken");
const MockAave = artifacts.require("MockAave");
const AaveIntegration = artifacts.require("AaveIntegration");
const Masset = artifacts.require("Masset");

interface SwapDetails {
    swapOutput: BN;
    feeRate: BN;
}

contract("Masset", async (accounts) => {
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
     * @param recipient Who should receive the output? Or default
     * @param swapOutputRevertExpected Should 'getSwapOutput' revert? If so, set this to true
     */
    const assertFailedSwap = async (
        mAsset: t.MassetInstance,
        inputBasset: t.MockErc20Instance,
        outputAsset: t.MockErc20Instance,
        amount: string | BN | number,
        expectedReason: string,
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
            mAsset.swap(inputBasset.address, outputAsset.address, approval, recipient),
            expectedReason,
        );

        // If swap fails, then we would expect swap output to fail for the same reason,
        // instead of reverting, it generally returns a response
        if (callSwapOutput) {
            if (swapOutputRevertExpected) {
                await expectRevert(
                    mAsset.getSwapOutput(inputBasset.address, outputAsset.address, approval),
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
        inputBasset: t.MockErc20Instance,
        outputAsset: t.MockErc20Instance,
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
        console.log("1");
        //    Is this swap actually a single bAsset mint?
        const isMint = mAsset.address === outputAsset.address;

        //    Get basic before data about the actors balances
        const swapperInputBalBefore = await inputBasset.balanceOf(sender);
        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient);
        console.log("2");

        //    Get basic before data on the swap assets
        const inputBassetBefore = await basketManager.getBasset(inputBasset.address);
        const outputBassetBefore = isMint
            ? null
            : await basketManager.getBasset(outputAsset.address);

        // 2. Do the necessary approvals and make the calls
        const approval0: BN = await massetMachine.approveMasset(
            inputBasset,
            mAsset,
            new BN(swapQuantity),
            sender,
            swapQuantityIsBaseUnits,
        );
        const swapTx = await mAsset.swap(
            inputBasset.address,
            outputAsset.address,
            approval0,
            recipient,
            { from: sender },
        );
        //    Call the swap output function to check if results match
        const swapOutputResponse = await mAsset.getSwapOutput(
            inputBasset.address,
            outputAsset.address,
            approval0,
            { from: sender },
        );
        console.log("3");

        // 3. Calculate expected responses
        const inputQuantityExact = swapQuantityIsBaseUnits
            ? new BN(swapQuantity)
            : simpleToExactAmount(swapQuantity, await inputBasset.decimals());
        console.log("4");
        const scaledInputQuantity = swapQuantityIsBaseUnits
            ? new BN(swapQuantity).mul(new BN(inputBassetBefore.ratio)).div(ratioScale)
            : simpleToExactAmount(swapQuantity, 18);
        console.log("5", scaledInputQuantity, isMint);
        const expectedOutputValue = isMint
            ? scaledInputQuantity
            : scaledInputQuantity.mul(ratioScale).div(new BN(outputBassetBefore.ratio));
        console.log("6");
        let fee = new BN(0);
        let feeRate = new BN(0);
        //    If there is a fee expected, then deduct it from output
        if (expectSwapFee && !isMint) {
            feeRate = await mAsset.swapFee();
            expect(feeRate).bignumber.gt(new BN(0) as any);
            console.log("6.5");
            expect(feeRate).bignumber.lt(fullScale.div(new BN(50)) as any);
            fee = expectedOutputValue.mul(feeRate).div(fullScale);
        }
        console.log("7");

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
            await expectEvent(swapTx.receipt, "PaidFee", {
                payer: sender,
                asset: outputAsset.address,
                feeQuantity: fee,
            });
            await expectEvent(swapTx.receipt, "Transfer", {
                from: sender,
                to: await basketManager.getBassetIntegrator(inputBasset.address),
                value: inputQuantityExact,
            });
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
        await expectEvent.inTransaction(swapTx.tx, emitter, "Deposit", {
            _bAsset: inputBasset.address,
            _amount: approval0,
        });
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
                new BN(outputBassetBefore.vaultBalance).sub(expectedOutputValue),
            );
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
                        "Invalid recipient",
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
                        undefined,
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
                        "One of the assets does not exist",
                    );
                });
            });
            context("using bAssets with transfer fees", async () => {
                before(async () => {
                    // await runSetup(false, true);
                });
                it("should handle tokens with transfer fees", async () => {});
                it("should fail if the token charges a fee but we dont know about it", async () => {});
            });
            context("with an affected bAsset", async () => {
                it("should fail if bAsset is broken below peg", async () => {});
            });
            context("passing invalid arguments", async () => {
                before(async () => {
                    // await runSetup();
                });
                it("should revert when 0 quantity", async () => {});
                it("should fail if sender doesn't have balance", async () => {});
                it("should fail if sender doesn't give approval", async () => {});
                it("should fail if *either* bAsset does not exist", async () => {});
            });
            context("pushing the weighting beyond the maximum limit", async () => {
                before(async () => {
                    // await runSetup(false, false);
                });
                it("should succeed so long as we don't exceed the max weight", async () => {});
            });
        });
        context("when there are no active bAssets", async () => {});
        context("when there is 0 liquidity", async () => {});
        context("with a fluctuating basket", async () => {
            describe("minting when a bAsset has just been removed from the basket", async () => {
                // before(async () => {});
                it("should still deposit to the right lending platform", async () => {});
                it("should not be possible to mint with the removed bAsset", async () => {});
            });
        });
        context("when the weights exceeds the ForgeValidator limit", async () => {
            // beforeEach(async () => {});
            // minting should work as long as the thing we mint with doesnt exceed max
            it("should succeed if bAsset is underweight", async () => {});
            it("should fail if bAsset already exceeds max", async () => {});
        });
        context("when there are a large number of bAssets in the basket", async () => {
            // Create a basket filled with 16 bAssets, all hooked into the Mock intergation platform
            before(async () => {});
            it("should still perform with 12-16 bAssets in the basket", async () => {});
        });
        context("when the basket manager returns invalid response", async () => {
            before(async () => {
                // await runSetup();
            });
            it("should mint nothing if the preparation returns invalid from manager", async () => {});
            it("should fail if given an invalid integrator", async () => {});
            it("reverts if the BasketManager is paused", async () => {});
        });
        context("when the mAsset is undergoing change", () => {
            before(async () => {
                // await runSetup(true);
            });
            it("when failed", async () => {});
            it("when undergoing recol", async () => {});
        });
    });
});
