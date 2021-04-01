/* eslint-disable no-restricted-syntax */
/* eslint-disable import/prefer-default-export */
/* eslint-disable no-console */

import { Signer } from "ethers"
import { fullScale, ONE_YEAR } from "@utils/constants"
import { applyDecimals, applyRatio, BN } from "@utils/math"
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

// Only the FeederPool has the redeemProportionately function
function isFeederPool(asset: Masset | FeederPool): asset is FeederPool {
    return (asset as FeederPool).redeemProportionately !== undefined
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

export const snapConfig = async (asset: Masset | FeederPool, toBlock: number): Promise<void> => {
    let ampData
    if (isFeederPool(asset)) {
        const fpData = await asset.data()
        ampData = fpData.ampData
    } else {
        ampData = await asset.ampData()
    }
    const conf = await asset.getConfig({
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
    asset: Masset | FeederPool,
    bAssetSymbols: string[],
    mAssetName = "mBTC",
    quantityFormatter: QuantityFormatter,
    tvlConfig?: TvlConfig,
): Promise<void> => {
    const bAssets = await asset.getBassets()
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
    console.log(`Total (K)  ${formatUnits(bAssetsTotal)}`)

    const mAssetSurplus = isFeederPool(asset) ? BN.from(0) : await asset.surplus()
    const mAssetSupply = await asset.totalSupply()
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
        const tvlCap = await getTvlCap(asset.signer, tvlConfig)
        const tvlCapPercentage = bAssetsTotal.mul(100).div(tvlCap)
        console.log(`TVL cap   ${quantityFormatter(tvlCap)} ${tvlCapPercentage}%`)
    }
}

export const getMints = async (
    bAssets: Token[],
    mAsset: Masset | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    const filter = await mAsset.filters.Minted(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log("\nMints")
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = bAssets.find((b) => b.address === log.args.input)
        if (!inputBasset) {
            throw Error(`Failed to find bAsset with address ${log.args.input}`)
        }
        // mAssetQuantity is for Masset. output is for FeederPool
        const quantity = log.args.mAssetQuantity || log.args.output
        console.log(`${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)} ${quantityFormatter(quantity)}`)
        total = total.add(quantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`)
    return {
        count,
        total,
        fees: BN.from(0),
    }
}

export const getMultiMints = async (
    bAssets: Token[],
    mAsset: Masset | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    const filter = await mAsset.filters.MintedMulti(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log("\nMulti Mints")
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        // Ignore nMintMulti events from collectInterest and collectPlatformInterest
        if (!log.args.inputs.length) return
        const inputBassets = log.args.inputs.map((input) => bAssets.find((b) => b.address === input))
        // mAssetQuantity is for Masset. output is for FeederPool
        const quantity = log.args.mAssetQuantity || log.args.output
        console.log(`${log.blockNumber} ${log.transactionHash} ${quantityFormatter(quantity)}`)
        inputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(4)} ${quantityFormatter(log.args.inputQuantities[i], bAsset.decimals)}`)
        })
        total = total.add(quantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`)
    return {
        count,
        total,
        fees: BN.from(0),
    }
}

export const getSwaps = async (
    bAssets: Token[],
    mAsset: Masset | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    const filter = await mAsset.filters.Swapped(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log("\nSwaps")
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Input Output     Quantity      Fee")
    // Scaled bAsset quantities
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = bAssets.find((b) => b.address === log.args.input)
        const outputBasset = bAssets.find((b) => b.address === log.args.output)
        const fee = log.args.scaledFee || log.args.fee
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)}  ${outputBasset.symbol.padEnd(
                4,
            )} ${quantityFormatter(log.args.outputAmount, outputBasset.decimals)} ${quantityFormatter(fee, 18, 8)}`,
        )
        total = total.add(applyDecimals(log.args.outputAmount, outputBasset.decimals))
        fees = fees.add(fee)
        count += 1
    })
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`)

    return {
        count,
        total,
        fees,
    }
}

export const getRedemptions = async (
    bAssets: Token[],
    mAsset: Masset | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    const filter = await mAsset.filters.Redeemed(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log("\nRedemptions")
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity      Fee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBasset = bAssets.find((b) => b.address === log.args.output)
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${outputBasset.symbol.padEnd(4)} ${quantityFormatter(
                log.args.mAssetQuantity,
            )} ${quantityFormatter(log.args.scaledFee, 18, 8)}`,
        )
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`)

    return {
        count,
        total,
        fees,
    }
}

export const getMultiRedemptions = async (
    bAssets: Token[],
    mAsset: Masset | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    const filter = await mAsset.filters.RedeemedMulti(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log("\nMulti Redemptions")
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity      Fee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBassets = log.args.outputs.map((output) => bAssets.find((b) => b.address === output))
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${quantityFormatter(log.args.mAssetQuantity)} ${quantityFormatter(
                log.args.scaledFee,
                18,
                8,
            )}`,
        )
        outputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(4)} ${quantityFormatter(log.args.outputQuantity[i], bAsset.decimals)}`)
        })
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`)

    return {
        count,
        total,
        fees,
    }
}

export const outputFees = (
    mints: TxSummary,
    multiMints: TxSummary,
    swaps: TxSummary,
    redeems: TxSummary,
    multiRedeems: TxSummary,
    balances: Balances,
    startTime: Date,
    endTime: Date,
    quantityFormatter: QuantityFormatter,
): void => {
    const totalFees = redeems.fees.add(multiRedeems.fees).add(swaps.fees)
    if (totalFees.eq(0)) {
        console.log(`\nNo fees since ${startTime.toUTCString()}`)
        return
    }
    const totalTransactions = mints.total.add(multiMints.total).add(redeems.total).add(multiRedeems.total).add(swaps.total)
    const totalFeeTransactions = redeems.total.add(multiRedeems.total).add(swaps.total)
    console.log(`\nFees since ${startTime.toUTCString()}`)
    console.log("              #          Volume      Fees    %")
    console.log(
        `Mints         ${mints.count.toString().padEnd(2)} ${quantityFormatter(mints.total)} ${quantityFormatter(
            mints.fees,
            18,
            9,
        )} ${mints.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Multi Mints   ${multiMints.count.toString().padEnd(2)} ${quantityFormatter(multiMints.total)} ${quantityFormatter(
            multiMints.fees,
            18,
            9,
        )} ${multiMints.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Redeems       ${redeems.count.toString().padEnd(2)} ${quantityFormatter(redeems.total)} ${quantityFormatter(
            redeems.fees,
            18,
            9,
        )} ${redeems.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Multi Redeems ${multiRedeems.count.toString().padEnd(2)} ${quantityFormatter(multiRedeems.total)} ${quantityFormatter(
            multiRedeems.fees,
            18,
            9,
        )} ${multiRedeems.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Swaps         ${swaps.count.toString().padEnd(2)} ${quantityFormatter(swaps.total)} ${quantityFormatter(
            swaps.fees,
            18,
            9,
        )} ${swaps.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    const periodSeconds = BN.from(endTime.valueOf() - startTime.valueOf()).div(1000)
    const liquidityUtilization = totalFeeTransactions.mul(100).div(balances.total)
    const totalApy = totalFees.mul(100).mul(ONE_YEAR).div(balances.save).div(periodSeconds)
    console.log(`Total Txs        ${quantityFormatter(totalTransactions)}`)
    console.log(`Savings          ${quantityFormatter(balances.save)} ${quantityFormatter(totalFees, 18, 9)} APY ${totalApy}%`)
    console.log(
        `${liquidityUtilization}% liquidity utilization  (${quantityFormatter(totalFeeTransactions)} of ${quantityFormatter(
            balances.total,
        )} mAssets)`,
    )
}
