"use strict";
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-loop-func */
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const constants_1 = require("@utils/constants");
const assertions_1 = require("@utils/assertions");
const machines_1 = require("@utils/machines");
const validator_data_1 = require("@utils/validator-data");
const config = {
    a: math_1.BN.from(120),
    limits: {
        min: math_1.simpleToExactAmount(5, 16),
        max: math_1.simpleToExactAmount(75, 16),
    },
};
const ratio = math_1.simpleToExactAmount(1, 8);
const tolerance = math_1.BN.from(10);
const cv = (n) => math_1.BN.from(BigInt(n).toString());
const getReserves = (data) => [0, 1, 2, 3, 4, 5]
    .filter((i) => data[`reserve${i}`])
    .map((i) => ({
    ratio,
    vaultBalance: cv(data[`reserve${i}`]),
}));
const runLongTests = process.env.LONG_TESTS === "true";
describe("Invariant Validator - One basket many tests", () => {
    let mAsset;
    let sa;
    let recipient;
    let bAssetAddresses;
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        recipient = await sa.default.address;
        const renBTC = await mAssetMachine.loadBassetProxy("Ren BTC", "renBTC", 18);
        const sBTC = await mAssetMachine.loadBassetProxy("Synthetix BTC", "sBTC", 18);
        const wBTC = await mAssetMachine.loadBassetProxy("Wrapped BTC", "wBTC", 18);
        const bAssets = [renBTC, sBTC, wBTC];
        bAssetAddresses = bAssets.map((b) => b.address);
        const LogicFactory = await hardhat_1.ethers.getContractFactory("MassetLogic");
        const logicLib = (await LogicFactory.deploy());
        // 3. Invariant Validator
        const ManagerFactory = await hardhat_1.ethers.getContractFactory("MassetManager");
        const managerLib = (await ManagerFactory.deploy());
        const MassetFactory = (await hardhat_1.ethers.getContractFactory("ExposedMasset", {
            libraries: {
                MassetLogic: logicLib.address,
                MassetManager: managerLib.address,
            },
        })).connect(sa.default.signer);
        mAsset = (await MassetFactory.deploy(constants_1.DEAD_ADDRESS, math_1.simpleToExactAmount(5, 13)));
        await mAsset.initialize("mStable Asset", "mAsset", bAssets.map((b) => ({
            addr: b.address,
            integrator: constants_1.ZERO_ADDRESS,
            hasTxFee: false,
            status: 0,
        })), config);
        await Promise.all(bAssets.map((b) => b.approve(mAsset.address, constants_1.MAX_UINT256)));
        const reserves = getReserves(validator_data_1.mAssetData.integrationData);
        await mAsset.mintMulti(bAssetAddresses, reserves.map((r) => r.vaultBalance), 0, recipient);
    });
    const getData = async (_mAsset) => ({
        totalSupply: await _mAsset.totalSupply(),
        surplus: (await _mAsset.data()).surplus,
        vaultBalances: (await _mAsset.getBassets())[1].map((b) => b[1]),
        priceData: await _mAsset.getPrice(),
    });
    describe("Run all the data", () => {
        let dataBefore;
        let lastKDiff = math_1.BN.from(0);
        let count = 0;
        for (const testData of validator_data_1.mAssetData.integrationData.actions.slice(0, runLongTests ? validator_data_1.mAssetData.integrationData.actions.length : 100)) {
            describe(`Action ${(count += 1)}`, () => {
                before(async () => {
                    dataBefore = await getData(mAsset);
                });
                switch (testData.type) {
                    case "mint":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when minting ${testData.inputQty.toString()} bAssets with index ${testData.inputIndex}`, async () => {
                                await chai_1.expect(mAsset.mint(bAssetAddresses[testData.inputIndex], cv(testData.inputQty), 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(mAsset.getMintOutput(bAssetAddresses[testData.inputIndex], cv(testData.inputQty))).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else {
                            it(`should deposit ${testData.inputQty.toString()} bAssets with index ${testData.inputIndex}`, async () => {
                                const expectedOutput = await mAsset.getMintOutput(bAssetAddresses[testData.inputIndex], cv(testData.inputQty));
                                assertions_1.assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance);
                                await mAsset.mint(bAssetAddresses[testData.inputIndex], cv(testData.inputQty), cv(testData.expectedQty).sub(tolerance), recipient);
                                const dataMid = await getData(mAsset);
                                assertions_1.assertBNClose(dataMid.totalSupply.sub(dataBefore.totalSupply), expectedOutput, tolerance);
                            });
                        }
                        break;
                    case "mintMulti":
                        {
                            const qtys = testData.inputQtys.map((b) => cv(b));
                            if (testData.hardLimitError) {
                                it(`throws Max Weight error when minting ${qtys} bAssets with index ${testData.inputIndex}`, async () => {
                                    await chai_1.expect(mAsset.mintMulti(bAssetAddresses, qtys, 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                    await chai_1.expect(mAsset.getMintMultiOutput(bAssetAddresses, qtys)).to.be.revertedWith("Exceeds weight limits");
                                });
                            }
                            else {
                                it(`should mintMulti ${qtys} bAssets`, async () => {
                                    const expectedOutput = await mAsset.getMintMultiOutput(bAssetAddresses, qtys);
                                    assertions_1.assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance);
                                    await mAsset.mintMulti(bAssetAddresses, qtys, cv(testData.expectedQty).sub(tolerance), recipient);
                                    const dataMid = await getData(mAsset);
                                    assertions_1.assertBNClose(dataMid.totalSupply.sub(dataBefore.totalSupply), expectedOutput, tolerance);
                                });
                            }
                        }
                        break;
                    case "swap":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when swapping ${testData.inputQty.toString()} ${testData.inputIndex} for ${testData.outputIndex}`, async () => {
                                await chai_1.expect(mAsset.swap(bAssetAddresses[testData.inputIndex], bAssetAddresses[testData.outputIndex], cv(testData.inputQty), 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(mAsset.getSwapOutput(bAssetAddresses[testData.inputIndex], bAssetAddresses[testData.outputIndex], cv(testData.inputQty))).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else {
                            it(`swaps ${testData.inputQty.toString()} ${testData.inputIndex} for ${testData.outputIndex}`, async () => {
                                const expectedOutput = await mAsset.getSwapOutput(bAssetAddresses[testData.inputIndex], bAssetAddresses[testData.outputIndex], cv(testData.inputQty));
                                assertions_1.assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance);
                                await mAsset.swap(bAssetAddresses[testData.inputIndex], bAssetAddresses[testData.outputIndex], cv(testData.inputQty), cv(testData.expectedQty).sub(tolerance), recipient);
                            });
                        }
                        break;
                    case "redeem":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when redeeming ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                await chai_1.expect(mAsset.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(mAsset.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty)).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else if (testData.insufficientLiquidityError) {
                            it(`throws insufficient liquidity error when redeeming ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                await chai_1.expect(mAsset.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, 0, recipient)).to.be.revertedWith("VM Exception");
                                await chai_1.expect(mAsset.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty)).to.be.revertedWith("VM Exception");
                            });
                        }
                        else {
                            it(`redeem ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                const expectedOutput = await mAsset.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty);
                                assertions_1.assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance);
                                await mAsset.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, cv(testData.expectedQty).sub(tolerance), recipient);
                            });
                        }
                        break;
                    case "redeemMasset":
                        {
                            const qtys = testData.expectedQtys.map((b) => cv(b).sub(5));
                            if (testData.insufficientLiquidityError) {
                                it(`throws throw insufficient liquidity error when redeeming ${testData.inputQty} mAsset`, async () => {
                                    await chai_1.expect(mAsset.redeemMasset(cv(testData.inputQty), qtys, recipient)).to.be.revertedWith("VM Exception");
                                });
                            }
                            else if (testData.hardLimitError) {
                                it(`throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                                    await chai_1.expect(mAsset.redeemMasset(cv(testData.inputQty), qtys, recipient)).to.be.revertedWith("Exceeds weight limits");
                                    throw new Error("invalid exception");
                                });
                            }
                            else {
                                it(`redeem ${testData.inputQty} mAssets for proportionate bAssets`, async () => {
                                    await mAsset.redeemMasset(cv(testData.inputQty), qtys, recipient);
                                });
                            }
                        }
                        break;
                    case "redeemBassets":
                        {
                            const qtys = testData.inputQtys.map((b) => cv(b));
                            if (testData.insufficientLiquidityError) {
                                it(`throws throw insufficient liquidity error when redeeming ${qtys} bAssets`, async () => {
                                    await chai_1.expect(mAsset.redeemExactBassets(bAssetAddresses, qtys, 100, recipient)).to.be.revertedWith("VM Exception");
                                    await chai_1.expect(mAsset.getRedeemExactBassetsOutput(bAssetAddresses, qtys)).to.be.revertedWith("VM Exception");
                                });
                            }
                            else if (testData.hardLimitError) {
                                it(`throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                                    await chai_1.expect(mAsset.redeemExactBassets(bAssetAddresses, qtys, 100, recipient)).to.be.revertedWith("Exceeds weight limits");
                                    await chai_1.expect(mAsset.getRedeemExactBassetsOutput(bAssetAddresses, qtys)).to.be.revertedWith("Exceeds weight limits");
                                });
                            }
                            else {
                                it(`redeem ${qtys} bAssets`, async () => {
                                    const expectedOutput = await mAsset.getRedeemExactBassetsOutput(bAssetAddresses, qtys);
                                    const testDataOutput = cv(testData.expectedQty).add(cv(testData.swapFee));
                                    assertions_1.assertBNClose(expectedOutput, testDataOutput, tolerance);
                                    await mAsset.redeemExactBassets(bAssetAddresses, qtys, testDataOutput.add(tolerance), recipient);
                                    const dataMid = await getData(mAsset);
                                    assertions_1.assertBNClose(dataBefore.totalSupply.sub(dataMid.totalSupply), expectedOutput, tolerance);
                                });
                            }
                        }
                        break;
                    default:
                        throw Error("unknown action");
                }
                it("holds invariant after action", async () => {
                    const dataEnd = await getData(mAsset);
                    // 1. Check resulting reserves
                    if (testData.reserves) {
                        dataEnd.vaultBalances.map((vb, i) => assertions_1.assertBNClose(vb, cv(testData.reserves[i]), math_1.BN.from(1000)));
                    }
                    // 2. Check swap fee accrual
                    if (testData.swapFee) {
                        assertions_1.assertBNClose(dataEnd.surplus, dataBefore.surplus.add(cv(testData.swapFee)), 2, "Swap fees should accrue accurately after each action");
                    }
                    // 3. Check that invariant holds: `totalSupply + surplus = k = invariant(reserves)`
                    //    After each action, this property should hold true, proving 100% that mint/swap/redeem hold,
                    //    and fees are being paid 100% accurately. This should show that the redeemBasset holds.
                    assertions_1.assertBNSlightlyGT(dataEnd.priceData.k, dataEnd.surplus.add(dataEnd.totalSupply), math_1.BN.from(1000000000000), false, "K does not hold");
                    //    The dust collected should always increase in favour of the system
                    const newKDiff = dataEnd.priceData.k.sub(dataEnd.surplus.add(dataEnd.totalSupply));
                    const cachedLastDiff = lastKDiff;
                    lastKDiff = newKDiff;
                    if (testData.type !== "redeemMasset") {
                        // 50 base unit tolerance on dust increase
                        chai_1.expect(newKDiff, "Dust can only accumulate in favour of the system").gte(cachedLastDiff.sub(50));
                    }
                    else if (newKDiff < cachedLastDiff) {
                        assertions_1.assertBNClose(newKDiff, cachedLastDiff, math_1.BN.from(200), "K dust accrues on redeemMasset");
                    }
                });
            });
        }
    });
});
//# sourceMappingURL=integration.spec.js.map