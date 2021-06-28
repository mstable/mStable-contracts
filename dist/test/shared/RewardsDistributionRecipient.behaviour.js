"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldBehaveLikeDistributionRecipient = void 0;
const chai_1 = require("chai");
const constants_1 = require("@utils/constants");
const Module_behaviour_1 = require("./Module.behaviour");
function behaveLikeAModule(ctx) {
    return Module_behaviour_1.shouldBehaveLikeModule(ctx);
}
function shouldBehaveLikeDistributionRecipient(ctx) {
    behaveLikeAModule(ctx);
    it("should have a distributor", async () => {
        const distributor = await ctx.recipient.rewardsDistributor();
        chai_1.expect(distributor).not.eq(constants_1.ZERO_ADDRESS);
    });
    it("should allow governor to change the distributor", async () => {
        const newDistributor = ctx.sa.other;
        await ctx.recipient.connect(ctx.sa.governor.signer).setRewardsDistribution(newDistributor.address);
        chai_1.expect(await ctx.recipient.rewardsDistributor()).eq(newDistributor.address);
    });
    it("should prevent change from non-governor", async () => {
        const newDistributor = ctx.sa.other;
        const oldDistributor = await ctx.recipient.rewardsDistributor();
        await chai_1.expect(ctx.recipient.connect(ctx.sa.default.signer).setRewardsDistribution(newDistributor.address)).to.be.revertedWith("Only governor can execute");
        chai_1.expect(await ctx.recipient.rewardsDistributor()).eq(oldDistributor);
    });
}
exports.shouldBehaveLikeDistributionRecipient = shouldBehaveLikeDistributionRecipient;
exports.default = shouldBehaveLikeDistributionRecipient;
//# sourceMappingURL=RewardsDistributionRecipient.behaviour.js.map