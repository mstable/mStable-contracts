"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
require("ts-node/register");
require("tsconfig-paths/register");
const config_1 = require("hardhat/config");
const ethers_1 = require("ethers");
const generated_1 = require("types/generated");
const math_1 = require("@utils/math");
const mUsdEth_json_1 = __importDefault(require("../contracts/masset/versions/mUsdEth.json"));
const storage_utils_1 = require("./utils/storage-utils");
const snap_utils_1 = require("./utils/snap-utils");
const tokens_1 = require("./utils/tokens");
const quantity_formatters_1 = require("./utils/quantity-formatters");
const rates_utils_1 = require("./utils/rates-utils");
const utils_1 = require("./utils");
const mUsdBassets = [tokens_1.sUSD, tokens_1.USDC, tokens_1.DAI, tokens_1.USDT];
const mUsdPolygonBassets = [tokens_1.PUSDC, tokens_1.PDAI, tokens_1.PUSDT];
const getMasset = (signer, networkName) => {
    if (networkName === "polygon_mainnet") {
        return generated_1.Masset__factory.connect("0xE840B73E5287865EEc17d250bFb1536704B43B21", signer);
    }
    if (networkName === "polygon_testnet") {
        return generated_1.Masset__factory.connect("0x0f7a5734f208A356AB2e5Cf3d02129c17028F3cf", signer);
    }
    if (networkName === "ropsten") {
        return new ethers_1.Contract("0x4E1000616990D83e56f4b5fC6CC8602DcfD20459", mUsdEth_json_1.default, signer);
    }
    return new ethers_1.Contract("0xe2f2a5C287993345a840Db3B0845fbC70f5935a5", mUsdEth_json_1.default, signer);
};
config_1.task("mUSD-storage", "Dumps mUSD's storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, config_1.types.int)
    .setAction(async (taskArgs, { ethers, network }) => {
    const signer = await utils_1.getSigner(network.name, ethers);
    const toBlockNumber = taskArgs.to ? taskArgs.to : await ethers.provider.getBlockNumber();
    console.log(`Block number ${toBlockNumber}`);
    const mAsset = getMasset(signer, network.name);
    await storage_utils_1.dumpTokenStorage(mAsset, toBlockNumber);
    await storage_utils_1.dumpBassetStorage(mAsset, toBlockNumber);
    await storage_utils_1.dumpConfigStorage(mAsset, toBlockNumber);
});
config_1.task("mUSD-snap", "Snaps mUSD")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12094461, config_1.types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, config_1.types.int)
    .setAction(async (taskArgs, { ethers, network }) => {
    const signer = await utils_1.getSigner(network.name, ethers);
    let exposedValidator;
    if (!["mainnet", "polygon_mainnet"].includes(network.name)) {
        console.log("Not a mainnet chain");
        const LogicFactory = await ethers.getContractFactory("MassetLogic");
        const logicLib = await LogicFactory.deploy();
        const linkedAddress = {
            libraries: {
                MassetLogic: logicLib.address,
            },
        };
        const massetFactory = await ethers.getContractFactory("ExposedMassetLogic", linkedAddress);
        exposedValidator = await massetFactory.deploy();
    }
    const mAsset = getMasset(signer, network.name);
    const savingsManager = snap_utils_1.getSavingsManager(signer, network.name);
    const { fromBlock, toBlock } = await snap_utils_1.getBlockRange(ethers, taskArgs.from, taskArgs.to);
    const bAssets = network.name.includes("polygon") ? mUsdPolygonBassets : mUsdBassets;
    let accounts = [];
    if (network.name === "mainnet") {
        accounts = [
            {
                name: "imUSD",
                address: "0x30647a72dc82d7fbb1123ea74716ab8a317eac19",
            },
            {
                name: "Iron Bank",
                address: "0xbe86e8918dfc7d3cb10d295fc220f941a1470c5c",
            },
            {
                name: "Curve mUSD",
                address: "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6",
            },
            {
                name: "mStable DAO",
                address: "0x3dd46846eed8D147841AE162C8425c08BD8E1b41",
            },
            {
                name: "Balancer ETH/mUSD 50/50 #2",
                address: "0xe036cce08cf4e23d33bc6b18e53caf532afa8513",
            },
        ];
    }
    else if (network.name === "polygon_mainnet") {
        accounts = [
            {
                name: "imUSD",
                address: "0x5290Ad3d83476CA6A2b178Cd9727eE1EF72432af",
            },
        ];
    }
    const mintSummary = await snap_utils_1.getMints(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, quantity_formatters_1.usdFormatter);
    const mintMultiSummary = await snap_utils_1.getMultiMints(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, quantity_formatters_1.usdFormatter);
    const swapSummary = await snap_utils_1.getSwaps(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, quantity_formatters_1.usdFormatter);
    const redeemSummary = await snap_utils_1.getRedemptions(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, quantity_formatters_1.usdFormatter);
    const redeemMultiSummary = await snap_utils_1.getMultiRedemptions(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, quantity_formatters_1.usdFormatter);
    await snap_utils_1.snapConfig(mAsset, toBlock.blockNumber);
    await snap_utils_1.getBasket(mAsset, bAssets.map((b) => b.symbol), "mUSD", quantity_formatters_1.usdFormatter, toBlock.blockNumber, undefined, exposedValidator);
    const balances = await snap_utils_1.getBalances(mAsset, accounts, quantity_formatters_1.usdFormatter, toBlock.blockNumber);
    const collectedInterestSummary = await snap_utils_1.getCollectedInterest(bAssets, mAsset, savingsManager, fromBlock, toBlock, quantity_formatters_1.usdFormatter, balances.save);
    await snap_utils_1.getCompTokens(signer, toBlock);
    await snap_utils_1.getAaveTokens(signer, toBlock);
    await snap_utils_1.snapSave(signer, network.name, toBlock.blockNumber);
    snap_utils_1.outputFees(mintSummary, mintMultiSummary, swapSummary, redeemSummary, redeemMultiSummary, balances, fromBlock.blockTime, toBlock.blockTime, quantity_formatters_1.usdFormatter);
});
config_1.task("mUSD-rates", "mUSD rate comparison to Curve")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, config_1.types.int)
    .addOptionalParam("swapSize", "Swap size to compare rates with Curve", 10000, config_1.types.int)
    .setAction(async (taskArgs, { ethers, network }) => {
    const signer = await utils_1.getSigner(network.name, ethers);
    const mAsset = await getMasset(signer, network.name);
    const block = await snap_utils_1.getBlock(ethers, taskArgs.block);
    console.log(`\nGetting rates for mUSD at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`);
    const bAssets = network.name.includes("polygon") ? mUsdPolygonBassets : mUsdBassets;
    console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$");
    await rates_utils_1.getSwapRates(bAssets, bAssets, mAsset, block.blockNumber, quantity_formatters_1.usdFormatter, network.name, math_1.BN.from(taskArgs.swapSize));
    await snap_utils_1.snapConfig(mAsset, block.blockNumber);
});
config_1.task("rewards", "Get Compound and Aave platform reward tokens")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, config_1.types.int)
    .setAction(async (taskArgs, { ethers, network }) => {
    const signer = await utils_1.getSigner(network.name, ethers);
    const block = await snap_utils_1.getBlock(ethers, taskArgs.block);
    console.log(`\nGetting platform tokens at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`);
    await snap_utils_1.getCompTokens(signer, block);
    await snap_utils_1.getAaveTokens(signer, block);
});
module.exports = {};
//# sourceMappingURL=mUSD.js.map