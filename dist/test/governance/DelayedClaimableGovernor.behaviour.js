"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldBehaveLikeDelayedClaimable = void 0;
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const time_1 = require("@utils/time");
function shouldBehaveLikeDelayedClaimable(ctx) {
    it("should have delay set", async () => {
        const delay = await ctx.claimable.delay();
        chai_1.expect(delay, "wrong delay").gt(math_1.BN.from(0));
    });
    it("should have request time set", async () => {
        const timestamp = await time_1.getTimestamp();
        const requestTime = await ctx.claimable.requestTime();
        chai_1.expect(requestTime, "requestTime is 0").gt(math_1.BN.from(0));
        chai_1.expect(timestamp, "wrong timestamp").eq(requestTime);
    });
    it("prevent newGovernor to claim ownership before delay over", async () => {
        const newOwner = ctx.other;
        await chai_1.expect(ctx.claimable.connect(newOwner.signer).claimGovernorChange()).to.be.revertedWith("Delay not over");
        const owner = await ctx.claimable.governor();
        chai_1.expect(owner, "wrong owner").to.not.equal(newOwner);
    });
    it("prevent newOwner to claim ownership before 10 second of delay over time", async () => {
        const timestamp = await time_1.getTimestamp();
        const delay = await ctx.claimable.delay();
        await time_1.increaseTime(delay.sub(math_1.BN.from(10)));
        const newOwner = ctx.other;
        await chai_1.expect(ctx.claimable.connect(newOwner.signer).claimGovernorChange()).to.be.revertedWith("Delay not over");
        const owner = await ctx.claimable.governor();
        const requestTime = await ctx.claimable.requestTime();
        chai_1.expect(owner, "wrong owner").to.not.equal(newOwner);
        chai_1.expect(requestTime, "wrong requestTime").eq(timestamp);
    });
    it("allow pending owner to claim ownership after delay over", async () => {
        const delay = await ctx.claimable.delay();
        await time_1.increaseTime(delay);
        const previousGov = await ctx.claimable.governor();
        const newGovernor = ctx.other;
        const tx = ctx.claimable.connect(newGovernor.signer).claimGovernorChange();
        await chai_1.expect(tx).to.emit(ctx.claimable, "GovernorChangeClaimed").withArgs(newGovernor.address);
        await chai_1.expect(tx).to.emit(ctx.claimable, "GovernorChanged").withArgs(previousGov, newGovernor.address);
        const owner = await ctx.claimable.governor();
        const requestTime = await ctx.claimable.requestTime();
        chai_1.expect(owner, "owner not equal").to.equal(newGovernor.address);
        chai_1.expect(requestTime, "wrong requestTime").eq(math_1.BN.from(0));
    });
    it("should allow cancel change request", async () => {
        const requestTime = await ctx.claimable.requestTime();
        chai_1.expect(requestTime, "wrong requestTime").gt(math_1.BN.from(0));
        await ctx.claimable.connect(ctx.governor.signer).cancelGovernorChange();
        const newRequestTime = await ctx.claimable.requestTime();
        chai_1.expect(newRequestTime).eq(math_1.BN.from(0));
    });
}
exports.shouldBehaveLikeDelayedClaimable = shouldBehaveLikeDelayedClaimable;
//# sourceMappingURL=DelayedClaimableGovernor.behaviour.js.map