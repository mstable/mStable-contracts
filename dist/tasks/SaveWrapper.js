"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("ts-node/register");
require("tsconfig-paths/register");
const config_1 = require("hardhat/config");
const taskUtils_1 = require("./taskUtils");
const generated_1 = require("../types/generated");
config_1.task("SaveWrapper.deploy", "Deploy a new SaveWrapper").setAction(async (taskArgs, { ethers }) => {
    const [deployer] = await ethers.getSigners();
    await taskUtils_1.deployTx(deployer, generated_1.SaveWrapper__factory, "SaveWrapper");
});
config_1.task("SaveWrapper.approveMasset", "Sets approvals for a new mAsset")
    .addParam("saveWrapper", "SaveWrapper address", undefined, taskUtils_1.params.address, false)
    .addParam("masset", "mAsset address", undefined, taskUtils_1.params.address, false)
    .addParam("bassets", "bAsset addresses", undefined, taskUtils_1.params.addressArray, false)
    .addParam("fPools", "Feeder Pool addresses", undefined, taskUtils_1.params.addressArray, false)
    .addParam("fAssets", "fAsset addresses (corresponding to fPools)", undefined, taskUtils_1.params.addressArray, false)
    .addParam("save", "Save contract address (i.e. imAsset)", undefined, taskUtils_1.params.address, false)
    .addParam("vault", "BoostedSavingsVault contract address", undefined, taskUtils_1.params.address, false)
    .setAction(async ({ saveWrapper, masset, vault, bassets, fassets, fPools, save, }, { ethers }) => {
    const [deployer] = await ethers.getSigners();
    await taskUtils_1.sendTx(generated_1.SaveWrapper__factory.connect(saveWrapper, deployer), "approve(address,address[],address[],address[],address,address)", "Approve mAsset and other assets", masset, bassets, fPools, fassets, save, vault);
});
config_1.task("SaveWrapper.approveMulti", "Sets approvals for multiple tokens/a single spender")
    .addParam("saveWrapper", "SaveWrapper address", undefined, taskUtils_1.params.address, false)
    .addParam("tokens", "Token addresses", undefined, taskUtils_1.params.address, false)
    .addParam("spender", "Spender address", undefined, taskUtils_1.params.address, false)
    .setAction(async ({ saveWrapper, tokens, spender }, { ethers }) => {
    const [deployer] = await ethers.getSigners();
    await taskUtils_1.sendTx(generated_1.SaveWrapper__factory.connect(saveWrapper, deployer), "approve(address[],address)", "Approve muliple tokens/single spender", tokens, spender);
});
config_1.task("SaveWrapper.approve", "Sets approvals for a single token/spender")
    .addParam("saveWrapper", "SaveWrapper address", undefined, taskUtils_1.params.address, false)
    .addParam("token", "Token address", undefined, taskUtils_1.params.address, false)
    .addParam("spender", "Spender address", undefined, taskUtils_1.params.address, false)
    .setAction(async ({ saveWrapper, token, spender }, { ethers }) => {
    const [deployer] = await ethers.getSigners();
    await taskUtils_1.sendTx(generated_1.SaveWrapper__factory.connect(saveWrapper, deployer), "approve(address,address)", "Approve single token/spender", token, spender);
});
//# sourceMappingURL=SaveWrapper.js.map