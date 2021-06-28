"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("@utils/constants");
const math_1 = require("@utils/math");
const hardhat_1 = require("hardhat");
const generated_1 = require("types/generated");
const chai_1 = require("chai");
describe("StableMath", async () => {
    let math;
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        math = await (await new generated_1.PublicStableMath__factory(accounts[0])).deploy();
    });
    /** *************************************
                    GETTERS
    *************************************** */
    describe("calling the getters", async () => {
        it("should return the correct scale", async () => {
            chai_1.expect(await math.getFullScale()).to.be.eq(math_1.simpleToExactAmount(1, 18));
            chai_1.expect(await math.getFullScale()).to.be.eq(constants_1.fullScale);
        });
        it("should return the correct ratio scale", async () => {
            chai_1.expect(await math.getRatioScale()).to.be.eq(math_1.simpleToExactAmount(1, 8));
            chai_1.expect(await math.getRatioScale()).to.be.eq(constants_1.ratioScale);
        });
    });
    describe("scaling an integer", async () => {
        it("should scale an integer correctly", async () => {
            chai_1.expect(await math.scaleInteger("1000")).to.be.eq(math_1.simpleToExactAmount(1000, 18));
            chai_1.expect(await math.scaleInteger("7")).to.be.eq(math_1.simpleToExactAmount(7, 18));
            chai_1.expect(await math.scaleInteger("111231231231")).to.be.eq(math_1.simpleToExactAmount(111231231231, 18));
            chai_1.expect(await math.scaleInteger(math_1.simpleToExactAmount(1, 18))).to.be.eq(math_1.simpleToExactAmount(1, 36));
            chai_1.expect(await math.scaleInteger(1)).to.be.eq(math_1.simpleToExactAmount(1, 18));
        });
        it("should fail if integer overflow", async () => {
            await chai_1.expect(math.scaleInteger(math_1.simpleToExactAmount(1, 70))).to.be.revertedWith("VM Exception");
        });
    });
    /** *************************************
            PRECISE ARITHMETIC
    *************************************** */
    describe("calling mulTruncate(x, y, scale)", async () => {
        it("should return correct results", async () => {
            let x = math_1.simpleToExactAmount(1, 10);
            let y = math_1.simpleToExactAmount(9, 9);
            let scale = math_1.simpleToExactAmount(1, 12);
            let result = await math.mulTruncateScale(x, y, scale);
            chai_1.expect(result).to.be.eq(math_1.BN.from(x).mul(y).div(scale));
            chai_1.expect(result).to.be.lt(x);
            x = math_1.simpleToExactAmount(250, 22);
            y = math_1.simpleToExactAmount(95, 16);
            scale = constants_1.fullScale;
            result = await math.mulTruncateScale(x, y, scale);
            chai_1.expect(result).to.be.eq(math_1.BN.from(x).mul(y).div(scale));
            chai_1.expect(result).to.be.lt(x);
        });
        it("should truncate fractions", async () => {
            const x = math_1.BN.from(11);
            const y = math_1.BN.from(3);
            // 33 / 10 == 3.33.. should return 3
            const result = await math.mulTruncateScale(x, y, math_1.BN.from(10));
            chai_1.expect(result).to.be.eq(math_1.BN.from(3));
        });
        it("should fail if scale operand is 0", async () => {
            const sampleInput = math_1.simpleToExactAmount(1, 18);
            await chai_1.expect(math.mulTruncateScale(sampleInput, sampleInput, 0)).to.be.revertedWith("VM Exception");
        });
        it("should return 0 if either operand is 0", async () => {
            chai_1.expect(await math.mulTruncateScale(math_1.BN.from(0), math_1.simpleToExactAmount(1, 18), constants_1.fullScale)).to.be.eq(math_1.BN.from(0));
            chai_1.expect(await math.mulTruncateScale(math_1.simpleToExactAmount(1, 18), math_1.BN.from(0), constants_1.fullScale)).to.be.eq(math_1.BN.from(0));
        });
    });
    describe("calling mulTruncate(x, y)", async () => {
        it("should return correct results", async () => {
            let x = math_1.simpleToExactAmount(1, 10);
            let y = math_1.simpleToExactAmount(9, 9);
            let result = await math.mulTruncate(x, y);
            chai_1.expect(result).to.be.eq(math_1.BN.from(x).mul(y).div(constants_1.fullScale));
            chai_1.expect(result).to.be.lt(x);
            x = math_1.simpleToExactAmount(1, 20);
            y = math_1.simpleToExactAmount(25, 16);
            result = await math.mulTruncate(x, y);
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(25, 18));
            chai_1.expect(result).to.be.lt(x);
        });
        it("should truncate fractions", async () => {
            const x = math_1.BN.from(1234);
            const y = math_1.simpleToExactAmount(75, 16);
            const result = await math.mulTruncate(x, y);
            // 75% of 1234 = 925.5, round to 925
            chai_1.expect(result).to.be.eq(math_1.BN.from(925));
        });
        it("should return 0 if operands multiplied are less than the scale", async () => {
            const x = math_1.BN.from(100);
            const y = math_1.simpleToExactAmount(1, 15);
            const result = await math.mulTruncate(x, y);
            // (1e2 * 1e15) / 1e18 = 0.1
            chai_1.expect(result).to.be.eq(math_1.BN.from(0));
        });
        it("should return 0 if either operand is 0", async () => {
            chai_1.expect(await math.mulTruncate(math_1.BN.from(0), math_1.simpleToExactAmount(1, 18))).to.be.eq(math_1.BN.from(0));
            chai_1.expect(await math.mulTruncate(math_1.simpleToExactAmount(1, 18), math_1.BN.from(0))).to.be.eq(math_1.BN.from(0));
        });
    });
    describe("calling mulTruncateCeil(x, y)", async () => {
        it("should round up any fraction", async () => {
            let x = math_1.BN.from(3);
            let y = math_1.simpleToExactAmount(11, 17);
            let result = await math.mulTruncateCeil(x, y);
            // (3 * 11e17) / 1e18 == 33e17 / 1e18 == 3.3.
            chai_1.expect(result).to.be.eq(math_1.BN.from(4));
            x = math_1.BN.from(1);
            y = math_1.simpleToExactAmount(95, 16);
            result = await math.mulTruncateCeil(x, y);
            // (1 * 95e16) / 1e18 == 0.95
            chai_1.expect(result).to.be.eq(math_1.BN.from(1));
            x = math_1.BN.from(1234);
            y = math_1.simpleToExactAmount(75, 16);
            result = await math.mulTruncateCeil(x, y);
            // 75% of 1234 = 925.5, round to 926
            chai_1.expect(result).to.be.eq(math_1.BN.from(926));
        });
        it("should return 1 if operands multiplied are less than the scale", async () => {
            const x = math_1.BN.from(100);
            const y = math_1.simpleToExactAmount(1, 15);
            const result = await math.mulTruncateCeil(x, y);
            // (1e2 * 1e15) / 1e18 = 0.1
            chai_1.expect(result).to.be.eq(math_1.BN.from(1));
        });
        it("should not round a 0 fraction", async () => {
            const x = math_1.BN.from(30);
            const y = math_1.simpleToExactAmount(11, 17);
            const result = await math.mulTruncateCeil(x, y);
            // (30 * 11e17) / 1e18 == 33e18 / 1e18 == 33
            chai_1.expect(result).to.be.eq(math_1.BN.from(33));
        });
        it("should return 0 if either operand is 0", async () => {
            chai_1.expect(await math.mulTruncateCeil(math_1.BN.from(0), math_1.simpleToExactAmount(1, 18))).to.be.eq(math_1.BN.from(0));
            chai_1.expect(await math.mulTruncateCeil(math_1.simpleToExactAmount(1, 18), math_1.BN.from(0))).to.be.eq(math_1.BN.from(0));
        });
    });
    describe("calling divPrecisely(x, y)", async () => {
        it("should calculate x as a percentage value of y to scale of 1e18", async () => {
            let x = math_1.simpleToExactAmount(1, 18);
            let y = math_1.simpleToExactAmount(1, 17);
            let result = await math.divPrecisely(x, y);
            // (1e18 * 1e18) / 1e17 == 1e19
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(1, 19));
            x = math_1.simpleToExactAmount(1, 17);
            y = math_1.simpleToExactAmount(1, 19);
            result = await math.divPrecisely(x, y);
            // (1e17 * 1e18) / 1e19 == 1e16
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(1, 16));
        });
        it("should ignore remaining fractions", async () => {
            let x = math_1.BN.from(100);
            let y = math_1.simpleToExactAmount(1234, 16);
            let result = await math.divPrecisely(x, y);
            // (1e2 * 1e18) / 1234e16 == 8.103...
            chai_1.expect(result).to.be.eq(math_1.BN.from(8));
            x = math_1.simpleToExactAmount(1, 4);
            y = math_1.simpleToExactAmount(1, 24);
            result = await math.divPrecisely(x, y);
            // (1e4 * 1e18) / 1e24 == 0.01
            chai_1.expect(result).to.be.eq(math_1.BN.from(0));
        });
        it("should fail if the divisor is 0", async () => {
            const sampleInput = math_1.simpleToExactAmount(1, 18);
            await chai_1.expect(math.divPrecisely(sampleInput, 0)).to.be.revertedWith("VM Exception");
        });
        it("should fail if the left operand is too large", async () => {
            const sampleInput = math_1.simpleToExactAmount(1, 65);
            await chai_1.expect(math.divPrecisely(sampleInput, math_1.simpleToExactAmount(1, 18))).to.be.revertedWith("VM Exception");
        });
    });
    /** *************************************
                RATIO FUNCS
    *************************************** */
    describe("calling mulRatioTruncate(x, ratio)", async () => {
        it("should calculate correct mAsset value from bAsset", async () => {
            let x = math_1.simpleToExactAmount(1, 4); // 1e4 base bAsset units
            let y = constants_1.ratioScale; // 1e8 standard ratio
            let result = await math.mulRatioTruncate(x, y);
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(1, 4));
            x = math_1.simpleToExactAmount(1, 12); // 1e12 units of bAsset
            y = math_1.simpleToExactAmount(1, 14); // bAsset with 12 decimals, 1e8 * 1e(18-12)
            result = await math.mulRatioTruncate(x, y);
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(1, 18));
            x = math_1.BN.from(1234); // 1234 units of bAsset
            y = math_1.simpleToExactAmount("0.324", 14); // bAsset with 12 decimals and 0.324 mm
            result = await math.mulRatioTruncate(x, y);
            // result == 399.816 units
            chai_1.expect(result).to.be.eq(math_1.BN.from(399816000));
        });
        it("should truncate fractions", async () => {
            const x = math_1.BN.from(1234); // 1234 units of bAsset
            const y = math_1.simpleToExactAmount("0.324", 8); // bAsset with 18 decimals, but 0.324 mm
            const result = await math.mulRatioTruncate(x, y);
            // result == 399.816 units
            chai_1.expect(result).to.be.eq(math_1.BN.from(399));
        });
        it("should return 0 if operands multiplied are less than the scale", async () => {
            const x = math_1.BN.from(100);
            const y = math_1.simpleToExactAmount(1, 5);
            const result = await math.mulRatioTruncate(x, y);
            // (1e2 * 1e5) / 1e8 = 0.1
            chai_1.expect(result).to.be.eq(math_1.BN.from(0));
        });
        it("should return 0 if either operand is 0", async () => {
            chai_1.expect(await math.mulRatioTruncate(math_1.BN.from(0), math_1.simpleToExactAmount(1, 18))).to.be.eq(math_1.BN.from(0));
            chai_1.expect(await math.mulRatioTruncate(math_1.simpleToExactAmount(1, 18), math_1.BN.from(0))).to.be.eq(math_1.BN.from(0));
        });
    });
    describe("calling mulRatioTruncateCeil(x, ratio)", async () => {
        it("should calculate correct mAsset value from bAsset", async () => {
            let x = math_1.simpleToExactAmount(1, 4); // 1e4 base bAsset units
            let y = constants_1.ratioScale; // 1e8 standard ratio
            let result = await math.mulRatioTruncateCeil(x, y);
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(1, 4));
            x = math_1.simpleToExactAmount(1, 12); // 1e12 units of bAsset
            y = math_1.simpleToExactAmount(1, 14); // bAsset with 12 decimals, 1e8 * 1e(18-12)
            result = await math.mulRatioTruncateCeil(x, y);
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(1, 18));
            x = math_1.BN.from(1234); // 1234 units of bAsset
            y = math_1.simpleToExactAmount("0.324", 14); // bAsset with 12 decimals and 0.324 mm
            result = await math.mulRatioTruncateCeil(x, y);
            // result == 399.816 units
            chai_1.expect(result).to.be.eq(math_1.BN.from(399816000));
        });
        it("should round up any fractions", async () => {
            let x = math_1.BN.from(1234); // 1234 units of bAsset
            let y = math_1.simpleToExactAmount("0.324", 8); // bAsset with 18 decimals, but 0.324 mm
            let result = await math.mulRatioTruncateCeil(x, y);
            // result == 399.816 units
            chai_1.expect(result).to.be.eq(math_1.BN.from(400));
            x = math_1.simpleToExactAmount(1234, 3); // 1.234e6 units of bAsset
            y = math_1.simpleToExactAmount(3243, 4); // ratio = 3.243e7
            result = await math.mulRatioTruncateCeil(x, y);
            // result == 400186.2 units
            chai_1.expect(result).to.be.eq(math_1.BN.from(400187));
        });
        it("should return 1 if operands multiplied are less than the scale", async () => {
            const x = math_1.BN.from(100);
            const y = math_1.simpleToExactAmount(1, 5);
            const result = await math.mulRatioTruncateCeil(x, y);
            // (1e2 * 1e5) / 1e8 = 0.1
            chai_1.expect(result).to.be.eq(math_1.BN.from(1));
        });
        it("should return 0 if either operand is 0", async () => {
            chai_1.expect(await math.mulRatioTruncateCeil(math_1.BN.from(0), math_1.simpleToExactAmount(1, 18))).to.be.eq(math_1.BN.from(0));
            chai_1.expect(await math.mulRatioTruncateCeil(math_1.simpleToExactAmount(1, 18), math_1.BN.from(0))).to.be.eq(math_1.BN.from(0));
        });
    });
    describe("calling divRatioPrecisely(x, ratio)", async () => {
        it("should calculate x as a percentage value of y to scale of 1e8", async () => {
            let x = math_1.simpleToExactAmount(1, 18);
            let y = math_1.simpleToExactAmount(1, 8);
            let result = await math.divRatioPrecisely(x, y);
            // (1e18 * 1e8) / 1e8 == 1e18
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(1, 18));
            x = math_1.simpleToExactAmount(1, 14); // 1e14 base units of mAsset
            y = math_1.simpleToExactAmount(1, 12); // bAsset with 14 decimals
            result = await math.divRatioPrecisely(x, y);
            // Should equal mAsset units - 4 decimals, or 1e10
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(1, 10));
            x = math_1.simpleToExactAmount("0.235", 18); // 235e15
            y = math_1.simpleToExactAmount(1, 12);
            result = await math.divRatioPrecisely(x, y);
            // Should equal mAsset units - 4 decimals, or 235e11
            chai_1.expect(result).to.be.eq(math_1.simpleToExactAmount(235, 11));
        });
        it("should ignore remaining fractions", async () => {
            let x = math_1.BN.from(100);
            let y = math_1.simpleToExactAmount(1234, 6);
            let result = await math.divRatioPrecisely(x, y);
            // (1e2 * 1e8) / 1234e6 == 8.103...
            chai_1.expect(result).to.be.eq(math_1.BN.from(8));
            x = math_1.simpleToExactAmount(1, 4);
            y = math_1.simpleToExactAmount(1, 14);
            result = await math.divRatioPrecisely(x, y);
            // (1e4 * 1e8) / 1e14 == 0.01
            chai_1.expect(result).to.be.eq(math_1.BN.from(0));
        });
        it("should fail if the divisor is 0", async () => {
            const sampleInput = math_1.simpleToExactAmount(1, 18);
            await chai_1.expect(math.divRatioPrecisely(sampleInput, 0)).to.be.revertedWith("VM Exception");
        });
        it("should fail if the left operand is too large", async () => {
            const sampleInput = math_1.simpleToExactAmount(1, 71);
            await chai_1.expect(math.divRatioPrecisely(sampleInput, math_1.simpleToExactAmount(1, 8))).to.be.revertedWith("VM Exception");
        });
    });
    /** *************************************
                    HELPERS
    *************************************** */
    describe("calling min(x, y)", async () => {
        it("should find the minimum number", async () => {
            let x = math_1.BN.from(1);
            let y = math_1.BN.from(2);
            chai_1.expect(await math.min(x, y)).to.be.eq(x);
            chai_1.expect(await math.min(y, x)).to.be.eq(x);
            x = math_1.BN.from(2);
            y = math_1.BN.from(1);
            chai_1.expect(await math.min(x, y)).to.be.eq(y);
            chai_1.expect(await math.min(y, x)).to.be.eq(y);
            x = math_1.BN.from(0);
            y = math_1.simpleToExactAmount(2323, 24);
            chai_1.expect(await math.min(x, y)).to.be.eq(x);
            chai_1.expect(await math.min(y, x)).to.be.eq(x);
            x = math_1.simpleToExactAmount("0.242", 4);
            y = math_1.BN.from(0);
            chai_1.expect(await math.min(x, y)).to.be.eq(y);
            chai_1.expect(await math.min(y, x)).to.be.eq(y);
        });
    });
    describe("calling max(x, y)", async () => {
        it("should find the maximum number", async () => {
            let x = math_1.BN.from(1);
            let y = math_1.BN.from(2);
            chai_1.expect(await math.max(x, y)).to.be.eq(y);
            chai_1.expect(await math.max(y, x)).to.be.eq(y);
            x = math_1.BN.from(2);
            y = math_1.BN.from(1);
            chai_1.expect(await math.max(x, y)).to.be.eq(x);
            chai_1.expect(await math.max(y, x)).to.be.eq(x);
            x = math_1.BN.from(0);
            y = math_1.simpleToExactAmount(2323, 24);
            chai_1.expect(await math.max(x, y)).to.be.eq(y);
            chai_1.expect(await math.max(y, x)).to.be.eq(y);
            x = math_1.simpleToExactAmount("0.242", 4);
            y = math_1.BN.from(0);
            chai_1.expect(await math.max(x, y)).to.be.eq(x);
            chai_1.expect(await math.max(y, x)).to.be.eq(x);
        });
    });
    describe("calling clamp(x, uepprBound)", async () => {
        it("should clamp to the upper bound", async () => {
            let x = math_1.BN.from(1);
            let bound = math_1.BN.from(2);
            chai_1.expect(await math.clamp(x, bound)).to.be.eq(x);
            x = math_1.BN.from(2);
            bound = math_1.BN.from(1);
            chai_1.expect(await math.clamp(x, bound)).to.be.eq(bound);
            x = math_1.BN.from(0);
            bound = math_1.simpleToExactAmount(2323, 24);
            chai_1.expect(await math.clamp(x, bound)).to.be.eq(x);
            x = math_1.simpleToExactAmount("0.242", 4);
            bound = math_1.BN.from(0);
            chai_1.expect(await math.clamp(x, bound)).to.be.eq(bound);
        });
    });
});
//# sourceMappingURL=stable-math.spec.js.map