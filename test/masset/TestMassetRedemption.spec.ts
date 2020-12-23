/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable no-await-in-loop */

import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions";
import { simpleToExactAmount, applyRatio, applyRatioCeil } from "@utils/math";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { BassetStatus } from "@utils/mstable-objects";
import { ZERO_ADDRESS, fullScale, ratioScale } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";

const { expect } = envSetup.configure();

const MockBasketManager1 = artifacts.require("MockBasketManager1");
const MockERC20 = artifacts.require("MockERC20");
const MockAToken = artifacts.require("MockATokenV2");
const MockAave = artifacts.require("MockAaveV2");
const AaveIntegration = artifacts.require("AaveIntegration");

const Masset = artifacts.require("Masset");

contract("Masset - Redeem", async (accounts) => {
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
        bAsset: t.MockERC20Instance,
        amount: BN,
        reason: string,
    ): Promise<void> => {
        const bAssetDecimals: BN = await bAsset.decimals();
        // let decimalDifference: BN = bAssetDecimals.sub(new BN(18));
        const exactAmount = simpleToExactAmount(amount, bAssetDecimals.toNumber());
        await expectRevert(mAsset.redeem(bAsset.address, exactAmount), reason);
    };

    // Helper to assert basic redemption conditions, e.g. balance before and after
    const assertBasicRedemption = async (
        md: MassetDetails,
        bAssetRedeemAmount: BN | number,
        bAsset: t.MockERC20Instance,
        expectFee = true,
        useRedeemTo = false,
        recipient: string = sa.default,
        sender: string = sa.default,
        ignoreHealthAssertions = false,
    ): Promise<void> => {
        const { mAsset, basketManager } = md;
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

        // Get balances before
        const senderMassetBalBefore = await mAsset.balanceOf(sender);
        const mUSDSupplyBefore = await mAsset.totalSupply();
        const derivedRecipient = useRedeemTo ? recipient : sender;
        const recipientBassetBalBefore = await bAsset.balanceOf(derivedRecipient);
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
            scaledFee = fee.mul(new BN(bAssetBefore.ratio)).div(ratioScale);
        }

        const platformInteraction = await massetMachine.getPlatformInteraction(
            mAsset,
            "withdrawal",
            bAssetExact.sub(fee),
            integratorBalBefore,
            bAssetBefore,
        );

        // Execute the redemption
        const tx = useRedeemTo
            ? await mAsset.redeemTo(bAsset.address, bAssetExact, derivedRecipient)
            : await mAsset.redeem(bAsset.address, bAssetExact);

        // Calc mAsset burn amounts based on bAsset quantities
        const mAssetQuantity = applyRatio(bAssetExact, bAssetBefore.ratio);

        // Listen for the events
        await expectEvent(tx.receipt, "Redeemed", {
            redeemer: sender,
            recipient: derivedRecipient,
            mAssetQuantity,
            bAssets: [bAsset.address],
        });
        if (expectFee) {
            expectEvent(tx.receipt, "PaidFee", {
                payer: sender,
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
        const senderMassetBalAfter = await mAsset.balanceOf(sender);
        expect(senderMassetBalAfter).bignumber.eq(senderMassetBalBefore.sub(mAssetQuantity));
        // Total mUSD supply should be less
        const mUSDSupplyAfter = await mAsset.totalSupply();
        expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantity));
        // Recipient should have more bAsset, minus fee
        const recipientBassetBalAfter = await bAsset.balanceOf(derivedRecipient);
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

    // Helper to assert basic redemption conditions, i.e. balance before and after
    const assertRedeemMulti = async (
        md: MassetDetails,
        bAssetRedeemAmounts: Array<BN | number>,
        bAssets: Array<t.MockERC20Instance>,
        expectFee = true,
        recipient: string = sa.default,
        sender: string = sa.default,
        ignoreHealthAssertions = false,
    ): Promise<void> => {
        const { mAsset, basketManager } = md;
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

        // Get balances before
        const senderMassetBalBefore = await mAsset.balanceOf(sender);
        const mUSDSupplyBefore = await mAsset.totalSupply();
        // Get arrays of bAsset balances and bAssets
        const recipientBassetBalsBefore = await Promise.all(
            bAssets.map((b) => b.balanceOf(recipient)),
        );
        const bAssetsBefore = await Promise.all(
            bAssets.map((b) => massetMachine.getBasset(basketManager, b.address)),
        );
        const bAssetsDecimals = await Promise.all(bAssets.map((b) => b.decimals()));
        const bAssetsExact = await Promise.all(
            bAssets.map((_, i) => simpleToExactAmount(bAssetRedeemAmounts[i], bAssetsDecimals[i])),
        );
        const surplusBefore = await mAsset.surplus();

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
        let fees = bAssets.map(() => new BN(0));
        let scaledFees = bAssets.map(() => new BN(0));
        let feeRate = new BN(0);
        //    If there is a fee expected, then deduct it from output
        if (expectFee) {
            feeRate = await mAsset.swapFee();
            expect(feeRate).bignumber.gt(new BN(0) as any);
            expect(feeRate).bignumber.lt(fullScale.div(new BN(50)) as any);
            fees = bAssetsExact.map((b) => b.mul(feeRate).div(fullScale));
            fees.map((f, i) =>
                bAssetsExact[i].gt(new BN(0) as any)
                    ? expect(f).bignumber.gt(new BN(0) as any)
                    : null,
            );
            scaledFees = fees.map((f, i) => f.mul(new BN(bAssetsBefore[i].ratio)).div(ratioScale));
        }

        // Listen for the events
        await expectEvent(tx.receipt, "Redeemed", {
            redeemer: sender,
            recipient,
            mAssetQuantity,
            bAssets: bAssets.map((b) => b.address),
        });
        if (expectFee) {
            bAssets.map((b, i) =>
                fees[i].gt(new BN(0))
                    ? expectEvent(tx.receipt, "PaidFee", {
                          payer: sender,
                          asset: b.address,
                          feeQuantity: fees[i],
                      })
                    : null,
            );
        }
        const surplusAfter = await mAsset.surplus();
        expect(new BN(surplusAfter)).bignumber.eq(
            new BN(surplusBefore).add(scaledFees.reduce((p, c) => p.add(c), new BN(0))),
        );

        // Sender should have less mAsset
        const senderMassetBalAfter = await mAsset.balanceOf(sender);
        expect(senderMassetBalAfter).bignumber.eq(senderMassetBalBefore.sub(mAssetQuantity));
        // Total mUSD supply should be less
        const mUSDSupplyAfter = await mAsset.totalSupply();
        expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantity));
        // Recipient should have more bAsset
        const recipientBassetBalsAfter = await Promise.all(
            bAssets.map((b) => b.balanceOf(recipient)),
        );
        recipientBassetBalsAfter.map((b, i) =>
            expect(b).bignumber.eq(recipientBassetBalsBefore[i].add(bAssetsExact[i]).sub(fees[i])),
        );
        // VaultBalance should update for this bAsset
        const bAssetsAfter = await Promise.all(
            bAssets.map((b) => basketManager.getBasset(b.address)),
        );
        bAssetsAfter.map((b, i) =>
            expect(new BN(b.vaultBalance)).bignumber.eq(
                new BN(bAssetsBefore[i].vaultBalance).sub(bAssetsExact[i]).add(fees[i]),
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
                    await assertBasicRedemption(massetDetails, new BN(1), bAssets[1], true);
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
                        bAssets: [bAsset.address],
                    });

                    const recipientBassetBalAfter = await bAsset.balanceOf(sa.default);
                    expect(recipientBassetBalAfter).bignumber.eq(recipientBassetBalBefore.addn(1));
                    // Sender should have less mASset after
                    const totalSupplyAfter = await mAsset.totalSupply();
                    expect(totalSupplyAfter).bignumber.eq(totalSupplyBefore.sub(new BN(1000000)));
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
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
                    const newFee = simpleToExactAmount("5.234234", 15);
                    await mAsset.setSwapFee(newFee, { from: sa.governor });

                    // Calc mAsset burn amounts based on bAsset quantities
                    const bAssetQuantity = simpleToExactAmount(new BN(1), await bAsset.decimals());
                    const mAssetQuantity = applyRatio(bAssetQuantity, bAssetBefore.ratio);
                    const bAssetFee = bAssetQuantity.mul(newFee).div(fullScale);
                    const massetBalBefore = await mAsset.balanceOf(sa.default);
                    const bassetBalBefore = await bAsset.balanceOf(sa.default);
                    // Run the redemption
                    await assertBasicRedemption(massetDetails, new BN(1), bAsset);
                    const massetBalAfter = await mAsset.balanceOf(sa.default);
                    const bassetBalAfter = await bAsset.balanceOf(sa.default);
                    // Assert balance increase
                    expect(massetBalAfter).bignumber.eq(massetBalBefore.sub(mAssetQuantity));
                    expect(bassetBalAfter).bignumber.eq(
                        bassetBalBefore.add(bAssetQuantity).sub(bAssetFee),
                    );
                });
                it("should deduct nothing if the fee is 0", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const bAsset = bAssets[0];
                    const bAssetBefore = await basketManager.getBasset(bAsset.address);
                    // Set a new fee recipient
                    const newFee = new BN(0);
                    await mAsset.setSwapFee(newFee, { from: sa.governor });

                    // Calc mAsset burn amounts based on bAsset quantities
                    const bAssetQuantity = simpleToExactAmount(new BN(1), await bAsset.decimals());
                    const mAssetQuantity = applyRatio(bAssetQuantity, bAssetBefore.ratio);
                    const massetBalBefore = await mAsset.balanceOf(sa.default);
                    const bassetBalBefore = await bAsset.balanceOf(sa.default);
                    // Run the redemption
                    await assertBasicRedemption(massetDetails, new BN(1), bAsset, false);
                    const massetBalAfter = await mAsset.balanceOf(sa.default);
                    const bassetBalAfter = await bAsset.balanceOf(sa.default);
                    // Assert balance increase
                    expect(massetBalAfter).bignumber.eq(massetBalBefore.sub(mAssetQuantity));
                    expect(bassetBalAfter).bignumber.eq(bassetBalBefore.add(bAssetQuantity));
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
                    const feeRate = await mAsset.swapFee();
                    const bAssetFee = oneBasset.mul(feeRate).div(fullScale);
                    expectEvent(tx.receipt, "Redeemed", {
                        mAssetQuantity: expectedMassetQuantity,
                        bAssets: [bAsset.address],
                    });
                    // 4.0 Total supply goes down, and recipient bAsset goes up slightly
                    const recipientBassetBalAfter = await bAsset.balanceOf(recipient);
                    // Assert that we redeemed gt 99% of the bAsset
                    assertBNSlightlyGTPercent(
                        recipientBassetBalBefore.add(oneBasset.sub(bAssetFee)),
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
                        new BN(bAssetBefore.vaultBalance).sub(oneBasset).add(bAssetFee),
                    );
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                });
                it("should send less output to user if fee unexpected", async () => {
                    // It should burn the full amount of mAsset, but the fees deducted mean the redeemer receives less
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const recipient = sa.dummy3;
                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3];
                    const basket = await massetMachine.getBasketComposition(massetDetails);
                    const bAssetDecimals = await bAsset.decimals();
                    const oneBasset = simpleToExactAmount(1, bAssetDecimals);
                    const feeRate = await mAsset.swapFee();
                    const bAssetFee = oneBasset.mul(feeRate).div(fullScale);
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true);
                    await basketManager.setTransferFeesFlag(bAsset.address, false, {
                        from: sa.governor,
                    });

                    const recipientBassetBalBefore = await bAsset.balanceOf(recipient);
                    await mAsset.redeemTo(bAsset.address, oneBasset, recipient);
                    // 4.0 Total supply goes down, and recipient bAsset goes up slightly
                    const recipientBassetBalAfter = await bAsset.balanceOf(recipient);
                    // Assert that we redeemed gt 99% of the bAsset
                    assertBNSlightlyGTPercent(
                        recipientBassetBalBefore.add(oneBasset.sub(bAssetFee)),
                        recipientBassetBalAfter,
                        "0.4",
                        true,
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
                        "Must redeem some bAssets",
                    );
                });
                it("should fail if sender doesn't have mAsset balance", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    const sender = sa.dummy1;
                    expect(await mAsset.balanceOf(sender)).bignumber.eq(new BN(0));
                    await expectRevert(
                        mAsset.redeem(bAsset.address, new BN(1), { from: sender }),
                        "ERC20: burn amount exceeds balance",
                    );
                });
                it("should fail if the bAsset does not exist", async () => {
                    const bAsset = await MockERC20.new("Mock", "MKK", 18, sa.default, 1000);
                    await expectRevert(
                        massetDetails.mAsset.redeem(bAsset.address, new BN(100)),
                        "bAsset must exist",
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
                        "Must redeem proportionately",
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
                        "Must redeem proportionately",
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
                        "Must redeem proportionately",
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
            context("when some are above", async () => {
                beforeEach(async () => {
                    await runSetup(false);
                });
                it("should succeed if we redeem all overweight bAssets, and fail otherwise", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    let composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 100 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(40),
                        new BN(20),
                        new BN(20),
                        new BN(20),
                    ]);
                    // Set updated weightings
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(30, 16)),
                        {
                            from: sa.governor,
                        },
                    );
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
                it("should fail if there are multiple bAssets over", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    let composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 100 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(40),
                        new BN(20),
                        new BN(20),
                        new BN(40),
                    ]);
                    // Set updated weightings
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(30, 16)),
                        {
                            from: sa.governor,
                        },
                    );
                    composition = await massetMachine.getBasketComposition(massetDetails);
                    expect(composition.bAssets[0].overweight).to.eq(true);
                    // Should succeed if we redeem this
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    await expectRevert(
                        mAsset.redeem(bAsset.address, simpleToExactAmount(1, bAssetDecimals)),
                        "Redemption must contain all overweight bAssets",
                    );
                });
                it("should fail if redeeming overweight bAsset causes another to go overweight", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    let composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 100 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(31),
                        new BN(28),
                        new BN(21),
                        new BN(22),
                    ]);
                    // Set updated weightings
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(30, 16)),
                        {
                            from: sa.governor,
                        },
                    );
                    composition = await massetMachine.getBasketComposition(massetDetails);
                    expect(composition.bAssets[0].overweight).to.eq(true);
                    // Should succeed if we redeem this
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    await expectRevert(
                        mAsset.redeem(bAsset.address, simpleToExactAmount(10, bAssetDecimals)),
                        "bAssets must remain below max weight",
                    );
                });
            });
            context("when there is one breached", async () => {
                beforeEach(async () => {
                    await runSetup(false);
                });
                it("should allow redemption as long as nothing goes overweight", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 100 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    });
                    // Mint some of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        "29.5", // breached given that it's within 1%
                        new BN(28),
                        new BN(23),
                        "19.5",
                    ]);
                    // Set updated weightings
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(30, 16)),
                        {
                            from: sa.governor,
                        },
                    );
                    // Should succeed if we redeem this
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    await assertBasicRedemption(massetDetails, 2, bAsset, true);
                    // 30% * 93 = 27.8, meaning bAssets[1] is now overweight
                    await expectRevert(
                        mAsset.redeem(bAsset.address, simpleToExactAmount(5, bAssetDecimals)),
                        "bAssets must remain below max weight",
                    );
                });
            });
            context("if the redemption would push another overweight", async () => {
                beforeEach(async () => {
                    await runSetup(false);
                });
                it("should fail if any bAsset goes over", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    let composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 100 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    });
                    // Mint some of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(28),
                        new BN(28),
                        new BN(23),
                        new BN(23),
                    ]);
                    // Set updated weightings
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(30, 16)),
                        {
                            from: sa.governor,
                        },
                    );
                    composition = await massetMachine.getBasketComposition(massetDetails);
                    // Should succeed if we redeem this
                    const bAsset = bAssets[0];
                    const bAssetDecimals = await bAsset.decimals();
                    await expectRevert(
                        mAsset.redeem(bAsset.address, simpleToExactAmount(10, bAssetDecimals)),
                        "bAssets must remain below max weight",
                    );
                    // then do accepted one
                    await assertBasicRedemption(massetDetails, 6, bAsset, true);
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
                // Assert that we have indeed 10 bAssets
                const { basketManager, mAsset } = massetDetails;
                const onChainBassets = await massetMachine.getBassetsInMasset(massetDetails);
                expect(onChainBassets.length).to.eq(10);
                // Set equal basket weightings
                await basketManager.setBasketWeights(
                    onChainBassets.map((b) => b.addr),
                    onChainBassets.map(() => simpleToExactAmount(20, 16)),
                    { from: sa.governor },
                );
                // Mint 6.25 of each bAsset, taking total to 100%
                const approvals = await Promise.all(
                    onChainBassets.map((b, i) =>
                        massetMachine.approveMasset(b.contract, mAsset, new BN(10), sa.default),
                    ),
                );
                await mAsset.mintMulti(
                    onChainBassets.map((b) => b.addr),
                    approvals,
                    sa.default,
                    { from: sa.default },
                );
                // Do the redemption
                for (let i = 0; i < 5; i += 1) {
                    await assertBasicRedemption(
                        massetDetails,
                        new BN(1),
                        onChainBassets[i].contract,
                        true,
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
                const mockMasset = await Masset.new();
                await mockMasset.initialize(
                    "mMock",
                    "MK",
                    systemMachine.nexus.address,
                    forgeValidator.address,
                    newManager.address,
                );
                // Should redeem nothing due to the forge preparation being invalid
                await expectRevert(
                    mockMasset.redeem(bAsset.address, new BN(1)),
                    "bAsset must exist",
                );
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
                await basketManager.setBasket(true, simpleToExactAmount(8, 17));
            });
            it("should force proportional redemption", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                // should burn more than is necessary
                const bAsset = bAssets[0];
                const basket = await basketManager.getBasket();
                expect(basket.failed).eq(true);
                await expectRevert(
                    mAsset.redeem(bAsset.address, new BN(1)),
                    "Basket must be alive",
                );
            });
        });
        context("when the mAsset is undergoing recol", () => {
            beforeEach(async () => {
                await runSetup(true);
            });
            it("should block redemption", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                await assertBasketIsHealthy(massetMachine, massetDetails);
                await basketManager.setRecol(true);
                const bAsset = bAssets[0];
                await expectRevert(
                    mAsset.redeem(bAsset.address, new BN(1)),
                    "No bAssets can be undergoing recol",
                );
            });
        });
    });
    context("redeeming multiple bAssets", async () => {
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
                    const { mAsset, bAssets } = massetDetails;
                    const chosenBassets = bAssets.slice(0, 2);
                    const fee = await mAsset.swapFee();
                    const bAsset_redemption = await Promise.all(
                        chosenBassets.map(async (b) => simpleToExactAmount(1, await b.decimals())),
                    );
                    const bAsset_fees = await Promise.all(
                        bAsset_redemption.map(async (b) => b.mul(fee).div(fullScale)),
                    );
                    const bAsset_balBefore = await Promise.all(
                        chosenBassets.map((b) => b.balanceOf(sa.default)),
                    );
                    const mUSD_supplyBefore = await mAsset.totalSupply();
                    // Redeem
                    await mAsset.redeemMulti(
                        chosenBassets.map((b) => b.address),
                        bAsset_redemption,
                        sa.default,
                        {
                            from: sa.default,
                        },
                    );
                    // Assert balances
                    const mUSD_supplyAfter = await mAsset.totalSupply();
                    const bAsset_balAfter = await Promise.all(
                        chosenBassets.map((b) => b.balanceOf(sa.default)),
                    );
                    expect(mUSD_supplyAfter, "Must burn 2 full units of mUSD").bignumber.eq(
                        mUSD_supplyBefore.sub(simpleToExactAmount(2, 18)),
                    );
                    expect(
                        bAsset_balAfter[0],
                        "Must redeem 1 full units of each bAsset",
                    ).bignumber.eq(
                        bAsset_balBefore[0].add(bAsset_redemption[0]).sub(bAsset_fees[0]),
                    );
                });
                it("should redeem selected bAssets only", async () => {
                    const { bAssets } = massetDetails;
                    const comp = await massetMachine.getBasketComposition(massetDetails);
                    await assertRedeemMulti(massetDetails, [5, 10], [bAssets[2], bAssets[0]]);
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
                    await assertRedeemMulti(
                        massetDetails,
                        [new BN(1)],
                        [bAssets[0]],
                        true,
                        recipient,
                    );
                });
                it("should send mUSD when the recipient is an EOA", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = sa.dummy1;
                    await assertRedeemMulti(
                        massetDetails,
                        [new BN(1)],
                        [bAssets[1]],
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
                    await expectEvent(tx.receipt, "Redeemed", {
                        mAssetQuantity: expectedMasset,
                        bAssets: [bAsset.address],
                    });
                    // Recipient should not receive the bAsset because it equates to redeeming 0 cTokens
                    const recipientBassetBalAfter = await bAsset.balanceOf(sa.default);
                    expect(recipientBassetBalAfter).bignumber.eq(recipientBassetBalBefore.addn(1));
                    // Sender should have less mAsset after
                    const totalSupplyAfter = await mAsset.totalSupply();
                    expect(totalSupplyAfter).bignumber.eq(totalSupplyBefore.sub(new BN(1000000)));
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
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
                    // Sets a new Fee rate
                    const newFee = simpleToExactAmount("5.234234", 15);
                    await mAsset.setSwapFee(newFee, { from: sa.governor });
                    // Calc mAsset burn amounts based on bAsset quantities
                    const bAssetQuantity = simpleToExactAmount(new BN(1), await bAsset.decimals());
                    const mAssetQuantity = applyRatio(bAssetQuantity, bAssetBefore.ratio);
                    const bAssetFee = bAssetQuantity.mul(newFee).div(fullScale);
                    const massetBalBefore = await mAsset.balanceOf(sa.default);
                    const bassetBalBefore = await bAsset.balanceOf(sa.default);
                    // Run the redemption
                    await assertRedeemMulti(massetDetails, [new BN(1)], [bAsset]);
                    const massetBalAfter = await mAsset.balanceOf(sa.default);
                    const bassetBalAfter = await bAsset.balanceOf(sa.default);
                    // Assert balance increase
                    expect(massetBalAfter).bignumber.eq(massetBalBefore.sub(mAssetQuantity));
                    expect(bassetBalAfter).bignumber.eq(
                        bassetBalBefore.add(bAssetQuantity).sub(bAssetFee),
                    );
                });
                it("should deduct nothing if the fee is 0", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    // Set a new fee rate
                    const newFee = new BN(0);
                    await mAsset.setSwapFee(newFee, { from: sa.governor });
                    // Calc mAsset burn amounts based on bAsset quantities
                    const bAssetQuantity = simpleToExactAmount(new BN(1), await bAsset.decimals());
                    const bassetBalBefore = await bAsset.balanceOf(sa.default);
                    // Run the redemption
                    await assertRedeemMulti(massetDetails, [new BN(1)], [bAsset], false);
                    const bassetBalAfter = await bAsset.balanceOf(sa.default);
                    // Assert balance increase
                    expect(bassetBalAfter).bignumber.eq(bassetBalBefore.add(bAssetQuantity));
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
                    const feeRate = await mAsset.swapFee();
                    const bAssetFee = oneBasset.mul(feeRate).div(fullScale);
                    expect(bAssetBefore.isTransferFeeCharged).to.eq(true);
                    // 2.0 Get balances
                    const totalSupplyBefore = await mAsset.totalSupply();
                    const recipientBassetBalBefore = await bAsset.balanceOf(recipient);
                    expect(recipientBassetBalBefore).bignumber.eq(new BN(0));
                    // 3.0 Do the redemption
                    const tx = await mAsset.redeemMulti([bAsset.address], [oneBasset], recipient);
                    const expectedMassetQuantity = applyRatio(oneBasset, bAssetBefore.ratio);
                    expectEvent(tx.receipt, "Redeemed", {
                        mAssetQuantity: expectedMassetQuantity,
                        bAssets: [bAsset.address],
                    });
                    // 4.0 Total supply goes down, and recipient bAsset goes up slightly
                    const recipientBassetBalAfter = await bAsset.balanceOf(recipient);
                    // Assert that we redeemed gt 99% of the bAsset
                    assertBNSlightlyGTPercent(
                        recipientBassetBalBefore.add(oneBasset.sub(bAssetFee)),
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
                        new BN(bAssetBefore.vaultBalance).sub(oneBasset.sub(bAssetFee)),
                    );
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                });
                it("should fail if the token charges a fee but we dont know about it", async () => {
                    // It should burn the full amount of mAsset, but the fees deducted mean the redeemer receives less
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const recipient = sa.dummy3;
                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3];
                    const basket = await massetMachine.getBasketComposition(massetDetails);
                    const bAssetDecimals = await bAsset.decimals();
                    const oneBasset = simpleToExactAmount(1, bAssetDecimals);
                    const feeRate = await mAsset.swapFee();
                    const bAssetFee = oneBasset.mul(feeRate).div(fullScale);
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true);
                    await basketManager.setTransferFeesFlag(bAsset.address, false, {
                        from: sa.governor,
                    });

                    const recipientBassetBalBefore = await bAsset.balanceOf(recipient);
                    await mAsset.redeemMulti([bAsset.address], [oneBasset], recipient);
                    // 4.0 Total supply goes down, and recipient bAsset goes up slightly
                    const recipientBassetBalAfter = await bAsset.balanceOf(recipient);
                    // Assert that we redeemed gt 99% of the bAsset
                    assertBNSlightlyGTPercent(
                        recipientBassetBalBefore.add(oneBasset.sub(bAssetFee)),
                        recipientBassetBalAfter,
                        "0.4",
                        true,
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
                            true,
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
                        "bAsset must exist",
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
                        "Must redeem proportionately",
                    );
                });
                it("should fail if any bAsset is blacklisted", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                    const bAsset = bAssets[0];
                    await basketManager.setBassetStatus(
                        bAssets[1].address,
                        BassetStatus.Blacklisted,
                        {
                            from: sa.governor,
                        },
                    );
                    const newBasset = await basketManager.getBasset(bAssets[1].address);
                    expect(newBasset.status).to.eq(BassetStatus.Blacklisted.toString());
                    await expectRevert(
                        mAsset.redeemMulti([bAsset.address], [new BN(1)], sa.default),
                        "Basket contains blacklisted bAsset",
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
                        "Must redeem proportionately",
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
                        "Must redeem proportionately",
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
                    await expectEvent(tx.receipt, "Redeemed", {
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
            context("when some are above", async () => {
                beforeEach(async () => {
                    await runSetup(false);
                });
                it("should succeed if we redeem all the overweight bAssets, and fail otherwise", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    let composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 100
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    await seedWithWeightings(massetDetails, [
                        new BN(40),
                        new BN(20),
                        new BN(20),
                        new BN(40),
                    ]);
                    // Set updated weightings
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(25, 16)),
                        {
                            from: sa.governor,
                        },
                    );
                    composition = await massetMachine.getBasketComposition(massetDetails);
                    expect(composition.bAssets[0].overweight).to.eq(true);
                    // Should succeed if we redeem this
                    const bAsset = bAssets[0];
                    const bAsset2 = bAssets[2];
                    const bAsset3 = bAssets[3];
                    const bAssetDecimals = await bAsset.decimals();
                    const bAsset2Decimals = await bAsset2.decimals();
                    const bAsset3Decimals = await bAsset3.decimals();
                    const totalSupplyBefore = await mAsset.totalSupply();
                    await mAsset.redeemMulti(
                        [bAsset.address, bAsset3.address],
                        [
                            simpleToExactAmount(2, bAssetDecimals),
                            simpleToExactAmount(2, bAsset3Decimals),
                        ],
                        sa.default,
                    );
                    const totalSupplyAfter = await mAsset.totalSupply();
                    expect(totalSupplyAfter).bignumber.eq(
                        totalSupplyBefore.sub(simpleToExactAmount(4, 18)),
                    );
                    // Should fail if we redeem anything but the overweight bAsset
                    /* eslint-disable-next-line prefer-destructuring */
                    await expectRevert(
                        mAsset.redeemMulti(
                            [bAsset.address],
                            [simpleToExactAmount(1, bAssetDecimals)],
                            sa.default,
                        ),
                        "Redemption must contain all overweight bAssets",
                    );
                    await expectRevert(
                        mAsset.redeemMulti(
                            [bAsset3.address, bAsset2.address],
                            [
                                simpleToExactAmount(15, bAsset3Decimals),
                                simpleToExactAmount(1, bAsset2Decimals),
                            ],
                            sa.default,
                        ),
                        "Must redeem overweight bAssets",
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
                // Assert that we have indeed 10 bAssets
                const { basketManager, mAsset } = massetDetails;
                const onChainBassets = await massetMachine.getBassetsInMasset(massetDetails);
                expect(onChainBassets.length).to.eq(10);
                // Set equal basket weightings
                await basketManager.setBasketWeights(
                    onChainBassets.map((b) => b.addr),
                    onChainBassets.map(() => simpleToExactAmount(20, 16)),
                    { from: sa.governor },
                );
                // Mint 6.25 of each bAsset, taking total to 100%
                const approvals = await Promise.all(
                    onChainBassets.map((b, i) =>
                        massetMachine.approveMasset(b.contract, mAsset, new BN(10), sa.default),
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
                const mockMasset = await Masset.new();
                await mockMasset.initialize(
                    "mMock",
                    "MK",
                    systemMachine.nexus.address,
                    forgeValidator.address,
                    newManager.address,
                );
                // Should redeem nothing due to the forge preparation being invalid
                await expectRevert(
                    mockMasset.redeemMulti([bAsset.address], [new BN(1)], sa.default),
                    "bAsset must exist",
                );
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
                await basketManager.setBasket(true, simpleToExactAmount(8, 17));
            });
            it("should force proportional redemption", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                // should burn more than is necessary
                const bAsset = bAssets[0];
                const basket = await basketManager.getBasket();
                expect(basket.failed).eq(true);
                await expectRevert(
                    mAsset.redeemMulti([bAsset.address], [new BN(1)], sa.default),
                    "Basket must be alive",
                );
            });
        });
        context("when the mAsset is undergoing recol", () => {
            beforeEach(async () => {
                await runSetup(true);
            });
            it("should block redemption", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                await assertBasketIsHealthy(massetMachine, massetDetails);
                await basketManager.setRecol(true);
                const bAsset = bAssets[0];
                await expectRevert(
                    mAsset.redeemMulti([bAsset.address], [new BN(1)], sa.default),
                    "No bAssets can be undergoing recol",
                );
            });
        });
    });
});
