"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
const assertions_1 = require("@utils/assertions");
const machines_1 = require("@utils/machines");
const validator_data_1 = require("@utils/validator-data");
const { integrationData } = validator_data_1.crossData;
// NOTE - CONFIG
// This must mimic the test data and be input manually
const config = {
    a: math_1.BN.from(300),
    limits: {
        min: math_1.simpleToExactAmount(20, 16),
        max: math_1.simpleToExactAmount(80, 16),
    },
};
const massetA = 120;
const maxAction = 100;
const feederFees = { swap: math_1.simpleToExactAmount(8, 14), redeem: math_1.simpleToExactAmount(6, 14), gov: math_1.simpleToExactAmount(1, 17) };
const mAssetFees = { swap: math_1.simpleToExactAmount(6, 14), redeem: math_1.simpleToExactAmount(3, 14) };
const ratio = math_1.simpleToExactAmount(1, 8);
const tolerance = math_1.BN.from(20);
const cv = (n) => math_1.BN.from(BigInt(n).toString());
const getMPReserves = (data) => [0, 1, 2, 3, 4, 5]
    .filter((i) => data[`mpAssetReserve${i}`])
    .map((i) => ({
    ratio,
    vaultBalance: cv(data[`mpAssetReserve${i}`]),
}));
const getFPReserves = (data) => [data.feederPoolMAssetReserve, data.feederPoolFAssetReserve].map((r) => ({
    ratio,
    vaultBalance: cv(r),
}));
const runLongTests = process.env.LONG_TESTS === "true";
const getData = async (_feederPool, _mAsset) => ({
    fp: {
        totalSupply: (await _feederPool.totalSupply()).add((await _feederPool.data()).pendingFees),
        vaultBalances: (await _feederPool.getBassets())[1].map((b) => b[1]),
        value: await _feederPool.getPrice(),
    },
    mAsset: {
        totalSupply: (await _mAsset.getConfig()).supply,
        vaultBalances: (await _mAsset.getBassets())[1].map((b) => b[1]),
    },
});
describe("Cross swap - One basket many tests", () => {
    let feederPool;
    let mAsset;
    let sa;
    let recipient;
    let fpAssetAddresses;
    let mpAssetAddresses;
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        recipient = await sa.default.address;
        const mAssetDetails = await mAssetMachine.deployLite(massetA);
        await mAssetDetails.mAsset.connect(sa.governor.signer).setFees(mAssetFees.swap, mAssetFees.redeem);
        const fAsset = await mAssetMachine.loadBassetProxy("Feeder Asset", "fAST", 18);
        const bAssets = [mAssetDetails.mAsset, fAsset];
        fpAssetAddresses = bAssets.map((b) => b.address);
        mpAssetAddresses = mAssetDetails.bAssets.map((b) => b.address);
        mAsset = mAssetDetails.mAsset;
        const feederLogic = await new generated_1.FeederLogic__factory(sa.default.signer).deploy();
        const manager = await new generated_1.FeederManager__factory(sa.default.signer).deploy();
        const FeederFactory = (await hardhat_1.ethers.getContractFactory("ExposedFeederPool", {
            libraries: {
                FeederManager: manager.address,
                FeederLogic: feederLogic.address,
            },
        })).connect(sa.default.signer);
        await mAssetMachine.seedWithWeightings(mAssetDetails, getMPReserves(integrationData).map((r) => r.vaultBalance), true);
        feederPool = (await FeederFactory.deploy(mAssetDetails.nexus.address, bAssets[0].address));
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
        }, mpAssetAddresses, config);
        await feederPool.connect(sa.governor.signer).setFees(feederFees.swap, feederFees.redeem, feederFees.gov);
        await Promise.all(bAssets.map((b) => b.approve(feederPool.address, constants_1.MAX_UINT256)));
        await Promise.all(mAssetDetails.bAssets.map((b) => b.approve(feederPool.address, constants_1.MAX_UINT256)));
        const reserves = getFPReserves(integrationData);
        await feederPool.mintMulti(fpAssetAddresses, reserves.map((r) => r.vaultBalance), 0, recipient);
    });
    describe("Run all the data", () => {
        let dataBefore;
        let count = 0;
        for (const testData of integrationData.actions.slice(0, runLongTests ? integrationData.actions.length : maxAction)) {
            describe(`Action ${(count += 1)}`, () => {
                before(async () => {
                    dataBefore = await getData(feederPool, mAsset);
                });
                switch (testData.type) {
                    case "mint":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when minting ${testData.inputQty.toString()} mpAsset with index ${testData.inputIndex}`, async () => {
                                await chai_1.expect(feederPool.mint(mpAssetAddresses[testData.inputIndex], cv(testData.inputQty), 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(feederPool.getMintOutput(mpAssetAddresses[testData.inputIndex], cv(testData.inputQty))).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else {
                            it(`should deposit ${testData.inputQty.toString()} mpAsset with index ${testData.inputIndex}`, async () => {
                                const expectedOutput = await feederPool.getMintOutput(mpAssetAddresses[testData.inputIndex], cv(testData.inputQty));
                                assertions_1.assertBNClose(expectedOutput, cv(testData.outputQty), tolerance);
                                await feederPool.mint(mpAssetAddresses[testData.inputIndex], cv(testData.inputQty), cv(testData.outputQty).sub(tolerance), recipient);
                                const dataMid = await getData(feederPool, mAsset);
                                assertions_1.assertBNClose(dataMid.fp.totalSupply.sub(dataBefore.fp.totalSupply), expectedOutput, tolerance);
                            });
                        }
                        break;
                    case "swap_mp_to_fp":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when swapping ${testData.inputQty.toString()} ${testData.inputIndex} for fAsset`, async () => {
                                await chai_1.expect(feederPool.swap(mpAssetAddresses[testData.inputIndex], fpAssetAddresses[1], cv(testData.inputQty), 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(feederPool.getSwapOutput(mpAssetAddresses[testData.inputIndex], fpAssetAddresses[1], cv(testData.inputQty))).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else {
                            it(`swaps ${testData.inputQty.toString()} ${testData.inputIndex} for fAsset`, async () => {
                                const expectedOutput = await feederPool.getSwapOutput(mpAssetAddresses[testData.inputIndex], fpAssetAddresses[1], cv(testData.inputQty));
                                assertions_1.assertBNClose(expectedOutput, cv(testData.outputQty), tolerance);
                                await feederPool.swap(mpAssetAddresses[testData.inputIndex], fpAssetAddresses[1], cv(testData.inputQty), cv(testData.outputQty).sub(tolerance), recipient);
                            });
                        }
                        break;
                    case "swap_fp_to_mp":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when swapping ${testData.inputQty.toString()} fAsset for ${testData.outputIndex}`, async () => {
                                await chai_1.expect(feederPool.swap(fpAssetAddresses[1], mpAssetAddresses[testData.outputIndex], cv(testData.inputQty), 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(feederPool.getSwapOutput(fpAssetAddresses[1], mpAssetAddresses[testData.outputIndex], cv(testData.inputQty))).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else {
                            it(`swaps ${testData.inputQty.toString()} fAsset for ${testData.outputIndex}`, async () => {
                                const expectedOutput = await feederPool.getSwapOutput(fpAssetAddresses[1], mpAssetAddresses[testData.outputIndex], cv(testData.inputQty));
                                assertions_1.assertBNClose(expectedOutput, cv(testData.outputQty), tolerance);
                                await feederPool.swap(fpAssetAddresses[1], mpAssetAddresses[testData.outputIndex], cv(testData.inputQty), cv(testData.outputQty).sub(tolerance), recipient);
                            });
                        }
                        break;
                    case "redeem":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when redeeming ${testData.inputQty} mAssets for mpAsset ${testData.outputIndex}`, async () => {
                                await chai_1.expect(feederPool.redeem(mpAssetAddresses[testData.outputIndex], testData.inputQty, 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(feederPool.getRedeemOutput(mpAssetAddresses[testData.outputIndex], testData.inputQty)).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else if (testData["insufficientLiquidityError"]) {
                            it(`throws insufficient liquidity error when redeeming ${testData.inputQty} mAssets for bAsset ${testData.outputIndex}`, async () => {
                                await chai_1.expect(feederPool.redeem(mpAssetAddresses[testData.outputIndex], testData.inputQty, 0, recipient)).to.be.revertedWith("VM Exception");
                                await chai_1.expect(feederPool.getRedeemOutput(mpAssetAddresses[testData.outputIndex], testData.inputQty)).to.be.revertedWith("VM Exception");
                            });
                        }
                        else {
                            it(`redeem ${testData.inputQty} mAssets for bAsset ${testData.outputIndex}`, async () => {
                                const expectedOutput = await feederPool.getRedeemOutput(mpAssetAddresses[testData.outputIndex], testData.inputQty);
                                assertions_1.assertBNClose(expectedOutput, cv(testData.outputQty), tolerance);
                                await feederPool.redeem(mpAssetAddresses[testData.outputIndex], testData.inputQty, cv(testData.outputQty).sub(tolerance), recipient);
                            });
                        }
                        break;
                    default:
                        throw Error("unknown action");
                }
                it("holds invariant after action", async () => {
                    const dataEnd = await getData(feederPool, mAsset);
                    // 1. Check resulting reserves
                    if (testData.fpReserves) {
                        dataEnd.fp.vaultBalances.map((vb, i) => assertions_1.assertBNClose(vb, cv(testData.fpReserves[i]), math_1.BN.from(1000)));
                    }
                    if (testData.mpReserves) {
                        dataEnd.mAsset.vaultBalances.map((vb, i) => assertions_1.assertBNClose(vb, cv(testData.mpReserves[i]), math_1.BN.from(1000)));
                    }
                    // 2. Price always goes up
                    chai_1.expect(dataEnd.fp.value.price, "fpToken price should always go up").gte(dataBefore.fp.value.price);
                    // 3. Supply checks out
                    if (testData.LPTokenSupply) {
                        assertions_1.assertBNClose(dataEnd.fp.totalSupply, cv(testData.LPTokenSupply), 100, "Total supply should check out");
                    }
                    if (testData.mAssetSupply) {
                        assertions_1.assertBNClose(dataEnd.mAsset.totalSupply, cv(testData.mAssetSupply), 100, "Total supply should check out");
                    }
                });
            });
        }
    });
});
//# sourceMappingURL=cross.spec.js.map