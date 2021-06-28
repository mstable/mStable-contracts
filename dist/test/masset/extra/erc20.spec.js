"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const machines_1 = require("@utils/machines");
const math_1 = require("@utils/math");
const hardhat_1 = require("hardhat");
const ERC20_behaviour_1 = require("../../shared/ERC20.behaviour");
describe("Masset - ERC20", () => {
    const ctx = {};
    const runSetup = async (seedBasket = false) => {
        ctx.details = await ctx.mAssetMachine.deployMasset();
        if (seedBasket) {
            await ctx.mAssetMachine.seedWithWeightings(ctx.details, [25, 25, 25, 25]);
        }
    };
    before("Init contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        ctx.mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        ctx.initialHolder = ctx.mAssetMachine.sa.default;
        ctx.recipient = ctx.mAssetMachine.sa.dummy1;
        ctx.anotherAccount = ctx.mAssetMachine.sa.dummy2;
    });
    beforeEach("reset contracts", async () => {
        await runSetup(true);
        ctx.token = ctx.details.mAsset;
    });
    ERC20_behaviour_1.shouldBehaveLikeERC20(ctx, "ERC20", math_1.simpleToExactAmount(100, 18));
});
//# sourceMappingURL=erc20.spec.js.map