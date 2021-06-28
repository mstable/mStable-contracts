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
const config = {
    a: math_1.BN.from(300),
    limits: {
        min: math_1.simpleToExactAmount(20, 16),
        max: math_1.simpleToExactAmount(80, 16),
    },
};
const massetA = 300;
const ratio = math_1.simpleToExactAmount(1, 8);
const tolerance = math_1.BN.from(10);
const maxAction = 100;
const feederFees = { swap: math_1.simpleToExactAmount(8, 14), redeem: math_1.simpleToExactAmount(6, 14), gov: math_1.simpleToExactAmount(1, 17) };
const cv = (n) => math_1.BN.from(BigInt(n).toString());
const getReserves = (data) => [0, 1, 2, 3, 4, 5]
    .filter((i) => data[`reserve${i}`])
    .map((i) => ({
    ratio,
    vaultBalance: cv(data[`reserve${i}`]),
}));
const runLongTests = process.env.LONG_TESTS === "true";
describe("Feeder Validation - One basket many tests", () => {
    let feederPool;
    let sa;
    let recipient;
    let bAssetAddresses;
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        recipient = await sa.default.address;
        const mAssetDetails = await mAssetMachine.deployMasset(false, false, massetA);
        await mAssetMachine.seedWithWeightings(mAssetDetails, [25000000, 25000000, 25000000, 25000000]);
        const bBtc = await mAssetMachine.loadBassetProxy("Binance BTC", "bBTC", 18);
        const bAssets = [mAssetDetails.mAsset, bBtc];
        bAssetAddresses = bAssets.map((b) => b.address);
        const feederLogic = await new generated_1.FeederLogic__factory(sa.default.signer).deploy();
        const manager = await new generated_1.FeederManager__factory(sa.default.signer).deploy();
        const FeederFactory = (await hardhat_1.ethers.getContractFactory("ExposedFeederPool", {
            libraries: {
                FeederManager: manager.address,
                FeederLogic: feederLogic.address,
            },
        })).connect(sa.default.signer);
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
        }, mAssetDetails.bAssets.map((b) => b.address), config);
        await feederPool.connect(sa.governor.signer).setFees(feederFees.swap, feederFees.redeem, feederFees.gov);
        await Promise.all(bAssets.map((b) => b.approve(feederPool.address, constants_1.MAX_UINT256)));
        const reserves = getReserves(validator_data_1.feederData.integrationData);
        await feederPool.mintMulti(bAssetAddresses, reserves.map((r) => r.vaultBalance), 0, recipient);
    });
    const getData = async (_feederPool) => ({
        totalSupply: await _feederPool.totalSupply(),
        fees: (await _feederPool.data()).pendingFees,
        vaultBalances: (await _feederPool.getBassets())[1].map((b) => b[1]),
        value: await _feederPool.getPrice(),
    });
    describe("Run all the data", () => {
        let dataBefore;
        let count = 0;
        validator_data_1.feederData.integrationData.actions
            .slice(0, runLongTests ? validator_data_1.feederData.integrationData.actions.length : maxAction)
            .map(async (testData) => {
            describe(`Action ${(count += 1)}`, () => {
                before(async () => {
                    dataBefore = await getData(feederPool);
                });
                switch (testData.type) {
                    case "mint":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when minting ${testData.inputQty.toString()} bAssets with index ${testData.inputIndex}`, async () => {
                                await chai_1.expect(feederPool.mint(bAssetAddresses[testData.inputIndex], cv(testData.inputQty), 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(feederPool.getMintOutput(bAssetAddresses[testData.inputIndex], cv(testData.inputQty))).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else {
                            it(`should deposit ${testData.inputQty.toString()} bAssets with index ${testData.inputIndex}`, async () => {
                                const expectedOutput = await feederPool.getMintOutput(bAssetAddresses[testData.inputIndex], cv(testData.inputQty));
                                assertions_1.assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance);
                                await feederPool.mint(bAssetAddresses[testData.inputIndex], cv(testData.inputQty), cv(testData.expectedQty).sub(tolerance), recipient);
                                const dataMid = await getData(feederPool);
                                assertions_1.assertBNClose(dataMid.totalSupply.sub(dataBefore.totalSupply), expectedOutput, tolerance);
                            });
                        }
                        break;
                    case "mintMulti":
                        {
                            const qtys = testData.inputQtys.map((b) => cv(b));
                            if (testData.hardLimitError) {
                                it(`throws Max Weight error when minting ${qtys} bAssets with index ${testData.inputIndex}`, async () => {
                                    await chai_1.expect(feederPool.mintMulti(bAssetAddresses, qtys, 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                    await chai_1.expect(feederPool.getMintMultiOutput(bAssetAddresses, qtys)).to.be.revertedWith("Exceeds weight limits");
                                });
                            }
                            else {
                                it(`should mintMulti ${qtys} bAssets`, async () => {
                                    const expectedOutput = await feederPool.getMintMultiOutput(bAssetAddresses, qtys);
                                    assertions_1.assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance);
                                    await feederPool.mintMulti(bAssetAddresses, qtys, cv(testData.expectedQty).sub(tolerance), recipient);
                                    const dataMid = await getData(feederPool);
                                    assertions_1.assertBNClose(dataMid.totalSupply.sub(dataBefore.totalSupply), expectedOutput, tolerance);
                                });
                            }
                        }
                        break;
                    case "swap":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when swapping ${testData.inputQty.toString()} ${testData.inputIndex} for ${testData.outputIndex}`, async () => {
                                await chai_1.expect(feederPool.swap(bAssetAddresses[testData.inputIndex], bAssetAddresses[testData.outputIndex], cv(testData.inputQty), 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(feederPool.getSwapOutput(bAssetAddresses[testData.inputIndex], bAssetAddresses[testData.outputIndex], cv(testData.inputQty))).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else {
                            it(`swaps ${testData.inputQty.toString()} ${testData.inputIndex} for ${testData.outputIndex}`, async () => {
                                const expectedOutput = await feederPool.getSwapOutput(bAssetAddresses[testData.inputIndex], bAssetAddresses[testData.outputIndex], cv(testData.inputQty));
                                assertions_1.assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance);
                                await feederPool.swap(bAssetAddresses[testData.inputIndex], bAssetAddresses[testData.outputIndex], cv(testData.inputQty), cv(testData.expectedQty).sub(tolerance), recipient);
                            });
                        }
                        break;
                    case "redeem":
                        if (testData.hardLimitError) {
                            it(`throws Max Weight error when redeeming ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                await chai_1.expect(feederPool.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, 0, recipient)).to.be.revertedWith("Exceeds weight limits");
                                await chai_1.expect(feederPool.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty)).to.be.revertedWith("Exceeds weight limits");
                            });
                        }
                        else if (testData.insufficientLiquidityError) {
                            it(`throws insufficient liquidity error when redeeming ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                await chai_1.expect(feederPool.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, 0, recipient)).to.be.revertedWith("VM Exception");
                                await chai_1.expect(feederPool.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty)).to.be.revertedWith("VM Exception");
                            });
                        }
                        else {
                            it(`redeem ${testData.inputQty} mAssets for bAsset ${testData.inputIndex}`, async () => {
                                const expectedOutput = await feederPool.getRedeemOutput(bAssetAddresses[testData.inputIndex], testData.inputQty);
                                assertions_1.assertBNClose(expectedOutput, cv(testData.expectedQty), tolerance);
                                await feederPool.redeem(bAssetAddresses[testData.inputIndex], testData.inputQty, cv(testData.expectedQty).sub(tolerance), recipient);
                            });
                        }
                        break;
                    case "redeemMasset":
                        {
                            const qtys = testData.expectedQtys.map((b) => cv(b).sub(5));
                            if (testData.insufficientLiquidityError) {
                                it(`throws throw insufficient liquidity error when redeeming ${testData.inputQty} mAsset`, async () => {
                                    await chai_1.expect(feederPool.redeemProportionately(cv(testData.inputQty), qtys, recipient)).to.be.revertedWith("VM Exception");
                                });
                            }
                            else if (testData.hardLimitError) {
                                it(`throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                                    await chai_1.expect(feederPool.redeemProportionately(cv(testData.inputQty), qtys, recipient)).to.be.revertedWith("Exceeds weight limits");
                                    throw new Error("invalid exception");
                                });
                            }
                            else {
                                it(`redeem ${testData.inputQty} mAssets for proportionate bAssets`, async () => {
                                    await feederPool.redeemProportionately(cv(testData.inputQty), qtys, recipient);
                                });
                            }
                        }
                        break;
                    case "redeemBassets":
                        {
                            const qtys = testData.inputQtys.map((b) => cv(b));
                            if (testData.insufficientLiquidityError) {
                                it(`throws throw insufficient liquidity error when redeeming ${qtys} bAssets`, async () => {
                                    await chai_1.expect(feederPool.redeemExactBassets(bAssetAddresses, qtys, 100, recipient)).to.be.revertedWith("VM Exception");
                                    await chai_1.expect(feederPool.getRedeemExactBassetsOutput(bAssetAddresses, qtys)).to.be.revertedWith("VM Exception");
                                });
                            }
                            else if (testData.hardLimitError) {
                                it(`throws Max Weight error when redeeming ${qtys} bAssets`, async () => {
                                    await chai_1.expect(feederPool.redeemExactBassets(bAssetAddresses, qtys, 100, recipient)).to.be.revertedWith("Exceeds weight limits");
                                    await chai_1.expect(feederPool.getRedeemExactBassetsOutput(bAssetAddresses, qtys)).to.be.revertedWith("Exceeds weight limits");
                                });
                            }
                            else {
                                it(`redeem ${qtys} bAssets`, async () => {
                                    const expectedOutput = await feederPool.getRedeemExactBassetsOutput(bAssetAddresses, qtys);
                                    const testDataOutput = cv(testData.expectedQty).add(cv(testData.swapFee));
                                    assertions_1.assertBNClose(expectedOutput, testDataOutput, tolerance);
                                    await feederPool.redeemExactBassets(bAssetAddresses, qtys, testDataOutput.add(tolerance), recipient);
                                    const dataMid = await getData(feederPool);
                                    assertions_1.assertBNClose(dataBefore.totalSupply.sub(dataMid.totalSupply), expectedOutput, tolerance);
                                });
                            }
                        }
                        break;
                    default:
                        throw Error("unknown action");
                }
                it("holds invariant after action", async () => {
                    const dataEnd = await getData(feederPool);
                    // 1. Check resulting reserves
                    if (testData.reserves) {
                        dataEnd.vaultBalances.map((vb, i) => assertions_1.assertBNClose(vb, cv(testData.reserves[i]), math_1.BN.from(1000)));
                    }
                    // 2. Price always goes up
                    if (testData.type !== "redeemMasset") {
                        chai_1.expect(dataEnd.value.price, "fpToken price should always go up").gte(dataBefore.value.price);
                    }
                    else if (dataEnd.value.price.lt(dataBefore.value.price)) {
                        assertions_1.assertBNClose(dataEnd.value.price, dataBefore.value.price, 200, "fpToken price should always go up");
                    }
                    // 3. Supply checks out
                    if (testData.LPTokenSupply) {
                        assertions_1.assertBNClose(dataEnd.totalSupply.add(dataEnd.fees), cv(testData.LPTokenSupply), 100, "Total supply should check out");
                    }
                });
            });
        });
    });
});
//# sourceMappingURL=integration.spec.js.map