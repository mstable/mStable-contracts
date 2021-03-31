/* eslint-disable import/prefer-default-export */
/* eslint-disable no-console */

import { fullScale } from "@utils/constants"
import { applyRatio, BN } from "@utils/math"
import { Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { FeederPool, Masset, ValidatorWithTVLCap__factory } from "types/generated"

export const snapConfig = async (mAsset: Masset | FeederPool, toBlock: number): Promise<void> => {
    const ampData = await mAsset.ampData()
    const conf = await mAsset.getConfig({
        blockTag: toBlock,
    })
    console.log(`\nAmplification coefficient (A): current ${formatUnits(conf.a, 2)}`)
    const startDate = new Date(ampData.rampStartTime.toNumber() * 1000)
    const endDate = new Date(ampData.rampEndTime.toNumber() * 1000)
    if (startDate.valueOf() !== endDate.valueOf()) {
        console.log(`Ramp A: initial ${formatUnits(ampData.initialA, 2)}; target ${formatUnits(ampData.targetA, 2)}`)
        console.log(`Ramp A: start ${startDate.toUTCString()}; end ${endDate.toUTCString()}`)
    }
    console.log(`Weights: min ${formatUnits(conf.limits.min, 16)}% max ${formatUnits(conf.limits.max, 16)}%`)
}

export interface TvlConfig {
    startingCap: BN
    capFactor: BN
    invariantValidatorAddress: string
}
const getTvlCap = async (signer: Signer, tvlConfig: TvlConfig): Promise<BN> => {
    const validator = await new ValidatorWithTVLCap__factory(signer).attach(tvlConfig.invariantValidatorAddress)
    const tvlStartTime = await validator.startTime()
    const weeksSinceLaunch = BN.from(Date.now()).div(1000).sub(tvlStartTime).mul(fullScale).div(604800)
    // // e.g. 1e19 + (15e18 * 2.04e36) = 1e19 + 3.06e55
    // // startingCap + (capFactor * weeksSinceLaunch**2 / 1e36);
    return tvlConfig.startingCap.add(tvlConfig.capFactor.mul(weeksSinceLaunch.pow(2)).div(fullScale.pow(2)))
}

export const getBasket = async (
    mAsset: Masset | FeederPool,
    bAssetSymbols: string[],
    mAssetName = "mBTC",
    tvlConfig?: TvlConfig,
): Promise<void> => {
    const bAssets = await mAsset.getBassets()
    const bAssetTotals: BN[] = []
    let bAssetsTotal = BN.from(0)
    bAssetSymbols.forEach((_, i) => {
        const scaledBassetQuantity = applyRatio(bAssets[1][i].vaultBalance, bAssets[1][i].ratio)
        bAssetTotals.push(scaledBassetQuantity)
        bAssetsTotal = bAssetsTotal.add(scaledBassetQuantity)
    })

    console.log(`\n${mAssetName} basket`)
    bAssetSymbols.forEach((symbol, i) => {
        const percentage = bAssetTotals[i].mul(100).div(bAssetsTotal)
        console.log(`  ${symbol.padEnd(7)}  ${formatUnits(bAssetTotals[i]).padEnd(20)} ${percentage.toString().padStart(2)}%`)
    })
    console.log(`Total (K)  ${formatUnits(bAssetsTotal)}`)
    const mAssetSurplus = await mAsset.surplus()
    const mAssetSupply = await mAsset.totalSupply()
    console.log(`Surplus    ${formatUnits(mAssetSurplus)}`)
    console.log(`${mAssetName}       ${formatUnits(mAssetSupply)}`)
    const mAssetTotal = mAssetSupply.add(mAssetSurplus)
    // Sum of base assets less mAsset total supply less mAsset surplus
    const bAssetMassetDiff = bAssetsTotal.sub(mAssetTotal)
    const bAssetMassetDiffBasisPoints = bAssetMassetDiff.mul(10000).div(mAssetTotal)
    console.log(
        `Total ${mAssetName} ${formatUnits(mAssetTotal)} (${formatUnits(
            bAssetMassetDiff,
        )} ${bAssetMassetDiffBasisPoints}bps over collateralize)`,
    )

    if (tvlConfig) {
        const tvlCap = await getTvlCap(mAsset.signer, tvlConfig)
        const tvlCapPercentage = bAssetsTotal.mul(100).div(tvlCap)
        console.log(`TVL cap   ${formatUnits(tvlCap).padStart(21)} ${tvlCapPercentage}%`)
    }
}

// Get mAsset token storage variables
export const dumpTokenStorage = async (token: Masset | FeederPool, toBlock: number): Promise<void> => {
    const override = {
        blockTag: toBlock,
    }
    console.log("\nSymbol: ", (await token.symbol(override)).toString())
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
    console.log("\nForgeValidator : ", (await mAsset.forgeValidator(override)).toString())
    console.log("MaxBassets     : ", (await mAsset.maxBassets(override)).toString())

    // Get basket state
    const basketState = await mAsset.basket(override)
    console.log("UndergoingRecol: ", basketState.undergoingRecol)
    console.log("Failed         : ", basketState.failed)

    const invariantConfig = await mAsset.getConfig(override)
    console.log("A              : ", invariantConfig.a.toString())
    console.log("Min            : ", invariantConfig.limits.min.toString())
    console.log("Max            : ", invariantConfig.limits.max.toString())

    console.log("SwapFee        : ", (await mAsset.swapFee(override)).toString())
    console.log("RedemptionFee  : ", (await mAsset.redemptionFee(override)).toString())
    // console.log("GovFee: ", (await mAsset.redemptionFee(override)).toString())

    console.log("CacheSize      : ", (await mAsset.cacheSize(override)).toString())
    console.log("Surplus        : ", (await mAsset.surplus(override)).toString())
}
