/* eslint-disable @typescript-eslint/camelcase */

import * as t from "types/generated";
import { shouldFail } from "openzeppelin-test-helpers";

import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import { MassetMachine, StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import { aToH, BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";

const Masset: t.MassetContract = artifacts.require("Masset");

const { expect, assert } = envSetup.configure();

contract("MassetMinting", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);

        // 2. Masset contract deploy
        massetDetails = await massetMachine.deployMassetAndSeedBasket();
    });

    // describe("mint", () => {
    //     context("when the basket is healthy", () => {
    //         context("when the basket is under the limit", () => {});

    //         context("when the basket exceeds the limit", () => {});
    //     });

    //     context("when the basket is not healthy", () => {
    //         it("reverts");
    //     });
    // });

    // describe("mintTo", () => {
    //     context("when the basket is healthy", () => {
    //         context("when the basket is under the limit", () => {
    //             context("when the recipient is an EOA", () => {});

    //             context("when the recipient is a contract ", () => {});

    //             context("when the recipient is the zero address", () => {});
    //         });

    //         context("when the basket exceeds the limit", () => {});
    //     });

    //     context("when the basket is not healthy", () => {
    //         it("reverts");
    //     });
    // });

    describe("Minting", () => {
        it("Should mint multiple bAssets", async () => {
            // It's only possible to mint a single base unit of mAsset, if the bAsset also has 18 decimals
            // For those tokens with 12 decimals, they can at minimum mint 1*10**6 mAsset base units.
            // Thus, these basic calculations should work in whole mAsset units, with specific tests for
            // low decimal bAssets
            const { bAssets } = massetDetails;

            const approvals = await massetMachine.approveMassetMulti(
                [bAssets[0], bAssets[1], bAssets[2]],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            await massetDetails.mAsset.mintMulti(7, approvals, sa.default);

            const approvals2 = await massetMachine.approveMassetMulti(
                [bAssets[0], bAssets[1], bAssets[2], bAssets[3]],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            const mUSD_balBefore = await massetDetails.mAsset.balanceOf(sa.default);
            await massetDetails.mAsset.mintMulti(15, approvals2, sa.default);
            const mUSD_balAfter = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_balAfter, "Must mint 4 full units of mUSD").bignumber.eq(
                mUSD_balBefore.add(simpleToExactAmount(4, 18)),
            );
        });
        it("Should mint 2 bAssets", async () => {
            const { bAssets } = massetDetails;
            const approvals = await massetMachine.approveMassetMulti(
                [bAssets[0], bAssets[2]],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            const bitmap = 5; // 0101 = 5
            await massetDetails.mAsset.mintMulti(bitmap, approvals, sa.default, {
                from: sa.default,
            });
        });
        it("Should mint single bAsset", async () => {
            const { bAssets } = massetDetails;
            const oneMasset = simpleToExactAmount(1, 18);
            const mUSD_bal0 = await massetDetails.mAsset.balanceOf(sa.default);

            const approval0: BN = await massetMachine.approveMasset(
                bAssets[0],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            await massetDetails.mAsset.mint(bAssets[0].address, approval0, { from: sa.default });

            const mUSD_bal1 = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_bal1).bignumber.eq(mUSD_bal0.add(oneMasset));

            const approval1: BN = await massetMachine.approveMasset(
                bAssets[1],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            await massetDetails.mAsset.mint(bAssets[1].address, approval1, { from: sa.default });

            const mUSD_bal2 = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_bal2).bignumber.eq(mUSD_bal1.add(oneMasset));

            const approval2: BN = await massetMachine.approveMasset(
                bAssets[2],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            await massetDetails.mAsset.mint(bAssets[2].address, approval2, { from: sa.default });

            const mUSD_bal3 = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_bal3).bignumber.eq(mUSD_bal2.add(oneMasset));

            const approval3: BN = await massetMachine.approveMasset(
                bAssets[3],
                massetDetails.mAsset,
                1,
                sa.default,
            );
            await massetDetails.mAsset.mint(bAssets[3].address, approval3, { from: sa.default });

            const mUSD_bal4 = await massetDetails.mAsset.balanceOf(sa.default);
            expect(mUSD_bal4).bignumber.eq(mUSD_bal3.add(oneMasset));
        });
        it("should fail if recipient is 0x0");
        it("should mint to sender in basic mint func");
        describe("testing forgevalidation", async () => {
            // context("when some bAssets are overweight...")
            it("should fail if the mint pushes overweight");
            it("should fail if the mint uses invalid bAssets");
            // it("should fail if the mint uses invalid bAssets");
        });
        describe("testing PrepareForgeBasset connection", async () => {
            it("should mint nothing if the prearation returns invalid");
            // it("should");
        });
        it("should allow minting with some 0 quantities, but not all");
        it("mintMulti should fail if mAsset quantity is 0");
        it("Should mint selected bAssets only", async () => {});
        it("Should mintTo a selected recipient", async () => {});
        it("Should deposit tokens into target platforms", async () => {});
    });
});
