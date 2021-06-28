"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldBehaveLikePausableModule = void 0;
const chai_1 = require("chai");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
function shouldBehaveLikePausableModule(ctx) {
    it("should have Nexus", async () => {
        const nexusAddr = await ctx.module.nexus();
        chai_1.expect(nexusAddr).to.not.equal(constants_1.ZERO_ADDRESS);
    });
    it("should have Governor address", async () => {
        const nexusAddr = await ctx.module.nexus();
        const nexus = await generated_1.INexus__factory.connect(nexusAddr, ctx.sa.default.signer);
        const nexusGovernor = await nexus.governor();
        chai_1.expect(nexusGovernor).to.equal(ctx.sa.governor.address);
    });
    it("should not be paused", async () => {
        const paused = await ctx.module.paused();
        chai_1.expect(paused).to.eq(false);
    });
    it("should allow pausing and unpausing by governor", async () => {
        // Pause
        let tx = ctx.module.connect(ctx.sa.governor.signer).pause();
        await chai_1.expect(tx).to.emit(ctx.module, "Paused").withArgs(ctx.sa.governor.address);
        // Fail if already paused
        await chai_1.expect(ctx.module.connect(ctx.sa.governor.signer).pause()).to.be.revertedWith("Pausable: paused");
        // Unpause
        tx = ctx.module.connect(ctx.sa.governor.signer).unpause();
        await chai_1.expect(tx).to.emit(ctx.module, "Unpaused").withArgs(ctx.sa.governor.address);
        // Fail to unpause twice
        await chai_1.expect(ctx.module.connect(ctx.sa.governor.signer).unpause()).to.be.revertedWith("Pausable: not paused");
    });
    it("should fail to pause if non-governor", async () => {
        await chai_1.expect(ctx.module.connect(ctx.sa.other.signer).pause()).to.be.revertedWith("Only governor can execute");
    });
}
exports.shouldBehaveLikePausableModule = shouldBehaveLikePausableModule;
exports.default = shouldBehaveLikePausableModule;
//# sourceMappingURL=PausableModule.behaviour.js.map