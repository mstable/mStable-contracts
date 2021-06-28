"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const assertions_1 = require("@utils/assertions");
const math_1 = require("@utils/math");
const machines_1 = require("@utils/machines");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
const time_1 = require("@utils/time");
const one = math_1.simpleToExactAmount(1);
const swapFee = math_1.simpleToExactAmount(6, 14);
const recolFee = math_1.simpleToExactAmount(5, 13);
const snapshot = async () => {
    const id = await hardhat_1.network.provider.request({
        method: "evm_snapshot",
    });
    return id;
};
const revert = async (id) => {
    await hardhat_1.network.provider.request({
        method: "evm_revert",
        params: [id],
    });
};
describe("Recol functions", () => {
    let sa;
    let mAssetMachine;
    let details;
    let validator;
    const runSetup = async () => {
        details = await mAssetMachine.deployMasset();
        await mAssetMachine.seedWithWeightings(details, [22, 28, 23, 24]);
        const logicLib = await new generated_1.MassetLogic__factory(sa.default.signer).deploy();
        const linkedAddress = {
            libraries: {
                MassetLogic: logicLib.address,
            },
        };
        const massetFactory = await hardhat_1.ethers.getContractFactory("ExposedMassetLogic", linkedAddress);
        validator = (await massetFactory.deploy());
    };
    before("Init contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        await runSetup();
    });
    const changeCollateralisation = async (over) => {
        const { mAsset } = details;
        const time = await time_1.getTimestamp();
        const currentA = (await mAsset.getConfig()).a;
        const futureA = over ? currentA.mul(4) : currentA.div(4);
        await mAsset.connect(sa.governor.signer).startRampA(futureA.div(100), time.add(constants_1.ONE_DAY.add(1)));
        await time_1.increaseTime(constants_1.ONE_DAY.add(1));
    };
    describe("recol fee application", () => {
        context("when over collateralised", () => {
            before(async () => {
                await runSetup();
                await changeCollateralisation(true);
                const price = await details.mAsset.getPrice();
                chai_1.expect(price.price).gt(one);
            });
            it("should not apply fee", async () => {
                const { mAsset } = details;
                const bAssetData = (await mAsset.getBassets())[1];
                const config = await mAsset.getConfig();
                const noRecol = {
                    ...config,
                    recolFee: math_1.BN.from(0),
                };
                const withRecol = {
                    ...config,
                    recolFee,
                };
                // mint
                const mintWithNone = await validator.computeMint(bAssetData, 0, one, noRecol);
                const mintWithRecol = await validator.computeMint(bAssetData, 0, one, withRecol);
                chai_1.expect(mintWithNone).eq(mintWithRecol);
                // mintMulti
                const multiWithNone = await validator.computeMintMulti(bAssetData, [0], [one], noRecol);
                const multiWithRecol = await validator.computeMintMulti(bAssetData, [0], [one], withRecol);
                chai_1.expect(multiWithNone).eq(multiWithRecol);
                // swap
                const [swapWithNone] = await validator.computeSwap(bAssetData, 0, 1, one, swapFee, noRecol);
                const [swapWithRecol] = await validator.computeSwap(bAssetData, 0, 1, one, swapFee, withRecol);
                chai_1.expect(swapWithNone).eq(swapWithRecol);
                // redeem
                const [redeemWithNone] = await validator.computeRedeem(bAssetData, 0, one, noRecol, swapFee);
                const [redeemWithRecol] = await validator.computeRedeem(bAssetData, 0, one, withRecol, swapFee);
                chai_1.expect(redeemWithNone).eq(redeemWithRecol);
                // redeemExact
                const [exactWithNone] = await validator.computeRedeemExact(bAssetData, [0], [one], noRecol, swapFee);
                const [exactWithRecol] = await validator.computeRedeemExact(bAssetData, [0], [one], withRecol, swapFee);
                chai_1.expect(exactWithNone).eq(exactWithRecol);
                // redeemProportionately
                const sID = await snapshot();
                await mAsset.simulateRedeemMasset(one, [0, 0, 0, 0], 0);
                const vaultsWithNone = (await mAsset.getBassets())[1];
                await revert(sID);
                await mAsset.simulateRedeemMasset(one, [0, 0, 0, 0], math_1.simpleToExactAmount(5, 13));
                const vaultsWithRecol = (await mAsset.getBassets())[1];
                vaultsWithRecol.map((v, i) => chai_1.expect(v.vaultBalance).eq(vaultsWithNone[i].vaultBalance));
            });
        });
        context("when under collateralised", () => {
            before(async () => {
                await runSetup();
                await changeCollateralisation(false);
                const price = await details.mAsset.getPrice();
                chai_1.expect(price.price).lt(one);
            });
            it("should deduct fee if set", async () => {
                const { mAsset } = details;
                const bAssetData = (await mAsset.getBassets())[1];
                const config = await mAsset.getConfig();
                const noRecol = {
                    ...config,
                    recolFee: math_1.BN.from(0),
                };
                const withRecol = {
                    ...config,
                    recolFee,
                };
                // mint
                const mintWithNone = await validator.computeMint(bAssetData, 0, one, noRecol);
                const mintWithRecol = await validator.computeMint(bAssetData, 0, one, withRecol);
                assertions_1.assertBNSlightlyGTPercent(mintWithNone, mintWithRecol, "0.006", true);
                // mintMulti
                const multiWithNone = await validator.computeMintMulti(bAssetData, [0], [one], noRecol);
                const multiWithRecol = await validator.computeMintMulti(bAssetData, [0], [one], withRecol);
                assertions_1.assertBNSlightlyGTPercent(multiWithNone, multiWithRecol, "0.006", true);
                // swap
                const [swapWithNone] = await validator.computeSwap(bAssetData, 0, 1, one, swapFee, noRecol);
                const [swapWithRecol] = await validator.computeSwap(bAssetData, 0, 1, one, swapFee, withRecol);
                assertions_1.assertBNSlightlyGTPercent(swapWithNone, swapWithRecol, "0.006", true);
                // redeem
                const [redeemWithNone] = await validator.computeRedeem(bAssetData, 0, one, noRecol, swapFee);
                const [redeemWithRecol] = await validator.computeRedeem(bAssetData, 0, one, withRecol, swapFee);
                assertions_1.assertBNSlightlyGTPercent(redeemWithNone, redeemWithRecol, "0.006", true);
                // redeemExact
                const [exactWithNone] = await validator.computeRedeemExact(bAssetData, [0], [one], noRecol, swapFee);
                const [exactWithRecol] = await validator.computeRedeemExact(bAssetData, [0], [one], withRecol, swapFee);
                assertions_1.assertBNSlightlyGTPercent(exactWithRecol, exactWithNone, "0.006", true);
                // redeemProportionately
                const sID = await snapshot();
                await mAsset.simulateRedeemMasset(one, [0, 0, 0, 0], 0);
                const vaultsWithNone = (await mAsset.getBassets())[1];
                await revert(sID);
                await mAsset.simulateRedeemMasset(one, [0, 0, 0, 0], math_1.simpleToExactAmount(5, 13));
                const vaultsWithRecol = (await mAsset.getBassets())[1];
                vaultsWithRecol.map((v, i) => assertions_1.assertBNSlightlyGTPercent(v.vaultBalance, vaultsWithNone[i].vaultBalance, "0.006", true));
            });
        });
    });
    describe("manually re-setting collateraliastion", () => {
        context("when over collateralised", () => {
            before(async () => {
                await runSetup();
                await changeCollateralisation(true);
                const price = await details.mAsset.getPrice();
                chai_1.expect(price.price).gt(one);
            });
            it("should fail to burnSurplus", async () => {
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).burnSurplus()).to.be.revertedWith("No surplus");
            });
            it("should distribute surplus to savers", async () => {
                const { mAsset } = details;
                const { surplus } = await mAsset.data();
                let supply = await mAsset.totalSupply();
                const { k } = await mAsset.getPrice();
                const diff = await k.sub(supply.add(surplus));
                const tx = mAsset.connect(sa.governor.signer).mintDeficit();
                await chai_1.expect(tx).to.emit(mAsset, "DeficitMinted").withArgs(diff);
                const { surplus: surplusAfter } = await mAsset.data();
                supply = await mAsset.totalSupply();
                const { price, k: kAfter } = await mAsset.getPrice();
                chai_1.expect(k).eq(kAfter);
                chai_1.expect(price).eq(math_1.simpleToExactAmount(1));
                chai_1.expect(surplusAfter).eq(surplus.add(diff));
                chai_1.expect(k).eq(supply.add(surplusAfter));
            });
            it("should do nothing if called again", async () => {
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).mintDeficit()).to.be.revertedWith("No deficit");
            });
        });
        context("when under collateralised", () => {
            before(async () => {
                await runSetup();
                await changeCollateralisation(false);
                const price = await details.mAsset.getPrice();
                chai_1.expect(price.price).lt(one);
            });
            it("should fail to mintDeficit", async () => {
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).mintDeficit()).to.be.revertedWith("No deficit");
            });
            it("should deduct deficit from sender and reset", async () => {
                const { mAsset } = details;
                const balBefore = await mAsset.balanceOf(sa.default.address);
                const { surplus } = await mAsset.data();
                const supplyBefore = await mAsset.totalSupply();
                const { k } = await mAsset.getPrice();
                const diff = await supplyBefore.add(surplus).sub(k);
                const tx = mAsset.connect(sa.default.signer).burnSurplus();
                await chai_1.expect(tx).to.emit(mAsset, "SurplusBurned").withArgs(sa.default.address, diff);
                const balAfter = await mAsset.balanceOf(sa.default.address);
                const { surplus: surplusAfter } = await mAsset.data();
                const supplyafter = await mAsset.totalSupply();
                const { price, k: kAfter } = await mAsset.getPrice();
                chai_1.expect(k).eq(kAfter);
                chai_1.expect(price).eq(math_1.simpleToExactAmount(1));
                chai_1.expect(surplusAfter).eq(surplus);
                chai_1.expect(balAfter).eq(balBefore.sub(diff));
                chai_1.expect(supplyafter).eq(supplyBefore.sub(diff));
            });
            it("should do nothing if called again", async () => {
                await chai_1.expect(details.mAsset.connect(sa.default.signer).burnSurplus()).to.be.revertedWith("No surplus");
            });
        });
    });
});
//# sourceMappingURL=recol.spec.js.map