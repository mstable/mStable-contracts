"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("ts-node/register");
require("tsconfig-paths/register");
const config_1 = require("hardhat/config");
const constants_1 = require("@utils/constants");
const taskUtils_1 = require("./taskUtils");
const generated_1 = require("../types/generated");
config_1.task("BoostedSavingsVault.deploy", "Deploys a BoostedSavingsVault")
    .addParam("nexus", "Nexus address", undefined, taskUtils_1.params.address, false)
    .addParam("proxyAdmin", "ProxyAdmin address", undefined, taskUtils_1.params.address, false)
    .addParam("rewardsDistributor", "RewardsDistributor address", undefined, taskUtils_1.params.address, false)
    .addParam("stakingToken", "Staking token address", undefined, taskUtils_1.params.address, false)
    .addParam("rewardsToken", "Rewards token address", undefined, taskUtils_1.params.address, false)
    .addParam("vaultName", "Vault name", undefined, config_1.types.string, false)
    .addParam("vaultSymbol", "Vault symbol", undefined, config_1.types.string, false)
    .addParam("boostCoefficient", "Boost coefficient", undefined, config_1.types.string, false)
    .addParam("priceCoefficient", "Price coefficient", undefined, config_1.types.string, false)
    .setAction(async ({ boostCoefficient, nexus, priceCoefficient, proxyAdmin, rewardsDistributor, rewardsToken, vaultName, vaultSymbol, stakingToken, }, { ethers }) => {
    const [deployer] = await ethers.getSigners();
    const implementation = await new generated_1.BoostedSavingsVault__factory(deployer).deploy(nexus, stakingToken, constants_1.DEAD_ADDRESS, priceCoefficient, boostCoefficient, rewardsToken);
    const receipt = await implementation.deployTransaction.wait();
    console.log(`Deployed Vault Implementation to ${implementation.address}. gas used ${receipt.gasUsed}`);
    const data = implementation.interface.encodeFunctionData("initialize", [rewardsDistributor, vaultName, vaultSymbol]);
    const assetProxy = await new generated_1.AssetProxy__factory(deployer).deploy(implementation.address, proxyAdmin, data);
    const assetProxyDeployReceipt = await assetProxy.deployTransaction.wait();
    await new generated_1.BoostedSavingsVault__factory(deployer).attach(assetProxy.address);
    console.log(`Deployed Vault Proxy to ${assetProxy.address}. gas used ${assetProxyDeployReceipt.gasUsed}`);
});
//# sourceMappingURL=deployBoostedSavingsVault.js.map