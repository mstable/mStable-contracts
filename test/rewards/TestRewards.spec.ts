import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BigNumber } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ERC20MockInstance, MassetInstance } from "types/generated";

const MassetArtifact = artifacts.require("Masset");

envSetup.configure();
const { expect, assert } = chai;

contract("Rewards", async (accounts) => {
    const BN = web3.utils.BN;
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let masset: MassetInstance;
    let b1, b2, b3, b4, b5, b6, b7;

    before("Init contract", async () => {
        systemMachine = new SystemMachine(accounts, sa.other);
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
        masset = await MassetArtifact.new(
            "TestMasset",
            "TMT",
            systemMachine.nexus.address,
            [b1.address, b2.address, b3.address, b4.address, b5.address, b6.address, b7.address],
            [aToH("b1"), aToH("b2"), aToH("b3"), aToH("b4"), aToH("b5"), aToH("b6"), aToH("b7")],
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
            sa.feePool,
            systemMachine.forgeValidator.address,
        );
    });

    describe("Minting via Rewards contract", () => {
        it("Governer should add rewards token to contract", async () => {

        });

        it("Should approve single bAsset", async () => {
        });

        it("Should approve multiple bAssets", async () => {
        });

        it("Should mint single bAsset", async () => {
        });

        it("Should mint multiple bAsset", async () => {
        });

        it("User should claim reward", async () => {
        });

        it("User should redeem reward", async () => {
        });
    });
});
