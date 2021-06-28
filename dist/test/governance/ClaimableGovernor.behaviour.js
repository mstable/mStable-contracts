"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldBehaveLikeClaimable = void 0;
const chai_1 = require("chai");
const constants_1 = require("@utils/constants");
function shouldBehaveLikeClaimable(ctx) {
    it("should have a governor", async () => {
        const governor = await ctx.claimable.governor();
        chai_1.expect(governor !== constants_1.ZERO_ADDRESS).to.be.true;
    });
    it("changes pendingGovernor after transfer", async () => {
        const newGovernor = ctx.other;
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(newGovernor.address);
        const proposedGovernor = await ctx.claimable.proposedGovernor();
        chai_1.expect(proposedGovernor === newGovernor.address).to.be.true;
    });
    it("should prevent cancelGovernor from non-governor", async () => {
        // Request new Governor
        const newGovernor = ctx.other;
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(newGovernor.address);
        const proposedGovernor = await ctx.claimable.proposedGovernor();
        chai_1.expect(proposedGovernor === newGovernor.address).to.be.true;
        // Try to Cancel governor
        await chai_1.expect(ctx.claimable.connect(ctx.default.signer).cancelGovernorChange()).to.be.revertedWith("GOV: caller is not the Governor");
        const newProposedGovernor = await ctx.claimable.proposedGovernor();
        chai_1.expect(proposedGovernor === newProposedGovernor).to.be.true;
    });
    it("should prevent cancelGovernor from pending-governor", async () => {
        // Request new Governor
        const newGovernor = ctx.other;
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(newGovernor.address);
        const proposedGovernor = await ctx.claimable.proposedGovernor();
        chai_1.expect(proposedGovernor === newGovernor.address).to.be.true;
        // Try to Cancel governor
        await chai_1.expect(ctx.claimable.connect(ctx.other.signer).cancelGovernorChange()).to.be.revertedWith("GOV: caller is not the Governor");
        const newProposedGovernor = await ctx.claimable.proposedGovernor();
        chai_1.expect(proposedGovernor === newProposedGovernor).to.be.true;
    });
    it("should allow cancelGovernor from Governor", async () => {
        // Request new Governor
        const newGovernor = ctx.other;
        const currentGovernor = await ctx.claimable.governor();
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(newGovernor.address);
        const proposedGovernor = await ctx.claimable.proposedGovernor();
        chai_1.expect(proposedGovernor === newGovernor.address).to.be.true;
        // Try to Cancel governor
        await ctx.claimable.connect(ctx.governor.signer).cancelGovernorChange();
        const newProposedGovernor = await ctx.claimable.proposedGovernor();
        const governor = await ctx.claimable.governor();
        chai_1.expect(proposedGovernor !== constants_1.ZERO_ADDRESS).to.be.true;
        chai_1.expect(newProposedGovernor === constants_1.ZERO_ADDRESS).to.be.true;
        chai_1.expect(governor === currentGovernor).to.be.true;
    });
    it("should prevent Others to call claimOwnership when there is no pendingGovernor", async () => {
        await chai_1.expect(ctx.claimable.connect(ctx.other.signer).claimGovernorChange()).to.be.revertedWith("Sender is not proposed governor");
    });
    it("should prevent Governor to call claimOwnership when there is no pendingGovernor", async () => {
        await chai_1.expect(ctx.claimable.connect(ctx.governor.signer).claimGovernorChange()).to.be.revertedWith("Sender is not proposed governor");
    });
    it("should prevent non-governors from transfering", async () => {
        const governor = await ctx.claimable.governor();
        chai_1.expect(governor !== ctx.other.address).to.be.true;
        await chai_1.expect(ctx.claimable.connect(ctx.other.signer).requestGovernorChange(ctx.other.address)).to.be.revertedWith("GOV: caller is not the Governor");
    });
    it("should prevent direct change governor", async () => {
        await chai_1.expect(ctx.claimable.connect(ctx.governor.signer).changeGovernor(ctx.other.address)).to.be.revertedWith("Direct change not allowed");
    });
    it("requestGovernorChange(): should prevent zero address", async () => {
        // NOTE - false negative when passing specific error string
        await chai_1.expect(ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(constants_1.ZERO_ADDRESS)).to.be.reverted;
    });
    it("should prevent when already proposed", async () => {
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(ctx.other.address);
        await chai_1.expect(ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(ctx.other.address)).to.be.revertedWith("Proposed governor already set");
    });
    it("cancelGovernorChange(): should prevent when not proposed", async () => {
        await chai_1.expect(ctx.claimable.connect(ctx.governor.signer).cancelGovernorChange()).to.be.revertedWith("Proposed Governor not set");
    });
}
exports.shouldBehaveLikeClaimable = shouldBehaveLikeClaimable;
//# sourceMappingURL=ClaimableGovernor.behaviour.js.map