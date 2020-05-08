/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable no-await-in-loop */

import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions";
import { simpleToExactAmount, applyRatio, applyRatioCeil } from "@utils/math";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { BassetStatus } from "@utils/mstable-objects";
import { ZERO_ADDRESS, fullScale, ratioScale, ZERO } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";

const { expect } = envSetup.configure();

const MockBasketManager1 = artifacts.require("MockBasketManager1");
const MockERC20 = artifacts.require("MockERC20");
const MockAToken = artifacts.require("MockAToken");
const MockAave = artifacts.require("MockAave");
const AaveIntegration = artifacts.require("AaveIntegration");

const Masset = artifacts.require("Masset");

contract("Masset - RedeemMasset", async (accounts) => {
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
     * @dev Seeds the mAsset basket with custom weightings
     * @param md Masset details object containing all deployed contracts
     * @param weights Whole numbers of mAsset to mint for each given bAsset
     */
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

    const assertFailedRedemption = async (
        mAsset: t.MassetInstance,
        amount: BN,
        reason: string,
        recipient = sa.default,
    ): Promise<void> => {
        const exactAmount = simpleToExactAmount(amount, 18);
        await expectRevert(mAsset.redeemMasset(exactAmount, recipient), reason);
    };

    // Helper to assert basic redemption conditions, e.g. balance before and after
    const assertRedemption = async (
        md: MassetDetails,
        exactAmount: BN,
        recipient: string = sa.default,
        sender: string = sa.default,
        ignoreHealthAssertions = false,
    ): Promise<void> => {
        const { mAsset, basketManager, bAssets } = md;

        // 1. Assert all state is currently valid and prepare objects
        //    Assert that the basket is in a healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

        //    Get balances before
        const senderMassetBalBefore = await mAsset.balanceOf(sender);
        const mUSDSupplyBefore = await mAsset.totalSupply();
        //    Get arrays of bAsset balances and bAssets
        const recipientBassetBalsBefore = await Promise.all(
            bAssets.map((b) => b.balanceOf(recipient)),
        );
        const basketComp = await massetMachine.getBasketComposition(md);

        // 2. Execute the redemption
        const tx = await mAsset.redeemMasset(exactAmount, recipient, { from: sender });

        // 3. Calculate expected results
        //    Exact bAssets that should be received based on previous collateral levels
        const expectedBassets = await Promise.all(
            basketComp.bAssets.map((b) => {
                const percentageOfBasket = b.mAssetUnits
                    .mul(fullScale)
                    .div(basketComp.sumOfBassets);
                return percentageOfBasket.mul(new BN(exactAmount)).div(fullScale);
            }),
        );
        const expectedBassetsExact = expectedBassets.map((b, i) =>
            b.mul(ratioScale).div(new BN(basketComp.bAssets[i].ratio)),
        );

        // 4. Validate any basic events that should occur
        //    Listen for the events
        await expectEvent(tx.receipt, "RedeemedMasset", {
            redeemer: sender,
            recipient,
            mAssetQuantity: exactAmount,
        });

        // 5. Validate output state
        //    Sender should have less mAsset
        const senderMassetBalAfter = await mAsset.balanceOf(sender);
        expect(senderMassetBalAfter).bignumber.eq(senderMassetBalBefore.sub(new BN(exactAmount)));
        //    Total mUSD supply should be less
        const mUSDSupplyAfter = await mAsset.totalSupply();
        expect(mUSDSupplyAfter).bignumber.eq(
            mUSDSupplyBefore.sub(new BN(exactAmount)),
            "Total mUSD supply should be less",
        );
        //    Recipient should have more bAsset
        const recipientBassetBalsAfter = await Promise.all(
            bAssets.map((b) => b.balanceOf(recipient)),
        );
        recipientBassetBalsAfter.map((b, i) =>
            expect(b).bignumber.eq(
                recipientBassetBalsBefore[i].add(expectedBassetsExact[i]),
                `Recipient should have more bAsset[${i}]`,
            ),
        );
        //    Basset payout should always be lte exactAmount in Masset terms
        const sumOfRedemption = expectedBassets.reduce((p, c) => p.add(c), new BN(0));
        assertBNSlightlyGTPercent(new BN(exactAmount), sumOfRedemption, "0.0001", false);

        //    VaultBalance should update for all bAssets
        const bAssetsAfter = await Promise.all(
            bAssets.map((b) => basketManager.getBasset(b.address)),
        );
        bAssetsAfter.map((b, i) =>
            expect(new BN(b.vaultBalance)).bignumber.eq(
                new BN(basketComp.bAssets[i].vaultBalance).sub(expectedBassetsExact[i]),
                `Vault balance should reduce for bAsset[${i}]`,
            ),
        );

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
    };

    /**
     * @dev (Re)Sets the local variables for this test file
     * @param seedBasket Should we add base layer liquidity to the vault?
     * @param enableUSDTFee Enable the bAssets with transfer fees?
     */
    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);

        await runSetup();
    });

    context("redeeming some mAssets", () => {
        context("when the weights are within the ForgeValidator limit", () => {
            context("and sending to a specific recipient", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should fail if recipient is 0x0", async () => {
                    const { mAsset } = massetDetails;
                    await assertFailedRedemption(
                        mAsset,
                        simpleToExactAmount(1, 18),
                        "Must be a valid recipient",
                        ZERO_ADDRESS,
                    );
                });
                it("should redeem mUSD when recipient is a contract", async () => {
                    const { basketManager } = massetDetails;
                    const recipient = basketManager.address;
                    await assertRedemption(massetDetails, simpleToExactAmount(1, 18), recipient);
                });
                it("should redeem mUSD when the recipient is an EOA", async () => {
                    const recipient = sa.dummy1;
                    await assertRedemption(massetDetails, simpleToExactAmount(1, 18), recipient);
                });
            });
            context("and specifying one mAsset base unit", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should redeem no bAssets due to rounding down", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = sa.dummy2;
                    const recipientBassetBalsBefore = await Promise.all(
                        bAssets.map((b) => b.balanceOf(recipient)),
                    );
                    await assertRedemption(massetDetails, new BN(1), recipient);
                    const recipientBassetBalsAfter = await Promise.all(
                        bAssets.map((b) => b.balanceOf(recipient)),
                    );
                    recipientBassetBalsAfter.map((b, i) =>
                        expect(b).bignumber.eq(recipientBassetBalsBefore[i]),
                    );
                });
            });
            context("using bAssets with transfer fees", async () => {
                beforeEach(async () => {
                    await runSetup(true, true);
                });
                it("should handle tokens with transfer fees", async () => {
                    // It should burn the full amount of mAsset, but the fees deducted mean the redeemer receives less
                    const { mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const exactMassetQuantity = simpleToExactAmount(1, 18);
                    const recipient = sa.dummy3;
                    // 1.0 Assert bAsset has fee
                    const basketComp = await massetMachine.getBasketComposition(massetDetails);
                    const bAsset = basketComp.bAssets[3];
                    const expectedBasset = bAsset.mAssetUnits
                        .mul(fullScale)
                        .div(basketComp.sumOfBassets)
                        .mul(new BN(exactMassetQuantity))
                        .div(fullScale);

                    expect(bAsset.isTransferFeeCharged).to.eq(true);
                    // 2.0 Get balances
                    const totalSupplyBefore = await mAsset.totalSupply();
                    const recipientBassetBalBefore = await bAsset.contract.balanceOf(recipient);
                    expect(recipientBassetBalBefore).bignumber.eq(new BN(0));
                    // 3.0 Do the redemption
                    await mAsset.redeemMasset(exactMassetQuantity, recipient);
                    // 4.0 Total supply goes down, and recipient bAsset goes up slightly
                    const recipientBassetBalAfter = await bAsset.contract.balanceOf(recipient);
                    // Assert that we redeemed gt 99% of the bAsset
                    assertBNSlightlyGTPercent(
                        recipientBassetBalBefore.add(expectedBasset),
                        recipientBassetBalAfter,
                        "0.3",
                        true,
                    );
                    // Total supply goes down full amount
                    const totalSupplyAfter = await mAsset.totalSupply();
                    expect(totalSupplyAfter).bignumber.eq(
                        totalSupplyBefore.sub(exactMassetQuantity),
                    );
                    // VaultBalance should update for this bAsset
                    const bAssetAfter = await basketManager.getBasset(bAsset.address);
                    expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(
                        new BN(bAsset.vaultBalance).sub(expectedBasset),
                    );
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                });
                it("should fail if the token charges a fee but we dont know about it", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3];
                    const basket = await massetMachine.getBasketComposition(massetDetails);
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true);
                    await basketManager.setTransferFeesFlag(bAsset.address, false, {
                        from: sa.governor,
                    });
                    // 2.0 Do the mint
                    await expectRevert(
                        mAsset.redeemMasset(new BN(1000000), sa.default),
                        "SafeERC20: low-level call failed",
                    );
                });
            });

            context("passing invalid arguments", async () => {
                before(async () => {
                    // await runSetup();
                });
                it("should revert when 0 quantity", async () => {
                    // const bAsset = massetDetails.bAssets[0];
                    // await expectRevert(
                    //     massetDetails.mAsset.redeem(bAsset.address, new BN(0)),
                    //     "Must redeem some bAssets",
                    // );
                });
                it("should fail if sender doesn't have mAsset balance", async () => {
                    // const { bAssets, mAsset } = massetDetails;
                    // const bAsset = bAssets[0];
                    // const sender = sa.dummy1;
                    // expect(await mAsset.balanceOf(sender)).bignumber.eq(new BN(0));
                    // await expectRevert(
                    //     mAsset.redeem(bAsset.address, new BN(1), { from: sender }),
                    //     "ERC20: burn amount exceeds balance",
                    // );
                });
            });
            context("when the bAsset ratio needs to be ceil", async () => {
                before(async () => {
                    // await runSetup(true, false);
                });
                it("should burn an extra base unit of mAsset per bAsset unit", async () => {
                    // const { bAssets, mAsset, basketManager } = massetDetails;
                    // const bAsset = bAssets[0];
                    // const bAssetDecimals = await bAsset.decimals();
                    // const oneBaseUnit = new BN(1);
                    // const mUSDSupplyBefore = await mAsset.totalSupply();
                    // // Update ratio
                    // const baseRatio = new BN(10).pow(new BN(18).sub(bAssetDecimals));
                    // const ratio = new BN(baseRatio).mul(new BN(100000001));
                    // await basketManager.setBassetRatio(bAsset.address, ratio);
                    // // Calc mAsset burn amounts based on bAsset quantities
                    // const mAssetQuantity = applyRatio(oneBaseUnit, ratio);
                    // const mAssetQuantityCeil = applyRatioCeil(oneBaseUnit, ratio);
                    // expect(mAssetQuantityCeil).bignumber.eq(mAssetQuantity.add(new BN(1)));
                    // // Send the TX
                    // const tx = await mAsset.redeem(bAsset.address, oneBaseUnit);
                    // // Listen for the events
                    // await expectEvent(tx.receipt, "Redeemed", {
                    //     mAssetQuantity: mAssetQuantityCeil,
                    //     bAssets: [bAsset.address],
                    // });
                    // // Total mUSD supply should be less
                    // const mUSDSupplyAfter = await mAsset.totalSupply();
                    // expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantityCeil));
                });
            });
            context("performing multiple actions in a row", async () => {
                before("reset", async () => {
                    // await runSetup();
                });
                it("should change output proportions with mints/redeems in between");
            });
        });
        context("when there are affected bAssets in the basket", async () => {
            describe("when there are blacklisted", async () => {
                it("should fail");
            });
            describe("when there are broken pegs", async () => {
                it("should pass");
            });
        });
        context("when the basket weights are out of sync", async () => {
            context("when some are above", async () => {
                beforeEach(async () => {
                    // await runSetup(false);
                });
                it("should succeed if we redeem all overweight bAssets, and fail otherwise", async () => {
                    // const { bAssets, mAsset, basketManager } = massetDetails;
                    // let composition = await massetMachine.getBasketComposition(massetDetails);
                    // // Expect 4 bAssets with 100 weightings
                    // composition.bAssets.forEach((b) => {
                    //     expect(b.vaultBalance).bignumber.eq(new BN(0));
                    //     expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    // });
                    // // Mint 25 of each bAsset, taking total to 100%
                    // await seedWithWeightings(massetDetails, [
                    //     new BN(40),
                    //     new BN(20),
                    //     new BN(20),
                    //     new BN(20),
                    // ]);
                    // // Set updated weightings
                    // await basketManager.setBasketWeights(
                    //     bAssets.map((b) => b.address),
                    //     bAssets.map(() => simpleToExactAmount(30, 16)),
                    //     {
                    //         from: sa.governor,
                    //     },
                    // );
                    // composition = await massetMachine.getBasketComposition(massetDetails);
                    // expect(composition.bAssets[0].overweight).to.eq(true);
                    // // Should succeed if we redeem this
                    // let bAsset = bAssets[0];
                    // let bAssetDecimals = await bAsset.decimals();
                    // const totalSupplyBefore = await mAsset.totalSupply();
                    // await mAsset.redeem(bAsset.address, simpleToExactAmount(2, bAssetDecimals));
                    // const totalSupplyAfter = await mAsset.totalSupply();
                    // expect(totalSupplyAfter).bignumber.eq(
                    //     totalSupplyBefore.sub(simpleToExactAmount(2, 18)),
                    // );
                    // // Should fail if we redeem anything but the overweight bAsset
                    // /* eslint-disable-next-line prefer-destructuring */
                    // bAsset = bAssets[1];
                    // bAssetDecimals = await bAsset.decimals();
                    // await expectRevert(
                    //     mAsset.redeem(bAsset.address, simpleToExactAmount(1, bAssetDecimals)),
                    //     "Must redeem overweight bAssets",
                    // );
                });
            });
            context("when there is one breached", async () => {
                beforeEach(async () => {
                    // await runSetup(false);
                });
                it("should force proportional redemption no matter what", async () => {
                    // const { bAssets, mAsset, basketManager } = massetDetails;
                    // const composition = await massetMachine.getBasketComposition(massetDetails);
                    // // Expect 4 bAssets with 100 weightings
                    // composition.bAssets.forEach((b) => {
                    //     expect(b.vaultBalance).bignumber.eq(new BN(0));
                    //     expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    // });
                    // // Mint some of each bAsset, taking total to 100%
                    // await seedWithWeightings(massetDetails, [
                    //     "29.5", // breached given that it's within 1%
                    //     new BN(28),
                    //     new BN(23),
                    //     "19.5",
                    // ]);
                    // // Set updated weightings
                    // await basketManager.setBasketWeights(
                    //     bAssets.map((b) => b.address),
                    //     bAssets.map(() => simpleToExactAmount(30, 16)),
                    //     {
                    //         from: sa.governor,
                    //     },
                    // );
                    // // Should succeed if we redeem this
                    // const bAsset = bAssets[0];
                    // const bAssetDecimals = await bAsset.decimals();
                    // await expectRevert(
                    //     mAsset.redeem(bAsset.address, simpleToExactAmount(10, bAssetDecimals)),
                    //     "Must redeem proportionately",
                    // );
                });
            });
            context("when some are 0", async () => {
                beforeEach(async () => {
                    // await runSetup(false);
                });
                it("should not care about maxweights", async () => {});
                it("should withdraw 0 if there is 0 collateral", async () => {});
            });
        });
        context("when there are a large number of bAssets in the basket", async () => {
            // Create a basket filled with 16 bAssets, all hooked into the Mock intergation platform
            before(async () => {
                // await runSetup(false, false);
                // const { basketManager, aaveIntegration } = massetDetails;
                // const aaveAddress = await aaveIntegration.platformAddress();
                // const mockAave = await MockAave.at(aaveAddress);
                // // Create 12 new bAssets
                // for (let i = 0; i < 12; i += 1) {
                //     const mockBasset = await MockERC20.new(
                //         `MKI${i}`,
                //         `MI${i}`,
                //         18,
                //         sa.default,
                //         100000000,
                //     );
                //     const mockAToken = await MockAToken.new(aaveAddress, mockBasset.address);
                //     // Add to the mock aave platform
                //     await mockAave.addAToken(mockAToken.address, mockBasset.address);
                //     // Add the pToken to our integration
                //     await aaveIntegration.setPTokenAddress(mockBasset.address, mockAToken.address, {
                //         from: sa.governor,
                //     });
                //     // Add the bAsset to the basket
                //     await basketManager.addBasset(
                //         mockBasset.address,
                //         aaveIntegration.address,
                //         false,
                //         { from: sa.governor },
                //     );
                // }
            });
            it("should still perform with 12-16 bAssets in the basket", async () => {
                // // Assert that we have indeed 16 bAssets
                // const { basketManager, mAsset } = massetDetails;
                // const onChainBassets = await massetMachine.getBassetsInMasset(massetDetails);
                // expect(onChainBassets.length).to.eq(16);
                // // Set equal basket weightings
                // await basketManager.setBasketWeights(
                //     onChainBassets.map((b) => b.addr),
                //     onChainBassets.map(() => simpleToExactAmount(10, 16)),
                //     { from: sa.governor },
                // );
                // // Mint 6.25 of each bAsset, taking total to 100%
                // const approvals = await Promise.all(
                //     onChainBassets.map((b, i) =>
                //         massetMachine.approveMasset(b.contract, mAsset, new BN(10), sa.default),
                //     ),
                // );
                // await mAsset.mintMulti(
                //     onChainBassets.map((b) => b.addr),
                //     approvals,
                //     sa.default,
                //     { from: sa.default },
                // );
                // // Do the redemption
                // for (let i = 0; i < onChainBassets.length; i += 1) {
                //     await assertBasicRedemption(
                //         massetDetails,
                //         new BN(1),
                //         onChainBassets[i].contract,
                //         true,
                //     );
                // }
            });
        });
        context("when the mAsset has failed", () => {
            beforeEach(async () => {
                await runSetup(true);
                const { basketManager } = massetDetails;
                // Set the colRatio to 80%, which means that the mAsset is undercollateralised
                // by 20%. TO compensate, redemption burns higher amount of mAsset, and totalSupply
                // passed to the forgevalidator is affected to maintain accurate weightings
                await basketManager.setBasket(true, simpleToExactAmount(8, 17));
            });
            it("should still allow redemption, apply the colRatio effectively", async () => {
                // const { bAssets, mAsset, basketManager } = massetDetails;
                // // should burn more than is necessary
                // const bAsset = bAssets[0];
                // const basket = await basketManager.getBasket();
                // expect(basket.failed).eq(true);
                // await expectRevert(
                //     mAsset.redeem(bAsset.address, new BN(1)),
                //     "Must redeem proportionately",
                // );
            });
        });
        context("when the mAsset is undergoing recol", () => {
            beforeEach(async () => {
                // await runSetup(true);
            });
            it("should block redemption", async () => {
                // const { bAssets, mAsset, basketManager } = massetDetails;
                // await assertBasketIsHealthy(massetMachine, massetDetails);
                // await basketManager.setRecol(true);
                // const bAsset = bAssets[0];
                // await expectRevert(
                //     mAsset.redeem(bAsset.address, new BN(1)),
                //     "No bAssets can be undergoing recol",
                // );
            });
        });
        context("when the BasketManager is paused", () => {
            beforeEach(async () => {
                // await runSetup(true);
            });
            it("should block redemption", async () => {
                // const { bAssets, mAsset, basketManager } = massetDetails;
                // await assertBasketIsHealthy(massetMachine, massetDetails);
                // await basketManager.setRecol(true);
                // const bAsset = bAssets[0];
                // await expectRevert(
                //     mAsset.redeem(bAsset.address, new BN(1)),
                //     "No bAssets can be undergoing recol",
                // );
            });
        });
    });
});
