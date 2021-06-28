"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const machines_1 = require("@utils/machines");
const generated_1 = require("types/generated");
const DelayedClaimableGovernor_behaviour_1 = require("./DelayedClaimableGovernor.behaviour");
const ClaimableGovernor_behaviour_1 = require("./ClaimableGovernor.behaviour");
describe("DelayedClaimableGovernor", () => {
    const ctx = {};
    const GOVERNANCE_DELAY = 60 * 60 * 24 * 7; // 1 week
    describe("Should behave like Claimable", () => {
        beforeEach("Create Contract", async () => {
            const accounts = await hardhat_1.ethers.getSigners();
            const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
            ctx.default = mAssetMachine.sa.default;
            ctx.governor = mAssetMachine.sa.governor;
            ctx.other = mAssetMachine.sa.other;
            ctx.claimable = await new generated_1.DelayedClaimableGovernor__factory(ctx.governor.signer).deploy(ctx.governor.address, GOVERNANCE_DELAY);
        });
        ClaimableGovernor_behaviour_1.shouldBehaveLikeClaimable(ctx);
    });
    describe("Should behave like DelayedClaimable", () => {
        beforeEach("Initiate change Governor", async () => {
            const accounts = await hardhat_1.ethers.getSigners();
            const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
            ctx.default = mAssetMachine.sa.default;
            ctx.governor = mAssetMachine.sa.governor;
            ctx.other = mAssetMachine.sa.other;
            ctx.claimable = await new generated_1.DelayedClaimableGovernor__factory(ctx.governor.signer).deploy(ctx.governor.address, GOVERNANCE_DELAY);
            await ctx.claimable.requestGovernorChange(ctx.other.address);
        });
        DelayedClaimableGovernor_behaviour_1.shouldBehaveLikeDelayedClaimable(ctx);
        it("should not allow zero delay", async () => {
            await chai_1.expect(new generated_1.DelayedClaimableGovernor__factory(ctx.governor.signer).deploy(ctx.governor.address, 0)).to.be.revertedWith("Delay must be greater than zero");
        });
    });
});
//# sourceMappingURL=delayed-governor.spec.js.map