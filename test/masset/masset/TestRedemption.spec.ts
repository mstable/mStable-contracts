/* eslint-disable @typescript-eslint/camelcase */

import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import { shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ERC20MockInstance, MassetInstance } from "types/generated";
import { MassetDetails } from "@utils/machines/massetMachine";

const Masset = artifacts.require("Masset");

const { expect, assert } = envSetup.configure();

contract("MassetRedemption", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    before("Init contract", async () => {
        // 1. Create the system Mock machines
        systemMachine = new SystemMachine(sa.all, sa.other);
        await systemMachine.initialiseMocks();
        massetMachine = new MassetMachine(systemMachine);

        // 2. Create the mAsset & add it to the manager
        // 3. Do a mint with all the bAssets
        massetDetails = await massetMachine.createMassetAndSeedBasket();
        console.log("===>>>", (await massetDetails.mAsset.totalSupply()).toString());
    });

    describe("Redeem", () => {
        it("Should redeem a bAsset", async () => {
            // 4. add the prices to the oracle
            await systemMachine.addMockPrices("1000000", massetDetails.mAsset.address);

            // 5. ensure i have MTA and approve mUSD & MTA
            await systemMachine.systok.approve(
                massetDetails.mAsset.address,
                simpleToExactAmount(1000, 18),
                { from: systemMachine.sa.default },
            );
            // 6. redeem
            await massetDetails.mAsset.redeem(massetDetails.bAssets[0].address, "1", {
                from: systemMachine.sa.default,
            });
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
