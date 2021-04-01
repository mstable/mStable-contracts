/* eslint-disable no-restricted-syntax */
/* eslint-disable import/prefer-default-export */
/* eslint-disable no-console */

import { Signer } from "ethers"
import { fullScale } from "@utils/constants"
import { applyRatio, BN } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { FeederPool, Masset, ValidatorWithTVLCap__factory } from "types/generated"
import { QuantityFormatter } from "./quantity-formatters"
import { Token } from "./tokens"

export interface TxSummary {
    count: number
    total: BN
    fees: BN
}
export interface Balances {
    total: BN
    save: BN
    earn: BN
}

export interface BlockInfo {
    blockNumber: number
    blockTime: Date
}

export interface BlockRange {
    fromBlock: BlockInfo
    toBlock: BlockInfo
}
export interface SwapRate {
    inputToken: Token
    inputAmountRaw: BN
    outputToken: Token
    mOutputRaw: BN
    curveOutputRaw: BN
    curveInverseOutputRaw: BN
}

export const getBlock = async (ethers, _blockNumber?: number): Promise<BlockInfo> => {
    const blockNumber = _blockNumber || (await ethers.provider.getBlockNumber())
    const toBlock = await ethers.provider.getBlock(blockNumber)
    const blockTime = new Date(toBlock.timestamp * 1000)

    return {
        blockNumber,
        blockTime,
    }
}

export const getBlockRange = async (ethers, fromBlockNumber: number, _toBlockNumber?: number): Promise<BlockRange> => {
    const toBlockNumber = _toBlockNumber || (await ethers.provider.getBlockNumber())
    // const toBlock = await ethers.provider.getBlock(toBlockNumber)
    // const endTime = new Date(toBlock.timestamp * 1000)
    const toBlock = await getBlock(ethers, _toBlockNumber)
    const fromBlock = await getBlock(ethers, fromBlockNumber)
    console.log(
        `Between blocks ${
            fromBlock.blockNumber
        } and ${toBlockNumber}. ${fromBlock.blockTime.toUTCString()} and ${toBlock.blockTime.toUTCString()}`,
    )

    return {
        fromBlock,
        toBlock,
    }
}

export const snapConfig = async (mAsset: Masset | FeederPool, toBlock: number): Promise<void> => {
    let ampData
    if (mAsset.redeemProportionately) {
        const fpData = await (mAsset as FeederPool).data()
        ampData = fpData.ampData
    } else {
        ampData = await (mAsset as Masset).ampData()
    }
    const conf = await mAsset.getConfig({
        blockTag: toBlock,
    })
    console.log(`\nAmplification coefficient (A): ${formatUnits(conf.a, 2)}`)
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
    quantityFormatter: QuantityFormatter,
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
        console.log(`  ${symbol.padEnd(7)}  ${quantityFormatter(bAssetTotals[i]).padEnd(20)} ${percentage.toString().padStart(2)}%`)
    })
    console.log(`Total (K)  ${quantityFormatter(bAssetsTotal)}`)
    const mAssetSurplus = await mAsset.surplus()
    const mAssetSupply = await mAsset.totalSupply()
    console.log(`Surplus    ${quantityFormatter(mAssetSurplus)}`)
    console.log(`${mAssetName}       ${quantityFormatter(mAssetSupply)}`)
    const mAssetTotal = mAssetSupply.add(mAssetSurplus)
    // Sum of base assets less mAsset total supply less mAsset surplus
    const bAssetMassetDiff = bAssetsTotal.sub(mAssetTotal)
    const bAssetMassetDiffBasisPoints = bAssetMassetDiff.mul(10000).div(mAssetTotal)
    console.log(
        `Total ${mAssetName} ${quantityFormatter(mAssetTotal)} (${quantityFormatter(
            bAssetMassetDiff,
        )} ${bAssetMassetDiffBasisPoints}bps over collateralize)`,
    )

    if (tvlConfig) {
        const tvlCap = await getTvlCap(mAsset.signer, tvlConfig)
        const tvlCapPercentage = bAssetsTotal.mul(100).div(tvlCap)
        console.log(`TVL cap   ${quantityFormatter(tvlCap).padStart(21)} ${tvlCapPercentage}%`)
    }
}
