/* eslint-disable @typescript-eslint/camelcase */

import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import { shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ERC20MockInstance, MassetInstance } from "types/generated";

const Masset = artifacts.require("Masset");

const { expect, assert } = envSetup.configure();
contract("MassetMinting", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let masset: MassetInstance;
    let b1;
    let b2;
    let b3;
    let b4;
    let b5;
    let b6;
    let b7;

    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all, sa.other);
        await systemMachine.initialiseMocks();
        const bassetMachine = new BassetMachine(sa.default, sa.other, 500000);

        // 1. Deploy Bassets
        b1 = await bassetMachine.deployERC20Async();
        b2 = await bassetMachine.deployERC20Async();
        b3 = await bassetMachine.deployERC20Async();
        b4 = await bassetMachine.deployERC20Async();
        b5 = await bassetMachine.deployERC20Async();
        b6 = await bassetMachine.deployERC20Async();
        b7 = await bassetMachine.deployERC20Async();

        // 2. Masset contract deploy
        masset = await Masset.new(
            "TestMasset",
            "TMT",
            systemMachine.nexus.address,
            [b1.address, b2.address, b3.address, b4.address, b5.address, b6.address, b7.address],
            [
                percentToWeight(30),
                percentToWeight(30),
                percentToWeight(30),
                percentToWeight(30),
                percentToWeight(20),
                percentToWeight(20),
                percentToWeight(20),
            ],
            [
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
            ],
            [true, false, false, false, false, false, false],
            sa.feePool,
            systemMachine.forgeValidator.address,
        );
    });

    describe("Minting", () => {
        it("Should mint multiple bAssets", async () => {
            await b1.approve(masset.address, 10, { from: sa.default });
            await b2.approve(masset.address, 10, { from: sa.default });
            await b3.approve(masset.address, 10, { from: sa.default });
            await b4.approve(masset.address, 10, { from: sa.default });
            await b5.approve(masset.address, 10, { from: sa.default });
            await b6.approve(masset.address, 10, { from: sa.default });
            await b7.approve(masset.address, 10, { from: sa.default });

            const mUSD_balBefore = await masset.balanceOf(sa.default);
            await masset.mintMulti(127, [10, 10, 10, 10, 10, 10, 10], sa.default);
            const mUSD_balAfter = await masset.balanceOf(sa.default);
            expect(mUSD_balBefore).bignumber.eq(new BN(0));
            expect(mUSD_balAfter, "Must mint 70 base units of mUSD").bignumber.eq(new BN(70));
        });

        it("Should mint 2 bAssets", async () => {
            await b1.approve(masset.address, 10, { from: sa.default });
            // await b2.approve(masset.address, 10, { from: sa.default });
            await b3.approve(masset.address, 10, { from: sa.default });
            // await b4.approve(masset.address, 10, { from: sa.default });

            const bitmap = 5; // 0101 = 5
            await masset.mintMulti(bitmap, [10, 10], sa.default, { from: sa.default });
        });

        it("Should mint single bAsset", async () => {
            await b1.approve(masset.address, 10, { from: sa.default });
            await masset.mint(b1.address, 10, { from: sa.default });
        });

        it("Should return bAssets bitmap", async () => {
            // Returns two bit set, as there are only two bAssets
            const bitmap = await masset.getBitmapForAllBassets();
            expect(bitmap, "wrong bitmap").bignumber.eq(new BN(127));

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
