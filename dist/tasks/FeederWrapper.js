"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("ts-node/register");
require("tsconfig-paths/register");
const config_1 = require("hardhat/config");
const taskUtils_1 = require("./taskUtils");
const generated_1 = require("../types/generated");
const defender_utils_1 = require("./utils/defender-utils");
config_1.task("FeederWrapper.deploy", "Deploy a new FeederWrapper").setAction(async (taskArgs, hre) => {
    const deployer = await defender_utils_1.getSigner(hre.network.name, hre.ethers);
    await taskUtils_1.deployTx(deployer, generated_1.FeederWrapper__factory, "FeederWrapper");
});
config_1.task("FeederWrapper.approveAll", "Sets approvals for a Feeder Pool")
    .addParam("feederWrapper", "FeederWrapper address", undefined, taskUtils_1.params.address, false)
    .addParam("feeder", "Feeder Pool address", undefined, taskUtils_1.params.address, false)
    .addParam("vault", "BoostedVault contract address", undefined, taskUtils_1.params.address, false)
    .addParam("assets", "Asset addresses", undefined, taskUtils_1.params.addressArray, false)
    .setAction(async ({ feederWrapper, feeder, vault, assets }, { ethers, network }) => {
    const deployer = await defender_utils_1.getSigner(network.name, ethers);
    await taskUtils_1.sendTx(generated_1.FeederWrapper__factory.connect(feederWrapper, deployer), "approve(address,address,address[])", "Approve Feeder/Vault and other assets", feeder, vault, assets);
});
config_1.task("FeederWrapper.approveMulti", "Sets approvals for multiple tokens/a single spender")
    .addParam("feederWrapper", "FeederWrapper address", undefined, taskUtils_1.params.address, false)
    .addParam("tokens", "Token addresses", undefined, taskUtils_1.params.address, false)
    .addParam("spender", "Spender address", undefined, taskUtils_1.params.address, false)
    .setAction(async ({ feederWrapper, tokens, spender }, hre) => {
    const deployer = await defender_utils_1.getSigner(hre.network.name, hre.ethers);
    await taskUtils_1.sendTx(generated_1.FeederWrapper__factory.connect(feederWrapper, deployer), "approve(address[],address)", "Approve muliple tokens/single spender", tokens, spender);
});
config_1.task("FeederWrapper.approve", "Sets approvals for a single token/spender")
    .addParam("feederWrapper", "FeederWrapper address", undefined, taskUtils_1.params.address, false)
    .addParam("token", "Token address", undefined, taskUtils_1.params.address, false)
    .addParam("spender", "Spender address", undefined, taskUtils_1.params.address, false)
    .setAction(async ({ feederWrapper, token, spender }, { ethers }) => {
    const [deployer] = await ethers.getSigners();
    await taskUtils_1.sendTx(generated_1.FeederWrapper__factory.connect(feederWrapper, deployer), "approve(address,address)", "Approve single token/spender", token, spender);
});
//# sourceMappingURL=FeederWrapper.js.map