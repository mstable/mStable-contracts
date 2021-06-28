"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("ts-node/register");
require("tsconfig-paths/register");
const config_1 = require("hardhat/config");
const generated_1 = require("types/generated");
const MusdEth__factory_1 = require("types/generated/factories/MusdEth__factory");
const math_1 = require("@utils/math");
const uniswap_1 = require("@utils/peripheral/uniswap");
const defender_utils_1 = require("./utils/defender-utils");
const deploy_utils_1 = require("./utils/deploy-utils");
const tokens_1 = require("./utils/tokens");
// mStable contracts
const nexusAddress = "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3";
// Aave contracts
const lendingPoolAddressProviderAddress = "0xb53c1a33016b2dc2ff3653530bff1848a515c8c5";
// Also called Incentives Controller
const aaveRewardControllerAddress = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5";
// Reward token
const stkAaveTokenAddress = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";
config_1.task("deployAaveIntegration", "Deploys an instance of AaveV2Integration contract").setAction(async (_, hre) => {
    const { ethers, network } = hre;
    const [deployer] = await ethers.getSigners();
    if (network.name !== "mainnet")
        throw Error("Invalid network");
    const addresses = {
        mAsset: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
        nexus: "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3",
        aave: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
        aaveToken: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    };
    // Deploy
    const impl = await new generated_1.AaveV2Integration__factory(deployer).deploy(addresses.nexus, addresses.mAsset, addresses.aave, addresses.aaveToken);
    const reciept = await impl.deployTransaction.wait();
    console.log(`Deployed Integration to ${impl.address}. gas used ${reciept.gasUsed}`);
    // Complete setup
    //  - Set pToken addresses via governance
});
config_1.task("deployPAaveIntegration", "Deploys mUSD and mBTC instances of PAaveIntegration").setAction(async (_, hre) => {
    const { ethers, network } = hre;
    const deployer = network.name === "mainnet" ? await defender_utils_1.getDefenderSigner() : (await ethers.getSigners())[0];
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
    // Deploy
    const mUsdPAaveIntegration = await deploy_utils_1.deployContract(new generated_1.PAaveIntegration__factory(deployer), "PAaveIntegration for mUSD", [nexusAddress, mUsdAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress]);
    let tx = await mUsdPAaveIntegration.initialize([daiAddress, usdtAddress, sUsdAddress], [aDaiAddress, aUsdtAddress, asUsdAddress]);
    await deploy_utils_1.logTxDetails(tx, "mUsdPAaveIntegration.initialize");
    const mBtcPAaveIntegration = await deploy_utils_1.deployContract(new generated_1.PAaveIntegration__factory(deployer), "PAaveIntegration for mBTC", [nexusAddress, mBtcAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress]);
    tx = await mBtcPAaveIntegration.initialize([wBtcAddress], [aWBtcAddress]);
    await deploy_utils_1.logTxDetails(tx, "mBtcPAaveIntegration.initialize");
    const approveRewardTokenData = mUsdPAaveIntegration.interface.encodeFunctionData("approveRewardToken");
    console.log(`\napproveRewardToken data: ${approveRewardTokenData}`);
    const mBtc = await MusdEth__factory_1.MusdEth__factory.connect(mBtcAddress, deployer);
    const mUsd = await MusdEth__factory_1.MusdEth__factory.connect(mUsdAddress, deployer);
    console.log(`\nGovernor tx data`);
    const mBtcMigrateWbtcData = mBtc.interface.encodeFunctionData("migrateBassets", [[wBtcAddress], mBtcPAaveIntegration.address]);
    console.log(`mBTC migrateBassets WBTC data: ${mBtcMigrateWbtcData}`);
    const mUsdMigrateDaiData = mUsd.interface.encodeFunctionData("migrateBassets", [[daiAddress], mUsdPAaveIntegration.address]);
    console.log(`mUSD migrateBassets DAI data: ${mUsdMigrateDaiData}`);
    const mUsdMigrateUsdtData = mUsd.interface.encodeFunctionData("migrateBassets", [[usdtAddress], mUsdPAaveIntegration.address]);
    console.log(`mUSD migrateBassets USDT data: ${mUsdMigrateUsdtData}`);
    const mUsdMigrateSusdData = mUsd.interface.encodeFunctionData("migrateBassets", [[sUsdAddress], mUsdPAaveIntegration.address]);
    console.log(`mUSD migrateBassets sUSD data: ${mUsdMigrateSusdData}`);
});
config_1.task("deployFPAaveIntegration", "Deploys mUSD feeder pool instances of PAaveIntegration").setAction(async (_, hre) => {
    const { ethers, network } = hre;
    const deployer = network.name === "mainnet" ? await defender_utils_1.getDefenderSigner() : (await ethers.getSigners())[0];
    // fpAssets
    const bUsdFpAddress = "0xfE842e95f8911dcc21c943a1dAA4bd641a1381c6";
    const gUsdFpAddress = "0x4fB30C5A3aC8e85bC32785518633303C4590752d";
    // fAssets
    const bUsdAddress = "0x4Fabb145d64652a948d72533023f6E7A623C7C53";
    const gUsdAddress = "0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd";
    // Aave aTokens
    const abUsdAddress = "0xA361718326c15715591c299427c62086F69923D9";
    const agUsdAddress = "0xD37EE7e4f452C6638c96536e68090De8cBcdb583";
    // Deploy
    const bUsdPAaveIntegration = await deploy_utils_1.deployContract(new generated_1.PAaveIntegration__factory(deployer), "PAaveIntegration for BUSD Feeder Pool", [nexusAddress, bUsdFpAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress]);
    let tx = await bUsdPAaveIntegration.initialize([bUsdAddress], [abUsdAddress]);
    await deploy_utils_1.logTxDetails(tx, "bUsdPAaveIntegration.initialize");
    const gUsdPAaveIntegration = await deploy_utils_1.deployContract(new generated_1.PAaveIntegration__factory(deployer), "PAaveIntegration for GUSD Feeder Pool", [nexusAddress, gUsdFpAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress]);
    tx = await gUsdPAaveIntegration.initialize([gUsdAddress], [agUsdAddress]);
    await deploy_utils_1.logTxDetails(tx, "gUsdPAaveIntegration.initialize");
    const approveRewardTokenData = bUsdPAaveIntegration.interface.encodeFunctionData("approveRewardToken");
    console.log(`\napproveRewardToken data: ${approveRewardTokenData}`);
    const bUsdFp = await generated_1.FeederPool__factory.connect(bUsdFpAddress, deployer);
    const gUsdFp = await generated_1.FeederPool__factory.connect(gUsdFpAddress, deployer);
    console.log(`\nGovernor tx data`);
    const bUsdMigrateWbtcData = bUsdFp.interface.encodeFunctionData("migrateBassets", [[bUsdAddress], bUsdPAaveIntegration.address]);
    console.log(`Feeder Pool migrateBassets BUSD data: ${bUsdMigrateWbtcData}`);
    const gUsdMigrateDaiData = gUsdFp.interface.encodeFunctionData("migrateBassets", [[gUsdAddress], gUsdPAaveIntegration.address]);
    console.log(`Feeder Pool migrateBassets GUSD data: ${gUsdMigrateDaiData}`);
});
config_1.task("deployLiquidator", "Deploys new Liquidator contract").setAction(async (_, hre) => {
    const { ethers, network } = hre;
    const signer = network.name === "mainnet" ? await defender_utils_1.getDefenderSigner() : (await ethers.getSigners())[0];
    const liquidatorAddress = "0xe595D67181D701A5356e010D9a58EB9A341f1DbD";
    const delayedAdminAddress = "0x5c8eb57b44c1c6391fc7a8a0cf44d26896f92386";
    const uniswapRouterV3Address = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
    const uniswapQuoterV3Address = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
    const uniswapEthToken = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const aaveMusdIntegrationAddress = "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E";
    const aaveMbtcIntegrationAddress = "0xC9451a4483d1752a3E9A3f5D6b1C7A6c34621fC6";
    const delayedProxyAdmin = generated_1.DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer);
    // Deploy the new implementation
    const liquidatorImpl = await deploy_utils_1.deployContract(new generated_1.Liquidator__factory(signer), "Liquidator", [
        nexusAddress,
        tokens_1.stkAAVE.address,
        tokens_1.AAVE.address,
        uniswapRouterV3Address,
        uniswapQuoterV3Address,
        tokens_1.COMP.address,
    ]);
    // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
    const upgradeData = liquidatorImpl.interface.encodeFunctionData("upgrade");
    const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
        liquidatorAddress,
        liquidatorImpl.address,
        upgradeData,
    ]);
    console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`);
    const liquidator = generated_1.Liquidator__factory.connect(liquidatorAddress, signer);
    // Output tx data for createLiquidation of Aave for mUSD
    const uniswapAaveUsdcPath = uniswap_1.encodeUniswapPath([tokens_1.AAVE.address, uniswapEthToken, tokens_1.USDC.address], [3000, 3000]);
    const musdData = liquidator.interface.encodeFunctionData("createLiquidation", [
        aaveMusdIntegrationAddress,
        tokens_1.AAVE.address,
        tokens_1.USDC.address,
        uniswapAaveUsdcPath.encoded,
        uniswapAaveUsdcPath.encodedReversed,
        0,
        math_1.simpleToExactAmount(50, tokens_1.USDC.decimals),
        tokens_1.mUSD.address,
        true,
    ]);
    console.log(`\ncreateLiquidation of Aave from mUSD to ${liquidatorAddress}, data:\n${musdData}`);
    // Output tx data for createLiquidation of Aave for mBTC
    const uniswapAaveWbtcPath = uniswap_1.encodeUniswapPath([tokens_1.AAVE.address, uniswapEthToken, tokens_1.WBTC.address], [3000, 3000]);
    const mbtcData = liquidator.interface.encodeFunctionData("createLiquidation", [
        aaveMbtcIntegrationAddress,
        tokens_1.AAVE.address,
        tokens_1.WBTC.address,
        uniswapAaveWbtcPath.encoded,
        uniswapAaveWbtcPath.encodedReversed,
        0,
        math_1.simpleToExactAmount(2, tokens_1.WBTC.decimals - 3),
        tokens_1.mBTC.address,
        true,
    ]);
    console.log(`\ncreateLiquidation of Aave from mBTC to ${liquidatorAddress}, data:\n${mbtcData}`);
});
module.exports = {};
//# sourceMappingURL=deployAaveIntegration.js.map