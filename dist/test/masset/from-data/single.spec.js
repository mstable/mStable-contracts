"use strict";
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-loop-func */
Object.defineProperty(exports, "__esModule", { value: true });
const assertions_1 = require("@utils/assertions");
const constants_1 = require("@utils/constants");
const machines_1 = require("@utils/machines");
const math_1 = require("@utils/math");
const validator_data_1 = require("@utils/validator-data");
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const { mintData, mintMultiData, redeemData, redeemExactData, redeemMassetData, swapData } = validator_data_1.mAssetData;
let config = {
    supply: math_1.BN.from(0),
    a: math_1.BN.from(12000),
    limits: {
        min: math_1.simpleToExactAmount(5, 16),
        max: math_1.simpleToExactAmount(75, 16),
    },
    recolFee: math_1.simpleToExactAmount(5, 13),
};
const ratio = math_1.simpleToExactAmount(1, 8);
const swapFeeRate = math_1.simpleToExactAmount(6, 14);
const tolerance = 1;
const cv = (n) => math_1.BN.from(BigInt(n).toString());
const getReserves = (data) => [0, 1, 2, 3, 4]
    .filter((i) => data[`reserve${i}`])
    .map((i) => ({
    ratio,
    vaultBalance: cv(data[`reserve${i}`]),
}));
const runLongTests = process.env.LONG_TESTS === "true";
describe("Feeder Logic - One basket one test", () => {
    let validator;
    let sa;
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        const LogicFactory = await hardhat_1.ethers.getContractFactory("MassetLogic");
        const logicLib = await LogicFactory.deploy();
        const linkedAddress = {
            libraries: {
                MassetLogic: logicLib.address,
            },
        };
        const massetFactory = await hardhat_1.ethers.getContractFactory("ExposedMassetLogic", linkedAddress);
        validator = (await massetFactory.deploy());
    });
    describe("Compute Mint", () => {
        let count = 0;
        const testMintData = runLongTests ? mintData : mintData.slice(0, 1);
        for (const testData of testMintData) {
            const reserves = getReserves(testData);
            config = {
                ...config,
                supply: cv(testData.mAssetSupply),
            };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}, ${testData.reserve2}`, () => {
                for (const testMint of testData.mints) {
                    if (testMint.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when minting ${testMint.bAssetQty.toString()} bAssets with index ${testMint.bAssetIndex}`, async () => {
                            await chai_1.expect(validator.computeMint(reserves, testMint.bAssetIndex, cv(testMint.bAssetQty), config)).to.be.revertedWith("Exceeds weight limits");
                        });
                    }
                    else {
                        it(`${(count += 1)} deposit ${testMint.bAssetQty.toString()} bAssets with index ${testMint.bAssetIndex}`, async () => {
                            const mAssetQty = await validator.computeMint(reserves, testMint.bAssetIndex, cv(testMint.bAssetQty), config);
                            chai_1.expect(mAssetQty).eq(cv(testMint.expectedQty));
                        });
                    }
                }
            });
        }
    });
    describe("Compute Multi Mint", () => {
        let count = 0;
        const testMultiMintData = runLongTests ? mintMultiData : mintMultiData.slice(0, 1);
        for (const testData of testMultiMintData) {
            const reserves = getReserves(testData);
            config = {
                ...config,
                supply: cv(testData.mAssetSupply),
            };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}, ${testData.reserve2}`, () => {
                for (const testMint of testData.mints) {
                    const qtys = testMint.bAssetQtys.map((b) => cv(b));
                    it(`${(count += 1)} deposit ${qtys} bAssets`, async () => {
                        const mAssetQty = await validator.computeMintMulti(reserves, [0, 1, 2], qtys, config);
                        chai_1.expect(mAssetQty).eq(cv(testMint.expectedQty));
                    });
                }
            });
        }
    });
    describe("Compute Swap", () => {
        let count = 0;
        const testSwapData = runLongTests ? swapData : swapData.slice(0, 1);
        for (const testData of testSwapData) {
            const reserves = getReserves(testData);
            config = {
                ...config,
                supply: cv(testData.mAssetSupply),
            };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}, ${testData.reserve2}`, () => {
                for (const testSwap of testData.swaps) {
                    if (testSwap.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when swapping ${testSwap.inputQty.toString()} ${testSwap.inputIndex} for ${testSwap.outputIndex}`, async () => {
                            await chai_1.expect(validator.computeSwap(reserves, testSwap.inputIndex, testSwap.outputIndex, cv(testSwap.inputQty), swapFeeRate, config)).to.be.revertedWith("Exceeds weight limits");
                        });
                    }
                    else {
                        it(`${(count += 1)} swaps ${testSwap.inputQty.toString()} ${testSwap.inputIndex} for ${testSwap.outputIndex}`, async () => {
                            const result = await validator.computeSwap(reserves, testSwap.inputIndex, testSwap.outputIndex, cv(testSwap.inputQty), swapFeeRate, config);
                            assertions_1.assertBNClose(result.bAssetOutputQuantity, cv(testSwap.outputQty), tolerance);
                        });
                    }
                }
            });
        }
    });
    describe("Compute Redeem", () => {
        let count = 0;
        const testRedeemData = runLongTests ? redeemData : redeemData.slice(0, 1);
        for (const testData of testRedeemData) {
            const reserves = getReserves(testData);
            config = {
                ...config,
                supply: cv(testData.mAssetSupply),
            };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}, ${testData.reserve2}`, () => {
                for (const testRedeem of testData.redeems) {
                    // Deduct swap fee before performing redemption
                    if (testRedeem.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when redeeming ${testRedeem.mAssetQty} mAssets for bAsset ${testRedeem.bAssetIndex}`, async () => {
                            await chai_1.expect(validator.computeRedeem(reserves, testRedeem.bAssetIndex, cv(testRedeem.mAssetQty), config, swapFeeRate)).to.be.revertedWith("Exceeds weight limits");
                        });
                    }
                    else {
                        it(`${(count += 1)} redeem ${testRedeem.mAssetQty} mAssets for bAsset ${testRedeem.bAssetIndex}`, async () => {
                            const [bAssetQty] = await validator.computeRedeem(reserves, testRedeem.bAssetIndex, cv(testRedeem.mAssetQty), config, swapFeeRate);
                            assertions_1.assertBNClose(bAssetQty, cv(testRedeem.outputQty), 2);
                        });
                    }
                }
            });
        }
    });
    describe("Compute Exact Redeem", () => {
        let count = 0;
        const testRedeemExactData = runLongTests ? redeemExactData : redeemExactData.slice(0, 1);
        for (const testData of testRedeemExactData) {
            const reserves = getReserves(testData);
            config = {
                ...config,
                supply: cv(testData.mAssetSupply),
            };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}, ${testData.reserve2}`, () => {
                for (const testRedeem of testData.redeems) {
                    // Deduct swap fee after performing redemption
                    const qtys = testRedeem.bAssetQtys.map((b) => cv(b));
                    if (testRedeem.insufficientLiquidityError) {
                        it(`${(count += 1)} throws throw insufficient liquidity error when redeeming ${qtys} bAssets`, async () => {
                            await chai_1.expect(validator.computeRedeemExact(reserves, [0, 1, 2], qtys, config, swapFeeRate)).to.be.revertedWith("VM Exception");
                        });
                    }
                    else if (testRedeem.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                            await chai_1.expect(validator.computeRedeemExact(reserves, [0, 1, 2], qtys, config, swapFeeRate)).to.be.revertedWith("Exceeds weight limits");
                        });
                    }
                    else {
                        it(`${(count += 1)} redeem ${qtys} bAssets`, async () => {
                            const [mAssetQty] = await validator.computeRedeemExact(reserves, [0, 1, 2], qtys, config, swapFeeRate);
                            assertions_1.assertBNClose(mAssetQty, cv(testRedeem.mAssetQty), tolerance);
                        });
                    }
                }
            });
        }
    });
    // Test data seems to be incorrect
    // After minting with the given reserves, we receive more mAsset back than is calculated in the cases.
    // This causes the redeem amounts to be lower, because we are redeeming a lower proportion of the basket
    describe("Compute Redeem Masset", () => {
        let count = 0;
        const testRedeemData = runLongTests ? redeemMassetData : redeemMassetData.slice(0, 1);
        for (const testData of testRedeemData) {
            const reserves = getReserves(testData);
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}, ${testData.reserve2}`, () => {
                let mAsset;
                let recipient;
                let bAssetAddresses;
                let bAssets;
                let massetFactory;
                let forgeValAddr;
                before(async () => {
                    const accounts = await hardhat_1.ethers.getSigners();
                    const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
                    sa = mAssetMachine.sa;
                    recipient = await sa.default.address;
                    const renBTC = await mAssetMachine.loadBassetProxy("Ren BTC", "renBTC", 18);
                    const sBTC = await mAssetMachine.loadBassetProxy("Synthetix BTC", "sBTC", 18);
                    const wBTC = await mAssetMachine.loadBassetProxy("Wrapped BTC", "wBTC", 18);
                    bAssets = [renBTC, sBTC, wBTC];
                    bAssetAddresses = bAssets.map((b) => b.address);
                    const LogicFactory = await hardhat_1.ethers.getContractFactory("MassetLogic");
                    const logicLib = (await LogicFactory.deploy());
                    const ManagerFactory = await hardhat_1.ethers.getContractFactory("MassetManager");
                    const managerLib = (await ManagerFactory.deploy());
                    massetFactory = (await hardhat_1.ethers.getContractFactory("Masset", {
                        libraries: {
                            MassetLogic: logicLib.address,
                            MassetManager: managerLib.address,
                        },
                    })).connect(sa.default.signer);
                });
                beforeEach(async () => {
                    mAsset = (await massetFactory.deploy(constants_1.DEAD_ADDRESS, math_1.simpleToExactAmount(5, 13)));
                    await mAsset.initialize("mStable Asset", "mAsset", bAssets.map((b) => ({
                        addr: b.address,
                        integrator: constants_1.ZERO_ADDRESS,
                        hasTxFee: false,
                        status: 0,
                    })), {
                        a: math_1.BN.from(120),
                        limits: {
                            min: math_1.simpleToExactAmount(5, 16),
                            max: math_1.simpleToExactAmount(75, 16),
                        },
                    });
                    await Promise.all(bAssets.map((b) => b.approve(mAsset.address, constants_1.MAX_UINT256)));
                    await mAsset.mintMulti(bAssetAddresses, reserves.map((r) => r.vaultBalance), 0, recipient);
                });
                for (const testRedeem of testData.redeems) {
                    const qtys = testRedeem.bAssetQtys.map((b) => cv(b));
                    if (testRedeem["insufficientLiquidityError"]) {
                        it(`${(count += 1)} throws throw insufficient liquidity error when redeeming ${testRedeem.mAssetQty} mAsset`, async () => {
                            await chai_1.expect(mAsset.redeemMasset(cv(testRedeem.mAssetQty), qtys, recipient)).to.be.revertedWith("VM Exception");
                        });
                    }
                    else if (testRedeem["hardLimitError"]) {
                        it(`${(count += 1)} throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                            await chai_1.expect(mAsset.redeemMasset(cv(testRedeem.mAssetQty), qtys, recipient)).to.be.revertedWith("Exceeds weight limits");
                            throw new Error("invalid exception");
                        });
                    }
                    else {
                        it(`${(count += 1)} redeem ${testRedeem.mAssetQty} mAssets for proportionate bAssets`, async () => {
                            await mAsset.redeemMasset(cv(testRedeem.mAssetQty), qtys, recipient);
                        });
                    }
                }
            });
        }
    });
});
//# sourceMappingURL=single.spec.js.map