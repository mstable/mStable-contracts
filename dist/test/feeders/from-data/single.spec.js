"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assertions_1 = require("@utils/assertions");
const constants_1 = require("@utils/constants");
const machines_1 = require("@utils/machines");
const math_1 = require("@utils/math");
const validator_data_1 = require("@utils/validator-data");
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const generated_1 = require("types/generated");
const { mintData, mintMultiData, redeemData, redeemExactData, redeemProportionalData, swapData } = validator_data_1.feederData;
const config = {
    a: math_1.BN.from(30000),
    limits: {
        min: math_1.simpleToExactAmount(20, 16),
        max: math_1.simpleToExactAmount(80, 16),
    },
};
const swapFeeRate = math_1.simpleToExactAmount(8, 14);
const redemptionFeeRate = math_1.simpleToExactAmount(6, 14);
const ratio = math_1.simpleToExactAmount(1, 8);
const tolerance = 1;
const cv = (n) => math_1.BN.from(BigInt(n).toString());
const getReserves = (data) => [0, 1, 2, 3, 4]
    .filter((i) => data[`reserve${i}`])
    .map((i) => ({
    ratio,
    vaultBalance: cv(data[`reserve${i}`]),
}));
const runLongTests = process.env.LONG_TESTS === "true";
describe("Feeder Validator - One basket one test", () => {
    let exposedFeeder;
    let sa;
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        const logic = await new generated_1.FeederLogic__factory(sa.default.signer).deploy();
        const linkedAddress = {
            __$7791d1d5b7ea16da359ce352a2ac3a881c$__: logic.address,
        };
        exposedFeeder = await new generated_1.ExposedFeederLogic__factory(linkedAddress, sa.default.signer).deploy();
    });
    describe("Compute Mint", () => {
        let count = 0;
        const testMintData = runLongTests ? mintData : mintData.slice(0, 2);
        for (const testData of testMintData) {
            const reserves = getReserves(testData);
            const localConfig = { ...config, supply: testData.LPTokenSupply };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                for (const testMint of testData.mints) {
                    if (testMint.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when minting ${testMint.bAssetQty.toString()} bAssets with index ${testMint.bAssetIndex}`, async () => {
                            await chai_1.expect(exposedFeeder.computeMint(reserves, testMint.bAssetIndex, cv(testMint.bAssetQty), localConfig)).to.be.revertedWith("Exceeds weight limits");
                        });
                    }
                    else {
                        it(`${(count += 1)} deposit ${testMint.bAssetQty.toString()} bAssets with index ${testMint.bAssetIndex}`, async () => {
                            const mAssetQty = await exposedFeeder.computeMint(reserves, testMint.bAssetIndex, cv(testMint.bAssetQty), localConfig);
                            chai_1.expect(mAssetQty).eq(cv(testMint.expectedQty));
                        });
                    }
                }
            });
        }
    });
    describe("Compute Multi Mint", () => {
        let count = 0;
        const testMultiMintData = runLongTests ? mintMultiData : mintMultiData.slice(0, 2);
        for (const testData of testMultiMintData) {
            const reserves = getReserves(testData);
            const localConfig = { ...config, supply: testData.LPTokenSupply };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                for (const testMint of testData.mints) {
                    const qtys = testMint.bAssetQtys.map((b) => cv(b));
                    it(`${(count += 1)} deposit ${qtys} bAssets`, async () => {
                        const mAssetQty = await exposedFeeder.computeMintMulti(reserves, [0, 1], qtys, localConfig);
                        chai_1.expect(mAssetQty).eq(cv(testMint.expectedQty));
                    });
                }
            });
        }
    });
    describe("Compute Swap", () => {
        let count = 0;
        const testSwapData = runLongTests ? swapData : swapData.slice(0, 2);
        for (const testData of testSwapData) {
            const reserves = getReserves(testData);
            const localConfig = { ...config, supply: testData.LPTokenSupply };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                for (const testSwap of testData.swaps) {
                    if (testSwap.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when swapping ${testSwap.inputQty.toString()} ${testSwap.inputIndex} for ${testSwap.outputIndex}`, async () => {
                            await chai_1.expect(exposedFeeder.computeSwap(reserves, testSwap.inputIndex, testSwap.outputIndex, cv(testSwap.inputQty), testSwap.outputIndex === 0 ? 0 : swapFeeRate, localConfig)).to.be.revertedWith("Exceeds weight limits");
                        });
                    }
                    else {
                        it(`${(count += 1)} swaps ${testSwap.inputQty.toString()} ${testSwap.inputIndex} for ${testSwap.outputIndex}`, async () => {
                            const result = await exposedFeeder.computeSwap(reserves, testSwap.inputIndex, testSwap.outputIndex, cv(testSwap.inputQty), testSwap.outputIndex === 0 ? 0 : swapFeeRate, localConfig);
                            assertions_1.assertBNClose(result.bAssetOutputQuantity, cv(testSwap.outputQty), tolerance);
                        });
                    }
                }
            });
        }
    });
    describe("Compute Redeem", () => {
        let count = 0;
        const testRedeemData = runLongTests ? redeemData : redeemData.slice(0, 2);
        for (const testData of testRedeemData) {
            const reserves = getReserves(testData);
            const localConfig = { ...config, supply: testData.LPTokenSupply };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                for (const testRedeem of testData.redeems) {
                    // Deduct swap fee before performing redemption
                    const netInput = cv(testRedeem.mAssetQty)
                        .mul(constants_1.fullScale.sub(redemptionFeeRate))
                        .div(constants_1.fullScale);
                    if (testRedeem.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when redeeming ${testRedeem.mAssetQty} mAssets for bAsset ${testRedeem.bAssetIndex}`, async () => {
                            await chai_1.expect(exposedFeeder.computeRedeem(reserves, testRedeem.bAssetIndex, netInput, localConfig)).to.be.revertedWith("Exceeds weight limits");
                        });
                    }
                    else {
                        it(`${(count += 1)} redeem ${testRedeem.mAssetQty} mAssets for bAsset ${testRedeem.bAssetIndex}`, async () => {
                            const bAssetQty = await exposedFeeder.computeRedeem(reserves, testRedeem.bAssetIndex, netInput, localConfig);
                            assertions_1.assertBNClose(bAssetQty, cv(testRedeem.outputQty), 2);
                        });
                    }
                }
            });
        }
    });
    describe("Compute Exact Redeem", () => {
        let count = 0;
        const testRedeemExactData = runLongTests ? redeemExactData : redeemExactData.slice(0, 2);
        for (const testData of testRedeemExactData) {
            const reserves = getReserves(testData);
            const localConfig = { ...config, supply: testData.LPTokenSupply };
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                for (const testRedeem of testData.redeems) {
                    // Deduct swap fee after performing redemption
                    const applyFee = (m) => m.mul(constants_1.fullScale).div(constants_1.fullScale.sub(redemptionFeeRate));
                    const qtys = testRedeem.bAssetQtys.map((b) => cv(b));
                    if (testRedeem.insufficientLiquidityError) {
                        it(`${(count += 1)} throws throw insufficient liquidity error when redeeming ${qtys} bAssets`, async () => {
                            await chai_1.expect(exposedFeeder.computeRedeemExact(reserves, [0, 1], qtys, localConfig)).to.be.revertedWith("VM Exception");
                        });
                    }
                    else if (testRedeem.hardLimitError) {
                        it(`${(count += 1)} throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                            await chai_1.expect(exposedFeeder.computeRedeemExact(reserves, [0, 1], qtys, localConfig)).to.be.revertedWith("Exceeds weight limits");
                        });
                    }
                    else {
                        it(`${(count += 1)} redeem ${qtys} bAssets`, async () => {
                            const mAssetQty = await exposedFeeder.computeRedeemExact(reserves, [0, 1], qtys, localConfig);
                            assertions_1.assertBNClose(applyFee(mAssetQty), cv(testRedeem.mAssetQty), tolerance);
                        });
                    }
                }
            });
        }
    });
    describe("Compute Redeem Masset", () => {
        let count = 0;
        const testRedeemData = runLongTests ? redeemProportionalData : redeemProportionalData.slice(0, 2);
        for (const testData of testRedeemData) {
            const reserves = getReserves(testData);
            describe(`reserves: ${testData.reserve0}, ${testData.reserve1}`, () => {
                let feederPool;
                let recipient;
                let bAssetAddresses;
                let bAssets;
                let mAssetBassets;
                let feederFactory;
                before(async () => {
                    const accounts = await hardhat_1.ethers.getSigners();
                    const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
                    sa = mAssetMachine.sa;
                    recipient = await sa.default.address;
                    const mAssetDetails = await mAssetMachine.deployMasset(false, false);
                    await mAssetMachine.seedWithWeightings(mAssetDetails, [25000000, 25000000, 25000000, 25000000]);
                    mAssetBassets = mAssetDetails.bAssets;
                    const bBtc = await mAssetMachine.loadBassetProxy("Binance BTC", "bBTC", 18);
                    bAssets = [mAssetDetails.mAsset, bBtc];
                    bAssetAddresses = bAssets.map((b) => b.address);
                    const feederLogic = await new generated_1.FeederLogic__factory(sa.default.signer).deploy();
                    const manager = await new generated_1.FeederManager__factory(sa.default.signer).deploy();
                    feederFactory = (await hardhat_1.ethers.getContractFactory("FeederPool", {
                        libraries: {
                            FeederManager: manager.address,
                            FeederLogic: feederLogic.address,
                        },
                    })).connect(sa.default.signer);
                    const linkedAddress = {
                        __$7791d1d5b7ea16da359ce352a2ac3a881c$__: feederLogic.address,
                    };
                    exposedFeeder = await new generated_1.ExposedFeederLogic__factory(linkedAddress, sa.default.signer).deploy();
                });
                beforeEach(async () => {
                    feederPool = (await feederFactory.deploy(constants_1.DEAD_ADDRESS, bAssets[0].address));
                    await feederPool.initialize("mStable mBTC/bBTC Feeder", "bBTC fPool", {
                        addr: bAssets[0].address,
                        integrator: constants_1.ZERO_ADDRESS,
                        hasTxFee: false,
                        status: 0,
                    }, {
                        addr: bAssets[1].address,
                        integrator: constants_1.ZERO_ADDRESS,
                        hasTxFee: false,
                        status: 0,
                    }, mAssetBassets.map((b) => b.address), {
                        ...config,
                        a: config.a.div(100),
                    });
                    await Promise.all(bAssets.map((b) => b.approve(feederPool.address, constants_1.MAX_UINT256)));
                    await feederPool.mintMulti(bAssetAddresses, reserves.map((r) => r.vaultBalance), 0, recipient);
                });
                for (const testRedeem of testData.redeems) {
                    const qtys = testRedeem.bAssetQtys.map((b) => cv(b));
                    if (testRedeem["insufficientLiquidityError"]) {
                        it(`${(count += 1)} throws throw insufficient liquidity error when redeeming ${testRedeem.mAssetQty} mAsset`, async () => {
                            await chai_1.expect(feederPool.redeemProportionately(cv(testRedeem.mAssetQty), qtys, recipient)).to.be.revertedWith("VM Exception");
                        });
                    }
                    else if (testRedeem["hardLimitError"]) {
                        it(`${(count += 1)} throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                            await chai_1.expect(feederPool.redeemProportionately(cv(testRedeem.mAssetQty), qtys, recipient)).to.be.revertedWith("Exceeds weight limits");
                            throw new Error("invalid exception");
                        });
                    }
                    else {
                        it(`${(count += 1)} redeem ${testRedeem.mAssetQty} mAssets for proportionate bAssets`, async () => {
                            await feederPool.redeemProportionately(cv(testRedeem.mAssetQty), qtys, recipient);
                        });
                    }
                }
            });
        }
    });
});
//# sourceMappingURL=single.spec.js.map