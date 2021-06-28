"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldBehaveLikeModule = void 0;
const chai_1 = require("chai");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
function shouldBehaveLikeModule(ctx) {
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
}
exports.shouldBehaveLikeModule = shouldBehaveLikeModule;
exports.default = shouldBehaveLikeModule;
//# sourceMappingURL=Module.behaviour.js.map