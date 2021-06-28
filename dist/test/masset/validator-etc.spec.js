"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const machines_1 = require("@utils/machines");
const config = {
    supply: math_1.BN.from(0),
    a: math_1.BN.from(10000),
    limits: {
        min: math_1.simpleToExactAmount(5, 16),
        max: math_1.simpleToExactAmount(55, 16),
    },
    recolFee: math_1.simpleToExactAmount(5, 13),
};
const looseConfig = {
    supply: math_1.BN.from(0),
    a: math_1.BN.from(10000),
    limits: {
        min: math_1.simpleToExactAmount(1, 16),
        max: math_1.simpleToExactAmount(99, 16),
    },
    recolFee: math_1.simpleToExactAmount(5, 13),
};
const fee = math_1.simpleToExactAmount(6, 15);
const getReserves = (simpleUnits, decimals = simpleUnits.map(() => 18)) => simpleUnits.map((s, i) => ({
    ratio: math_1.simpleToExactAmount(1, 8 + (18 - decimals[i])),
    vaultBalance: math_1.simpleToExactAmount(s, decimals[i]),
}));
describe("Invariant Validator", () => {
    let validator;
    let sa;
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        await redeployValidator();
    });
    const redeployValidator = async () => {
        const LogicFactory = await hardhat_1.ethers.getContractFactory("MassetLogic");
        const logicLib = await LogicFactory.deploy();
        const linkedAddress = {
            libraries: {
                MassetLogic: logicLib.address,
            },
        };
        const massetFactory = await hardhat_1.ethers.getContractFactory("ExposedMassetLogic", linkedAddress);
        validator = (await massetFactory.deploy());
    };
    describe("Validating bAssets with different ratios", () => {
        const x1 = getReserves([10, 10, 10, 10], [10, 18, 6, 18]);
        const x2 = getReserves([10, 10, 10, 10], [18, 18, 6, 18]);
        looseConfig.supply = x1.reduce((p, c) => p.add(c.vaultBalance.mul(math_1.simpleToExactAmount(1, 8).div(c.ratio))), math_1.BN.from(0));
        before(async () => {
            await redeployValidator();
        });
        it("should treat them equally in mint", async () => {
            const r1 = await validator.computeMint(x1, 0, math_1.simpleToExactAmount(1, 10), looseConfig);
            const r2 = await validator.computeMint(x2, 0, math_1.simpleToExactAmount(1, 18), looseConfig);
            chai_1.expect(r1).eq(r2);
        });
        it("should treat them equally in mint multi", async () => {
            const r1 = await validator.computeMintMulti(x1, [0, 1], [math_1.simpleToExactAmount(1, 10), math_1.simpleToExactAmount(1, 18)], looseConfig);
            const r2 = await validator.computeMintMulti(x2, [0, 1], [math_1.simpleToExactAmount(1, 18), math_1.simpleToExactAmount(1, 18)], looseConfig);
            chai_1.expect(r1).eq(r2);
        });
        it("should treat them equally in swap", async () => {
            const r1 = await validator.computeSwap(x1, 0, 1, math_1.simpleToExactAmount(1, 10), fee, looseConfig);
            const r2 = await validator.computeSwap(x2, 0, 1, math_1.simpleToExactAmount(1, 18), fee, looseConfig);
            chai_1.expect(r1[0]).eq(r2[0]);
            chai_1.expect(r1[1]).eq(r2[1]);
        });
        it("should treat them equally in redeem", async () => {
            const [r1] = await validator.computeRedeem(x1, 0, math_1.simpleToExactAmount(1, 18), looseConfig, fee);
            const [r2] = await validator.computeRedeem(x2, 0, math_1.simpleToExactAmount(1, 18), looseConfig, fee);
            chai_1.expect(r1).eq(r2.div(math_1.simpleToExactAmount(1, 8)));
        });
        it("should treat them equally in redeem multi", async () => {
            const [r1] = await validator.computeRedeemExact(x1, [0, 1], [math_1.simpleToExactAmount(1, 10), math_1.simpleToExactAmount(1, 18)], looseConfig, fee);
            const [r2] = await validator.computeRedeemExact(x2, [0, 1], [math_1.simpleToExactAmount(1, 18), math_1.simpleToExactAmount(1, 18)], looseConfig, fee);
            chai_1.expect(r1).eq(r2);
        });
    });
    describe("With params in different orders", () => {
        const x = getReserves([10, 10, 10, 10], [10, 18, 6, 18]);
        looseConfig.supply = x.reduce((p, c) => p.add(c.vaultBalance.mul(math_1.simpleToExactAmount(1, 8).div(c.ratio))), math_1.BN.from(0));
        before(async () => {
            await redeployValidator();
        });
        it("should treat them equally in mint multi", async () => {
            const r1 = await validator.computeMintMulti(x, [0, 1], [math_1.simpleToExactAmount(1, 10), math_1.simpleToExactAmount(1, 18)], looseConfig);
            const r2 = await validator.computeMintMulti(x, [1, 0], [math_1.simpleToExactAmount(1, 18), math_1.simpleToExactAmount(1, 10)], looseConfig);
            chai_1.expect(r1).eq(r2);
        });
        it("should treat them equally in redeem multi", async () => {
            const [r1] = await validator.computeRedeemExact(x, [0, 1], [math_1.simpleToExactAmount(1, 10), math_1.simpleToExactAmount(1, 18)], looseConfig, fee);
            const [r2] = await validator.computeRedeemExact(x, [1, 0], [math_1.simpleToExactAmount(1, 18), math_1.simpleToExactAmount(1, 10)], looseConfig, fee);
            chai_1.expect(r1).eq(r2);
        });
    });
    describe("Exceeding max weights", () => {
        const x = getReserves([30, 10, 10, 10]);
        looseConfig.supply = x.reduce((p, c) => p.add(c.vaultBalance.mul(math_1.simpleToExactAmount(1, 8).div(c.ratio))), math_1.BN.from(0));
        before(async () => {
            await redeployValidator();
        });
        it("should throw in mint multi", async () => {
            // max weight is 55%
            await chai_1.expect(validator.computeMintMulti(x, [0, 1], [math_1.simpleToExactAmount(9, 18), math_1.simpleToExactAmount(1, 18)], config)).to.be.revertedWith("Exceeds weight limits");
        });
    });
    describe("Using invalid args", () => {
        const x = getReserves([10, 10, 10, 10], [10, 18, 6, 18]);
        looseConfig.supply = x.reduce((p, c) => p.add(c.vaultBalance.mul(math_1.simpleToExactAmount(1, 8).div(c.ratio))), math_1.BN.from(0));
        it("should throw in mint", async () => {
            await chai_1.expect(validator.computeMint(x, 4, math_1.simpleToExactAmount(1, 18), config)).to.be.reverted;
        });
        it("should throw in mint multi", async () => {
            await chai_1.expect(validator.computeMintMulti(x, [4, 5], [math_1.simpleToExactAmount(1, 18), math_1.simpleToExactAmount(1, 18)], config)).to.be
                .reverted;
        });
        it("should throw in swap", async () => {
            await chai_1.expect(validator.computeSwap(x, 4, 1, math_1.simpleToExactAmount(1, 18), fee, config)).to.be.reverted;
        });
        it("should throw in redeem", async () => {
            await chai_1.expect(validator.computeRedeem(x, 4, math_1.simpleToExactAmount(1, 18), config, fee)).to.be.reverted;
        });
        it("should throw in redeem multi", async () => {
            await chai_1.expect(validator.computeRedeemExact(x, [1, 4], [math_1.simpleToExactAmount(1, 18), math_1.simpleToExactAmount(1, 18)], config, fee)).to
                .be.reverted;
        });
    });
});
//# sourceMappingURL=validator-etc.spec.js.map