"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const machines_1 = require("@utils/machines");
const generated_1 = require("types/generated");
const ClaimableGovernor_behaviour_1 = require("./ClaimableGovernor.behaviour");
describe("ClaimableGovernable", () => {
    const ctx = {};
    beforeEach("Create Contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        ctx.default = mAssetMachine.sa.default;
        ctx.governor = mAssetMachine.sa.governor;
        ctx.other = mAssetMachine.sa.other;
        ctx.claimable = await new generated_1.ClaimableGovernor__factory(mAssetMachine.sa.governor.signer).deploy(mAssetMachine.sa.governor.address);
    });
    ClaimableGovernor_behaviour_1.shouldBehaveLikeClaimable(ctx);
    describe("after initiating a transfer", () => {
        let newOwner;
        beforeEach(async () => {
            const accounts = await hardhat_1.ethers.getSigners();
            const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
            newOwner = mAssetMachine.sa.other;
            await ctx.claimable.connect(mAssetMachine.sa.governor.signer).requestGovernorChange(newOwner.address);
        });
        it("changes allow pending owner to claim ownership", async () => {
            await ctx.claimable.connect(newOwner.signer).claimGovernorChange();
            const owner = await ctx.claimable.governor();
            chai_1.expect(owner === newOwner.address).to.be.true;
        });
    });
});
//# sourceMappingURL=claimable-governor.spec.js.map