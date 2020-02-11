

import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BigNumber } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ERC20MockInstance, MassetInstance, ForgeRewardsMUSDContract, ForgeRewardsMUSDInstance } from "types/generated";

const MassetArtifact = artifacts.require("Masset");
const ForgeRewardsMUSD = artifacts.require("ForgeRewardsMUSD");

envSetup.configure();
const { expect, assert } = chai;

contract("Rewards", async (accounts) => {
    const BN = web3.utils.BN;
    const sa = new StandardAccounts(accounts);
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
        masset = await MassetArtifact.new(
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

        //3. Deploy ForgeRewardsMUSD
        rewardsContract = await ForgeRewardsMUSD.new(
            masset.address,
            systemMachine.systok.address,
            sa.governor,
            { from: sa.governor }
        );
    });

    describe("Contract deployed", async () => {
        it("Should have valid parameters", async () => {
            assert((await rewardsContract.mUSD()) == masset.address);
            assert((await rewardsContract.MTA()) == systemMachine.systok.address);
            assert((await rewardsContract.governor()) == sa.governor);
        });
        it("Should approved all bAsset tokens to max", async () => {
            let MAX: BN = ((new BN(2)).pow(new BN(256))).sub(new BN(1));
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
            let data = await rewardsContract.getTrancheData(0);
            console.log(data);
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
            const qtyMinted = await rewardsContract.mintTo(
                bitmap,
                [10, 10, 10, 10],
                sa.default,
                sa.default,
                { from: sa.default }
            );
            //console.log(qtyMinted.receipt.log[0]);
            //assert(qtyMinted.eq(new BN(40)));
            assert((await masset.balanceOf(sa.default)).eq(new BN(40)));
            assert((await masset.totalSupply()).eq(new BN(40)));

            assert((await b1.balanceOf(masset.address)).eq(new BN(10)));
            assert((await b2.balanceOf(masset.address)).eq(new BN(10)));
            assert((await b3.balanceOf(masset.address)).eq(new BN(10)));
            assert((await b4.balanceOf(masset.address)).eq(new BN(10)));

            //Rewards updated
            let data: any = await rewardsContract.getTrancheData(0);

            assert(data.totalMintVolume.eq(new BN(40)));
            assert(data.totalRewardUnits.eq(new BN(0)));
            assert(data.unclaimedRewardUnits.eq(new BN(0)));

            //Reward for the user
            data = await rewardsContract.getRewardeesData(0, [sa.default]);
            console.log(data);
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

// async function mintBassets(numberOfBassets, qtyPerBassetToMint) {
//     //await b1.approve(rewardsContract.address, 10, { from: sa.default });
// }