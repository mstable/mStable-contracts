import { expectEvent } from "@openzeppelin/test-helpers";

import { assertBasketIsHealthy } from "@utils/assertions";
import { simpleToExactAmount, applyRatio } from "@utils/math";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { Basset } from "@utils/mstable-objects";
import { fullScale, ratioScale } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";

const { expect } = envSetup.configure();

const AaveIntegration = artifacts.require("AaveIntegration");

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

    const seedWithWeightings = async (
        md: MassetDetails,
        weights: Array<BN | string | number>,
    ): Promise<void> => {
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
        const hasTxFee = bAssetBefore.isTransferFeeCharged;

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
        if (!hasTxFee) {
            const recipientBassetBalAfter = await bAsset.balanceOf(sa.default);
            expect(recipientBassetBalAfter).bignumber.eq(
                recipientBassetBalBefore.add(bAssetExact).sub(fee),
            );
        }
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
        const platformInteractionIn = await massetMachine.getPlatformInteraction(
            mAsset,
            "deposit",
            approval0,
            inputIntegratorBalBefore,
            inputBassetBefore,
        );
        const platformInteractionOut = isMint
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
        expect(inputIntegratorBalAfter).bignumber.eq(platformInteractionIn.rawBalance);
        const outputIntegratorBalAfter = isMint
            ? new BN(0)
            : await outputBassetBefore.contract.balanceOf(outputBassetBefore.integrator.address);
        if (!isMint) {
            expect(outputIntegratorBalAfter).bignumber.eq(platformInteractionOut.rawBalance);
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
        if (platformInteractionIn.expectInteraction) {
            await expectEvent.inTransaction(swapTx.tx, emitter, "Deposit", {
                _bAsset: inputBasset.address,
                _amount: platformInteractionIn.amount,
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

            if (platformInteractionOut.expectInteraction) {
                await expectEvent.inTransaction(swapTx.tx, emitter, "PlatformWithdrawal", {
                    bAsset: outputAsset.address,
                    totalAmount: platformInteractionOut.amount,
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
            await assertBasicMint(massetDetails, new BN(10), bAssets[0]);
            await assertBasicMint(massetDetails, new BN(20), bAssets[0]);
            await assertBasicMint(massetDetails, new BN(12), bAssets[1]);
            await assertBasicMint(massetDetails, new BN(3), bAssets[2]);
            await assertBasicRedemption(massetDetails, new BN(1), bAssets[1], true);
            await assertSwap(massetDetails, bAssets[0], bAssets[1], new BN(10), true, sa.dummy4);
            await assertSwap(massetDetails, bAssets[0], bAssets[1], new BN(6), true);
            await assertSwap(massetDetails, bAssets[1], bAssets[2], new BN(20), true);
            await assertBasicMint(massetDetails, new BN(3), bAssets[2]);
            await assertBasicMint(massetDetails, new BN(6), bAssets[0]);
            await assertBasicMint(massetDetails, new BN(12), bAssets[0]);
            await assertBasicRedemption(massetDetails, new BN(1), bAssets[0], true);
            await assertBasicRedemption(massetDetails, new BN(14), bAssets[0], true);
            await assertSwap(massetDetails, bAssets[2], bAssets[3], new BN(14), true);

            // Test savings deposit
            await massetDetails.mAsset.approve(systemMachine.savingsContract.address, new BN(1), {
                from: sa.default,
            });
            await systemMachine.savingsContract.methods["depositSavings(uint256)"](new BN(1), {
                from: sa.default,
            });
            await assertSwap(massetDetails, bAssets[1], bAssets[2], new BN(1), true);
            await massetDetails.mAsset.approve(systemMachine.savingsContract.address, new BN(1));
            await systemMachine.savingsContract.methods["depositSavings(uint256)"](new BN(1));
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
        it("should allow for changing cache sizes", async () => {
            await massetDetails.mAsset.setCacheSize(simpleToExactAmount(2, 17), {
                from: sa.governor,
            });
            await runTxs();
            await massetDetails.mAsset.setCacheSize(simpleToExactAmount(2, 16), {
                from: sa.governor,
            });
            await runTxs();
            await massetDetails.mAsset.setCacheSize(simpleToExactAmount(1, 17), {
                from: sa.governor,
            });
            await runTxs();
        });
        context("lowering the cache size with assets in the cache", async () => {});
    });
    context("testing the fine tuning of cache limits", () => {
        // start with a total supply of 100 and no cache
        let bAssetsBefore: Basset[];
        beforeEach("reset", async () => {
            await runSetup(false);
            await seedWithWeightings(massetDetails, [
                new BN(25),
                new BN(25),
                new BN(25),
                new BN(25),
            ]);
            const { basketManager, bAssets } = massetDetails;
            // Refactor the weightings to push some overweight
            await basketManager.setBasketWeights(
                bAssets.map((b) => b.address),
                bAssets.map(() => simpleToExactAmount(60, 16)),
                {
                    from: sa.governor,
                },
            );
            bAssetsBefore = await Promise.all(
                bAssets.map((b) => massetMachine.getBasset(basketManager, b.address)),
            );
            const integratorBalsBefore = await Promise.all(
                bAssetsBefore.map((b) => b.contract.balanceOf(b.integrator.address)),
            );
            integratorBalsBefore.map((b) => expect(b).bignumber.eq(new BN(0)));
        });
        it("should deposit if it goes over", async () => {
            const bAsset = bAssetsBefore[0];
            const bAssetDecimals = await bAsset.contract.decimals();
            const senderBalStart = await bAsset.contract.balanceOf(sa.default);
            // first tx should move it to 5 units in cache
            await assertBasicMint(massetDetails, 5, bAsset.contract, false);
            // Total Supply = 105, cache = 5, vaultBalance = 30
            // second tx pushes above
            await assertBasicMint(massetDetails, 6, bAsset.contract, false);
            // Total Supply = 111, cache = 5.25, vaultBalance = 36
            const cacheBalAfter = await bAsset.contract.balanceOf(bAsset.integrator.address);
            expect(cacheBalAfter).bignumber.eq(simpleToExactAmount("5.25", bAssetDecimals));
            // Sender should have 7 less
            const senderBalAfter = await bAsset.contract.balanceOf(sa.default);
            expect(senderBalAfter).bignumber.eq(
                senderBalStart.sub(simpleToExactAmount(11, bAssetDecimals)),
            );
        });
        it("should withdrawRaw if there is cache balance", async () => {
            const bAsset = bAssetsBefore[0];
            const bAssetDecimals = await bAsset.contract.decimals();
            // first tx should move it to 5 units in cache
            await assertBasicRedemption(massetDetails, 1, bAsset.contract, true);
            // Total Supply = 99, cache = 5, vaultBalance = 24
            // second tx withdraws raw
            await assertBasicRedemption(massetDetails, 4, bAsset.contract, true);
            // Total Supply = 93, cache = 1, vaultBalance = 18

            const cacheBalAfter = await bAsset.contract.balanceOf(bAsset.integrator.address);
            expect(cacheBalAfter).bignumber.eq(simpleToExactAmount("1.0024", bAssetDecimals));
        });
        it("should withdraw to mean", async () => {
            const { mAsset } = massetDetails;
            const bAsset = bAssetsBefore[0];
            const bAssetDecimals = await bAsset.contract.decimals();
            const senderBalStart = await mAsset.balanceOf(sa.default);
            // first tx should move it to 5 units in cache
            await assertBasicRedemption(massetDetails, 1, bAsset.contract, true);
            // Total Supply = 99, cache = 5, vaultBalance = 24
            // second tx resets the cache and withdraws
            await assertBasicRedemption(massetDetails, 10, bAsset.contract, true);
            // Total Supply = 89, cache = 5, vaultBalance = 25
            const cacheBalAfter = await bAsset.contract.balanceOf(bAsset.integrator.address);
            expect(cacheBalAfter).bignumber.eq(simpleToExactAmount("4.95003", bAssetDecimals));
            // Sender should have 11 less mAsset
            const senderBalAfter = await mAsset.balanceOf(sa.default);
            expect(senderBalAfter).bignumber.eq(senderBalStart.sub(simpleToExactAmount(11, 18)));
        });
    });
    context("with an asset with a txfee", () => {
        let bAssetsBefore: Basset[];
        beforeEach("reset", async () => {
            await runSetup(false, true);
            await seedWithWeightings(massetDetails, [
                new BN(25),
                new BN(25),
                new BN(25),
                new BN(25),
            ]);
            const { basketManager, bAssets } = massetDetails;
            // Refactor the weightings to push some overweight
            await basketManager.setBasketWeights(
                bAssets.map((b) => b.address),
                bAssets.map(() => simpleToExactAmount(60, 16)),
                {
                    from: sa.governor,
                },
            );
            bAssetsBefore = await Promise.all(
                bAssets.map((b) => massetMachine.getBasset(basketManager, b.address)),
            );
            const integratorBalsBefore = await Promise.all(
                bAssetsBefore.map((b) => b.contract.balanceOf(b.integrator.address)),
            );
            integratorBalsBefore.map((b) => expect(b).bignumber.eq(new BN(0)));
        });
        it("should not store anything in the cache if there is a tx fee", async () => {
            const { mAsset } = massetDetails;
            const bAsset = bAssetsBefore[1];
            const senderBalStart = await mAsset.balanceOf(sa.default);
            // first tx should move it to 5 units in cache
            await assertBasicRedemption(massetDetails, 1, bAsset.contract, true);
            // Total Supply = 99, cache = 0, vaultBalance = 24
            // second tx resets the cache and withdraws
            await assertBasicRedemption(massetDetails, 10, bAsset.contract, true);
            // Total Supply = 89, cache = 0, vaultBalance = 25
            const cacheBalAfter = await bAsset.contract.balanceOf(bAsset.integrator.address);
            expect(cacheBalAfter).bignumber.eq(new BN(0));
            // Sender should have 11 less mAsset
            const senderBalAfter = await mAsset.balanceOf(sa.default);
            expect(senderBalAfter).bignumber.eq(senderBalStart.sub(simpleToExactAmount(11, 18)));
        });
    });
    context("ensuring redeemMasset analyses max cache and surplus correctly", () => {
        // start with a total supply of 100 and no cache
        let bAssetsBefore: Basset[];
        beforeEach("reset", async () => {
            await runSetup(false);
            await seedWithWeightings(massetDetails, [
                new BN(25),
                new BN(25),
                new BN(25),
                new BN(25),
            ]);
            const { basketManager, bAssets } = massetDetails;
            // Refactor the weightings to push some overweight
            await basketManager.setBasketWeights(
                bAssets.map((b) => b.address),
                bAssets.map(() => simpleToExactAmount(60, 16)),
                {
                    from: sa.governor,
                },
            );
            bAssetsBefore = await Promise.all(
                bAssets.map((b) => massetMachine.getBasset(basketManager, b.address)),
            );
            const integratorBalsBefore = await Promise.all(
                bAssetsBefore.map((b) => b.contract.balanceOf(b.integrator.address)),
            );
            integratorBalsBefore.map((b) => expect(b).bignumber.eq(new BN(0)));
        });
        it("should reset all assets to cache mid point", async () => {
            const { mAsset } = massetDetails;
            const bAssetDecimals = await Promise.all(
                bAssetsBefore.map((b) => b.contract.decimals()),
            );
            const senderBalStart = await mAsset.balanceOf(sa.default);
            // first tx should move it to 5 units in cache
            await mAsset.redeemMasset(simpleToExactAmount(1, 18), sa.default);
            // Total Supply = 99, cache = 5, vaultBalance = 99.0003
            // second tx resets the cache and withdraws
            await mAsset.redeemMasset(simpleToExactAmount(22, 18), sa.default);
            // Total Supply = 77, cache = 4.950015, vaultBalance = 79.0069
            const integratorBalsAfter = await Promise.all(
                bAssetsBefore.map((b) => b.contract.balanceOf(b.integrator.address)),
            );
            integratorBalsAfter.map((b, i) =>
                expect(b).bignumber.eq(simpleToExactAmount("4.950015", bAssetDecimals[i])),
            );
            // Sender should have 2 less mAsset
            const senderBalAfter = await mAsset.balanceOf(sa.default);
            expect(senderBalAfter).bignumber.eq(senderBalStart.sub(simpleToExactAmount(23, 18)));
        });
        it("should accumulate a surplus over multiple tx's", async () => {
            const { mAsset } = massetDetails;
            const surplusStart = await mAsset.surplus();
            const totalSupplyStart = await mAsset.totalSupply();
            // first tx should move it to 5 units in cache
            await mAsset.redeemMasset(simpleToExactAmount(1, 18), sa.default);
            // Total Supply = 99, cache = 5, vaultBalance = 99.0003
            // second tx resets the cache and withdraws
            await mAsset.redeemMasset(simpleToExactAmount(1, 18), sa.default);
            // Total Supply = 98, cache = 4.950015, vaultBalance = 98.0006
            const surplusEnd = await mAsset.surplus();
            expect(surplusEnd).bignumber.eq(surplusStart.add(simpleToExactAmount("0.0006", 18)));
            const totalSupplyEnd = await mAsset.totalSupply();
            expect(totalSupplyEnd).bignumber.eq(totalSupplyStart.sub(simpleToExactAmount(2, 18)));
        });
    });
    context("testing fee collection and distribution", () => {
        before("generate some surplus and lending market interest", async () => {
            await runSetup(true);
            await massetDetails.mAsset.redeemMasset(simpleToExactAmount(20, 18), sa.default);
            const surplus = await massetDetails.mAsset.surplus();
            expect(surplus).bignumber.eq(simpleToExactAmount("0.006", 18));
        });
        it("allows SM to collect surplus", async () => {
            const { mAsset } = massetDetails;
            const compositionBefore = await massetMachine.getBasketComposition(massetDetails);
            const balBefore = await mAsset.balanceOf(systemMachine.savingsContract.address);
            await massetDetails.mAsset.approve(systemMachine.savingsContract.address, new BN(1), {
                from: sa.default,
            });
            await systemMachine.savingsContract.methods["depositSavings(uint256)"](new BN(1), {
                from: sa.default,
            });
            const compositionAfter = await massetMachine.getBasketComposition(massetDetails);
            expect(compositionAfter.sumOfBassets).bignumber.eq(compositionBefore.sumOfBassets);
            expect(compositionAfter.surplus).bignumber.eq(new BN(1));
            expect(compositionAfter.totalSupply).bignumber.eq(
                compositionBefore.totalSupply.add(compositionBefore.surplus).subn(1),
            );
            const balAfter = await mAsset.balanceOf(systemMachine.savingsContract.address);
            expect(balAfter).bignumber.eq(balBefore.add(compositionBefore.surplus));

            await massetDetails.mAsset.approve(systemMachine.savingsContract.address, new BN(1), {
                from: sa.default,
            });
            await systemMachine.savingsContract.methods["depositSavings(uint256)"](new BN(1), {
                from: sa.default,
            });

            const compositionEnd = await massetMachine.getBasketComposition(massetDetails);
            expect(compositionEnd.sumOfBassets).bignumber.eq(compositionAfter.sumOfBassets);
            expect(compositionEnd.surplus).bignumber.eq(new BN(1));
            expect(compositionEnd.totalSupply).bignumber.eq(compositionAfter.totalSupply);
            const balEnd = await mAsset.balanceOf(systemMachine.savingsContract.address);
            expect(balEnd).bignumber.eq(balAfter.add(new BN(1)));
        });
        it("allows SM to collect platform interest", async () => {
            const { mAsset } = massetDetails;
            const compositionBefore = await massetMachine.getBasketComposition(massetDetails);
            const balBefore = await mAsset.balanceOf(systemMachine.savingsManager.address);
            const sumBefore = compositionBefore.bAssets.reduce(
                (p, c, i) => p.add(applyRatio(c.actualBalance, c.ratio)),
                new BN(0),
            );

            await systemMachine.savingsManager.collectAndStreamInterest(mAsset.address);

            const compositionAfter = await massetMachine.getBasketComposition(massetDetails);
            const balAfter = await mAsset.balanceOf(systemMachine.savingsManager.address);
            const sumAfter = compositionAfter.bAssets.reduce(
                (p, c, i) => p.add(applyRatio(c.actualBalance, c.ratio)),
                new BN(0),
            );
            const vaultBalanceDiff = compositionAfter.sumOfBassets.sub(
                compositionBefore.sumOfBassets,
            );

            expect(compositionAfter.sumOfBassets).bignumber.gt(compositionBefore.sumOfBassets);
            expect(compositionAfter.surplus).bignumber.eq(compositionBefore.surplus);
            expect(compositionAfter.totalSupply).bignumber.eq(
                compositionBefore.totalSupply.add(vaultBalanceDiff),
            );
            expect(sumAfter).bignumber.eq(sumBefore);
            expect(sumBefore).bignumber.eq(compositionAfter.sumOfBassets);
            expect(balAfter).bignumber.eq(balBefore.add(vaultBalanceDiff));
        });
    });
});
