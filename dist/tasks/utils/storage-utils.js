"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dumpFeederDataStorage = exports.dumpConfigStorage = exports.dumpFassetStorage = exports.dumpBassetStorage = exports.dumpTokenStorage = void 0;
// Get mAsset token storage variables
const dumpTokenStorage = async (token, toBlock) => {
    const override = {
        blockTag: toBlock,
    };
    console.log("\nSymbol  : ", (await token.symbol(override)).toString());
    console.log("Name    : ", (await token.name(override)).toString());
    console.log("Decimals: ", (await token.decimals(override)).toString());
    console.log("Supply  : ", (await token.totalSupply(override)).toString());
};
exports.dumpTokenStorage = dumpTokenStorage;
// Get bAsset storage variables
const dumpBassetStorage = async (mAsset, toBlock) => {
    const override = {
        blockTag: toBlock,
    };
    console.log("\nbAssets");
    const bAssets = await mAsset.getBassets(override);
    bAssets.personal.forEach(async (personal, i) => {
        console.log(`bAsset with index ${i}`);
        console.log(` Address    :`, personal.addr.toString());
        console.log(` Integration:`, personal.integrator.toString());
        console.log(` Tx fee     :`, personal.hasTxFee.toString());
        console.log(` Status     :`, personal.status.toString());
        console.log("\n");
    });
};
exports.dumpBassetStorage = dumpBassetStorage;
// Get fAsset storage variables
const dumpFassetStorage = async (pool, toBlock) => {
    const override = {
        blockTag: toBlock,
    };
    console.log("\nbAssets");
    const fAssets = await pool.getBassets(override);
    fAssets.forEach(async (_, i) => {
        console.log(`bAsset with index ${i}`);
        console.log(` Address    :`, fAssets[0][i].addr.toString());
        console.log(` Integration:`, fAssets[0][i].integrator.toString());
        console.log(` Tx fee     :`, fAssets[0][i].hasTxFee.toString());
        console.log(` Status     :`, fAssets[0][i].status.toString());
        console.log(` Ratio      :`, fAssets[1][i].ratio.toString());
        console.log(` Vault      :`, fAssets[1][i].vaultBalance.toString());
        console.log("\n");
    });
};
exports.dumpFassetStorage = dumpFassetStorage;
// Get Masset storage variables
const dumpConfigStorage = async (mAsset, toBlock) => {
    const override = {
        blockTag: toBlock,
    };
    const invariantConfig = await mAsset.getConfig(override);
    console.log("A              : ", invariantConfig.a.toString());
    console.log("Min            : ", invariantConfig.limits.min.toString());
    console.log("Max            : ", invariantConfig.limits.max.toString());
};
exports.dumpConfigStorage = dumpConfigStorage;
// Get Masset storage variables
const dumpFeederDataStorage = async (pool, toBlock) => {
    const override = {
        blockTag: toBlock,
    };
    const feederData = await pool.data(override);
    console.log("SwapFee        : ", feederData.swapFee.toString());
    console.log("RedemptionFee  : ", feederData.redemptionFee.toString());
    console.log("GovFee         : ", feederData.govFee.toString());
    console.log("pendingFees    : ", feederData.pendingFees.toString());
    console.log("CacheSize      : ", feederData.cacheSize.toString());
};
exports.dumpFeederDataStorage = dumpFeederDataStorage;
//# sourceMappingURL=storage-utils.js.map