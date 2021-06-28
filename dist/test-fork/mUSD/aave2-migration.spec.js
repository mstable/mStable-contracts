"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const units_1 = require("@ethersproject/units");
const constants_1 = require("@utils/constants");
const fork_1 = require("@utils/fork");
const math_1 = require("@utils/math");
const time_1 = require("@utils/time");
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const deploy_utils_1 = require("tasks/utils/deploy-utils");
const generated_1 = require("types/generated");
const MusdEth__factory_1 = require("types/generated/factories/MusdEth__factory");
const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2";
const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84";
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const wbtcWhaleAddress = "0x6daB3bCbFb336b29d06B9C793AEF7eaA57888922";
const daiWhaleAddress = "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be";
const sUsdWhaleAddress = "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be";
const usdtWhaleAddress = "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be";
const nexusAddress = "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3";
const lendingPoolAddressProviderAddress = "0xb53c1a33016b2dc2ff3653530bff1848a515c8c5";
// Also called Incentives Controller
const aaveRewardControllerAddress = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5";
const liquidatorAddress = "0xe595D67181D701A5356e010D9a58EB9A341f1DbD";
const oldAaveIntegrationAddress = "0xB9b0cfa90436C3FcBf8d8eb6Ed8d0c2e3da47CA9";
const compoundIntegrationAddress = "0xd55684f4369040c12262949ff78299f2bc9db735";
// Reward token
const stkAaveTokenAddress = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";
// mAssets
const mUsdAddress = "0xe2f2a5c287993345a840db3b0845fbc70f5935a5";
const mBtcAddress = "0x945Facb997494CC2570096c74b5F66A3507330a1";
// bAssets
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdtAddress = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const sUsdAddress = "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51";
const wBtcAddress = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
// Aave aTokens
const aDaiAddress = "0x028171bCA77440897B824Ca71D1c56caC55b68A3";
const aUsdtAddress = "0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811";
const asUsdAddress = "0x6C5024Cd4F8A59110119C56f8933403A539555EB";
const aWBtcAddress = "0x9ff58f4fFB29fA2266Ab25e75e2A8b3503311656";
// Compound cTokens
const cDaiAddress = "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643";
const safeInfinity = math_1.BN.from(2).pow(256).sub(1);
context("DAI and WBTC migration to integration that can claim stkAave", () => {
    let governor;
    let deployer;
    let ethWhale;
    let wbtcWhale;
    let daiWhale;
    let sUsdWhale;
    let usdtWhale;
    let mUsd;
    let mBtc;
    let stkAave;
    let wbtc;
    let dai;
    let usdt;
    let susd;
    let mUsdPAaveIntegration;
    let mBtcPAaveIntegration;
    let aaveIncentivesController;
    before("reset block number", async () => {
        await hardhat_1.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 12416000,
                    },
                },
            ],
        });
        deployer = await fork_1.impersonate(deployerAddress);
        governor = await fork_1.impersonate(governorAddress);
        ethWhale = await fork_1.impersonate(ethWhaleAddress);
        wbtcWhale = await fork_1.impersonate(wbtcWhaleAddress);
        daiWhale = await fork_1.impersonate(daiWhaleAddress);
        sUsdWhale = await fork_1.impersonate(sUsdWhaleAddress);
        usdtWhale = await fork_1.impersonate(usdtWhaleAddress);
        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: math_1.simpleToExactAmount(10),
        });
        mUsd = await MusdEth__factory_1.MusdEth__factory.connect(mUsdAddress, deployer);
        mBtc = await MusdEth__factory_1.MusdEth__factory.connect(mBtcAddress, deployer);
        wbtc = await generated_1.IERC20__factory.connect(wBtcAddress, deployer);
        dai = await generated_1.IERC20__factory.connect(daiAddress, deployer);
        usdt = await generated_1.IERC20__factory.connect(usdtAddress, deployer);
        susd = await generated_1.IERC20__factory.connect(sUsdAddress, deployer);
        stkAave = await generated_1.IERC20__factory.connect(stkAaveTokenAddress, governor);
        aaveIncentivesController = await generated_1.IAaveIncentivesController__factory.connect(aaveRewardControllerAddress, governor);
        // whales approve spending by mAssets
        await dai.connect(daiWhale).approve(mUsdAddress, math_1.simpleToExactAmount(1000));
        await susd.connect(sUsdWhale).approve(mUsdAddress, math_1.simpleToExactAmount(1000));
        await usdt.connect(usdtWhale).approve(mUsdAddress, math_1.simpleToExactAmount(1000, 6));
        await wbtc.connect(wbtcWhale).approve(mBtcAddress, math_1.simpleToExactAmount(100, 8));
    });
    it("Test connectivity", async () => {
        const currentBlock = await hardhat_1.ethers.provider.getBlockNumber();
        console.log(`Current block ${currentBlock}`);
        const startEther = await deployer.getBalance();
        console.log(`Deployer ${deployerAddress} has ${startEther} Ether`);
    });
    it("deploy and initialize Aave integration for mUSD", async () => {
        mUsdPAaveIntegration = await deploy_utils_1.deployContract(new generated_1.PAaveIntegration__factory(deployer), "Aave Integration for mUSD", [nexusAddress, mUsdAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress]);
        chai_1.expect(mUsdPAaveIntegration.address).to.length(42);
        await mUsdPAaveIntegration.initialize([daiAddress, usdtAddress, sUsdAddress], [aDaiAddress, aUsdtAddress, asUsdAddress]);
    });
    it("deploy and initialize Aave integration for mBTC", async () => {
        mBtcPAaveIntegration = await deploy_utils_1.deployContract(new generated_1.PAaveIntegration__factory(deployer), "Aave Integration for mBTC", [nexusAddress, mBtcAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress]);
        chai_1.expect(mBtcPAaveIntegration.address).to.length(42);
        await mBtcPAaveIntegration.initialize([wBtcAddress], [aWBtcAddress]);
    });
    it("Governor approves Liquidator to spend the reward (stkAave) tokens", async () => {
        chai_1.expect(await stkAave.allowance(mUsdPAaveIntegration.address, liquidatorAddress)).to.eq(0);
        chai_1.expect(await stkAave.allowance(mBtcPAaveIntegration.address, liquidatorAddress)).to.eq(0);
        // This will be done via the delayedProxyAdmin on mainnet
        await mUsdPAaveIntegration.connect(governor).approveRewardToken();
        await mBtcPAaveIntegration.connect(governor).approveRewardToken();
        chai_1.expect(await stkAave.allowance(mUsdPAaveIntegration.address, liquidatorAddress)).to.eq(safeInfinity);
        chai_1.expect(await stkAave.allowance(mBtcPAaveIntegration.address, liquidatorAddress)).to.eq(safeInfinity);
    });
    context("WBTC in mBTC", () => {
        it("No stkAave rewards before migration", async () => {
            chai_1.expect(await aaveIncentivesController.getRewardsBalance([aWBtcAddress], mBtcPAaveIntegration.address), "No stkAave for WBTC yet").to.eq(0);
        });
        it("Migrate WBTC from mBTC to Aave", async () => {
            // Before migration checks
            const wbtcMigrationAmount = await wbtc.balanceOf(mBtcAddress);
            const wbtcBalInATokenBefore = await wbtc.balanceOf(aWBtcAddress);
            chai_1.expect(wbtcMigrationAmount, "Over 100 WBTC in mBTC").to.gt(math_1.simpleToExactAmount(100, 8));
            const { data: bAssetDataBefore } = await mBtc.getBasset(wBtcAddress);
            chai_1.expect(bAssetDataBefore.vaultBalance).to.eq(wbtcMigrationAmount);
            // Migrate WBTC in mBTC to new PAaveIntegration contract
            const tx = await mBtc.connect(governor).migrateBassets([wBtcAddress], mBtcPAaveIntegration.address);
            console.log(`WBTC migrateBassets tx data: ${tx.data}`);
            // Post migration checks
            chai_1.expect(await wbtc.balanceOf(mBtcPAaveIntegration.address), "All WBTC in mBTC migrated to PAaveIntegration").to.eq(wbtcMigrationAmount);
            chai_1.expect(await wbtc.balanceOf(mBtcAddress), "No more WBTC in mBTC").to.eq(0);
            chai_1.expect(await wbtc.balanceOf(aWBtcAddress), "WBTC not deposited to aToken Aave, yet").to.eq(wbtcBalInATokenBefore);
            // Check mBTC vault balance has not changed
            const { data: bAssetDataAfter } = await mBtc.getBasset(wBtcAddress);
            chai_1.expect(bAssetDataBefore.vaultBalance, "Before and after mBTC WBTC vault balances").to.eq(bAssetDataAfter.vaultBalance);
        });
        it("Mint some mBTC using 10 WBTC", async () => {
            const { data: wbtcDataBefore } = await mBtc.getBasset(wBtcAddress);
            // WBTC whale mints mBTC using 10 WBTC
            const mintAmount = math_1.simpleToExactAmount(10, 8);
            await mBtc.connect(wbtcWhale).mint(wBtcAddress, mintAmount, 0, wbtcWhaleAddress);
            const { data: wbtcDataAfter } = await mBtc.getBasset(wBtcAddress);
            chai_1.expect(wbtcDataAfter.vaultBalance, "Vault balances").to.eq(wbtcDataBefore.vaultBalance.add(mintAmount));
        });
        it("Move ahead 1 day and claimed stkAave", async () => {
            // Move the blockchain time ahead 1 day
            await time_1.increaseTime(constants_1.ONE_DAY.toNumber());
            // Before claim
            chai_1.expect(await aaveIncentivesController.getRewardsBalance([aWBtcAddress], mBtcPAaveIntegration.address), "mBTC Aave integrator has accrued stkAave for WBTC before claim").to.gt(0);
            chai_1.expect(await stkAave.balanceOf(mBtcPAaveIntegration.address), "mBTC Aave integrator has no stkAave before claim").to.eq(0);
            // Anyone can claim the rewards using the mBTC Integration
            const tx = mBtcPAaveIntegration.connect(ethWhale).claimRewards();
            await chai_1.expect(tx).to.emit(mBtcPAaveIntegration, "RewardsClaimed");
            // After claim
            chai_1.expect(await aaveIncentivesController.getRewardsBalance([aWBtcAddress], mBtcPAaveIntegration.address), "mBTC Aave integrator has no accrued stkAave after claim").to.eq(0);
            chai_1.expect(await stkAave.balanceOf(mBtcPAaveIntegration.address), "mBTC Aave integrator has stkAave after claim").to.gt(0);
        });
        it("Redeem 9 WBTC from mBTC", async () => {
            const { data: wbtcDataBefore } = await mBtc.getBasset(wBtcAddress);
            const wbtcAmount = math_1.simpleToExactAmount(9, 8);
            await mBtc.connect(wbtcWhale).redeemExactBassets([wBtcAddress], [wbtcAmount], math_1.simpleToExactAmount(10), wbtcWhaleAddress);
            const { data: wbtcDataAfter } = await mBtc.getBasset(wBtcAddress);
            chai_1.expect(wbtcDataAfter.vaultBalance, "Vault balances").to.eq(wbtcDataBefore.vaultBalance.sub(wbtcAmount));
        });
    });
    context("DAI in mUSD", () => {
        it("Migrate DAI from Compound to Aave", async () => {
            // Before migration checks
            const daiBalInATokenBefore = await dai.balanceOf(aDaiAddress);
            const daiBalInCTokenBefore = await dai.balanceOf(cDaiAddress);
            const { data: bAssetDataBefore } = await mUsd.getBasset(daiAddress);
            const daiMigrationAmount = bAssetDataBefore.vaultBalance;
            chai_1.expect(daiMigrationAmount, "Over 11m DAI in mUSD").to.gt(math_1.simpleToExactAmount(11000000));
            console.log(`DAI to be migrated ${units_1.formatUnits(daiMigrationAmount)}`);
            // All mUSD's DAI is in Compound's cDai or cached in Compound integration contract
            chai_1.expect(await dai.balanceOf(oldAaveIntegrationAddress), "No DAI in old Aave integration before").to.eq(0);
            const daiCachedInCompoundIntegrationBefore = await dai.balanceOf(compoundIntegrationAddress);
            console.log(`${units_1.formatUnits(daiCachedInCompoundIntegrationBefore)} DAI cached in Compound Integration before`);
            chai_1.expect(daiCachedInCompoundIntegrationBefore, "> 100k DAI cached in mUSD Compound integration before").to.gt(math_1.simpleToExactAmount(100000));
            chai_1.expect(await dai.balanceOf(cDaiAddress), "> 700m DAI in cDAI").to.gt(math_1.simpleToExactAmount(700, 24));
            chai_1.expect(await dai.balanceOf(mUsdAddress), "No DAI in mUSD before").to.eq(0);
            chai_1.expect(await dai.balanceOf(oldAaveIntegrationAddress), "No DAI in old Aave Integration before").to.eq(0);
            chai_1.expect(await dai.balanceOf(mUsdPAaveIntegration.address), "No DAI in new PAaveIntegration before").to.eq(0);
            // Migrate DAI in mUSD from old Aave V2 Integration to new PAaveIntegration contract
            const tx = await mUsd.connect(governor).migrateBassets([daiAddress], mUsdPAaveIntegration.address);
            console.log(`DAI migrateBassets tx data: ${tx.data}`);
            // All DAI in mUSD should have moved to the PAaveIntegration contract
            chai_1.expect(await dai.balanceOf(oldAaveIntegrationAddress), "No DAI in old Aave Integration after").to.eq(0);
            chai_1.expect(await dai.balanceOf(compoundIntegrationAddress), "No DAI cached in mUSD Compound integration").to.eq(0);
            chai_1.expect(await dai.balanceOf(mUsdAddress), "No DAI in mUSD after").to.eq(0);
            const daiCachedInAaveIntegrationAfter = await dai.balanceOf(mUsdPAaveIntegration.address);
            const daiBalInATokenAfter = await dai.balanceOf(aDaiAddress);
            const daiBalInCTokenAfter = await dai.balanceOf(cDaiAddress);
            // DAI in aToken after - aToken before + Aave integration after = cToken before - cToken after + Compound integration before
            chai_1.expect(daiBalInATokenAfter.sub(daiBalInATokenBefore).add(daiCachedInAaveIntegrationAfter), "No DAI was lost").to.eq(daiBalInCTokenBefore.sub(daiBalInCTokenAfter).add(daiCachedInCompoundIntegrationBefore));
            const { data: bAssetDataAfter } = await mUsd.getBasset(daiAddress);
            chai_1.expect(bAssetDataBefore.vaultBalance, "Before and after mUSD DAI vault balances").to.eq(bAssetDataAfter.vaultBalance);
        });
        it("Swap 10 DAI for USDT", async () => {
            const { data: daiDataBefore } = await mUsd.getBasset(daiAddress);
            // whale swaps 10 DAI for USDT
            const swapAmount = math_1.simpleToExactAmount(10);
            await mUsd.connect(daiWhale).swap(daiAddress, usdtAddress, swapAmount, 0, daiWhaleAddress);
            const { data: daiDataAfter } = await mUsd.getBasset(daiAddress);
            chai_1.expect(daiDataAfter.vaultBalance, "DAI Vault balances").to.eq(daiDataBefore.vaultBalance.add(swapAmount));
        });
        it("Swap 10 USDT for DAI", async () => {
            // whale swaps 10 USDT for DAI
            const swapAmount = math_1.simpleToExactAmount(10, 6);
            await mUsd.connect(usdtWhale).swap(usdtAddress, daiAddress, swapAmount, 0, usdtWhaleAddress);
        });
    });
    context("USDT in mUSD", () => {
        it("Migrate USDT from old Aave to new Aave", async () => {
            // Before migration checks
            const usdtBalInATokenBefore = await usdt.balanceOf(aUsdtAddress);
            const { data: bAssetDataBefore } = await mUsd.getBasset(usdtAddress);
            const usdtMigrationAmount = bAssetDataBefore.vaultBalance;
            chai_1.expect(usdtMigrationAmount, "Over 11m USDT in mUSD").to.gt(math_1.simpleToExactAmount(11000000, 6));
            console.log(`USDT to be migrated ${units_1.formatUnits(usdtMigrationAmount, 6)}`);
            // All mUSD's USDT is in Aave's aUSDT or cached in old Aave integration contract
            const usdtCachedInOldIntegrationBefore = await usdt.balanceOf(oldAaveIntegrationAddress);
            console.log(`${units_1.formatUnits(usdtCachedInOldIntegrationBefore, 6)} USDT cached in old Aave Integration before `);
            chai_1.expect(usdtCachedInOldIntegrationBefore, "> 50k USDT cached in old Aave integration before").to.gt(math_1.simpleToExactAmount(50000, 6));
            chai_1.expect(await usdt.balanceOf(aUsdtAddress), "> 70m USDT in aUSDT before").to.gt(math_1.simpleToExactAmount(70, 12));
            chai_1.expect(await usdt.balanceOf(mUsdAddress), "No USDT in mUSD before").to.eq(0);
            chai_1.expect(await usdt.balanceOf(mUsdPAaveIntegration.address), "No USDT in new PAaveIntegration before").to.eq(0);
            // Migrate USDT in mUSD from old Aave V2 Integration to new PAaveIntegration contract
            const tx = await mUsd.connect(governor).migrateBassets([usdtAddress], mUsdPAaveIntegration.address);
            console.log(`USDT migrateBassets tx data: ${tx.data}`);
            // All USDT in mUSD should have moved to the PAaveIntegration contract
            chai_1.expect(await usdt.balanceOf(oldAaveIntegrationAddress), "No USDT in old Aave Integration after").to.eq(0);
            chai_1.expect(await usdt.balanceOf(mUsdAddress), "No USDT in mUSD after").to.eq(0);
            const usdtCachedInAaveIntegrationAfter = await usdt.balanceOf(mUsdPAaveIntegration.address);
            const usdtBalInATokenAfter = await usdt.balanceOf(aUsdtAddress);
            console.log(`usdtBalInATokenAfter ${usdtBalInATokenAfter}`);
            console.log(`usdtCachedInAaveIntegrationAfter ${usdtCachedInAaveIntegrationAfter}`);
            console.log(`usdtBalInATokenBefore ${usdtBalInATokenBefore}`);
            console.log(`usdtCachedInOldIntegrationBefore ${usdtCachedInOldIntegrationBefore}`);
            // USDT in aToken after + new Aave integration after = aToken before + old Aave integration before
            chai_1.expect(usdtBalInATokenAfter.add(usdtCachedInAaveIntegrationAfter), "No USDT was lost").to.eq(usdtBalInATokenBefore.add(usdtCachedInOldIntegrationBefore));
            const { data: bAssetDataAfter } = await mUsd.getBasset(usdtAddress);
            chai_1.expect(bAssetDataBefore.vaultBalance, "Before and after mUSD USDT vault balances").to.eq(bAssetDataAfter.vaultBalance);
        });
        it("Swap 10 sUSD for USDT", async () => {
            const { data: sUsdDataBefore } = await mUsd.getBasset(sUsdAddress);
            // whale swaps 10 sUSD for USDT
            const swapAmount = math_1.simpleToExactAmount(10);
            await mUsd.connect(daiWhale).swap(sUsdAddress, usdtAddress, swapAmount, 0, sUsdWhaleAddress);
            const { data: sUsdDataAfter } = await mUsd.getBasset(sUsdAddress);
            chai_1.expect(sUsdDataAfter.vaultBalance, "DAI Vault balances").to.eq(sUsdDataBefore.vaultBalance.add(swapAmount));
        });
        it("Swap 10 USDT for sUSD", async () => {
            const swapAmount = math_1.simpleToExactAmount(10, 6);
            await mUsd.connect(usdtWhale).swap(usdtAddress, sUsdAddress, swapAmount, 0, usdtWhaleAddress);
        });
    });
    context("sUSD in mUSD", () => {
        it("Migrate sUSD from old Aave to new Aave", async () => {
            // Before migration checks
            const sUsdBalInATokenBefore = await susd.balanceOf(sUsdAddress);
            const { data: bAssetDataBefore } = await mUsd.getBasset(sUsdAddress);
            const sUsdMigrationAmount = bAssetDataBefore.vaultBalance;
            chai_1.expect(sUsdMigrationAmount, "Over 2m sUSD in mUSD").to.gt(math_1.simpleToExactAmount(2000000));
            console.log(`sUSD to be migrated ${units_1.formatUnits(sUsdMigrationAmount, 6)}`);
            // All mUSD's sUSD is in Aave's asUSD or cached in old Aave integration contract
            const sUsdCachedInOldIntegrationBefore = await susd.balanceOf(oldAaveIntegrationAddress);
            console.log(`${units_1.formatUnits(sUsdCachedInOldIntegrationBefore, 6)} sUSD cached in old Aave Integration before `);
            chai_1.expect(sUsdCachedInOldIntegrationBefore, "> 2k sUSD cached in old Aave integration before").to.gt(math_1.simpleToExactAmount(2000));
            chai_1.expect(await susd.balanceOf(asUsdAddress), "> 10m sUSD in asUSD before").to.gt(math_1.simpleToExactAmount(10, 12));
            chai_1.expect(await susd.balanceOf(mUsdAddress), "No sUSD in mUSD before").to.eq(0);
            chai_1.expect(await susd.balanceOf(mUsdPAaveIntegration.address), "No sUSD in new PAaveIntegration before").to.eq(0);
            // Migrate sUSD and sUSD in mUSD from old Aave V2 Integration to new PAaveIntegration contract
            const tx = await mUsd.connect(governor).migrateBassets([sUsdAddress], mUsdPAaveIntegration.address);
            console.log(`sUSD and sUSD migrateBassets tx data: ${tx.data}`);
            // All sUSD in mUSD should have moved to the PAaveIntegration contract
            chai_1.expect(await susd.balanceOf(oldAaveIntegrationAddress), "No sUSD in old Aave Integration after").to.eq(0);
            chai_1.expect(await susd.balanceOf(mUsdAddress), "No sUSD in mUSD after").to.eq(0);
            const susdCachedInAaveIntegrationAfter = await susd.balanceOf(mUsdPAaveIntegration.address);
            const susdBalInATokenAfter = await susd.balanceOf(asUsdAddress);
            console.log(`susdBalInATokenAfter ${susdBalInATokenAfter}`);
            console.log(`susdCachedInAaveIntegrationAfter ${susdCachedInAaveIntegrationAfter}`);
            console.log(`susdBalInATokenBefore ${sUsdBalInATokenBefore}`);
            console.log(`susdCachedInOldIntegrationBefore ${sUsdCachedInOldIntegrationBefore}`);
            // sUSD in aToken after + new Aave integration after = aToken before + old Aave integration before
            chai_1.expect(susdBalInATokenAfter.add(susdCachedInAaveIntegrationAfter), "No sUSD was lost").to.eq(sUsdBalInATokenBefore.add(sUsdCachedInOldIntegrationBefore));
            const { data: bAssetDataAfter } = await mUsd.getBasset(sUsdAddress);
            chai_1.expect(bAssetDataBefore.vaultBalance, "Before and after mUSD sUSD vault balances").to.eq(bAssetDataAfter.vaultBalance);
        });
        it("Swap 10 sUSD for USDT", async () => {
            const { data: sUsdDataBefore } = await mUsd.getBasset(sUsdAddress);
            // whale swaps 10 sUSD for USDT
            const swapAmount = math_1.simpleToExactAmount(10);
            await mUsd.connect(daiWhale).swap(sUsdAddress, usdtAddress, swapAmount, 0, sUsdWhaleAddress);
            const { data: sUsdDataAfter } = await mUsd.getBasset(sUsdAddress);
            chai_1.expect(sUsdDataAfter.vaultBalance, "DAI Vault balances").to.eq(sUsdDataBefore.vaultBalance.add(swapAmount));
        });
        it("Swap 10 USDT for sUSD", async () => {
            const swapAmount = math_1.simpleToExactAmount(10, 6);
            await mUsd.connect(usdtWhale).swap(usdtAddress, sUsdAddress, swapAmount, 0, usdtWhaleAddress);
        });
    });
});
//# sourceMappingURL=aave2-migration.spec.js.map