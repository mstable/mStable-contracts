"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("ts-node/register");
require("tsconfig-paths/register");
const config_1 = require("hardhat/config");
const generated_1 = require("types/generated");
const math_1 = require("@utils/math");
const storage_utils_1 = require("./utils/storage-utils");
const snap_utils_1 = require("./utils/snap-utils");
const tokens_1 = require("./utils/tokens");
const quantity_formatters_1 = require("./utils/quantity-formatters");
const rates_utils_1 = require("./utils/rates-utils");
const getBalances = async (mAsset, toBlock, asset) => {
    const mAssetBalance = await mAsset.totalSupply({
        blockTag: toBlock,
    });
    const vaultBalance = await mAsset.balanceOf(asset.vault, {
        blockTag: toBlock,
    });
    const otherBalances = mAssetBalance.sub(vaultBalance);
    console.log("\nHolders");
    console.log(`Vault                      ${quantity_formatters_1.usdFormatter(vaultBalance)} ${vaultBalance.mul(100).div(mAssetBalance)}%`);
    console.log(`Others                     ${quantity_formatters_1.usdFormatter(otherBalances)} ${otherBalances.mul(100).div(mAssetBalance)}%`);
    console.log(`Total                      ${quantity_formatters_1.usdFormatter(mAssetBalance)}`);
    return {
        total: mAssetBalance,
        save: vaultBalance,
        earn: math_1.BN.from(0),
    };
};
const getFeederPool = (signer, contractAddress) => {
    const linkedAddress = {
        // FeederManager
        __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: "0x90aE544E8cc76d2867987Ee4f5456C02C50aBd8B",
        // FeederLogic
        __$7791d1d5b7ea16da359ce352a2ac3a881c$__: "0x2837C77527c37d61D9763F53005211dACB4125dE",
    };
    const feederPoolFactory = new generated_1.FeederPool__factory(linkedAddress, signer);
    return feederPoolFactory.attach(contractAddress);
};
const getQuantities = (fAsset, _swapSize) => {
    let quantityFormatter;
    let swapSize;
    if (fAsset.quantityFormatter === "USD") {
        quantityFormatter = quantity_formatters_1.usdFormatter;
        swapSize = _swapSize || 10000;
    }
    else if (fAsset.quantityFormatter === "BTC") {
        quantityFormatter = quantity_formatters_1.btcFormatter;
        swapSize = _swapSize || 1;
    }
    return {
        quantityFormatter,
        swapSize,
    };
};
config_1.task("feeder-storage", "Dumps feeder contract storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, config_1.types.int)
    .addParam("fasset", "Token symbol of the feeder pool asset.  eg HBTC, TBTC, GUSD or BUSD", undefined, config_1.types.string, false)
    .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;
    const fAsset = tokens_1.tokens.find((t) => t.symbol === taskArgs.fasset);
    if (!fAsset) {
        console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`);
        process.exit(1);
    }
    const { blockNumber } = await snap_utils_1.getBlock(ethers, taskArgs.block);
    const [signer] = await ethers.getSigners();
    const pool = getFeederPool(signer, fAsset.feederPool);
    await storage_utils_1.dumpTokenStorage(pool, blockNumber);
    await storage_utils_1.dumpFassetStorage(pool, blockNumber);
    await storage_utils_1.dumpConfigStorage(pool, blockNumber);
});
config_1.task("feeder-snap", "Gets feeder transactions over a period of time")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12146627, config_1.types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, config_1.types.int)
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, TBTC, GUSD or BUSD", undefined, config_1.types.string, false)
    .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;
    const [signer] = await ethers.getSigners();
    const { fromBlock, toBlock } = await snap_utils_1.getBlockRange(ethers, taskArgs.from, taskArgs.to);
    const fAsset = tokens_1.tokens.find((t) => t.symbol === taskArgs.fasset);
    if (!fAsset) {
        console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`);
        process.exit(1);
    }
    console.log(`\nGetting snap for feeder pool ${fAsset.symbol} from block ${fromBlock.blockNumber}, to ${toBlock.blockNumber}`);
    const mAsset = tokens_1.tokens.find((t) => t.symbol === fAsset.parent);
    const fpAssets = [mAsset, fAsset];
    const feederPool = getFeederPool(signer, fAsset.feederPool);
    const savingsManager = snap_utils_1.getSavingsManager(signer, hre.network.name);
    const { quantityFormatter } = getQuantities(fAsset, taskArgs.swapSize);
    const mintSummary = await snap_utils_1.getMints(tokens_1.tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter);
    const mintMultiSummary = await snap_utils_1.getMultiMints(tokens_1.tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter);
    const swapSummary = await snap_utils_1.getSwaps(tokens_1.tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter);
    const redeemSummary = await snap_utils_1.getRedemptions(tokens_1.tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter);
    const redeemMultiSummary = await snap_utils_1.getMultiRedemptions(tokens_1.tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter);
    await snap_utils_1.snapConfig(feederPool, toBlock.blockNumber);
    await snap_utils_1.getBasket(feederPool, fpAssets.map((b) => b.symbol), mAsset.symbol, quantity_formatters_1.usdFormatter, toBlock.blockNumber);
    const balances = await getBalances(feederPool, toBlock.blockNumber, fAsset);
    const collectedInterestSummary = await snap_utils_1.getCollectedInterest(fpAssets, feederPool, savingsManager, fromBlock, toBlock, quantityFormatter, balances.save);
    snap_utils_1.outputFees(mintSummary, mintMultiSummary, swapSummary, redeemSummary, redeemMultiSummary, balances, fromBlock.blockTime, toBlock.blockTime, quantityFormatter);
});
config_1.task("feeder-rates", "Feeder rate comparison to Curve")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, config_1.types.int)
    .addOptionalParam("swapSize", "Swap size to compare rates with Curve", undefined, config_1.types.float)
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, TBTC, GUSD or BUSD", undefined, config_1.types.string, false)
    .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;
    const [signer] = await ethers.getSigners();
    const block = await snap_utils_1.getBlock(ethers, taskArgs.block);
    const fAsset = tokens_1.tokens.find((t) => t.symbol === taskArgs.fasset);
    if (!fAsset) {
        console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`);
        process.exit(1);
    }
    console.log(`\nGetting rates for feeder pool ${fAsset.symbol} at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`);
    const feederPool = getFeederPool(signer, fAsset.feederPool);
    const mAsset = tokens_1.tokens.find((t) => t.symbol === fAsset.parent);
    const fpAssets = [mAsset, fAsset];
    // Get the bAssets for the main pool. eg bAssets in mUSD or mBTC
    // These are the assets that are not feeder pools and parent matches the fAsset's parent
    const mpAssets = tokens_1.tokens.filter((t) => t.parent === fAsset.parent && !t.feederPool);
    const { quantityFormatter, swapSize } = getQuantities(fAsset, taskArgs.swapSize);
    console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$");
    await rates_utils_1.getSwapRates(fpAssets, fpAssets, feederPool, block.blockNumber, quantityFormatter, hre.network.name, swapSize);
    await rates_utils_1.getSwapRates([fAsset], mpAssets, feederPool, block.blockNumber, quantityFormatter, hre.network.name, swapSize);
    await rates_utils_1.getSwapRates(mpAssets, [fAsset], feederPool, block.blockNumber, quantityFormatter, hre.network.name, swapSize);
    await snap_utils_1.snapConfig(feederPool, block.blockNumber);
});
module.exports = {};
//# sourceMappingURL=feeder.js.map