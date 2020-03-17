/* eslint-disable @typescript-eslint/camelcase */

import * as t from "types/generated";
import { shouldFail } from "openzeppelin-test-helpers";

import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import {
    BassetMachine,
    MassetMachine,
    StandardAccounts,
    SystemMachine,
    MassetDetails,
} from "@utils/machines";
import { aToH, BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";

const Masset: t.MassetContract = artifacts.require("Masset");

const { expect, assert } = envSetup.configure();

const approveMasset = async (
    bAsset: t.ERC20MockInstance,
    mAsset: t.MassetInstance,
    fullMassetUnits: number,
    sender: string,
): Promise<BN> => {
    const bAssetDecimals: BN = await bAsset.decimals();
    // let decimalDifference: BN = bAssetDecimals.sub(new BN(18));
    const approvalAmount: BN = simpleToExactAmount(fullMassetUnits, bAssetDecimals.toNumber());
    await bAsset.approve(mAsset.address, approvalAmount, { from: sender });
    return approvalAmount;
};

contract("MassetMinting", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);

        // 2. Masset contract deploy
        massetDetails = await massetMachine.deployMasset();
    });

    describe("Minting", () => {
        it("Should mint multiple bAssets", async () => {
            // It's only possible to mint a single base unit of mAsset, if the bAsset also has 18 decimals
            // For those tokens with 12 decimals, they can at minimum mint 1*10**6 mAsset base units.
            // Thus, these basic calculations should work in whole mAsset units, with specific tests for
            // low decimal bAssets
            const { bAssets } = massetDetails;
            const approval0: BN = await approveMasset(
                bAssets[0],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            const approval1: BN = await approveMasset(
                bAssets[1],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            const approval2: BN = await approveMasset(
                bAssets[2],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            const approval3: BN = await approveMasset(
                bAssets[3],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            const mUSD_balBefore = await massetDetails.mAsset.balanceOf(sa.default);
            await massetDetails.mAsset.mintMulti(
                15,
                [approval0, approval1, approval2, approval3],
                sa.default,
            );
            const mUSD_balAfter = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_balBefore).bignumber.eq(new BN(0));
            expect(mUSD_balAfter, "Must mint 4 full units of mUSD").bignumber.eq(
                simpleToExactAmount(4, 18),
            );
        });
        it("Should mint 2 bAssets", async () => {
            const { bAssets } = massetDetails;
            const approval0: BN = await approveMasset(
                bAssets[0],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            const approval2: BN = await approveMasset(
                bAssets[2],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            const bitmap = 5; // 0101 = 5
            await massetDetails.mAsset.mintMulti(bitmap, [approval0, approval2], sa.default, {
                from: sa.default,
            });
        });
        it("Should mint single bAsset", async () => {
            const { bAssets } = massetDetails;
            const oneMasset = simpleToExactAmount(1, 18);
            const mUSD_bal0 = await massetDetails.mAsset.balanceOf(sa.default);

            const approval0: BN = await approveMasset(
                bAssets[0],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            await massetDetails.mAsset.mint(bAssets[0].address, approval0, { from: sa.default });

            const mUSD_bal1 = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_bal1).bignumber.eq(mUSD_bal0.add(oneMasset));

            const approval1: BN = await approveMasset(
                bAssets[1],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            await massetDetails.mAsset.mint(bAssets[1].address, approval1, { from: sa.default });

            const mUSD_bal2 = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_bal2).bignumber.eq(mUSD_bal1.add(oneMasset));

            const approval2: BN = await approveMasset(
                bAssets[2],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            await massetDetails.mAsset.mint(bAssets[2].address, approval2, { from: sa.default });

            const mUSD_bal3 = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_bal3).bignumber.eq(mUSD_bal2.add(oneMasset));

            const approval3: BN = await approveMasset(
                bAssets[3],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            await massetDetails.mAsset.mint(bAssets[3].address, approval3, { from: sa.default });

            const mUSD_bal4 = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_bal4).bignumber.eq(mUSD_bal3.add(oneMasset));
        });

        it("Should return bAssets bitmap", async () => {
            // Returns two bit set, as there are only two bAssets
            // const bitmap = await masset.getBitmapForAllBassets();
            // expect(bitmap, "wrong bitmap").bignumber.eq(new BN(127));
            // Result sets only first bit, as b1 is at first index in bAsset array
            // bitmap = await masset.getBitmapFor([b1.address]);
            // expect(bitmap).bignumber.eq(new BN(1));
            // Result sets only second bit, as b2 is at second index in bAsset array
            // bitmap = await masset.getBitmapFor([b2.address]);
            // expect(bitmap).bignumber.eq(new BN(2));
            // TODO add test for 0 items
            // TODO add test for 32 items
            // TODO add test for more than 32 items
        });

        it("Should convert bitmap to index array", async () => {
            // let indexes = await masset.convertBitmapToIndexArr(3, 2);
            // console.log(indexes);
            // TODO (3,3) will return indexes[0,1,0] which is wrong
            // TODO need to look for solution
            // shouldFail(await masset.convertBitmapToIndexArr(3, 3));
            // console.log(indexes);
        });

        it("Should mint selected bAssets only", async () => {});
    });
});
