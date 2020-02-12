
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { BN, constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BigNumber } from "@utils/tools";


import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ERC20MockInstance, MassetInstance, ForgeRewardsMUSDContract, ForgeRewardsMUSDInstance } from "types/generated";

//import { BN } from "bn.js";
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
            //expect((await b1.allowance(rewardsContract.address, masset.address))).BN.eq(MAX);
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
        it("Should have initial Tranche data", async () => {
            //let data = await rewardsContract.getTrancheData(0);
            //console.log(data);
        });
    });

    // describe("approveAllBassets()", () => {
    //     it("Should fail when called by non Governer", async () => {

    //     });
    //     it("Should allowed when called by Governer", async () => {

    //     });
    //     it("Should approve to MAX when allowances are utilized", async () => {

    //     })
    // });

    // describe("approveFor()", () => {
    //     it("Should fail when called by non Governer", async () => {

    //     });
    //     it("Should allowed when called by Governer", async () => {

    //     });
    //     it("Should approve to MAX when allowances are utilized", async () => {

    //     });
    // });

    describe("mintTo()", () => {
        // it("Should mint single bAsset", async () => {
        //     await b1.approve(rewardsContract.address, 10, { from: sa.default });
        //     assert((await b1.allowance(sa.default, rewardsContract.address)).eq(new BN(10)));
        //     const bitmap = 1;
        //     const qtyMinted = await rewardsContract.mintTo(bitmap, [10], sa.default, sa.default, { from: sa.default });
        //     assert(qtyMinted.eq(new BN(10)));
        // });

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

            //Expect event
            console.log(txReceipt.logs);
            expectEvent.inLogs(txReceipt.logs, "MintVolumeIncreased", { trancheNumber: new BN(0), mintVolume: new BN(40) });
            //expectEvent.inLogs(txReceipt.logs, "RewardeeMintVolumeIncreased", { trancheNumber: new BN(0), rewardee: sa.default, mintVolume: new BN(40) });


            assert((await masset.balanceOf(sa.default)).eq(new BN(40)));
            assert((await masset.totalSupply()).eq(new BN(40)));

            assert((await b1.balanceOf(masset.address)).eq(new BN(10)));
            assert((await b2.balanceOf(masset.address)).eq(new BN(10)));
            assert((await b3.balanceOf(masset.address)).eq(new BN(10)));
            assert((await b4.balanceOf(masset.address)).eq(new BN(10)));

            //Rewards updated
            let data: any = await rewardsContract.getTrancheData(0);
            let rewardStartTime = await rewardsContract.rewardStartTime();
            //validateTrancheDates(data, rewardStartTime, 0);

            assert(data.totalMintVolume.eq(new BN(40)));
            assert(data.totalRewardUnits.eq(new BN(0)));
            assert(data.unclaimedRewardUnits.eq(new BN(0)));

            //Reward for the user
            data = await rewardsContract.getRewardeesData(0, [sa.default]);
            assert(data.mintVolume[0].eq(new BN(40)));
            assert(data.claimed[0] == false);
            assert(data.rewardAllocation[0].eq(new BN(0)));
            assert(data.redeemed[0] == false);


            //console.log(genTrancheDate(rewardStartTime, 0));
            //genTrancheDate(rewardsContract.rewardStartTime(), 0)

        });
    });

    // describe("claimReward()", () => {

    //     it("User should claim reward", async () => {
    //     });
    // });

    // describe("claimReward() with rewardee", () => {

    //     it("User should claim reward", async () => {
    //     });
    // });

    // describe("redeemReward()", () => {
    //     it("Should redeem reward", () => {

    //     })
    // });

    // describe("fundTranche()", () => {
    //     context("when the Rewards contract deployed", () => {
    //         context("Should fail", async () => {
    //             it("when fundTranche() is called by non governer", async () => {
    //                 //rewardsContract.
    //                 //rewardsContract.fundTranche();
    //             });
    //         });
    //     });
    //     context("getTrancheData()", () => {
    //         it("Should have Tranche data after funding", async () => {

    //         });
    //     });
    // });
});

async function validateTrancheDates(trancheData, rewardStartTime, trancheNumber) {
    let calcDatesData = await genTrancheDate(rewardStartTime, trancheNumber);
    assert(trancheData[0].eq(calcDatesData[0]));
    assert(trancheData[1].eq(calcDatesData[1]));
    assert(trancheData[2].eq(calcDatesData[2]));
    assert(trancheData[3].eq(calcDatesData[3]));
}

async function genTrancheDate(rewardStartTime, trancheNumber) {
    const TRANCHE_PERIOD = 60 * 60 * 24 * 7 * 4; // 4 week
    const CLAIM_PERIOD = 60 * 60 * 24 * 7 * 8;   // 8 weeks
    const LOCKUP_PERIOD = 60 * 60 * 24 * 7 * 52; // 52 weeks
    let trancheData = new Array();
    // startTime
    trancheData[0] = rewardStartTime.add(new BN(trancheNumber)).mul(new BN(TRANCHE_PERIOD));
    // endTime
    trancheData[1] = trancheData[0].add(new BN(TRANCHE_PERIOD));
    // claimEndTime
    trancheData[2] = trancheData[1].add(new BN(CLAIM_PERIOD));
    // unlockTime
    trancheData[3] = trancheData[1].add(new BN());
    return trancheData;
}

async function createMassetWithBassets(numOfBassets) {
    this.systemMachine = new SystemMachine(this.accounts, this.sa.other);
    await this.systemMachine.initialiseMocks();
    const bassetMachine = new BassetMachine(this.sa.default, this.sa.other, 500000);

    // 1. Deploy bAssets
    let bAssets = new Array();
    let bAssetsAddr = new Array();
    let symbols = new Array();
    let weights = new Array();
    let multiplier = new Array();

    const percent = 200 / numOfBassets;// Lets take 200% and divide by total bAssets to create
    var i;
    for (i = 0; i < numOfBassets; i++) {
        bAssets[i] = await bassetMachine.deployERC20Async();
        bAssetsAddr[i] = bAssets[i].address;
        symbols[i] = aToH("bAsset-" + (i + 1));
        weights[i] = percentToWeight(percent);
        multiplier[i] = createMultiple(1); // By Default all ratio 1
    }

    // 2. Masset contract deploy
    this.masset = await Masset.new(
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

}