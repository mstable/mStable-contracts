"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const math_1 = require("@utils/math");
const hardhat_1 = require("hardhat");
const generated_1 = require("types/generated");
const chai_1 = require("chai");
describe("Root", () => {
    let root;
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        root = await (await new generated_1.MockRoot__factory(accounts[0])).deploy();
    });
    describe("calculating the root", () => {
        it("returns floored root", async () => {
            let amt = math_1.BN.from(1000000000);
            let res = await root.sqrt(amt);
            chai_1.expect(res).to.be.eq(math_1.BN.from(31622));
            amt = math_1.BN.from(64);
            res = await root.sqrt(amt);
            chai_1.expect(res).to.be.eq(math_1.BN.from(8));
            amt = math_1.BN.from("160000000000000000");
            res = await root.sqrt(amt);
            chai_1.expect(res).to.be.eq(math_1.BN.from(400000000));
        });
        it("returns root for seconds in year", async () => {
            const amt = math_1.BN.from("31540000");
            const res = await root.sqrt(amt);
            chai_1.expect(res).to.be.eq(math_1.BN.from(5616));
        });
        it("returns root for seconds in 6 months", async () => {
            const amt = math_1.BN.from("15724800");
            const res = await root.sqrt(amt);
            chai_1.expect(res).to.be.eq(math_1.BN.from(3965));
        });
        it("returns root for seconds in week", async () => {
            const amt = math_1.BN.from("604800");
            const res = await root.sqrt(amt);
            chai_1.expect(res).to.be.eq(math_1.BN.from(777));
        });
    });
});
//# sourceMappingURL=root.spec.js.map