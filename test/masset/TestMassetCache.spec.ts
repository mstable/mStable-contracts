/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable no-await-in-loop */

import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";

import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { BassetStatus } from "@utils/mstable-objects";
import { ZERO_ADDRESS, fullScale } from "@utils/constants";
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

interface MintOutput {
    minterBassetBalBefore: BN;
    minterBassetBalAfter: BN;
    recipientBalBefore: BN;
    recipientBalAfter: BN;
}

contract("Masset - Mint", async (accounts) => {
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

    const assertFailedMint = async (
        mAsset: t.MassetInstance,
        bAsset: t.MockErc20Instance,
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
        bAsset: t.MockErc20Instance,
        useMintTo = false,
        recipient: string = sa.default,
        sender: string = sa.default,
        ignoreHealthAssertions = false,
    ): Promise<void> => {
        const { mAsset, basketManager } = md;
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

        const minterBassetBalBefore = await bAsset.balanceOf(sender);
        const derivedRecipient = useMintTo ? recipient : sender;
        const recipientBalBefore = await mAsset.balanceOf(derivedRecipient);
        const bAssetBefore = await basketManager.getBasset(bAsset.address);

        const approval0: BN = await massetMachine.approveMasset(
            bAsset,
            mAsset,
            new BN(mAssetMintAmount),
        );
        const tx = useMintTo
            ? await mAsset.mintTo(bAsset.address, approval0, derivedRecipient, { from: sender })
            : await mAsset.mint(bAsset.address, approval0, { from: sender });

        // const mAssetQuantity = simpleToExactAmount(mAssetMintAmount, 18);
        // const bAssetQuantity = simpleToExactAmount(mAssetMintAmount, await bAsset.decimals());
        // await expectEvent(tx.receipt, "Minted", {
        //     minter: sender,
        //     recipient: derivedRecipient,
        //     mAssetQuantity,
        //     bAsset: bAsset.address,
        //     bAssetQuantity,
        // });
        // // Transfers to lending platform
        // await expectEvent(tx.receipt, "Transfer", {
        //     from: sender,
        //     to: await basketManager.getBassetIntegrator(bAsset.address),
        //     value: bAssetQuantity,
        // });
        // // Deposits into lending platform
        // const emitter = await AaveIntegration.new();
        // await expectEvent.inTransaction(tx.tx, emitter, "Deposit", {
        //     _bAsset: bAsset.address,
        //     _amount: bAssetQuantity,
        // });
        // // Recipient should have mAsset quantity after
        // const recipientBalAfter = await mAsset.balanceOf(derivedRecipient);
        // expect(recipientBalAfter).bignumber.eq(recipientBalBefore.add(mAssetQuantity));
        // // Sender should have less bAsset after
        // const minterBassetBalAfter = await bAsset.balanceOf(sender);
        // expect(minterBassetBalAfter).bignumber.eq(minterBassetBalBefore.sub(bAssetQuantity));
        // // VaultBalance should update for this bAsset
        // const bAssetAfter = await basketManager.getBasset(bAsset.address);
        // expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(
        //     new BN(bAssetBefore.vaultBalance).add(bAssetQuantity),
        // );

        // // Complete basket should remain in healthy state
        // if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
    };

    // Helper to assert basic redemption conditions, e.g. balance before and after
    const assertBasicRedemption = async (
        md: MassetDetails,
        bAssetRedeemAmount: BN | number,
        bAsset: t.MockErc20Instance,
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
        const bAssetBefore = await basketManager.getBasset(bAsset.address);
        const bAssetDecimals = await bAsset.decimals();
        const bAssetExact = simpleToExactAmount(bAssetRedeemAmount, bAssetDecimals);

        // Execute the redemption
        const tx = useRedeemTo
            ? await mAsset.redeemTo(bAsset.address, bAssetExact, derivedRecipient)
            : await mAsset.redeem(bAsset.address, bAssetExact);

        // // Calc mAsset burn amounts based on bAsset quantities
        // const mAssetQuantity = applyRatio(bAssetExact, bAssetBefore.ratio);
        // let fee = new BN(0);
        // let feeRate = new BN(0);
        // //    If there is a fee expected, then deduct it from output
        // if (expectFee) {
        //     feeRate = await mAsset.swapFee();
        //     expect(feeRate).bignumber.gt(new BN(0) as any);
        //     expect(feeRate).bignumber.lt(fullScale.div(new BN(50)) as any);
        //     fee = bAssetExact.mul(feeRate).div(fullScale);
        //     expect(fee).bignumber.gt(new BN(0) as any);
        // }

        // // Listen for the events
        // await expectEvent(tx.receipt, "Redeemed", {
        //     redeemer: sender,
        //     recipient: derivedRecipient,
        //     mAssetQuantity,
        //     bAssets: [bAsset.address],
        // });
        // if (expectFee) {
        //     expectEvent(tx.receipt, "PaidFee", {
        //         payer: sender,
        //         asset: bAsset.address,
        //         feeQuantity: fee,
        //     });
        // }
        // // - Withdraws from lending platform
        // const emitter = await AaveIntegration.new();
        // await expectEvent.inTransaction(tx.tx, emitter, "Withdrawal", {
        //     _bAsset: bAsset.address,
        //     _amount: bAssetExact.sub(fee),
        // });
        // // Sender should have less mAsset
        // const senderMassetBalAfter = await mAsset.balanceOf(sender);
        // expect(senderMassetBalAfter).bignumber.eq(senderMassetBalBefore.sub(mAssetQuantity));
        // // Total mUSD supply should be less
        // const mUSDSupplyAfter = await mAsset.totalSupply();
        // expect(mUSDSupplyAfter).bignumber.eq(mUSDSupplyBefore.sub(mAssetQuantity));
        // // Recipient should have more bAsset, minus fee
        // const recipientBassetBalAfter = await bAsset.balanceOf(derivedRecipient);
        // expect(recipientBassetBalAfter).bignumber.eq(
        //     recipientBassetBalBefore.add(bAssetExact).sub(fee),
        // );
        // // VaultBalance should update for this bAsset, including fee
        // const bAssetAfter = await basketManager.getBasset(bAsset.address);
        // expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(
        //     new BN(bAssetBefore.vaultBalance).sub(bAssetExact),
        // );

        // // Complete basket should remain in healthy state
        // if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
    };

    describe("minting with a single bAsset", () => {
        context("when the weights are within the ForgeValidator limit", () => {
            before("reset", async () => {
                await runSetup();
            });
            it("should exec", async () => {
                const { bAssets, forgeValidator } = massetDetails;
                const recipient = forgeValidator.address;
                await assertBasicMint(massetDetails, new BN(100), bAssets[0], true, recipient);
                await assertBasicMint(massetDetails, new BN(100), bAssets[0], false);
                await assertBasicRedemption(
                    massetDetails,
                    new BN(1),
                    bAssets[1],
                    true,
                    true,
                    recipient,
                );
                await assertBasicRedemption(massetDetails, new BN(20), bAssets[1], true, false);
            });
        });
    });
});
