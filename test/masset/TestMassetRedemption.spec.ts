/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable no-await-in-loop */

import * as t from "types/generated";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";

import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions";
import { simpleToExactAmount, applyRatio } from "@utils/math";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { BassetStatus } from "@utils/mstable-objects";
import { ZERO_ADDRESS, fullScale } from "@utils/constants";

import envSetup from "@utils/env_setup";
import { BasketComposition } from "../../types";

const { expect } = envSetup.configure();

const MockBasketManager1: t.MockBasketManager1Contract = artifacts.require("MockBasketManager1");
const MockBasketManager2: t.MockBasketManager2Contract = artifacts.require("MockBasketManager2");
const MockERC20: t.MockERC20Contract = artifacts.require("MockERC20");
const MockAToken: t.MockATokenContract = artifacts.require("MockAToken");
const MockAave: t.MockAaveContract = artifacts.require("MockAave");
const AaveIntegration: t.AaveIntegrationContract = artifacts.require("AaveIntegration");

const Masset: t.MassetContract = artifacts.require("Masset");

interface RedemptionOutput {
    senderMassetBalBefore: BN;
    senderMassetBalAfter: BN;
    recipientBassetBalBefore: BN;
    recipientBassetBalAfter: BN;
}

contract("Masset", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);

        await runSetup();
    });

    const runSetup = async (seedBasket = true, enableUSDTFee = false) => {
        massetDetails = seedBasket
            ? await massetMachine.deployMassetAndSeedBasket(enableUSDTFee)
            : await massetMachine.deployMasset(enableUSDTFee);
        await assertBasketIsHealthy(massetMachine, massetDetails);
    };

    const seedWithWeightings = async (md: MassetDetails, weights: Array<BN>) => {
        for (let i = 0; i < md.bAssets.length; i += 1) {
            if (weights[i].gt(new BN(0))) {
                await assertBasicRedemption(
                    md,
                    weights[i],
                    md.bAssets[i],
                    false,
                    undefined,
                    undefined,
                    true,
                );
            }
        }
    };
    const assertFailedRedemption = async (
        mAsset: t.MassetInstance,
        bAsset: t.MockERC20Instance,
        amount: BN,
        reason: string,
    ) => {
        const approval: BN = await massetMachine.approveMasset(bAsset, mAsset, amount);
        await expectRevert(mAsset.redeem(bAsset.address, approval), reason);
    };

    // Helper to assert basic redemption conditions, i.e. balance before and after
    const assertBasicRedemption = async (
        md: MassetDetails,
        bAssetRedeemAmount: BN | number,
        bAsset: t.MockERC20Instance,
        useRedeemTo = false,
        recipient: string = sa.default,
        sender: string = sa.default,
        ignoreHealthAssertions = false,
    ): Promise<RedemptionOutput> => {
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

        // Get balances before
        const senderMassetBalBefore = await md.mAsset.balanceOf(sender);
        const mUSDSupplyBefore = await md.mAsset.totalSupply();
        const feeRecipient = await md.mAsset.feeRecipient();
        const feeRecipientBalBefore = await md.mAsset.balanceOf(feeRecipient);
        const derivedRecipient = useRedeemTo ? recipient : sender;
        const recipientBassetBalBefore = await bAsset.balanceOf(derivedRecipient);
        const bAssetBefore = await md.basketManager.getBasset(bAsset.address);
        const bAssetDecimals = await bAsset.decimals();
        const bAssetExact = simpleToExactAmount(bAssetRedeemAmount, bAssetDecimals);

        // Execute the redemption
        const tx = useRedeemTo
            ? await md.mAsset.redeemTo(bAsset.address, bAssetExact, derivedRecipient)
            : await md.mAsset.redeem(bAsset.address, bAssetExact);

        // Calc mAsset burn amounts based on bAsset quantities
        const mAssetQuantity = applyRatio(bAssetExact, bAssetBefore.ratio);
        const feeRate = await md.mAsset.redemptionFee();
        const mAssetFee = mAssetQuantity.mul(feeRate).div(fullScale);

        // Listen for the events
        await expectEvent(tx.receipt, "Redeemed", {
            recipient: derivedRecipient,
            redeemer: sender,
            mAssetQuantity,
            bAsset: bAsset.address,
            bAssetQuantity: bAssetExact,
        });
        // - Transfers to lending platform
        await expectEvent(tx.receipt, "Transfer", {
            from: await md.basketManager.getBassetIntegrator(bAsset.address),
            to: recipient,
            value: bAssetExact,
        });
        // - Withdraws into lending platform
        const emitter = await AaveIntegration.new();
        await expectEvent.inTransaction(tx.tx, emitter, "Withdrawal", {
            _bAsset: bAsset.address,
            _amount: bAssetExact,
        });
        // Sender should have less mAsset
        const senderMassetBalAfter = await md.mAsset.balanceOf(sender);
        expect(senderMassetBalAfter).bignumber.eq(
            senderMassetBalBefore.sub(mAssetQuantity).sub(mAssetFee),
        );
        // Total mUSD supply should be less
        const mUSDSupplyAfter = await md.mAsset.totalSupply();
        expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantity));
        // FeeRecipient should receive fees
        const feeRecipientBalAfter = await md.mAsset.balanceOf(feeRecipient);
        expect(feeRecipientBalAfter).bignumber.eq(feeRecipientBalBefore.add(mAssetFee));
        // Recipient should have more bAsset
        const recipientBassetBalAfter = await bAsset.balanceOf(derivedRecipient);
        expect(recipientBassetBalAfter).bignumber.eq(recipientBassetBalBefore.add(bAssetExact));
        // VaultBalance should update for this bAsset
        const bAssetAfter = await md.basketManager.getBasset(bAsset.address);
        expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(
            new BN(bAssetBefore.vaultBalance).sub(bAssetExact),
        );

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

        return {
            senderMassetBalBefore,
            senderMassetBalAfter,
            recipientBassetBalBefore,
            recipientBassetBalAfter,
        };
    };

    describe("redeeming with a single bAsset", () => {
        context("when the weights are within the ForgeValidator limit", () => {
            context("and sending to a specific recipient", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should fail if recipient is 0x0", async () => {
                    await expectRevert(
                        massetDetails.mAsset.redeemTo(
                            massetDetails.bAssets[0].address,
                            new BN(1),
                            ZERO_ADDRESS,
                        ),
                        "Must be a valid recipient",
                    );
                });
                it("should send mUSD when recipient is a contract", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = massetDetails.forgeValidator.address;
                    await assertBasicRedemption(
                        massetDetails,
                        new BN(1),
                        bAssets[0],
                        true,
                        recipient,
                    );
                });
                it("should send mUSD when the recipient is an EOA", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = sa.dummy1;
                    await assertBasicRedemption(
                        massetDetails,
                        new BN(1),
                        bAssets[1],
                        true,
                        recipient,
                    );
                });
            });
            context("and not defining recipient", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should mint to sender in basic mint func", async () => {
                    const { bAssets } = massetDetails;
                    await assertBasicRedemption(massetDetails, new BN(1), bAssets[1], false);
                });
            });
            context("and specifying one bAsset base unit", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should redeem a higher q of mAsset base units when using bAsset with 12", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    // bAsset has 12 dp
                    const decimals = await bAsset.decimals();
                    expect(decimals).bignumber.eq(new BN(12));

                    const totalSupplyBefore = await mAsset.totalSupply();
                    const recipientBassetBalBefore = await bAsset.balanceOf(sa.default);

                    const tx = await mAsset.redeem(bAsset.address, new BN(1));
                    const expectedMasset = new BN(1000000);
                    await expectEvent(tx.receipt, "Redeemed", {
                        mAssetQuantity: expectedMasset,
                        bAsset: bAsset.address,
                        bAssetQuantity: new BN(1),
                    });
                    // Recipient should have bAsset quantity after
                    const recipientBassetBalAfter = await bAsset.balanceOf(sa.default);
                    expect(recipientBassetBalAfter).bignumber.eq(
                        recipientBassetBalBefore.add(new BN(1)),
                    );
                    // Sender should have less mASset after
                    const totalSupplyAfter = await mAsset.totalSupply();
                    expect(totalSupplyAfter).bignumber.eq(totalSupplyBefore.sub(new BN(1000000)));
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                });
            });

            context("and the feeRecipient changes", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should send the fee to the new recipient", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    const bAssetBefore = await massetDetails.basketManager.getBasset(
                        bAsset.address,
                    );
                    // Do a basic redemption
                    await assertBasicRedemption(massetDetails, new BN(1), bAsset);
                    // Set a new fee recipient
                    await mAsset.setFeeRecipient(sa.dummy1, { from: sa.governor });
                    // Cal expected payout
                    const feeRate = await mAsset.redemptionFee();
                    // Calc mAsset burn amounts based on bAsset quantities
                    const mAssetQuantity = applyRatio(
                        simpleToExactAmount(new BN(1), await bAsset.decimals()),
                        bAssetBefore.ratio,
                    );
                    const mAssetFee = mAssetQuantity.mul(feeRate).div(fullScale);
                    const balBefore = await mAsset.balanceOf(sa.dummy1);
                    // Run the redemption
                    await assertBasicRedemption(massetDetails, new BN(1), bAsset);
                    const balAfter = await mAsset.balanceOf(sa.dummy1);
                    // Assert balance increase
                    expect(balAfter).bignumber.eq(balBefore.add(mAssetFee));
                });
            });
            context("and the feeRate changes", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should deduct the suitable fee", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    const bAssetBefore = await massetDetails.basketManager.getBasset(
                        bAsset.address,
                    );
                    // Set a new fee recipient
                    await mAsset.setFeeRecipient(sa.dummy1, { from: sa.governor });
                    const newFee = simpleToExactAmount("5.234234", 16);
                    await mAsset.setRedemptionFee(newFee, { from: sa.governor });

                    // Calc mAsset burn amounts based on bAsset quantities
                    const mAssetQuantity = applyRatio(
                        simpleToExactAmount(new BN(1), await bAsset.decimals()),
                        bAssetBefore.ratio,
                    );
                    const mAssetFee = mAssetQuantity.mul(newFee).div(fullScale);
                    const balBefore = await mAsset.balanceOf(sa.dummy1);
                    // Run the redemption
                    await assertBasicRedemption(massetDetails, new BN(1), bAsset);
                    const balAfter = await mAsset.balanceOf(sa.dummy1);
                    // Assert balance increase
                    expect(balAfter).bignumber.eq(balBefore.add(mAssetFee));
                });
                it("should deduct nothing if the fee is 0", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    // Set a new fee recipient
                    await mAsset.setFeeRecipient(sa.dummy1, { from: sa.governor });
                    const newFee = new BN(0);
                    await mAsset.setRedemptionFee(newFee, { from: sa.governor });

                    // Calc mAsset burn amounts based on bAsset quantities
                    const balBefore = await mAsset.balanceOf(sa.dummy1);
                    // Run the redemption
                    await assertBasicRedemption(massetDetails, new BN(1), bAsset);
                    const balAfter = await mAsset.balanceOf(sa.dummy1);
                    // Assert balance increase
                    expect(balAfter).bignumber.eq(balBefore);
                });
            });
            context("and there is insufficient bAsset in the basket", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should throw if we request more than in vault", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const bAsset = bAssets[0];
                    // bAsset has 12 dp
                    const bAssetBefore = await basketManager.getBasset(bAsset.address);
                    const bAssetVault = new BN(bAssetBefore.vaultBalance);
                    const bAssetRedeemAmount = bAssetVault.add(new BN(1));

                    await assertFailedRedemption(
                        mAsset,
                        bAsset,
                        bAssetRedeemAmount,
                        "Cannot redeem more bAssets than are in the vault",
                    );
                });
            });
            context("using bAssets with transfer fees", async () => {
                before(async () => {
                    await runSetup(true, true);
                });
                it("should handle tokens with transfer fees", async () => {
                    // It should burn the full amount of mAsset, but the fees deducted mean the redeemer receives less
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const recipient = sa.dummy3;
                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3];
                    const bAssetDecimals = await bAsset.decimals();
                    const oneBasset = simpleToExactAmount(1, bAssetDecimals);
                    const bAssetBefore = await basketManager.getBasset(bAsset.address);
                    expect(bAssetBefore.isTransferFeeCharged).to.eq(true);

                    // 2.0 Get balances
                    const totalSupplyBefore = await mAsset.totalSupply();
                    const recipientBassetBalBefore = await bAsset.balanceOf(recipient);
                    expect(recipientBassetBalBefore).bignumber.eq(new BN(0));

                    // 3.0 Do the redemption
                    const tx = await mAsset.redeemTo(bAsset.address, oneBasset, recipient);
                    const expectedMassetQuantity = applyRatio(oneBasset, bAssetBefore.ratio);
                    expectEvent(tx.receipt, "Redeemed", {
                        mAssetQuantity: expectedMassetQuantity,
                        bAsset: bAsset.address,
                    });
                    // 4.0 Total supply goes down, and recipient bAsset goes up slightly
                    const recipientBassetBalAfter = await bAsset.balanceOf(recipient);
                    // Assert that we redeemed gt 99% of the bAsset
                    assertBNSlightlyGTPercent(
                        recipientBassetBalBefore.add(oneBasset),
                        recipientBassetBalAfter,
                        "0.4",
                        true,
                    );
                    // Total supply goes down full amount
                    const totalSupplyAfter = await mAsset.totalSupply();
                    expect(totalSupplyAfter).bignumber.eq(
                        totalSupplyBefore.sub(expectedMassetQuantity),
                    );
                    // VaultBalance should update for this bAsset
                    const bAssetAfter = await basketManager.getBasset(bAsset.address);
                    expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(
                        new BN(bAssetBefore.vaultBalance).sub(oneBasset),
                    );
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                });
                it("should fail if the token charges a fee but we dont know about it", async () => {
                    // It should burn the full amount of mAsset, but the fees deducted mean the redeemer receives less
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
                        mAsset.mintTo(bAsset.address, new BN(1), sa.default),
                        "SafeERC20: low-level call failed",
                    );
                });
            });
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should revert when 0 quantity", async () => {
                    const bAsset = massetDetails.bAssets[0];
                    await expectRevert(
                        massetDetails.mAsset.redeem(bAsset.address, new BN(0)),
                        "Quantity must not be 0",
                    );
                });
                it("should fail if sender doesn't have mAsset balance", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    const sender = sa.dummy1;
                    expect(await mAsset.balanceOf(sender)).bignumber.eq(new BN(0));
                    await expectRevert(
                        mAsset.redeem(bAsset.address, new BN(1), { from: sender }),
                        "ERC20: transfer amount exceeds balance",
                    );
                });
                it("should fail if sender doesn't have mAsset balance to cover fee", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const bAsset = bAssets[0];
                    const sender = sa.dummy1;
                    const bAssetDecimals = await bAsset.decimals();
                    const bAssetExact = simpleToExactAmount(new BN(1), bAssetDecimals);
                    const bAssetBefore = await basketManager.getBasset(bAsset.address);

                    // Execute the redemption
                    await mAsset.redeem(bAsset.address, bAssetExact);

                    // Transfer sufficient balance to do the redemption, but not enough for the fee
                    const mAssetQuantity = applyRatio(bAssetExact, bAssetBefore.ratio);
                    await mAsset.transfer(sender, mAssetQuantity, { from: sa.default });
                    expect(await mAsset.balanceOf(sender)).bignumber.eq(mAssetQuantity);
                    await expectRevert(
                        mAsset.redeem(bAsset.address, bAssetExact, { from: sender }),
                        "ERC20: burn amount exceeds balance",
                    );
                });
                it("should fail if the bAsset does not exist", async () => {
                    const bAsset = await MockERC20.new("Mock", "MKK", 18, sa.default, 1000);
                    await expectRevert(
                        massetDetails.mAsset.redeem(bAsset.address, new BN(100)),
                        "bAsset does not exist",
                    );
                });
            });
            context("with an affected bAsset", async () => {
                it("should fail if bAsset is broken below peg", async () => {
                    // await assertBasketIsHealthy(massetMachine, massetDetails);
                    // const bAsset = massetDetails.bAssets[0];
                    // await massetDetails.basketManager.handlePegLoss(bAsset.address, true, {
                    //     from: sa.governor,
                    // });
                    // const newBasset = await massetDetails.basketManager.getBasset(bAsset.address);
                    // expect(newBasset.status).to.eq(BassetStatus.BrokenBelowPeg.toString());
                    // await massetMachine.approveMasset(bAsset, massetDetails.mAsset, new BN(1));
                    // await expectRevert(
                    //     massetDetails.mAsset.mint(bAsset.address, new BN(1)),
                    //     "bAsset not allowed in mint",
                    // );
                });
            });
            context("when the bAsset ratio needs to be ceil", async () => {
                // or decimals
                // req mock bAsset
            });
            context("pushing the weighting beyond the maximum limit", async () => {
                before(async () => {
                    // await runSetup(false, false);
                });
                it("should succeed so long as we don't exceed the max weight", async () => {
                    // await assertBasketIsHealthy(massetMachine, massetDetails);
                    // const composition = await massetMachine.getBasketComposition(massetDetails);
                    // // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    // composition.bAssets.forEach((b) => {
                    //     expect(b.vaultBalance).bignumber.eq(new BN(0));
                    //     expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    // });
                    // // Mint 25 of each bAsset, taking total to 100%
                    // for (let i = 0; i < composition.bAssets.length; i += 1) {
                    //     await assertBasicMint(
                    //         massetDetails,
                    //         new BN(25),
                    //         composition.bAssets[i].contract,
                    //         false,
                    //     );
                    // }
                    // // Set no grace allowance
                    // await massetDetails.basketManager.setGrace(simpleToExactAmount(1, 18), {
                    //     from: sa.governor,
                    // });
                    // // Assert basket is still healthy with 0 grace
                    // await assertBasketIsHealthy(massetMachine, massetDetails);
                    // // Should revert since we would be pushing above target + grace
                    // const bAsset = massetDetails.bAssets[0];
                    // const approval: BN = await massetMachine.approveMasset(
                    //     bAsset,
                    //     massetDetails.mAsset,
                    //     new BN(2),
                    // );
                    // await expectRevert(
                    //     massetDetails.mAsset.mint(bAsset.address, approval),
                    //     "Must be below implicit max weighting",
                    // );
                    // // Set sufficient grace allowance
                    // await massetDetails.basketManager.setGrace(simpleToExactAmount(2, 18), {
                    //     from: sa.governor,
                    // });
                    // // Mint should pass now
                    // await assertBasicMint(massetDetails, new BN(2), bAsset, false);
                });
            });
            context("performing multiple redemptions in a row", async () => {
                before("reset", async () => {
                    await runSetup();
                });
                it("should mint with single bAsset", async () => {
                    // const { bAssets } = massetDetails;
                    // const oneMasset = simpleToExactAmount(1, 18);
                    // const mUSD_bal0 = await massetDetails.mAsset.balanceOf(sa.default);
                    // const approval0: BN = await massetMachine.approveMasset(
                    //     bAssets[0],
                    //     massetDetails.mAsset,
                    //     1,
                    //     sa.default,
                    // );
                    // await massetDetails.mAsset.mint(bAssets[0].address, approval0, {
                    //     from: sa.default,
                    // });
                    // const mUSD_bal1 = await massetDetails.mAsset.balanceOf(sa.default);
                    // expect(mUSD_bal1).bignumber.eq(mUSD_bal0.add(oneMasset));
                    // const approval1: BN = await massetMachine.approveMasset(
                    //     bAssets[1],
                    //     massetDetails.mAsset,
                    //     1,
                    //     sa.default,
                    // );
                    // await massetDetails.mAsset.mint(bAssets[1].address, approval1, {
                    //     from: sa.default,
                    // });
                    // const mUSD_bal2 = await massetDetails.mAsset.balanceOf(sa.default);
                    // expect(mUSD_bal2).bignumber.eq(mUSD_bal1.add(oneMasset));
                    // const approval2: BN = await massetMachine.approveMasset(
                    //     bAssets[2],
                    //     massetDetails.mAsset,
                    //     1,
                    //     sa.default,
                    // );
                    // await massetDetails.mAsset.mint(bAssets[2].address, approval2, {
                    //     from: sa.default,
                    // });
                    // const mUSD_bal3 = await massetDetails.mAsset.balanceOf(sa.default);
                    // expect(mUSD_bal3).bignumber.eq(mUSD_bal2.add(oneMasset));
                    // const approval3: BN = await massetMachine.approveMasset(
                    //     bAssets[3],
                    //     massetDetails.mAsset,
                    //     1,
                    //     sa.default,
                    // );
                    // await massetDetails.mAsset.mint(bAssets[3].address, approval3, {
                    //     from: sa.default,
                    // });
                    // const mUSD_bal4 = await massetDetails.mAsset.balanceOf(sa.default);
                    // expect(mUSD_bal4).bignumber.eq(mUSD_bal3.add(oneMasset));
                });
            });
        });

        context("when the basket weights are out of sync", async () => {
            context("when some are above...", async () => {});
            context("when some are affected...", async () => {});
            context("when some are close to their threshold...", async () => {});
            context("when the bAsset weight exceeds the ForgeValidator limit", async () => {
                let composition: BasketComposition;
                beforeEach(async () => {
                    // await runSetup(false, false);
                    // await assertBasketIsHealthy(massetMachine, massetDetails);
                    // composition = await massetMachine.getBasketComposition(massetDetails);
                    // // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    // composition.bAssets.forEach((b) => {
                    //     expect(b.vaultBalance).bignumber.eq(new BN(0));
                    //     expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    // });
                });
                // minting should work as long as the thing we mint with doesnt exceed max
                it("should succeed if bAsset is underweight", async () => {
                    // // Mint 0, 50, 25, 25 of each bAsset, taking total to 100
                    // await seedWithWeightings(massetDetails, [
                    //     new BN(0),
                    //     new BN(50),
                    //     new BN(25),
                    //     new BN(25),
                    // ]);
                    // // Set no grace allowance
                    // await massetDetails.basketManager.setGrace(simpleToExactAmount(1, 18), {
                    //     from: sa.governor,
                    // });
                    // // Assert bAssets are now classed as overweight/underweight
                    // composition = await massetMachine.getBasketComposition(massetDetails);
                    // expect(composition.bAssets[0].underweight).to.eq(true);
                    // expect(composition.bAssets[1].overweight).to.eq(true);
                    // // Should succeed since we would be pushing towards target
                    // const bAsset0 = massetDetails.bAssets[0];
                    // await assertBasicMint(
                    //     massetDetails,
                    //     new BN(1),
                    //     bAsset0,
                    //     false,
                    //     undefined,
                    //     undefined,
                    //     true,
                    // );
                    // // Should fail if we mint with something else that will go over
                    // expect(composition.bAssets[2].underweight).to.eq(false);
                    // expect(composition.bAssets[2].overweight).to.eq(false);
                    // const bAsset2 = massetDetails.bAssets[2];
                    // await assertFailedMint(
                    //     massetDetails.mAsset,
                    //     bAsset2,
                    //     new BN(2),
                    //     "Must be below implicit max weighting",
                    // );
                });
                it("should fail if bAsset already exceeds max", async () => {
                    // await seedWithWeightings(massetDetails, [
                    //     new BN(0),
                    //     new BN(50),
                    //     new BN(25),
                    //     new BN(25),
                    // ]);
                    // // Set no grace allowance
                    // await massetDetails.basketManager.setGrace(simpleToExactAmount(1, 18), {
                    //     from: sa.governor,
                    // });
                    // // Assert bAssets are now classed as overweight/underweight
                    // composition = await massetMachine.getBasketComposition(massetDetails);
                    // expect(composition.bAssets[0].underweight).to.eq(true);
                    // expect(composition.bAssets[1].overweight).to.eq(true);
                    // // Should fail if we mint with something already overweight
                    // const bAsset1 = massetDetails.bAssets[1];
                    // await assertFailedMint(
                    //     massetDetails.mAsset,
                    //     bAsset1,
                    //     new BN(1),
                    //     "Must be below implicit max weighting",
                    // );
                });
            });
        });

        context("when there are a large number of bAssets in the basket", async () => {
            // Create a basket filled with 16 bAssets, all hooked into the Mock intergation platform
            before(async () => {
                // await runSetup();
                // const aaveAddress = await massetDetails.aaveIntegration.platformAddress();
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
                //     await massetDetails.aaveIntegration.setPTokenAddress(
                //         mockBasset.address,
                //         mockAToken.address,
                //         { from: sa.governor },
                //     );
                //     // Add the bAsset to the basket
                //     await massetDetails.basketManager.addBasset(
                //         mockBasset.address,
                //         massetDetails.aaveIntegration.address,
                //         false,
                //         { from: sa.governor },
                //     );
                // }
            });
            it("should still perform with 12-16 bAssets in the basket", async () => {
                // // Assert that we have indeed 16 bAssets
                // const onChainBassets = await massetMachine.getBassetsInMasset(massetDetails);
                // expect(onChainBassets.length).to.eq(16);
                // // Set equal basket weightings
                // await massetDetails.basketManager.setBasketWeights(
                //     onChainBassets.map((b) => b.addr),
                //     onChainBassets.map(() => simpleToExactAmount("6.25", 16)),
                //     { from: sa.governor },
                // );
                // for (let i = 0; i < onChainBassets.length; i += 1) {
                //     await assertBasicMint(
                //         massetDetails,
                //         new BN(10),
                //         onChainBassets[i].contract,
                //         false,
                //     );
                // }
            });
        });
        context("when the basket manager returns invalid response", async () => {
            before(async () => {
                // await runSetup();
            });
            it("should mint nothing if the preparation returns invalid from manager", async () => {
                // // mintSingle
                // const bAsset = await MockERC20.new("Mock", "MKK", 18, sa.default, 1000);
                // const newManager = await MockBasketManager1.new(bAsset.address);
                // const mockMasset = await Masset.new(
                //     "mMock",
                //     "MK",
                //     systemMachine.nexus.address,
                //     sa.dummy1,
                //     massetDetails.forgeValidator.address,
                //     newManager.address,
                // );
                // await massetMachine.approveMasset(bAsset, massetDetails.mAsset, new BN(1000));
                // const bAssetBalBefore = await bAsset.balanceOf(sa.default);
                // const mAssetBalBefore = await mockMasset.balanceOf(sa.default);
                // const mAssetSupplyBefore = await mockMasset.totalSupply();
                // // Should mint nothing due to the forge preparation being invalid
                // await mockMasset.mint(bAsset.address, new BN(1000));
                // const bAssetBalAfter = await bAsset.balanceOf(sa.default);
                // expect(bAssetBalBefore).bignumber.eq(bAssetBalAfter);
                // const mAssetBalAfter = await mockMasset.balanceOf(sa.default);
                // expect(mAssetBalBefore).bignumber.eq(mAssetBalAfter);
                // const mAssetSupplyAfter = await mockMasset.totalSupply();
                // expect(mAssetSupplyBefore).bignumber.eq(mAssetSupplyAfter);
            });
            it("should fail if given an invalid integrator", async () => {
                // mintSingle
                //     const bAsset = await MockERC20.new("Mock2", "MKK", 18, sa.default, 1000);
                //     const newManager = await MockBasketManager2.new(bAsset.address);
                //     const mockMasset = await Masset.new(
                //         "mMock",
                //         "MK",
                //         systemMachine.nexus.address,
                //         sa.dummy1,
                //         massetDetails.forgeValidator.address,
                //         newManager.address,
                //     );
                //     await massetMachine.approveMasset(bAsset, massetDetails.mAsset, new BN(1000));
                //     const bAssetBalBefore = await bAsset.balanceOf(sa.default);
                //     const mAssetBalBefore = await mockMasset.balanceOf(sa.default);
                //     const mAssetSupplyBefore = await mockMasset.totalSupply();
                //     // Should revert since we can't just call an invalid integrator
                //     await expectRevert(
                //         mockMasset.mint(bAsset.address, new BN(100)),
                //         "SafeERC20: low-level call failed",
                //     );
                //     const bAssetBalAfter = await bAsset.balanceOf(sa.default);
                //     expect(bAssetBalBefore).bignumber.eq(bAssetBalAfter);
                //     const mAssetBalAfter = await mockMasset.balanceOf(sa.default);
                //     expect(mAssetBalBefore).bignumber.eq(mAssetBalAfter);
                //     const mAssetSupplyAfter = await mockMasset.totalSupply();
                //     expect(mAssetSupplyBefore).bignumber.eq(mAssetSupplyAfter);
            });
            it("reverts if the BasketManager is paused", async () => {
                //     const bAsset = massetDetails.bAssets[0];
                //     await massetDetails.basketManager.pause({ from: sa.governor });
                //     expect(await massetDetails.basketManager.paused()).eq(true);
                //     await expectRevert(
                //         massetDetails.mAsset.mint(bAsset.address, new BN(100)),
                //         "Pausable: paused",
                //     );
                // });
            });
        });
        context("when the mAsset has failed", () => {
            before(async () => {
                // await runSetup(true);
            });
            it("should apply the colRatio effectively...!");
            it("should cause the forge validation to fail when we use the colratio");
            it("should revert any mints", async () => {
                // await assertBasketIsHealthy(massetMachine, massetDetails);
                // await massetDetails.basketManager.setBasket(true, fullScale);
                // const bAsset0 = massetDetails.bAssets[0];
                // await assertFailedMint(
                //     massetDetails.mAsset,
                //     bAsset0,
                //     new BN(1),
                //     "Basket must be alive",
                // );
            });
        });
    });
    context("redeeming multiple bAssets", async () => {
        it("Should redeem multiple bAssets", async () => {
            // Calc bAsset redemption amounts
            const bAssets = massetDetails.bAssets.slice(0, 2);
            const bAsset_redemption = await Promise.all(
                bAssets.map(async (b) => simpleToExactAmount(1, await b.decimals())),
            );
            const bAsset_balBefore = await Promise.all(bAssets.map((b) => b.balanceOf(sa.default)));
            const mUSD_supplyBefore = await massetDetails.mAsset.totalSupply();
            // Get bitmap
            const bitmap = await massetDetails.basketManager.getBitmapFor(
                bAssets.map((b) => b.address),
            );
            // Redeem
            await massetDetails.mAsset.redeemMulti(bitmap, bAsset_redemption, sa.default, {
                from: sa.default,
            });
            // Assert balances
            const mUSD_supplyAfter = await massetDetails.mAsset.totalSupply();
            const bAsset_balAfter = await Promise.all(bAssets.map((b) => b.balanceOf(sa.default)));
            expect(mUSD_supplyAfter, "Must burn 2 full units of mUSD").bignumber.eq(
                mUSD_supplyBefore.sub(simpleToExactAmount(2, 18)),
            );
            expect(bAsset_balAfter[0], "Must redeem 1 full units of each bAsset").bignumber.eq(
                bAsset_balBefore[0].add(bAsset_redemption[0]),
            );
        });
    });
});
