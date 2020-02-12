
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BN } from "@utils/tools";


import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ERC20MockInstance, MassetInstance, ForgeRewardsMUSDInstance } from "types/generated";

const Masset = artifacts.require("Masset");
const ForgeRewardsMUSD = artifacts.require("ForgeRewardsMUSD");

envSetup.configure();
const { expect, assert } = chai;

contract("Rewards", async (accounts) => {

    let sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let masset: MassetInstance;
    let b1, b2, b3, b4, b5, b6, b7;
    let rewardsContract: ForgeRewardsMUSDInstance;

    beforeEach("Init contract", async () => {
        //rewardContract = await deployer.deployed(c_ForgeRewardsMUSD);
        systemMachine = new SystemMachine(accounts, sa.other);
        await systemMachine.initialiseMocks();
        const bassetMachine = new BassetMachine(sa.default, sa.other, 500000);

        // 1. Deploy Bassets
        b1 = await bassetMachine.deployERC20Async();
        b2 = await bassetMachine.deployERC20Async();
        b3 = await bassetMachine.deployERC20Async();
        b4 = await bassetMachine.deployERC20Async();
        b5 = await bassetMachine.deployERC20Async();
        b6 = await bassetMachine.deployERC20Async();
        b7 = await bassetMachine.deployERC20Async();

        // 2. Masset contract deploy
        masset = await Masset.new(
            "TestMasset",
            "TMT",
            systemMachine.nexus.address,
            [b1.address, b2.address, b3.address, b4.address, b5.address, b6.address, b7.address],
            [aToH("b1"), aToH("b2"), aToH("b3"), aToH("b4"), aToH("b5"), aToH("b6"), aToH("b7")],
            [
                percentToWeight(30),
                percentToWeight(30),
                percentToWeight(30),
                percentToWeight(30),
                percentToWeight(20),
                percentToWeight(20),
                percentToWeight(20),
            ],
            [
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
                createMultiple(1),
            ],
            sa.feePool,
            systemMachine.forgeValidator.address,
        );

        // 3. Deploy ForgeRewardsMUSD
        rewardsContract = await ForgeRewardsMUSD.new(
            masset.address,
            systemMachine.systok.address,
            sa.governor,
            { from: sa.governor }
        );
    });

    describe("Contract deployed", async () => {
        it("Should have valid parameters", async () => {
            assert((await rewardsContract.mUSD()) === masset.address);
            assert((await rewardsContract.MTA()) === systemMachine.systok.address);
            assert((await rewardsContract.owner()) === sa.governor);
        });

        it("Should approved all bAsset tokens to max", async () => {
            let MAX: BN = ((new BN(2)).pow(new BN(256))).sub(new BN(1)); // 2^256-1
            assert((await b1.allowance(rewardsContract.address, masset.address)).eq(MAX));
            assert((await b2.allowance(rewardsContract.address, masset.address)).eq(MAX));
            assert((await b3.allowance(rewardsContract.address, masset.address)).eq(MAX));
            assert((await b4.allowance(rewardsContract.address, masset.address)).eq(MAX));
            assert((await b5.allowance(rewardsContract.address, masset.address)).eq(MAX));
            assert((await b6.allowance(rewardsContract.address, masset.address)).eq(MAX));
            assert((await b7.allowance(rewardsContract.address, masset.address)).eq(MAX));

        });
    });

    describe("getTrancheData()", () => {
        it("Should have initial Tranche data");
    });

    describe("approveAllBassets()", () => {
        it("Should fail when called by non Governer");
        it("Should allowed when called by Governer");
        it("Should approve to MAX when allowances are utilized")
    });

    describe("approveFor()", () => {
        it("Should fail when called by non Governer");
        it("Should allowed when called by Governer");
        it("Should approve to MAX when allowances are utilized");
    });

    describe("mintTo()", () => {
        it("Should mint single bAsset", async () => {
            const newSystemMachine = new SystemMachine(accounts, sa.other);
            await newSystemMachine.initialiseMocks();
            const newBassetMachine = new BassetMachine(sa.default, sa.other, 500000);

            const bAsset = await newBassetMachine.deployERC20Async();
            const newMasset = await Masset.new(
                "TestMasset",
                "TMT",
                newSystemMachine.nexus.address,
                [bAsset.address],
                [aToH("b1")],
                [percentToWeight(100)],
                [createMultiple(1)],
                sa.feePool,
                newSystemMachine.forgeValidator.address,
            );

            // 3. Deploy ForgeRewardsMUSD
            const newRewardsContract = await ForgeRewardsMUSD.new(
                newMasset.address,
                newSystemMachine.systok.address,
                sa.governor,
                { from: sa.governor }
            );

            await bAsset.approve(newRewardsContract.address, 10, { from: sa.default });
            assert((await bAsset.allowance(sa.default, newRewardsContract.address)).eq(new BN(10)));

            const txReceipt = await newRewardsContract.mintSingleTo(bAsset.address, 10, sa.default, sa.default, { from: sa.default });
            expectEvent.inLogs(txReceipt.logs, "MintVolumeIncreased", { trancheNumber: new BN(0), mintVolume: new BN(10) });
            expectEvent.inLogs(txReceipt.logs, "RewardeeMintVolumeIncreased", { trancheNumber: new BN(0), rewardee: sa.default, mintVolume: new BN(10) });

            assert((await newMasset.balanceOf(sa.default)).eq(new BN(10)));
            assert((await newMasset.totalSupply()).eq(new BN(10)));

            assert((await bAsset.balanceOf(newMasset.address)).eq(new BN(10)));
            // Rewards updated
            let data: any = await newRewardsContract.getTrancheData(0);
            let rewardStartTime = await newRewardsContract.rewardStartTime();
            validateTrancheDates(data, rewardStartTime, 0);

            assert(data.totalMintVolume.eq(new BN(10)));
            assert(data.totalRewardUnits.eq(new BN(0)));
            assert(data.unclaimedRewardUnits.eq(new BN(0)));

            // Reward for the user
            data = await newRewardsContract.getRewardeesData(0, [sa.default]);
            assert(data.mintVolume[0].eq(new BN(10)));
            assert(data.claimed[0] === false);
            assert(data.rewardAllocation[0].eq(new BN(0)));
            assert(data.redeemed[0] === false);

        });

        it("Should mint multiple bAssets", async () => {
            await b1.approve(rewardsContract.address, 10, { from: sa.default });
            await b2.approve(rewardsContract.address, 10, { from: sa.default });
            await b3.approve(rewardsContract.address, 10, { from: sa.default });
            await b4.approve(rewardsContract.address, 10, { from: sa.default });

            assert((await b1.allowance(sa.default, rewardsContract.address)).eq(new BN(10)));
            assert((await b2.allowance(sa.default, rewardsContract.address)).eq(new BN(10)));
            assert((await b3.allowance(sa.default, rewardsContract.address)).eq(new BN(10)));
            assert((await b4.allowance(sa.default, rewardsContract.address)).eq(new BN(10)));

            const bitmap = 15; // 1111
            const txReceipt = await rewardsContract.mintTo(
                bitmap,
                [10, 10, 10, 10],
                sa.default,
                sa.default,
                { from: sa.default }
            );

            // Expect event
            expectEvent.inLogs(txReceipt.logs, "MintVolumeIncreased", { trancheNumber: new BN(0), mintVolume: new BN(40) });
            expectEvent.inLogs(txReceipt.logs, "RewardeeMintVolumeIncreased", { trancheNumber: new BN(0), rewardee: sa.default, mintVolume: new BN(40) });

            assert((await masset.balanceOf(sa.default)).eq(new BN(40)));
            assert((await masset.totalSupply()).eq(new BN(40)));

            assert((await b1.balanceOf(masset.address)).eq(new BN(10)));
            assert((await b2.balanceOf(masset.address)).eq(new BN(10)));
            assert((await b3.balanceOf(masset.address)).eq(new BN(10)));
            assert((await b4.balanceOf(masset.address)).eq(new BN(10)));

            // Rewards updated
            let data: any = await rewardsContract.getTrancheData(0);
            //let totalMintVol,  = data[0];
            //let [totalMintVolume, totalRewardUnits] = data
            let rewardStartTime = await rewardsContract.rewardStartTime();
            validateTrancheDates(data, rewardStartTime, 0);

            assert(data.totalMintVolume.eq(new BN(40)));
            assert(data.totalRewardUnits.eq(new BN(0)));
            assert(data.unclaimedRewardUnits.eq(new BN(0)));

            // Reward for the user
            data = await rewardsContract.getRewardeesData(0, [sa.default]);
            assert(data.mintVolume[0].eq(new BN(40)));
            assert(data.claimed[0] === false);
            assert(data.rewardAllocation[0].eq(new BN(0)));
            assert(data.redeemed[0] === false);

        });
    });

    describe("claimReward()", () => {

        it("User should claim reward");
    });

    describe("claimReward() with rewardee", () => {

        it("User should claim reward");
    });

    describe("redeemReward()", () => {
        it("Should redeem reward");
    });

    describe("fundTranche()", () => {
        context("when the Rewards contract deployed", () => {
            context("Should fail", async () => {
                it("when fundTranche() is called by non governer");
            });
        });
        context("getTrancheData()", () => {
            it("Should have Tranche data after funding");
        });
    });
});

function validateTrancheDates(trancheData, rewardStartTime, trancheNumber) {
    let calcDatesData = genTrancheDate(rewardStartTime, trancheNumber);
    assert(trancheData[0].eq(calcDatesData[0]));
    assert(trancheData[1].eq(calcDatesData[1]));
    assert(trancheData[2].eq(calcDatesData[2]));
    assert(trancheData[3].eq(calcDatesData[3]));
}

function genTrancheDate(rewardStartTime, trancheNumber) {
    const TRANCHE_PERIOD = new BN(60 * 60 * 24 * 7 * 4); // 4 week
    const CLAIM_PERIOD = new BN(60 * 60 * 24 * 7 * 8);   // 8 weeks
    const LOCKUP_PERIOD = new BN(60 * 60 * 24 * 7 * 52); // 52 weeks
    let trancheData = new Array();
    // startTime
    trancheData[0] = rewardStartTime.add((new BN(trancheNumber)).mul(TRANCHE_PERIOD));
    // endTime
    trancheData[1] = trancheData[0].add(TRANCHE_PERIOD);
    // claimEndTime
    trancheData[2] = trancheData[1].add(CLAIM_PERIOD);
    // unlockTime
    trancheData[3] = trancheData[1].add(LOCKUP_PERIOD);
    return trancheData;
}

//TODO: Still not working
async function createMassetWithBassets(
    sysMachine: SystemMachine,
    numOfBassets) {

    await sysMachine.initialiseMocks();
    const bassetMachine = new BassetMachine(this.sa.default, this.sa.other, 500000);

    // 1. Deploy bAssets
    let bAssets = new Array();
    let bAssetsAddr = new Array();
    let symbols = new Array();
    let weights = new Array();
    let multiplier = new Array();

    const percent = 200 / numOfBassets;// Lets take 200% and divide by total bAssets to create
    let i;
    for (i = 0; i < numOfBassets; i++) {
        bAssets[i] = await bassetMachine.deployERC20Async();
        bAssetsAddr[i] = bAssets[i].address;
        symbols[i] = aToH("bAsset-" + (i + 1));
        weights[i] = percentToWeight(percent);
        multiplier[i] = createMultiple(1); // By Default all ratio 1
    }

    // 2. Masset contract deploy
    const masset = await Masset.new(
        "TestMasset",
        "TMT",
        this.systemMachine.nexus.address,
        bAssetsAddr,
        symbols,
        weights,
        multiplier,
        this.sa.feePool,
        this.systemMachine.forgeValidator.address,
    );
    return masset;
}