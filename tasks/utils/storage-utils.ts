/* eslint-disable import/prefer-default-export */
/* eslint-disable no-console */

import { FeederPool, Masset } from "types/generated"

// Get mAsset token storage variables
export const dumpTokenStorage = async (token: Masset | FeederPool, toBlock: number): Promise<void> => {
    const override = {
        blockTag: toBlock,
    }
    console.log("\nSymbol  : ", (await token.symbol(override)).toString())
    console.log("Name    : ", (await token.name(override)).toString())
    console.log("Decimals: ", (await token.decimals(override)).toString())
    console.log("Supply  : ", (await token.totalSupply(override)).toString())
}

// Get bAsset storage variables
export const dumpBassetStorage = async (mAsset: Masset, toBlock: number): Promise<void> => {
    const override = {
        blockTag: toBlock,
    }

    console.log("\nbAssets")
    const bAssets = await mAsset.getBassets(override)
    bAssets.forEach(async (_, i) => {
        console.log(`bAsset with index ${i}`)
        console.log(` Address    :`, bAssets.personal[i].addr.toString())
        console.log(` Integration:`, bAssets.personal[i].integrator.toString())
        console.log(` Tx fee     :`, bAssets.personal[i].hasTxFee.toString())
        console.log(` Status     :`, bAssets.personal[i].status.toString())
        console.log(` Ratio      :`, bAssets.data[i].ratio.toString())
        console.log(` Vault      :`, bAssets.data[i].vaultBalance.toString())
        console.log("\n")
    })

    console.log("\nForgeValidator : ", (await mAsset.forgeValidator(override)).toString())
    console.log("MaxBassets     : ", (await mAsset.maxBassets(override)).toString())

    // Get basket state
    const basketState = await mAsset.basket(override)
    console.log("UndergoingRecol: ", basketState.undergoingRecol)
    console.log("Failed         : ", basketState.failed)

    console.log("CacheSize      : ", (await mAsset.cacheSize(override)).toString())

    console.log("SwapFee        : ", (await mAsset.swapFee(override)).toString())
    console.log("RedemptionFee  : ", (await mAsset.redemptionFee(override)).toString())
    // console.log("GovFee: ", (await mAsset.redemptionFee(override)).toString())

    console.log("Surplus        : ", (await mAsset.surplus(override)).toString())
}

// Get fAsset storage variables
export const dumpFassetStorage = async (pool: FeederPool, toBlock: number): Promise<void> => {
    const override = {
        blockTag: toBlock,
    }

    console.log("\nbAssets")
    const fAssets = await pool.getBassets(override)
    fAssets.forEach(async (_, i) => {
        console.log(`bAsset with index ${i}`)
        console.log(` Address    :`, fAssets[0][i].addr.toString())
        console.log(` Integration:`, fAssets[0][i].integrator.toString())
        console.log(` Tx fee     :`, fAssets[0][i].hasTxFee.toString())
        console.log(` Status     :`, fAssets[0][i].status.toString())
        console.log(` Ratio      :`, fAssets[1][i].ratio.toString())
        console.log(` Vault      :`, fAssets[1][i].vaultBalance.toString())
        console.log("\n")
    })
}

// Get Masset storage variables
export const dumpConfigStorage = async (mAsset: Masset | FeederPool, toBlock: number): Promise<void> => {
    const override = {
        blockTag: toBlock,
    }

    const invariantConfig = await mAsset.getConfig(override)
    console.log("A              : ", invariantConfig.a.toString())
    console.log("Min            : ", invariantConfig.limits.min.toString())
    console.log("Max            : ", invariantConfig.limits.max.toString())
}

// Get Masset storage variables
export const dumpFeederDataStorage = async (pool: FeederPool, toBlock: number): Promise<void> => {
    const override = {
        blockTag: toBlock,
    }

    const feederData = await pool.data(override)

    console.log("SwapFee        : ", feederData.swapFee.toString())
    console.log("RedemptionFee  : ", feederData.redemptionFee.toString())
    console.log("GovFee         : ", feederData.govFee.toString())
    console.log("pendingFees    : ", feederData.pendingFees.toString())

    console.log("CacheSize      : ", feederData.cacheSize.toString())
}
