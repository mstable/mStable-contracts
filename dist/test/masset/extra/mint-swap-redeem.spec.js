"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const assertions_1 = require("@utils/assertions");
const math_1 = require("@utils/math");
const machines_1 = require("@utils/machines");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
describe("Masset - basic fns", () => {
    let sa;
    let mAssetMachine;
    let details;
    const runSetup = async () => {
        const renBtc = await mAssetMachine.loadBassetProxy("Ren BTC", "renBTC", 18);
        const sbtc = await mAssetMachine.loadBassetProxy("Synthetix BTC", "sBTC", 18);
        const wbtc = await mAssetMachine.loadBassetProxy("Wrapped BTC", "wBTC", 12);
        const bAssets = [renBtc, sbtc, wbtc];
        const LogicFactory = await hardhat_1.ethers.getContractFactory("MassetLogic");
        const logicLib = (await LogicFactory.deploy());
        const ManagerFactory = await hardhat_1.ethers.getContractFactory("MassetManager");
        const managerLib = (await ManagerFactory.deploy());
        const libs = {
            libraries: {
                MassetLogic: logicLib.address,
                MassetManager: managerLib.address,
            },
        };
        const factory = await hardhat_1.ethers.getContractFactory("ExposedMasset", libs);
        const impl = await factory.deploy(constants_1.DEAD_ADDRESS, math_1.simpleToExactAmount(5, 13));
        const data = impl.interface.encodeFunctionData("initialize", [
            "mStable BTC",
            "mBTC",
            bAssets.map((b) => ({
                addr: b.address,
                integrator: constants_1.ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            })),
            {
                a: math_1.simpleToExactAmount(1, 2),
                limits: {
                    min: math_1.simpleToExactAmount(5, 16),
                    max: math_1.simpleToExactAmount(55, 16),
                },
            },
        ]);
        const mAsset = await new generated_1.AssetProxy__factory(sa.default.signer).deploy(impl.address, constants_1.DEAD_ADDRESS, data);
        details = {
            mAsset: factory.attach(mAsset.address),
            bAssets,
        };
    };
    before("Init contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        await runSetup();
    });
    describe("testing some mints", () => {
        before("reset", async () => {
            await runSetup();
        });
        it("should mint some bAssets", async () => {
            const { bAssets, mAsset } = details;
            const approvals = await Promise.all(details.bAssets.map((b) => mAssetMachine.approveMasset(b, mAsset, 100)));
            await mAsset.mintMulti(bAssets.map((b) => b.address), approvals, 99, sa.default.address);
            const dataEnd = await mAssetMachine.getBasketComposition(details);
            chai_1.expect(dataEnd.totalSupply).to.eq(math_1.simpleToExactAmount(300, 18));
        });
        it("should mint less when going into penalty zone", async () => {
            // soft max is 50%, currently all are at 33% with 300 tvl
            // adding 50 units pushes tvl to 350 and weight to 42.8%
            const { bAssets, mAsset } = details;
            const dataBefore = await mAssetMachine.getBasketComposition(details);
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 50);
            await chai_1.expect(mAsset.mint(bAssets[0].address, approval, math_1.simpleToExactAmount(51), sa.default.address)).to.be.revertedWith("Mint quantity < min qty");
            await mAsset.mint(bAssets[0].address, approval, math_1.simpleToExactAmount(49), sa.default.address);
            const dataEnd = await mAssetMachine.getBasketComposition(details);
            const minted = dataEnd.totalSupply.sub(dataBefore.totalSupply);
            chai_1.expect(minted).to.lt(math_1.simpleToExactAmount(50, 18));
            chai_1.expect(minted).to.gt(math_1.simpleToExactAmount("49.7", 18));
        });
        it("should apply close to 5% penalty near hard max", async () => {
            // hard max is 55%, currently at 42.86% with 350 tvl
            // adding 80 units pushes tvl to 430 and weight to 53.4%
            // other weights then are 23.3%
            const { bAssets, mAsset } = details;
            const dataBefore = await mAssetMachine.getBasketComposition(details);
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 80);
            await chai_1.expect(mAsset.mint(bAssets[0].address, approval, math_1.simpleToExactAmount("79.9"), sa.default.address)).to.be.revertedWith("Mint quantity < min qty");
            await mAsset.mint(bAssets[0].address, approval, math_1.simpleToExactAmount(76), sa.default.address);
            const dataEnd = await mAssetMachine.getBasketComposition(details);
            const minted = dataEnd.totalSupply.sub(dataBefore.totalSupply);
            chai_1.expect(minted).to.lt(math_1.simpleToExactAmount(80, 18));
            chai_1.expect(minted).to.gt(math_1.simpleToExactAmount(77, 18));
        });
        it("should fail if we go over max", async () => {
            const { bAssets, mAsset } = details;
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 80);
            await chai_1.expect(mAsset.mint(bAssets[0].address, approval, math_1.simpleToExactAmount(87), sa.default.address)).to.be.revertedWith("Exceeds weight limits");
        });
        it("should allow lots of minting", async () => {
            const { bAssets, mAsset } = details;
            const approval = await mAssetMachine.approveMasset(bAssets[1], mAsset, 80);
            await mAsset.mint(bAssets[1].address, approval.div(80), 0, sa.default.address);
            await mAsset.mint(bAssets[1].address, approval.div(80), 0, sa.default.address);
            await mAsset.mint(bAssets[1].address, approval.div(80), 0, sa.default.address);
            await bAssets[2].transfer(sa.dummy2.address, math_1.simpleToExactAmount(50, await bAssets[2].decimals()));
            const approval2 = await mAssetMachine.approveMasset(bAssets[2], mAsset, 50, sa.dummy2.signer);
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address);
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address);
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address);
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address);
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address);
        });
    });
    describe("testing some swaps", () => {
        let dataStart;
        before("set up basket", async () => {
            await runSetup();
            const { bAssets, mAsset } = details;
            const approvals = await Promise.all(details.bAssets.map((b) => mAssetMachine.approveMasset(b, mAsset, 100)));
            await mAsset.mintMulti(bAssets.map((b) => b.address), approvals, math_1.simpleToExactAmount(99), sa.default.address);
            dataStart = await mAssetMachine.getBasketComposition(details);
            chai_1.expect(dataStart.totalSupply).to.eq(math_1.simpleToExactAmount(300, 18));
        });
        it("should swap 1:1(-fee) within normal range", async () => {
            // soft max is 41%, currently all are at 33% with 300 tvl
            // adding 10 units should result in 9.9994 output and 36.66%
            const { bAssets, mAsset } = details;
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 10);
            await chai_1.expect(mAsset.swap(bAssets[0].address, // renBTC
            bAssets[1].address, // sBTC
            approval, math_1.simpleToExactAmount(11), sa.default.address)).to.be.revertedWith("Output qty < minimum qty");
            await mAsset.swap(bAssets[0].address, // renBTC
            bAssets[1].address, // sBTC
            approval, math_1.simpleToExactAmount("9.9"), sa.default.address);
            const dataAfter = await mAssetMachine.getBasketComposition(details);
            const swappedOut = dataStart.bAssets[1].mAssetUnits.sub(dataAfter.bAssets[1].mAssetUnits);
            assertions_1.assertBNClosePercent(swappedOut, math_1.simpleToExactAmount("9.994", 18), "0.1");
            chai_1.expect(dataAfter.bAssets[0].mAssetUnits.sub(dataStart.bAssets[0].mAssetUnits)).to.eq(math_1.simpleToExactAmount(10, 18));
            chai_1.expect(dataAfter.totalSupply).to.eq(dataStart.totalSupply);
        });
        it("should apply minute fee when 2% over soft max ", async () => {
            // soft max is 41%, currently at 36.66% with 110/300 tvl
            // adding 20 units pushes to 130/300 and weight to 43.2%
            const { bAssets, mAsset } = details;
            const dataBefore = await mAssetMachine.getBasketComposition(details);
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 20);
            await mAsset.swap(bAssets[0].address, // renBTC
            bAssets[2].address, // wBTC
            approval, math_1.simpleToExactAmount(19, 12), sa.default.address);
            const dataAfter = await mAssetMachine.getBasketComposition(details);
            const swappedOut = dataBefore.bAssets[2].mAssetUnits.sub(dataAfter.bAssets[2].mAssetUnits);
            // sum of fee is 0.5% (incl 0.06% swap fee)
            chai_1.expect(swappedOut).to.gt(math_1.simpleToExactAmount("19.9", 18));
            chai_1.expect(swappedOut).to.lt(math_1.simpleToExactAmount(20, 18));
        });
        it("should apply close to 5% penalty near hard max", async () => {
            // hard max is 56%, currently at 43.2% with 130/300 tvl
            // adding 35 units pushes to 165/300 and weight to 55%
            const { bAssets, mAsset } = details;
            const dataBefore = await mAssetMachine.getBasketComposition(details);
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 35);
            await chai_1.expect(mAsset.swap(bAssets[0].address, // renBTC
            bAssets[1].address, // sBTC
            approval, math_1.simpleToExactAmount("34.9"), sa.default.address)).to.be.revertedWith("Output qty < minimum qty");
            await mAsset.swap(bAssets[0].address, // renBTC
            bAssets[1].address, // sBTC
            approval, math_1.simpleToExactAmount(31), sa.default.address);
            const dataAfter = await mAssetMachine.getBasketComposition(details);
            const swappedOut = dataBefore.bAssets[1].mAssetUnits.sub(dataAfter.bAssets[1].mAssetUnits);
            // sum of fee is 0.5% (incl 0.06% swap fee)
            chai_1.expect(swappedOut).to.gt(math_1.simpleToExactAmount(33, 18));
            chai_1.expect(swappedOut).to.lt(math_1.simpleToExactAmount("34.7", 18));
        });
        it("should fail if we go over max", async () => {
            const { bAssets, mAsset } = details;
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 10);
            await chai_1.expect(mAsset.swap(bAssets[0].address, // renBTC
            bAssets[2].address, // wBTC
            approval, math_1.simpleToExactAmount(9, 12), sa.default.address)).to.be.revertedWith("Exceeds weight limits");
        });
    });
    describe("testing redeem exact mAsset", () => {
        let dataStart;
        before("set up basket", async () => {
            await runSetup();
            const { bAssets, mAsset } = details;
            const approvals = await Promise.all(details.bAssets.map((b) => mAssetMachine.approveMasset(b, mAsset, 100)));
            await mAsset.mintMulti(bAssets.map((b) => b.address), approvals, 99, sa.default.address);
            dataStart = await mAssetMachine.getBasketComposition(details);
            chai_1.expect(dataStart.totalSupply).to.eq(math_1.simpleToExactAmount(300, 18));
        });
        it("should redeem 1:1(-fee) within normal range", async () => {
            // soft min is 25%, currently all are at 33% with 300 tvl
            // redeeming 10 units should result in 9.9994 output and 31%
            const { bAssets, mAsset } = details;
            const mAssetRedeemAmount = math_1.simpleToExactAmount(10, 18);
            const minBassetAmount = math_1.simpleToExactAmount(9, 18);
            await chai_1.expect(mAsset.redeem(bAssets[0].address, // renBTC,
            mAssetRedeemAmount, mAssetRedeemAmount, sa.default.address)).to.be.revertedWith("bAsset qty < min qty");
            await mAsset.redeem(bAssets[0].address, // renBTC,
            mAssetRedeemAmount, minBassetAmount, sa.default.address);
            const dataAfter = await mAssetMachine.getBasketComposition(details);
            const redeemed = dataStart.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits);
            assertions_1.assertBNClosePercent(redeemed, math_1.simpleToExactAmount("9.994", 18), "0.1");
            chai_1.expect(dataAfter.totalSupply).to.eq(dataStart.totalSupply.sub(mAssetRedeemAmount));
        });
        it("should apply minute fee when 2% under soft min ", async () => {
            // soft min is 25%, currently at 31% with 90/290 tvl
            // withdrawing 30 units pushes to 60/260 and weight to 23.07%
            const { bAssets, mAsset } = details;
            const dataBefore = await mAssetMachine.getBasketComposition(details);
            const mAssetRedeemAmount = math_1.simpleToExactAmount(30, 18);
            const minBassetAmount = math_1.simpleToExactAmount(29, 18);
            await mAsset.redeem(bAssets[0].address, // renBTC
            mAssetRedeemAmount, minBassetAmount, sa.default.address);
            const dataAfter = await mAssetMachine.getBasketComposition(details);
            const redeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits);
            // sum of slippage is max 0.33% (incl 0.06% swap fee)
            chai_1.expect(redeemed).to.gt(math_1.simpleToExactAmount("29.9", 18));
            chai_1.expect(redeemed).to.lt(math_1.simpleToExactAmount(30, 18));
            chai_1.expect(dataAfter.totalSupply).to.eq(dataBefore.totalSupply.sub(mAssetRedeemAmount));
            chai_1.expect(dataAfter.surplus.sub(dataBefore.surplus)).to.eq(math_1.simpleToExactAmount(18, 15));
        });
        it("should apply close to 5% penalty near hard min", async () => {
            // hard min is 10%, currently at 23.07% with 60/260 tvl
            // adding 37 units pushes to 23/223 and weight to 10.3%
            const { bAssets, mAsset } = details;
            const dataBefore = await mAssetMachine.getBasketComposition(details);
            const mAssetRedeemAmount = math_1.simpleToExactAmount(37, 18);
            const minBassetAmount = math_1.simpleToExactAmount(30, 18);
            await mAsset.redeem(bAssets[0].address, // renBTC
            mAssetRedeemAmount, minBassetAmount, sa.default.address);
            const dataAfter = await mAssetMachine.getBasketComposition(details);
            const bAssetRedeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits);
            // max slippage around 9%
            chai_1.expect(bAssetRedeemed).to.gt(math_1.simpleToExactAmount("34", 18));
            chai_1.expect(bAssetRedeemed).to.lt(math_1.simpleToExactAmount("36.5", 18));
            chai_1.expect(dataAfter.totalSupply).to.eq(dataBefore.totalSupply.sub(mAssetRedeemAmount));
        });
    });
    describe("testing redeem exact bAsset(s)", () => {
        let dataStart;
        before("set up basket", async () => {
            await runSetup();
            const { bAssets, mAsset } = details;
            const approvals = await Promise.all(details.bAssets.map((b) => mAssetMachine.approveMasset(b, mAsset, 100)));
            await mAsset.mintMulti(bAssets.map((b) => b.address), approvals, 99, sa.default.address);
            dataStart = await mAssetMachine.getBasketComposition(details);
            chai_1.expect(dataStart.totalSupply).to.eq(math_1.simpleToExactAmount(300, 18));
        });
        it("should redeem 1:1(-fee) within normal range", async () => {
            // soft min is 25%, currently all are at 33% with 300 tvl
            // redeeming 10 units should result in 10.006 burned and 31%
            const { bAssets, mAsset } = details;
            const bAssetAmount = math_1.simpleToExactAmount(10, 18);
            const maxMasset = math_1.simpleToExactAmount("10.01", 18);
            await mAsset.redeemExactBassets([bAssets[0].address], [bAssetAmount], maxMasset, sa.default.address);
            const dataAfter = await mAssetMachine.getBasketComposition(details);
            const mAssetBurned = dataStart.totalSupply.sub(dataAfter.totalSupply);
            assertions_1.assertBNClosePercent(mAssetBurned, math_1.simpleToExactAmount("10.006003602161296778", 18), "0.1");
            chai_1.expect(dataAfter.bAssets[0].vaultBalance).to.eq(dataStart.bAssets[0].vaultBalance.sub(math_1.simpleToExactAmount(10, 18)));
        });
        it("should apply minute fee when 2% under soft min ", async () => {
            // soft min is 25%, currently at 31% with 90/290 tvl
            // withdrawing 30 units pushes to 60/260 and weight to 23.07%
            const { bAssets, mAsset } = details;
            const dataBefore = await mAssetMachine.getBasketComposition(details);
            const bAssetRedeemAmount = math_1.simpleToExactAmount(30, 18);
            const maxMasset = math_1.simpleToExactAmount(31, 18);
            await mAsset.redeemExactBassets([bAssets[0].address], [bAssetRedeemAmount], maxMasset, sa.default.address);
            const dataAfter = await mAssetMachine.getBasketComposition(details);
            const redeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits);
            // sum of slippage is max 0.33% (incl 0.06% swap fee)
            chai_1.expect(redeemed).to.eq(math_1.simpleToExactAmount(30, 18));
            const mAssetBurned = dataBefore.totalSupply.sub(dataAfter.totalSupply);
            chai_1.expect(mAssetBurned).to.gt(math_1.simpleToExactAmount(30, 18));
            chai_1.expect(mAssetBurned).to.lt(math_1.simpleToExactAmount(31, 18));
            assertions_1.assertBNClosePercent(dataAfter.surplus.sub(dataBefore.surplus), math_1.simpleToExactAmount(18, 15), 2);
        });
        it("should apply close to 5% penalty near hard min", async () => {
            // hard min is 10%, currently at 23.07% with 60/260 tvl
            // adding 37 units pushes to 23/223 and weight to 10.3%
            const { bAssets, mAsset } = details;
            const dataBefore = await mAssetMachine.getBasketComposition(details);
            const bAssetRedeemAmount = math_1.simpleToExactAmount(35, 18);
            const maxMasset = math_1.simpleToExactAmount(39, 18);
            await chai_1.expect(mAsset.redeemExactBassets([bAssets[0].address], [bAssetRedeemAmount], math_1.simpleToExactAmount("35.3", 18), sa.default.address)).to.be.revertedWith("Redeem mAsset qty > max quantity");
            await mAsset.redeemExactBassets([bAssets[0].address], [bAssetRedeemAmount], maxMasset, sa.default.address);
            const dataAfter = await mAssetMachine.getBasketComposition(details);
            const redeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits);
            chai_1.expect(redeemed).to.eq(math_1.simpleToExactAmount(35, 18));
            const mAssetBurned = dataBefore.totalSupply.sub(dataAfter.totalSupply);
            chai_1.expect(mAssetBurned).to.gt(math_1.simpleToExactAmount("35.4", 18));
            chai_1.expect(mAssetBurned).to.lt(math_1.simpleToExactAmount(39, 18));
        });
    });
});
//# sourceMappingURL=mint-swap-redeem.spec.js.map