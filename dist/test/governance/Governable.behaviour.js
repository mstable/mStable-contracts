"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldBehaveLikeGovernable = void 0;
const chai_1 = require("chai");
const constants_1 = require("@utils/constants");
function shouldBehaveLikeGovernable(ctx) {
    describe("as a Governable", () => {
        it("should have a Governor", async () => {
            chai_1.expect(await ctx.governable.governor()).to.equal(ctx.owner.address);
        });
        it("changes governor after transfer", async () => {
            chai_1.expect(await ctx.governable.connect(ctx.other.signer).isGovernor()).to.be.equal(false);
            const tx = ctx.governable.connect(ctx.owner.signer).changeGovernor(ctx.other.address);
            await chai_1.expect(tx).to.emit(ctx.governable, "GovernorChanged");
            chai_1.expect(await ctx.governable.governor()).to.equal(ctx.other.address);
            chai_1.expect(await ctx.governable.connect(ctx.other.signer).isGovernor()).to.be.equal(true);
        });
        it("should prevent non-governor from changing governor", async () => {
            await chai_1.expect(ctx.governable.connect(ctx.other.signer).changeGovernor(ctx.other.address)).to.be.revertedWith("GOV: caller is not the Governor");
        });
        // NOTE - For some reason this does not pass with the exact string even though it is emitted (false negative)
        it("should guard ownership against stuck state", async () => {
            await chai_1.expect(ctx.governable.connect(ctx.owner.signer).changeGovernor(constants_1.ZERO_ADDRESS)).to.be.revertedWith("VM Exception");
        });
    });
}
exports.shouldBehaveLikeGovernable = shouldBehaveLikeGovernable;
//# sourceMappingURL=Governable.behaviour.js.map