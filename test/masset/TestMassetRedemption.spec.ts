/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable no-await-in-loop */

import * as t from "types/generated";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";

import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions";
import { simpleToExactAmount, applyRatio, applyRatioCeil } from "@utils/math";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { BassetStatus } from "@utils/mstable-objects";
import { ZERO_ADDRESS, fullScale } from "@utils/constants";

import envSetup from "@utils/env_setup";

const { expect } = envSetup.configure();

const MockBasketManager1: t.MockBasketManager1Contract = artifacts.require("MockBasketManager1");
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

    const runSetup = async (seedBasket = true, enableUSDTFee = false): Promise<void> => {
        massetDetails = seedBasket
            ? await massetMachine.deployMassetAndSeedBasket(enableUSDTFee)
            : await massetMachine.deployMasset(enableUSDTFee);
        await assertBasketIsHealthy(massetMachine, massetDetails);
    };

    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);

        await runSetup();
    });

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
    const assertFailedRedemption = async (
        mAsset: t.MassetInstance,
        bAsset: t.MockERC20Instance,
        amount: BN,
        reason: string,
    ): Promise<void> => {
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
                it("should redeem to sender in basic redeem func", async () => {
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
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const bAsset = bAssets[0];
                    const bAssetBefore = await basketManager.getBasset(bAsset.address);
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
                beforeEach(async () => {
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
                        mAsset.redeemTo(bAsset.address, new BN(1000000), sa.default),
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
                before(async () => {
                    await runSetup();
                });
                it("should fail if bAsset is broken above peg", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const bAsset = bAssets[0];
                    await basketManager.handlePegLoss(bAsset.address, false, {
                        from: sa.governor,
                    });
                    const newBasset = await basketManager.getBasset(bAsset.address);
                    expect(newBasset.status).to.eq(BassetStatus.BrokenAbovePeg.toString());
                    await expectRevert(
                        mAsset.redeem(bAsset.address, new BN(1)),
                        "Cannot redeem depegged bAsset",
                    );
                });
                it("should fail if any bAsset in basket is broken below peg", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const bAsset = bAssets[1];
                    await basketManager.setBassetStatus(
                        bAsset.address,
                        BassetStatus.BrokenBelowPeg,
                    );
                    const newBasset = await basketManager.getBasset(bAsset.address);
                    expect(newBasset.status).to.eq(BassetStatus.BrokenBelowPeg.toString());
                    await expectRevert(
                        mAsset.redeem(bAsset.address, new BN(1)),
                        "bAssets undergoing liquidation",
                    );
                });
                it("should fail if any bAsset in basket is liquidating or blacklisted", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const bAsset = bAssets[2];
                    await basketManager.setBassetStatus(bAsset.address, BassetStatus.Liquidating);
                    const newBasset = await basketManager.getBasset(bAsset.address);
                    expect(newBasset.status).to.eq(BassetStatus.Liquidating.toString());
                    await expectRevert(
                        mAsset.redeem(bAsset.address, new BN(1)),
                        "bAssets undergoing liquidation",
                    );
                });
            });
            context("when the bAsset ratio needs to be ceil", async () => {
                before(async () => {
                    await runSetup(true, false);
                });
                it("should burn an extra base unit of mAsset per bAsset unit", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    const oneBaseUnit = new BN(1);
                    const mUSDSupplyBefore = await mAsset.totalSupply();
                    // Update ratio
                    const baseRatio = new BN(10).pow(new BN(18).sub(bAssetDecimals));
                    const ratio = new BN(baseRatio).mul(new BN(100000001));
                    await basketManager.setBassetRatio(bAsset.address, ratio);
                    // Calc mAsset burn amounts based on bAsset quantities
                    const mAssetQuantity = applyRatio(oneBaseUnit, ratio);
                    const mAssetQuantityCeil = applyRatioCeil(oneBaseUnit, ratio);
                    expect(mAssetQuantityCeil).bignumber.eq(mAssetQuantity.add(new BN(1)));

                    // Send the TX
                    const tx = await mAsset.redeem(bAsset.address, oneBaseUnit);

                    // Listen for the events
                    await expectEvent(tx.receipt, "Redeemed", {
                        mAssetQuantity: mAssetQuantityCeil,
                        bAsset: bAsset.address,
                        bAssetQuantity: oneBaseUnit,
                    });
                    // Total mUSD supply should be less
                    const mUSDSupplyAfter = await mAsset.totalSupply();
                    expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantityCeil));
                });
            });
            context("performing multiple redemptions in a row", async () => {
                before("reset", async () => {
                    await runSetup();
                });
                it("should redeem with single bAsset", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const oneMasset = simpleToExactAmount(1, 18);
                    const mUSDSupplyBefore = await mAsset.totalSupply();

                    await Promise.all(
                        bAssets.map(async (b) => {
                            const bAssetDecimals = await b.decimals();
                            const bAssetWhole = simpleToExactAmount(new BN(1), bAssetDecimals);

                            return mAsset.redeem(b.address, bAssetWhole, {
                                from: sa.default,
                            });
                        }),
                    );

                    const mUSDSupplyAfter = await mAsset.totalSupply();
                    expect(mUSDSupplyAfter).bignumber.eq(
                        mUSDSupplyBefore.sub(new BN(bAssets.length).mul(oneMasset)),
                    );
                });
            });
        });

        context("when the basket weights are out of sync", async () => {
            context("when some are close to their threshold...", async () => {
                beforeEach(async () => {
                    await runSetup(false, false);
                });
                it("should fail if we push something else above max", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(25),
                        new BN(25),
                        new BN(25),
                        new BN(25),
                    ]);
                    // Set no grace allowance
                    await basketManager.setGrace(simpleToExactAmount(1, 18), {
                        from: sa.governor,
                    });
                    // Assert basket is still healthy with 0 grace
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    // Should revert since we would be pushing above target + grace
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    await expectRevert(
                        mAsset.redeem(bAsset.address, simpleToExactAmount(5, bAssetDecimals)),
                        "bAssets must remain above implicit min weight",
                    );
                });
                it("should fail if we go below implicit min", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(25),
                        new BN(25),
                        new BN(25),
                        new BN(25),
                    ]);
                    // Set no grace allowance
                    await basketManager.setGrace(simpleToExactAmount(1, 18), {
                        from: sa.governor,
                    });
                    // Assert basket is still healthy with 0 grace
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    // Should revert since we would be pushing above target + grace
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    // Resulting weighting: 23/98. Min weighting = 24.5 -1 = 23.5
                    await expectRevert(
                        mAsset.redeem(bAsset.address, simpleToExactAmount(2, bAssetDecimals)),
                        "bAssets must remain above implicit min weight",
                    );
                });
            });
            context("when some are above", async () => {
                beforeEach(async () => {
                    await runSetup(false);
                });
                it("should succeed if we redeem the overweight bAsset, and fail otherwise", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    let composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(30),
                        new BN(20),
                        new BN(20),
                        new BN(30),
                    ]);
                    // Set no grace allowance
                    await basketManager.setGrace(simpleToExactAmount(1, 18), {
                        from: sa.governor,
                    });
                    composition = await massetMachine.getBasketComposition(massetDetails);
                    expect(composition.bAssets[0].overweight).to.eq(true);
                    // Should succeed if we redeem this
                    let bAsset = bAssets[0];
                    let bAssetDecimals = await bAsset.decimals();
                    const totalSupplyBefore = await mAsset.totalSupply();
                    await mAsset.redeem(bAsset.address, simpleToExactAmount(2, bAssetDecimals));
                    const totalSupplyAfter = await mAsset.totalSupply();
                    expect(totalSupplyAfter).bignumber.eq(
                        totalSupplyBefore.sub(simpleToExactAmount(2, 18)),
                    );
                    // Should fail if we redeem anything but the overweight bAsset
                    /* eslint-disable-next-line prefer-destructuring */
                    bAsset = bAssets[1];
                    bAssetDecimals = await bAsset.decimals();
                    await expectRevert(
                        mAsset.redeem(bAsset.address, simpleToExactAmount(1, bAssetDecimals)),
                        "Must redeem overweight bAssets",
                    );
                });
                it("should fail if we redeem so much that it goes underweight", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    let composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(30),
                        new BN(20),
                        new BN(20),
                        new BN(30),
                    ]);
                    // Set no grace allowance
                    await basketManager.setGrace(simpleToExactAmount(1, 18), {
                        from: sa.governor,
                    });
                    composition = await massetMachine.getBasketComposition(massetDetails);
                    expect(composition.bAssets[0].overweight).to.eq(true);
                    // Should fail if we redeem anything but the overweight bAsset
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    await expectRevert(
                        mAsset.redeem(bAsset.address, simpleToExactAmount(20, bAssetDecimals)),
                        "bAssets must remain above implicit min weight",
                    );
                });
            });
        });

        context("when there are a large number of bAssets in the basket", async () => {
            // Create a basket filled with 16 bAssets, all hooked into the Mock intergation platform
            before(async () => {
                await runSetup(false, false);
                const { basketManager, aaveIntegration } = massetDetails;
                const aaveAddress = await aaveIntegration.platformAddress();
                const mockAave = await MockAave.at(aaveAddress);
                // Create 12 new bAssets
                for (let i = 0; i < 12; i += 1) {
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
            it("should still perform with 12-16 bAssets in the basket", async () => {
                // Assert that we have indeed 16 bAssets
                const { basketManager, mAsset } = massetDetails;
                const onChainBassets = await massetMachine.getBassetsInMasset(massetDetails);
                expect(onChainBassets.length).to.eq(16);
                // Set equal basket weightings
                await basketManager.setBasketWeights(
                    onChainBassets.map((b) => b.addr),
                    onChainBassets.map(() => simpleToExactAmount("6.25", 16)),
                    { from: sa.governor },
                );
                // Mint 6.25 of each bAsset, taking total to 100%
                const approvals = await Promise.all(
                    onChainBassets.map((b, i) =>
                        massetMachine.approveMasset(b.contract, mAsset, new BN("6.25"), sa.default),
                    ),
                );
                await mAsset.mintMulti(
                    onChainBassets.map((b) => b.addr),
                    approvals,
                    sa.default,
                    { from: sa.default },
                );
                // Do the redemption
                for (let i = 0; i < onChainBassets.length; i += 1) {
                    await assertBasicRedemption(
                        massetDetails,
                        new BN(1),
                        onChainBassets[i].contract,
                        false,
                    );
                }
            });
        });
        context("when the basket manager returns invalid response", async () => {
            before(async () => {
                await runSetup();
            });
            it("should redeem nothing if the preparation returns invalid from manager", async () => {
                const { forgeValidator } = massetDetails;
                // mintSingle
                const bAsset = await MockERC20.new("Mock", "MKK", 18, sa.default, 1000);
                const newManager = await MockBasketManager1.new(bAsset.address);
                const mockMasset = await Masset.new(
                    "mMock",
                    "MK",
                    systemMachine.nexus.address,
                    sa.dummy1,
                    forgeValidator.address,
                    newManager.address,
                );
                const mAssetSupplyBefore = await mockMasset.totalSupply();
                // Should redeem nothing due to the forge preparation being invalid
                await mockMasset.redeem(bAsset.address, new BN(1));
                const mAssetSupplyAfter = await mockMasset.totalSupply();
                expect(mAssetSupplyBefore).bignumber.eq(mAssetSupplyAfter);
            });
            it("reverts if the BasketManager is paused", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                const bAsset = bAssets[0];
                await basketManager.pause({ from: sa.governor });
                expect(await basketManager.paused()).eq(true);
                await expectRevert(mAsset.redeem(bAsset.address, new BN(100)), "Pausable: paused");
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
                const { bAssets, mAsset } = massetDetails;
                // should burn more than is necessary
                const bAsset = bAssets[0];
                const bAssetDecimals = await bAsset.decimals();
                const bAssetWhole = simpleToExactAmount(new BN(1), bAssetDecimals);
                const mUSDSupplyBefore = await mAsset.totalSupply();
                // Calc mAsset burn amounts based on bAsset quantities
                const mAssetQuantityScaled = simpleToExactAmount("1.25", 18);

                // Send the TX
                const tx = await mAsset.redeem(bAsset.address, bAssetWhole);

                // Listen for the events
                await expectEvent(tx.receipt, "Redeemed", {
                    mAssetQuantity: mAssetQuantityScaled,
                    bAsset: bAsset.address,
                    bAssetQuantity: bAssetWhole,
                });
                // Total mUSD supply should be less
                const mUSDSupplyAfter = await mAsset.totalSupply();
                expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantityScaled));
            });
        });
    });
    context("redeeming multiple bAssets", async () => {
        // Helper to assert basic redemption conditions, i.e. balance before and after
        const assertRedeemMulti = async (
            md: MassetDetails,
            bAssetRedeemAmounts: Array<BN | number>,
            bAssets: Array<t.MockERC20Instance>,
            recipient: string = sa.default,
            sender: string = sa.default,
            ignoreHealthAssertions = false,
        ): Promise<void> => {
            const { mAsset, basketManager } = md;
            if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

            // Get balances before
            const senderMassetBalBefore = await mAsset.balanceOf(sender);
            const mUSDSupplyBefore = await mAsset.totalSupply();
            const feeRecipient = await mAsset.feeRecipient();
            const feeRecipientBalBefore = await mAsset.balanceOf(feeRecipient);
            // Get arrays of bAsset balances and bAssets
            const recipientBassetBalsBefore = await Promise.all(
                bAssets.map((b) => b.balanceOf(recipient)),
            );
            const bAssetsBefore = await Promise.all(
                bAssets.map((b) => basketManager.getBasset(b.address)),
            );
            const bAssetsDecimals = await Promise.all(bAssets.map((b) => b.decimals()));
            const bAssetsExact = await Promise.all(
                bAssets.map((_, i) =>
                    simpleToExactAmount(bAssetRedeemAmounts[i], bAssetsDecimals[i]),
                ),
            );

            // Execute the redemption
            const tx = await mAsset.redeemMulti(
                bAssets.map((b) => b.address),
                bAssetsExact,
                recipient,
                { from: sender },
            );

            // Calc mAsset burn amounts based on bAsset quantities
            const mAssetQuantity = bAssetsExact.reduce(
                (p, c, i) => p.add(applyRatio(c, bAssetsBefore[i].ratio)),
                new BN(0),
            );
            const feeRate = await mAsset.redemptionFee();
            const mAssetFee = mAssetQuantity.mul(feeRate).div(fullScale);

            // Listen for the events
            await expectEvent(tx.receipt, "RedeemedMulti", {
                recipient,
                redeemer: sender,
                mAssetQuantity,
                bAssets: bAssets.map((b) => b.address),
            });
            // - Transfers to lending platform
            await Promise.all(
                bAssets.map(async (b, i) =>
                    bAssetsExact[i].gt(new BN(0))
                        ? expectEvent(tx.receipt, "Transfer", {
                              from: await basketManager.getBassetIntegrator(b.address),
                              to: recipient,
                              value: bAssetsExact[i],
                          })
                        : null,
                ),
            );
            // Sender should have less mAsset
            const senderMassetBalAfter = await mAsset.balanceOf(sender);
            expect(senderMassetBalAfter).bignumber.eq(
                senderMassetBalBefore.sub(mAssetQuantity).sub(mAssetFee),
            );
            // Total mUSD supply should be less
            const mUSDSupplyAfter = await mAsset.totalSupply();
            expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantity));
            // FeeRecipient should receive fees
            const feeRecipientBalAfter = await mAsset.balanceOf(feeRecipient);
            expect(feeRecipientBalAfter).bignumber.eq(feeRecipientBalBefore.add(mAssetFee));
            // Recipient should have more bAsset
            const recipientBassetBalsAfter = await Promise.all(
                bAssets.map((b) => b.balanceOf(recipient)),
            );
            recipientBassetBalsAfter.map((b, i) =>
                expect(b).bignumber.eq(recipientBassetBalsBefore[i].add(bAssetsExact[i])),
            );
            // VaultBalance should update for this bAsset
            const bAssetsAfter = await Promise.all(
                bAssets.map((b) => basketManager.getBasset(b.address)),
            );
            bAssetsAfter.map((b, i) =>
                expect(new BN(b.vaultBalance)).bignumber.eq(
                    new BN(bAssetsBefore[i].vaultBalance).sub(bAssetsExact[i]),
                ),
            );

            // Complete basket should remain in healthy state
            if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
        };

        before(async () => {
            await runSetup();
        });
        context("when the weights are within the ForgeValidator limit", () => {
            describe("minting with various orders", async () => {
                before(async () => {
                    await runSetup();
                });

                it("should redeem quantities relating to the order of the bAsset inputs", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const compBefore = await massetMachine.getBasketComposition(massetDetails);
                    // Redeeming 2 and 1.. they should match up the amounts
                    await mAsset.redeemMulti(
                        [bAssets[1].address, bAssets[0].address],
                        [new BN(2), new BN(1)],
                        sa.default,
                    );
                    const compAfter = await massetMachine.getBasketComposition(massetDetails);
                    expect(compAfter.bAssets[1].vaultBalance).bignumber.eq(
                        new BN(compBefore.bAssets[1].vaultBalance).sub(new BN(2)),
                    );
                    expect(compAfter.bAssets[0].vaultBalance).bignumber.eq(
                        new BN(compBefore.bAssets[0].vaultBalance).sub(new BN(1)),
                    );
                });
                it("Should redeem multiple bAssets", async () => {
                    // Calc bAsset redemption amounts
                    const bAssets = massetDetails.bAssets.slice(0, 2);
                    const bAsset_redemption = await Promise.all(
                        bAssets.map(async (b) => simpleToExactAmount(1, await b.decimals())),
                    );
                    const bAsset_balBefore = await Promise.all(
                        bAssets.map((b) => b.balanceOf(sa.default)),
                    );
                    const mUSD_supplyBefore = await massetDetails.mAsset.totalSupply();
                    // Redeem
                    await massetDetails.mAsset.redeemMulti(
                        bAssets.map((b) => b.address),
                        bAsset_redemption,
                        sa.default,
                        {
                            from: sa.default,
                        },
                    );
                    // Assert balances
                    const mUSD_supplyAfter = await massetDetails.mAsset.totalSupply();
                    const bAsset_balAfter = await Promise.all(
                        bAssets.map((b) => b.balanceOf(sa.default)),
                    );
                    expect(mUSD_supplyAfter, "Must burn 2 full units of mUSD").bignumber.eq(
                        mUSD_supplyBefore.sub(simpleToExactAmount(2, 18)),
                    );
                    expect(
                        bAsset_balAfter[0],
                        "Must redeem 1 full units of each bAsset",
                    ).bignumber.eq(bAsset_balBefore[0].add(bAsset_redemption[0]));
                });
                it("should redeem selected bAssets only", async () => {
                    const comp = await massetMachine.getBasketComposition(massetDetails);
                    await assertRedeemMulti(
                        massetDetails,
                        [5, 10],
                        [massetDetails.bAssets[2], massetDetails.bAssets[0]],
                    );
                    const compAfter = await massetMachine.getBasketComposition(massetDetails);
                    expect(comp.bAssets[1].vaultBalance).bignumber.eq(
                        compAfter.bAssets[1].vaultBalance,
                    );
                    expect(comp.bAssets[3].vaultBalance).bignumber.eq(
                        compAfter.bAssets[3].vaultBalance,
                    );
                });
            });
            context("and sending to a specific recipient", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should fail if recipient is 0x0", async () => {
                    await expectRevert(
                        massetDetails.mAsset.redeemMulti(
                            [massetDetails.bAssets[0].address],
                            [new BN(1)],
                            ZERO_ADDRESS,
                        ),
                        "Must be a valid recipient",
                    );
                });
                it("should send mUSD when recipient is a contract", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = massetDetails.forgeValidator.address;
                    await assertRedeemMulti(massetDetails, [new BN(1)], [bAssets[0]], recipient);
                });
                it("should send mUSD when the recipient is an EOA", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = sa.dummy1;
                    await assertRedeemMulti(massetDetails, [new BN(1)], [bAssets[1]], recipient);
                });
            });
            context("and not defining recipient", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should redeem to sender in basic redeem func", async () => {
                    const { bAssets } = massetDetails;
                    await assertRedeemMulti(massetDetails, [new BN(1)], [bAssets[1]]);
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
                    const tx = await mAsset.redeemMulti([bAsset.address], [new BN(1)], sa.default);
                    const expectedMasset = new BN(1000000);
                    await expectEvent(tx.receipt, "RedeemedMulti", {
                        mAssetQuantity: expectedMasset,
                        bAssets: [bAsset.address],
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
                    await assertRedeemMulti(massetDetails, [new BN(1)], [bAsset]);
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
                    await assertRedeemMulti(massetDetails, [new BN(1)], [bAsset]);
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
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const bAsset = bAssets[0];
                    const bAssetBefore = await basketManager.getBasset(bAsset.address);
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
                    await assertRedeemMulti(massetDetails, [new BN(1)], [bAsset]);
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
                    await assertRedeemMulti(massetDetails, [new BN(1)], [bAsset]);
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

                    await expectRevert(
                        mAsset.redeemMulti([bAsset.address], [bAssetRedeemAmount], sa.default),
                        "Cannot redeem more bAssets than are in the vault",
                    );
                });
            });
            context("using bAssets with transfer fees", async () => {
                beforeEach(async () => {
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
                    const tx = await mAsset.redeemMulti([bAsset.address], [oneBasset], recipient);
                    const expectedMassetQuantity = applyRatio(oneBasset, bAssetBefore.ratio);
                    expectEvent(tx.receipt, "RedeemedMulti", {
                        mAssetQuantity: expectedMassetQuantity,
                        bAssets: [bAsset.address],
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
                        mAsset.redeemMulti([bAsset.address], [new BN(1000000)], sa.default),
                        "SafeERC20: low-level call failed",
                    );
                });
            });
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup();
                });
                describe("redeeming with some 0 quantities", async () => {
                    it("should allow redemption with some 0 quantities", async () => {
                        const { bAssets } = massetDetails;
                        const recipient = sa.dummy1;
                        await assertRedeemMulti(
                            massetDetails,
                            [new BN(1), new BN(0)],
                            [bAssets[0], bAssets[1]],
                            recipient,
                        );
                    });
                    it("should fail if output mAsset quantity is 0", async () => {
                        const { mAsset, bAssets, basketManager } = massetDetails;
                        // Get all before balances
                        const bAssetBefore = await Promise.all(
                            bAssets.map((b) => basketManager.getBasset(b.address)),
                        );
                        // Approve spending of the bAssets
                        await Promise.all(
                            bAssets.map((b, i) =>
                                massetMachine.approveMasset(b, mAsset, new BN(1)),
                            ),
                        );
                        // Pass all 0's
                        await expectRevert(
                            mAsset.redeemMulti(
                                bAssetBefore.map((b) => b.addr),
                                [new BN(0), new BN(0), new BN(0), new BN(0)],
                                sa.default,
                            ),
                            "Must redeem some bAssets",
                        );
                    });
                });
                context("passing incorrect bAsset array", async () => {
                    it("should error if the array is empty", async () => {
                        const { mAsset } = massetDetails;
                        await expectRevert(
                            mAsset.redeemMulti([], [new BN(1)], sa.default),
                            "Input array mismatch",
                        );
                    });
                    it("should error if both inputs are null", async () => {
                        const { mAsset } = massetDetails;
                        await expectRevert(
                            mAsset.redeemMulti([], [], sa.default),
                            "Input array mismatch",
                        );
                    });
                    it("should error if there is a length mismatch", async () => {
                        const { mAsset, bAssets } = massetDetails;
                        await expectRevert(
                            mAsset.redeemMulti(
                                [bAssets[0].address],
                                [new BN(1), new BN(1)],
                                sa.default,
                            ),
                            "Input array mismatch",
                        );
                    });
                    it("should error if there is a length mismatch", async () => {
                        const { mAsset, bAssets } = massetDetails;
                        await expectRevert(
                            mAsset.redeemMulti(
                                [bAssets[0].address],
                                [new BN(1), new BN(1), new BN(1), new BN(1)],
                                sa.default,
                            ),
                            "Input array mismatch",
                        );
                    });
                    it("should fail if there are duplicate bAsset addresses", async () => {
                        const { mAsset, bAssets } = massetDetails;
                        await expectRevert(
                            mAsset.redeemMulti(
                                [bAssets[0].address, bAssets[0].address],
                                [new BN(1), new BN(1)],
                                sa.default,
                            ),
                            "Must have no duplicates",
                        );
                    });
                });
                it("should fail if sender doesn't have mAsset balance", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    const sender = sa.dummy1;
                    expect(await mAsset.balanceOf(sender)).bignumber.eq(new BN(0));
                    await expectRevert(
                        mAsset.redeemMulti(
                            [bAsset.address, bAssets[1].address],
                            [new BN(1), new BN(0)],
                            sa.default,
                            { from: sender },
                        ),
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

                    // Transfer sufficient balance to do the redemption, but not enough for the fee
                    const mAssetQuantity = applyRatio(bAssetExact, bAssetBefore.ratio);
                    await mAsset.transfer(sender, mAssetQuantity, { from: sa.default });
                    expect(await mAsset.balanceOf(sender)).bignumber.eq(mAssetQuantity);
                    await expectRevert(
                        mAsset.redeemMulti([bAsset.address], [bAssetExact], sender, {
                            from: sender,
                        }),
                        "ERC20: burn amount exceeds balance",
                    );
                });
                it("should fail if the bAsset does not exist", async () => {
                    const { bAssets } = massetDetails;
                    const bAsset = await MockERC20.new("Mock", "MKK", 18, sa.default, 1000);
                    await expectRevert(
                        massetDetails.mAsset.redeemMulti(
                            [bAsset.address, bAssets[0].address],
                            [new BN(100), new BN(100)],
                            sa.default,
                        ),
                        "Must exist",
                    );
                });
            });
            context("with an affected bAsset", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should fail if bAsset is broken above peg", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const bAsset = bAssets[0];
                    await basketManager.handlePegLoss(bAsset.address, false, {
                        from: sa.governor,
                    });
                    const newBasset = await basketManager.getBasset(bAsset.address);
                    expect(newBasset.status).to.eq(BassetStatus.BrokenAbovePeg.toString());
                    await expectRevert(
                        mAsset.redeemMulti([bAsset.address], [new BN(1)], sa.default),
                        "Cannot redeem depegged bAsset",
                    );
                });
                it("should fail if any bAsset in basket is broken below peg", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const bAsset = bAssets[1];
                    await basketManager.setBassetStatus(
                        bAsset.address,
                        BassetStatus.BrokenBelowPeg,
                    );
                    const newBasset = await basketManager.getBasset(bAsset.address);
                    expect(newBasset.status).to.eq(BassetStatus.BrokenBelowPeg.toString());
                    await expectRevert(
                        mAsset.redeemMulti([bAsset.address], [new BN(1)], sa.default),
                        "bAssets undergoing liquidation",
                    );
                });
                it("should fail if any bAsset in basket is liquidating or blacklisted", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const bAsset = bAssets[2];
                    await basketManager.setBassetStatus(bAsset.address, BassetStatus.Liquidating);
                    const newBasset = await basketManager.getBasset(bAsset.address);
                    expect(newBasset.status).to.eq(BassetStatus.Liquidating.toString());
                    await expectRevert(
                        mAsset.redeemMulti([bAsset.address], [new BN(1)], sa.default),
                        "bAssets undergoing liquidation",
                    );
                });
            });
            context("when the bAsset ratio needs to be ceil", async () => {
                before(async () => {
                    await runSetup(true, false);
                });
                it("should burn an extra base unit of mAsset per bAsset unit", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    const oneBaseUnit = new BN(1);
                    const mUSDSupplyBefore = await mAsset.totalSupply();
                    // Update ratio
                    const baseRatio = new BN(10).pow(new BN(18).sub(bAssetDecimals));
                    const ratio = new BN(baseRatio).mul(new BN(100000001));
                    await basketManager.setBassetRatio(bAsset.address, ratio);
                    // Calc mAsset burn amounts based on bAsset quantities
                    const mAssetQuantity = applyRatio(oneBaseUnit, ratio);
                    const mAssetQuantityCeil = applyRatioCeil(oneBaseUnit, ratio);
                    expect(mAssetQuantityCeil).bignumber.eq(mAssetQuantity.add(new BN(1)));
                    // Send the TX
                    const tx = await mAsset.redeemMulti(
                        [bAsset.address],
                        [oneBaseUnit],
                        sa.default,
                    );
                    // Listen for the events
                    await expectEvent(tx.receipt, "RedeemedMulti", {
                        mAssetQuantity: mAssetQuantityCeil,
                        bAssets: [bAsset.address],
                    });
                    // Total mUSD supply should be less
                    const mUSDSupplyAfter = await mAsset.totalSupply();
                    expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantityCeil));
                });
            });
            context("performing multiple redemptions in a row", async () => {
                before("reset", async () => {
                    await runSetup();
                });
                it("should redeem with single bAsset", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const oneMasset = simpleToExactAmount(1, 18);
                    const mUSDSupplyBefore = await mAsset.totalSupply();
                    await Promise.all(
                        bAssets.map(async (b) => {
                            const bAssetDecimals = await b.decimals();
                            const bAssetWhole = simpleToExactAmount(new BN(1), bAssetDecimals);
                            return mAsset.redeemMulti([b.address], [bAssetWhole], sa.default, {
                                from: sa.default,
                            });
                        }),
                    );
                    const mUSDSupplyAfter = await mAsset.totalSupply();
                    expect(mUSDSupplyAfter).bignumber.eq(
                        mUSDSupplyBefore.sub(new BN(bAssets.length).mul(oneMasset)),
                    );
                });
            });
        });

        context("when the basket weights are out of sync", async () => {
            context("when some are close to their threshold...", async () => {
                beforeEach(async () => {
                    await runSetup(false, false);
                });
                it("should fail if we push go below min weight", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(25),
                        new BN(25),
                        new BN(25),
                        new BN(25),
                    ]);
                    // Set no grace allowance
                    await basketManager.setGrace(simpleToExactAmount(1, 18), {
                        from: sa.governor,
                    });
                    // Assert basket is still healthy with 0 grace
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    // Should revert since we would be pushing above target + grace
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    await expectRevert(
                        mAsset.redeemMulti(
                            [bAsset.address],
                            [simpleToExactAmount(5, bAssetDecimals)],
                            sa.default,
                        ),
                        "bAssets must remain above implicit min weight",
                    );
                });
                it("should fail if we go below implicit min", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(25),
                        new BN(25),
                        new BN(25),
                        new BN(25),
                    ]);
                    // Set no grace allowance
                    await basketManager.setGrace(simpleToExactAmount(1, 18), {
                        from: sa.governor,
                    });
                    // Assert basket is still healthy with 0 grace
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    // Should revert since we would be pushing above target + grace
                    const bAsset = bAssets[0];
                    const bAsset2 = bAssets[1];
                    const bAssetDecimals = await bAsset.decimals();
                    const bAssetDecimals2 = await bAsset2.decimals();
                    // Resulting weighting: 23/98. Min weighting = 24.5 -1 = 23.5
                    await expectRevert(
                        mAsset.redeemMulti(
                            [bAsset.address, bAsset2.address],
                            [
                                simpleToExactAmount(1, bAssetDecimals),
                                simpleToExactAmount(3, bAssetDecimals2),
                            ],
                            sa.default,
                        ),
                        "bAssets must remain above implicit min weight",
                    );
                });
            });
            context("when some are above", async () => {
                beforeEach(async () => {
                    await runSetup(false);
                });
                it("should succeed if we redeem the overweight bAsset, and fail otherwise", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    let composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(30),
                        new BN(20),
                        new BN(20),
                        new BN(30),
                    ]);
                    // Set no grace allowance
                    await basketManager.setGrace(simpleToExactAmount(1, 18), {
                        from: sa.governor,
                    });
                    composition = await massetMachine.getBasketComposition(massetDetails);
                    expect(composition.bAssets[0].overweight).to.eq(true);
                    // Should succeed if we redeem this
                    let bAsset = bAssets[0];
                    let bAssetDecimals = await bAsset.decimals();
                    const totalSupplyBefore = await mAsset.totalSupply();
                    await mAsset.redeemMulti(
                        [bAsset.address],
                        [simpleToExactAmount(2, bAssetDecimals)],
                        sa.default,
                    );
                    const totalSupplyAfter = await mAsset.totalSupply();
                    expect(totalSupplyAfter).bignumber.eq(
                        totalSupplyBefore.sub(simpleToExactAmount(2, 18)),
                    );
                    // Should fail if we redeem anything but the overweight bAsset
                    /* eslint-disable-next-line prefer-destructuring */
                    bAsset = bAssets[1];
                    bAssetDecimals = await bAsset.decimals();
                    await expectRevert(
                        mAsset.redeemMulti(
                            [bAsset.address],
                            [simpleToExactAmount(1, bAssetDecimals)],
                            sa.default,
                        ),
                        "Must redeem overweight bAssets",
                    );
                });
                it("should fail if we redeem so much that it goes underweight", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    let composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 25, 25, 25, 25 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.targetWeight).bignumber.eq(simpleToExactAmount(25, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(30),
                        new BN(20),
                        new BN(20),
                        new BN(30),
                    ]);
                    // Set no grace allowance
                    await basketManager.setGrace(simpleToExactAmount(1, 18), {
                        from: sa.governor,
                    });
                    composition = await massetMachine.getBasketComposition(massetDetails);
                    expect(composition.bAssets[0].overweight).to.eq(true);
                    // Should fail if we redeem anything but the overweight bAsset
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    await expectRevert(
                        mAsset.redeemMulti(
                            [bAsset.address],
                            [simpleToExactAmount(20, bAssetDecimals)],
                            sa.default,
                        ),
                        "bAssets must remain above implicit min weight",
                    );
                });
            });
        });

        context("when there are a large number of bAssets in the basket", async () => {
            // Create a basket filled with 16 bAssets, all hooked into the Mock intergation platform
            before(async () => {
                await runSetup(false, false);
                const { basketManager, aaveIntegration } = massetDetails;
                const aaveAddress = await aaveIntegration.platformAddress();
                const mockAave = await MockAave.at(aaveAddress);
                // Create 12 new bAssets
                for (let i = 0; i < 12; i += 1) {
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
            it("should still perform with 12-16 bAssets in the basket", async () => {
                // Assert that we have indeed 16 bAssets
                const { basketManager, mAsset } = massetDetails;
                const onChainBassets = await massetMachine.getBassetsInMasset(massetDetails);
                expect(onChainBassets.length).to.eq(16);
                // Set equal basket weightings
                await basketManager.setBasketWeights(
                    onChainBassets.map((b) => b.addr),
                    onChainBassets.map(() => simpleToExactAmount("6.25", 16)),
                    { from: sa.governor },
                );
                // Mint 6.25 of each bAsset, taking total to 100%
                const approvals = await Promise.all(
                    onChainBassets.map((b, i) =>
                        massetMachine.approveMasset(b.contract, mAsset, new BN("6.25"), sa.default),
                    ),
                );
                await mAsset.mintMulti(
                    onChainBassets.map((b) => b.addr),
                    approvals,
                    sa.default,
                    { from: sa.default },
                );
                // Do the redemption with 16
                await assertRedeemMulti(
                    massetDetails,
                    onChainBassets.map(() => new BN(1)),
                    onChainBassets.map((b) => b.contract),
                );
            });
        });
        context("when the basket manager returns invalid response", async () => {
            before(async () => {
                await runSetup();
            });
            it("should redeem nothing if the preparation returns invalid from manager", async () => {
                const { forgeValidator } = massetDetails;
                // mintSingle
                const bAsset = await MockERC20.new("Mock", "MKK", 18, sa.default, 1000);
                const newManager = await MockBasketManager1.new(bAsset.address);
                const mockMasset = await Masset.new(
                    "mMock",
                    "MK",
                    systemMachine.nexus.address,
                    sa.dummy1,
                    forgeValidator.address,
                    newManager.address,
                );
                const mAssetSupplyBefore = await mockMasset.totalSupply();
                // Should redeem nothing due to the forge preparation being invalid
                await mockMasset.redeemMulti([bAsset.address], [new BN(1)], sa.default);
                const mAssetSupplyAfter = await mockMasset.totalSupply();
                expect(mAssetSupplyBefore).bignumber.eq(mAssetSupplyAfter);
            });
            it("reverts if the BasketManager is paused", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                const bAsset = bAssets[0];
                await basketManager.pause({ from: sa.governor });
                expect(await basketManager.paused()).eq(true);
                await expectRevert(
                    mAsset.redeemMulti([bAsset.address], [new BN(100)], sa.default),
                    "Pausable: paused",
                );
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
                const { bAssets, mAsset, basketManager } = massetDetails;
                // should burn more than is necessary
                const bAsset = bAssets[0];
                const bAssetDecimals = await bAsset.decimals();
                const bAssetWhole = simpleToExactAmount(new BN(1), bAssetDecimals);
                const mUSDSupplyBefore = await mAsset.totalSupply();
                // Calc mAsset burn amounts based on bAsset quantities
                const mAssetQuantityScaled = simpleToExactAmount("1.25", 18);
                // Send the TX
                const tx = await mAsset.redeem(bAsset.address, bAssetWhole);
                // Listen for the events
                await expectEvent(tx.receipt, "Redeemed", {
                    mAssetQuantity: mAssetQuantityScaled,
                    bAsset: bAsset.address,
                    bAssetQuantity: bAssetWhole,
                });
                // Total mUSD supply should be less
                const mUSDSupplyAfter = await mAsset.totalSupply();
                expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantityScaled));
            });
        });
    });
});
