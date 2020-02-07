import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ERC20MockInstance, MassetInstance } from "types/generated";

const MassetArtifact = artifacts.require("Masset");

envSetup.configure();
const { expect, assert } = chai;

contract("MassetMinting", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let masset: MassetInstance;
    let b1: ERC20MockInstance;
    let b2: ERC20MockInstance;

    before("Init contract", async () => {
        systemMachine = new SystemMachine(accounts, sa.other);
        await systemMachine.initialiseMocks();
        const bassetMachine = new BassetMachine(sa.default, sa.other, 500000);

        // 1. Deploy Bassets
        b1 = await bassetMachine.deployERC20Async();
        b2 = await bassetMachine.deployERC20Async();

        // 2. Masset contract deploy
        masset = await MassetArtifact.new(
            "TestMasset",
            "TMT",
            systemMachine.nexus.address,
            [b1.address, b2.address],
            [aToH("b1"), aToH("b2")],
            [percentToWeight(70), percentToWeight(70)],
            [createMultiple(1), createMultiple(1)],
            sa.feePool,
            systemMachine.forgeValidator.address,
        );
    });

    describe("Minting", () => {
        it("Should mint multiple bAssets", async () => {
            await b1.approve(masset.address, 10, { from: sa.default });
            await b2.approve(masset.address, 10, { from: sa.default });

            const mUSD_balBefore = await masset.balanceOf(sa.default);
            await masset.mint([10, 10]);
            const mUSD_balAfter = await masset.balanceOf(sa.default);
            // assert(mUSD_balBefore.eq(new BN(0)));
            // assert(mUSD_balAfter.eq(new BN(10)));
        });

        it("Should mint single bAsset", async () => {
            await b1.approve(masset.address, 10, { from: sa.default });
            await masset.mintSingle(b1.address, 10, sa.default, { from: sa.default });
        });
    });
});
