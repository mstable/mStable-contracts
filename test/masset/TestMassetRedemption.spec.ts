/* eslint-disable @typescript-eslint/camelcase */

import { createMultiple, simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import { shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ERC20MockInstance, MassetInstance } from "types/generated";
import { MassetDetails } from "@utils/machines/massetMachine";
import { expScale } from "@utils/constants";

const Masset = artifacts.require("Masset");

const { expect, assert } = envSetup.configure();

contract("MassetRedemption", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    before("Init contract", async () => {
        // 1. Create the system Mock machines
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);

        // 2. Do a mint with all the bAssets
        massetDetails = await massetMachine.createMassetAndSeedBasket();
    });

    describe("Redeem", () => {
        it("Should redeem a bAsset", async () => {
            // Approval for Fee, if necessary
            // const redemptionAmount = simpleToExactAmount(1, 18);
            // const redemptionFee = await massetDetails.mAsset.redemptionFee();
            // let redemptionFeeUnits = redemptionAmount.mul(redemptionFee).div(expScale);
            // redemptionFeeUnits = redemptionFeeUnits.add(new BN("10000000000000000000"));
            // // 3. ensure i have MTA and approve mUSD
            // await massetDetails.mAsset.approve(massetDetails.mAsset.address, redemptionFeeUnits, {
            //     from: sa.default,
            // });
            const mUSD_supplyBefore = await massetDetails.mAsset.totalSupply();
            const bAsset_balBefore = await massetDetails.bAssets[0].balanceOf(sa.default);
            const bAsset_redemption = simpleToExactAmount(
                1,
                await massetDetails.bAssets[0].decimals(),
            );
            await massetDetails.mAsset.redeem(massetDetails.bAssets[0].address, bAsset_redemption, {
                from: sa.default,
            });
            const mUSD_supplyAfter = await massetDetails.mAsset.totalSupply();
            const bAsset_balAfter = await massetDetails.bAssets[0].balanceOf(sa.default);
            expect(mUSD_supplyAfter, "Must burn 1 full units of mUSD").bignumber.eq(
                mUSD_supplyBefore.sub(simpleToExactAmount(1, 18)),
            );
            expect(bAsset_balAfter, "Must redeem 1 full units of bAsset").bignumber.eq(
                bAsset_balBefore.add(bAsset_redemption),
            );
        });

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
    // describe("Redeem", async () => {
    //     context("when the basket is healthy", () => {
    //         context("when the basket is under the limit", () => {
    //             context("when the recipient is an EOA", () => {
    //                 // massetDetails.mAsset.redeem()
    //                 expect(true, "this");
    //             });
    //             context("When mAsset is not added to Manager");
    //             context("When no prices are present");
    //             context("When mAsset prices are present");
    //         });

    //         context("when the basket exceeds the limit", () => {});
    //     });
    // });
});
