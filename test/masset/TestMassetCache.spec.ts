/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable no-await-in-loop */

import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";

import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions";
import { simpleToExactAmount, applyRatio } from "@utils/math";
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
const MockAave = artifacts.require("MockAaveV2");
const AaveIntegration = artifacts.require("AaveIntegration");
const Masset = artifacts.require("Masset");

interface MintOutput {
    minterBassetBalBefore: BN;
    minterBassetBalAfter: BN;
    recipientBalBefore: BN;
    recipientBalAfter: BN;
}

contract("Masset - Cache", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    const runSetup = async (seedBasket = true, enableUSDTFee = false): Promise<void> => {
        await systemMachine.initialiseMocks(seedBasket, false, enableUSDTFee);
        massetDetails = systemMachine.mUSD;
    };

    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);

        await runSetup();
    });

    const assertFailedMint = async (
        mAsset: t.MassetInstance,
        bAsset: t.MockERC20Instance,
        amount: BN,
        reason: string,
    ): Promise<void> => {
        const approval: BN = await massetMachine.approveMasset(bAsset, mAsset, amount);
        await expectRevert(mAsset.mint(bAsset.address, approval), reason);
    };

    // Helper to assert basic minting conditions, i.e. balance before and after
    const assertBasicMint = async (
        md: MassetDetails,
        mAssetMintAmount: BN | number,
        bAsset: t.MockERC20Instance,
        ignoreHealthAssertions = false,
    ): Promise<void> => {
        const { mAsset, basketManager } = md;
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

        const minterBassetBalBefore = await bAsset.balanceOf(sa.default);
        const recipientBalBefore = await mAsset.balanceOf(sa.default);
        const bAssetBefore = await massetMachine.getBasset(basketManager, bAsset.address);
        const integratorBalBefore = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator.address,
        );

        const approval0: BN = await massetMachine.approveMasset(
            bAsset,
            mAsset,
            new BN(mAssetMintAmount),
        );
        // Expect to be used in cache
        const platformInteraction = await massetMachine.getPlatformInteraction(
            mAsset,
            "deposit",
            approval0,
            integratorBalBefore,
            bAssetBefore,
        );
        const tx = await mAsset.mint(bAsset.address, approval0);

        const mAssetQuantity = simpleToExactAmount(mAssetMintAmount, 18);
        const bAssetQuantity = simpleToExactAmount(mAssetMintAmount, await bAsset.decimals());
        await expectEvent(tx.receipt, "Minted", {
            minter: sa.default,
            recipient: sa.default,
            mAssetQuantity,
            bAsset: bAsset.address,
            bAssetQuantity,
        });
        // Transfers to lending platform
        await expectEvent(tx.receipt, "Transfer", {
            from: sa.default,
            to: bAssetBefore.integrator.address,
            value: bAssetQuantity,
        });
        // Deposits into lending platform
        const emitter = await AaveIntegration.new();
        const integratorBalAfter = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator.address,
        );
        expect(integratorBalAfter).bignumber.eq(platformInteraction.rawBalance);
        if (platformInteraction.expectInteraction) {
            expectEvent.inTransaction(tx.tx, emitter, "Deposit", {
                _bAsset: bAsset.address,
                _amount: platformInteraction.amount,
            });
        }
        // Recipient should have mAsset quantity after
        const recipientBalAfter = await mAsset.balanceOf(sa.default);
        expect(recipientBalAfter).bignumber.eq(recipientBalBefore.add(mAssetQuantity));
        // Sender should have less bAsset after
        const minterBassetBalAfter = await bAsset.balanceOf(sa.default);
        expect(minterBassetBalAfter).bignumber.eq(minterBassetBalBefore.sub(bAssetQuantity));
        // VaultBalance should update for this bAsset
        const bAssetAfter = await basketManager.getBasset(bAsset.address);
        expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(
            new BN(bAssetBefore.vaultBalance).add(bAssetQuantity),
        );

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
    };

    // Helper to assert basic redemption conditions, e.g. balance before and after
    const assertBasicRedemption = async (
        md: MassetDetails,
        bAssetRedeemAmount: BN | number,
        bAsset: t.MockERC20Instance,
        expectFee = true,
        ignoreHealthAssertions = false,
    ): Promise<void> => {
        const { mAsset, basketManager } = md;
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

        // Get balances before
        const senderMassetBalBefore = await mAsset.balanceOf(sa.default);
        const mUSDSupplyBefore = await mAsset.totalSupply();
        const recipientBassetBalBefore = await bAsset.balanceOf(sa.default);
        const bAssetBefore = await massetMachine.getBasset(basketManager, bAsset.address);
        const bAssetDecimals = await bAsset.decimals();
        const bAssetExact = simpleToExactAmount(bAssetRedeemAmount, bAssetDecimals);
        const surplusBefore = await mAsset.surplus();

        const integratorBalBefore = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator.address,
        );

        let fee = new BN(0);
        let scaledFee = new BN(0);
        let feeRate = new BN(0);
        //    If there is a fee expected, then deduct it from output
        if (expectFee) {
            feeRate = await mAsset.swapFee();
            expect(feeRate).bignumber.gt(new BN(0) as any);
            expect(feeRate).bignumber.lt(fullScale.div(new BN(50)) as any);
            fee = bAssetExact.mul(feeRate).div(fullScale);
            expect(fee).bignumber.gt(new BN(0) as any);
            scaledFee = fee.mul(new BN(bAssetBefore.ratio)).div(simpleToExactAmount(1, 8));
        }
        const platformInteraction = await massetMachine.getPlatformInteraction(
            mAsset,
            "withdrawal",
            bAssetExact.sub(fee),
            integratorBalBefore,
            bAssetBefore,
        );

        // Execute the redemption
        const tx = await mAsset.redeem(bAsset.address, bAssetExact);

        // Calc mAsset burn amounts based on bAsset quantities
        const mAssetQuantity = applyRatio(bAssetExact, bAssetBefore.ratio);

        // Listen for the events
        await expectEvent(tx.receipt, "Redeemed", {
            redeemer: sa.default,
            recipient: sa.default,
            mAssetQuantity,
            bAssets: [bAsset.address],
        });
        if (expectFee) {
            expectEvent(tx.receipt, "PaidFee", {
                payer: sa.default,
                asset: bAsset.address,
                feeQuantity: fee,
            });
        }
        // - Withdraws from lending platform
        const emitter = await AaveIntegration.new();
        if (platformInteraction.expectInteraction) {
            await expectEvent.inTransaction(tx.tx, emitter, "PlatformWithdrawal", {
                bAsset: bAsset.address,
                totalAmount: platformInteraction.amount,
                userAmount: bAssetExact.sub(fee),
            });
        } else {
            await expectEvent.inTransaction(tx.tx, emitter, "Withdrawal", {
                _bAsset: bAsset.address,
                _amount: bAssetExact.sub(fee),
            });
        }
        // VaultBalance should line up
        const integratorBalAfter = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator.address,
        );
        expect(integratorBalAfter).bignumber.eq(platformInteraction.rawBalance);
        // Sender should have less mAsset
        const senderMassetBalAfter = await mAsset.balanceOf(sa.default);
        expect(senderMassetBalAfter).bignumber.eq(senderMassetBalBefore.sub(mAssetQuantity));
        // Total mUSD supply should be less
        const mUSDSupplyAfter = await mAsset.totalSupply();
        expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantity));
        // Recipient should have more bAsset, minus fee
        const recipientBassetBalAfter = await bAsset.balanceOf(sa.default);
        expect(recipientBassetBalAfter).bignumber.eq(
            recipientBassetBalBefore.add(bAssetExact).sub(fee),
        );
        // VaultBalance should update for this bAsset, including fee
        const bAssetAfter = await basketManager.getBasset(bAsset.address);
        // 100, 0.6
        // 1000-(100-0.6) = 1000-(99.4) = 900.6
        expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(
            new BN(bAssetBefore.vaultBalance).sub(bAssetExact.sub(fee)),
        );
        const surplusAfter = await mAsset.surplus();
        expect(new BN(surplusAfter)).bignumber.eq(new BN(surplusBefore).add(scaledFee));

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
    };

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
    ): Promise<void> => {
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
    };

    context("validating simple transactions with different cache sizes", () => {
        beforeEach("reset", async () => {
            await runSetup();
        });
        const runTxs = async () => {
            const { bAssets } = massetDetails;

            // Series of mints and redemptions
            await assertBasicRedemption(massetDetails, new BN(10), bAssets[1], true);
            await assertBasicMint(massetDetails, new BN(100), bAssets[0]);
            await assertBasicMint(massetDetails, new BN(100), bAssets[0]);
            await assertBasicMint(massetDetails, new BN(2), bAssets[0]);
            await assertBasicMint(massetDetails, new BN(50), bAssets[0]);
            await assertBasicRedemption(massetDetails, new BN(1), bAssets[1], true);
            await assertSwap(massetDetails, bAssets[0], bAssets[1], new BN(1), true, sa.dummy4);
            await assertSwap(massetDetails, bAssets[0], bAssets[1], new BN(1), true);
            await assertSwap(massetDetails, bAssets[1], bAssets[2], new BN(1), true);

            // Test savings deposit
            await massetDetails.mAsset.approve(systemMachine.savingsContract.address, new BN(1), {
                from: sa.default,
            });
            await systemMachine.savingsContract.depositSavings(new BN(1), {
                from: sa.default,
            });
            await assertSwap(massetDetails, bAssets[1], bAssets[2], new BN(1), true);
            await massetDetails.mAsset.approve(systemMachine.savingsContract.address, new BN(1));
            await systemMachine.savingsContract.depositSavings(new BN(1));
        };
        it("should exec with 0%", async () => {
            await massetDetails.mAsset.setCacheSize(0, {
                from: sa.governor,
            });
            await runTxs();
        });
        it("should exec with 10%", async () => {
            await massetDetails.mAsset.setCacheSize(simpleToExactAmount(1, 17), {
                from: sa.governor,
            });
            await runTxs();
        });
        it("should exec with 20%", async () => {
            await massetDetails.mAsset.setCacheSize(simpleToExactAmount(2, 17), {
                from: sa.governor,
            });
            await runTxs();
        });
    });
    context("testing the fine tuning of cache limits", () => {
        // start with a total supply of 100 and no cache
        it("should deposit if it goes over");
        it("should withdraw if tx fee");
        it("should withdrawRaw if there is cache balance");
        it("should withdraw to mean");
    });
    context("ensuring redeemMasset analyses max cache and surplus correctly", () => {
        before("reset", async () => {
            await runSetup();
        });
        it("should reset all assets to cache mid point");
        it("should accumulate a surplus over multiple tx's");
    });
    context("testing fee collection and distribution", () => {
        it("allows SM to collect surplus", async () => {
            // check surplus before
            // ensure it goes to 0 and relevant mUSD is minted
            //
        });
    });
});
