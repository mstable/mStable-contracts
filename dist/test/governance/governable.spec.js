"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const machines_1 = require("@utils/machines");
const generated_1 = require("types/generated");
const Governable_behaviour_1 = require("./Governable.behaviour");
describe("Governable", () => {
    const ctx = {};
    beforeEach("Create Contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        ctx.governable = await new generated_1.MockGovernable__factory(mAssetMachine.sa.governor.signer).deploy();
        ctx.owner = mAssetMachine.sa.governor;
        ctx.other = mAssetMachine.sa.other;
    });
    Governable_behaviour_1.shouldBehaveLikeGovernable(ctx);
});
//# sourceMappingURL=governable.spec.js.map