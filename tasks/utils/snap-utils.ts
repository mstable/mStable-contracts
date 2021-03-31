/* eslint-disable import/prefer-default-export */
/* eslint-disable no-console */

import { fullScale } from "@utils/constants"
import { applyRatio, BN } from "@utils/math"
import { Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { Masset, ValidatorWithTVLCap__factory } from "types/generated"

export const snapConfig = async (mAsset: Masset, toBlock: number): Promise<void> => {
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

export const getBasket = async (mAsset: Masset, bAssetSymbols: string[], mAssetName = "mBTC", tvlConfig?: TvlConfig): Promise<void> => {
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
