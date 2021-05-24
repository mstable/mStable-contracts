import { FeederPool, Masset } from "types/generated"
import { MusdEth } from "types/generated/MusdEth"

// Get mAsset token storage variables
export const dumpTokenStorage = async (token: Masset | MusdEth | FeederPool, toBlock: number): Promise<void> => {
    const override = {
        blockTag: toBlock,
    }
    console.log("\nSymbol  : ", (await token.symbol(override)).toString())
    console.log("Name    : ", (await token.name(override)).toString())
    console.log("Decimals: ", (await token.decimals(override)).toString())
    console.log("Supply  : ", (await token.totalSupply(override)).toString())
}

// Get bAsset storage variables
export const dumpBassetStorage = async (mAsset: Masset | MusdEth, toBlock: number): Promise<void> => {
    const override = {
        blockTag: toBlock,
    }

    console.log("\nbAssets")
    const bAssets = await mAsset.getBassets(override)
    bAssets.personal.forEach(async (personal, i) => {
        console.log(`bAsset with index ${i}`)
        console.log(` Address    :`, personal.addr.toString())
        console.log(` Integration:`, personal.integrator.toString())
        console.log(` Tx fee     :`, personal.hasTxFee.toString())
        console.log(` Status     :`, personal.status.toString())
        console.log("\n")
    })
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
export const dumpConfigStorage = async (mAsset: Masset | MusdEth | FeederPool, toBlock: number): Promise<void> => {
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
