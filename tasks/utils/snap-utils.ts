/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { Signer } from "ethers"
import { fullScale, ONE_YEAR } from "@utils/constants"
import { applyDecimals, applyRatio, BN } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import {
    ExposedMassetLogic,
    FeederPool,
    Masset,
    MV1,
    MV2,
    SavingsContract__factory,
    SavingsManager,
    SavingsManager__factory,
    ValidatorWithTVLCap__factory,
} from "types/generated"
import { MusdEth } from "types/generated/MusdEth"
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
export function isFeederPool(asset: Masset | MV1 | MV2 | MusdEth | FeederPool): asset is FeederPool {
    return (asset as FeederPool).redeemProportionately !== undefined
}

// Only the mUSD deployed to Ethereum mainnet has the surplus function
export function isMusdEth(asset: Masset | MV1 | MV2 | MusdEth | FeederPool): asset is MusdEth {
    return (asset as MusdEth).surplus !== undefined
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

export const getSavingsManager = (signer: Signer, networkName: string): SavingsManager => {
    if (networkName === "polygon_mainnet") {
        return SavingsManager__factory.connect("0x10bFcCae079f31c451033798a4Fd9D2c33Ea5487", signer)
    }
    return SavingsManager__factory.connect("0x9781C4E9B9cc6Ac18405891DF20Ad3566FB6B301", signer)
}

export const snapConfig = async (asset: Masset | MusdEth | FeederPool, toBlock: number): Promise<void> => {
    let ampData
    if (isMusdEth(asset)) {
        ampData = await asset.ampData()
    } else {
        const fpData = await asset.data()
        ampData = fpData.ampData
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

export const snapSave = async (signer: Signer, networkName: string, toBlock: number): Promise<void> => {
    const savingManagerAddress =
        networkName === "mainnet" ? "0x30647a72dc82d7fbb1123ea74716ab8a317eac19" : "0x5290Ad3d83476CA6A2b178Cd9727eE1EF72432af"
    const savingsManager = new SavingsContract__factory(signer).attach(savingManagerAddress)
    const exchangeRate = await savingsManager.exchangeRate({
        blockTag: toBlock,
    })
    console.log(`\nSave rate ${formatUnits(exchangeRate)}`)
}

export interface TvlConfig {
    startingCap: BN
    capFactor: BN
    invariantValidatorAddress: string
}
const getTvlCap = async (signer: Signer, tvlConfig: TvlConfig, toBlock: number): Promise<BN> => {
    const validator = await new ValidatorWithTVLCap__factory(signer).attach(tvlConfig.invariantValidatorAddress)
    const tvlStartTime = await validator.startTime({
        blockTag: toBlock,
    })
    const weeksSinceLaunch = BN.from(Date.now()).div(1000).sub(tvlStartTime).mul(fullScale).div(604800)
    // // e.g. 1e19 + (15e18 * 2.04e36) = 1e19 + 3.06e55
    // // startingCap + (capFactor * weeksSinceLaunch**2 / 1e36);
    return tvlConfig.startingCap.add(tvlConfig.capFactor.mul(weeksSinceLaunch.pow(2)).div(fullScale.pow(2)))
}

export const getBasket = async (
    asset: Masset | MV1 | MV2 | MusdEth | FeederPool,
    bAssetSymbols: string[],
    mAssetName = "mBTC",
    quantityFormatter: QuantityFormatter,
    toBlock: number,
    tvlConfig?: TvlConfig,
    exposedLogic?: ExposedMassetLogic,
): Promise<void> => {
    const bAssets = await asset.getBassets({
        blockTag: toBlock,
    })
    const bAssetTotals: BN[] = []
    let bAssetsTotal = BN.from(0)
    bAssetSymbols.forEach((_, i) => {
        let scaledBassetQuantity: BN
        if (isMusdEth(asset)) {
            scaledBassetQuantity = applyRatio(bAssets[1][i].vaultBalance, bAssets[1][i].ratio)
        } else if (isFeederPool(asset)) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            scaledBassetQuantity = applyRatio(bAssets.vaultData[i].vaultBalance, bAssets.vaultData[i].ratio)
        } else {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            scaledBassetQuantity = applyRatio(bAssets.bData[i].vaultBalance, bAssets.bData[i].ratio)
        }
        bAssetTotals.push(scaledBassetQuantity)
        bAssetsTotal = bAssetsTotal.add(scaledBassetQuantity)
    })

    console.log(`\n${mAssetName} basket`)
    bAssetSymbols.forEach((symbol, i) => {
        const percentage = bAssetTotals[i].mul(100).div(bAssetsTotal)
        console.log(`  ${symbol.padEnd(7)}  ${quantityFormatter(bAssetTotals[i]).padEnd(20)} ${percentage.toString().padStart(2)}%`)
    })

    let mAssetSurplus = BN.from(0)
    if (asset.surplus) {
        mAssetSurplus = await asset.surplus({
            blockTag: toBlock,
        })
    } else if (!isFeederPool(asset)) {
        mAssetSurplus = (
            await asset.data({
                blockTag: toBlock,
            })
        ).surplus
    }
    const mAssetSupply = await asset.totalSupply({
        blockTag: toBlock,
    })
    console.log(`Surplus    ${formatUnits(mAssetSurplus)}`)
    console.log(`${mAssetName}       ${quantityFormatter(mAssetSupply)}`)
    const mAssetTotal = mAssetSupply.add(mAssetSurplus)

    if (exposedLogic && !isMusdEth(asset)) {
        const config = {
            ...(await asset.getConfig({
                blockTag: toBlock,
            })),
            recolFee: 0,
        }
        const k = await exposedLogic.getK(bAssets[1], config)
        console.log(`Total (K)  ${formatUnits(k)}`)

        // Sum of base assets less mAsset total supply less mAsset surplus
        const bAssetMassetDiff = k.sub(mAssetTotal)
        const bAssetMassetDiffBasisPoints = bAssetMassetDiff.mul(10000).div(mAssetTotal)
        console.log(
            `Total ${mAssetName} ${formatUnits(mAssetTotal)} (${formatUnits(
                bAssetMassetDiff,
            )} ${bAssetMassetDiffBasisPoints}bps over-collateralised)`,
        )
    }

    if (tvlConfig) {
        const tvlCap = await getTvlCap(asset.signer, tvlConfig, toBlock)
        const tvlCapPercentage = bAssetsTotal.mul(100).div(tvlCap)
        console.log(`TVL cap   ${quantityFormatter(tvlCap)} ${tvlCapPercentage}%`)
    }
}

export const getBalances = async (
    mAsset: Masset | MusdEth,
    accounts: { name: string; address: string }[],
    quantityFormatter: QuantityFormatter,
    toBlock: number,
): Promise<Balances> => {
    const mAssetBalance = await mAsset.totalSupply({
        blockTag: toBlock,
    })
    console.log("\nHolders")
    let balanceSum = BN.from(0)
    const balances: BN[] = []
    for (const account of accounts) {
        const balance = await mAsset.balanceOf(account.address, {
            blockTag: toBlock,
        })
        console.log(`${account.name.padEnd(26)} ${quantityFormatter(balance)} ${balance.mul(100).div(mAssetBalance)}%`)
        balanceSum = balanceSum.add(balance)
        balances.push(balance)
    }
    const otherBalances = mAssetBalance.sub(balanceSum)
    console.log(`${"Other".padEnd(26)} ${quantityFormatter(otherBalances)} ${otherBalances.mul(100).div(mAssetBalance)}%`)

    const surplus = isMusdEth(mAsset)
        ? await mAsset.surplus({
              blockTag: toBlock,
          })
        : (
              await mAsset.data({
                  blockTag: toBlock,
              })
          ).surplus
    console.log(`Surplus                    ${quantityFormatter(surplus)}`)
    console.log(`Total                      ${quantityFormatter(mAssetBalance)}`)

    return {
        total: mAssetBalance,
        save: balances[0],
        earn: balances[1],
    }
}

export const getMints = async (
    bAssets: Token[],
    mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool,
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
    mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool,
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
        // Ignore MintMulti events from collectInterest and collectPlatformInterest
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
    mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool,
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
    mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool,
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
    mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool,
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

// Returns the APY in basis points which is the percentage to 2 decimal places
export const calcApy = (startTime: Date, endTime: Date, quantity: BN, saveBalance: BN): BN => {
    const periodSeconds = BN.from(endTime.valueOf() - startTime.valueOf()).div(1000)
    return quantity.mul(10000).mul(ONE_YEAR).div(saveBalance).div(periodSeconds)
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
    const totalApy = calcApy(startTime, endTime, totalFees, balances.save)
    const liquidityUtilization = totalFeeTransactions.mul(100).div(balances.total)
    console.log(`Total Txs        ${quantityFormatter(totalTransactions)}`)
    console.log(
        `Savings          ${quantityFormatter(balances.save)} ${quantityFormatter(totalFees, 18, 9)} APY ${formatUnits(totalApy, 2)}%`,
    )
    console.log(
        `${liquidityUtilization}% liquidity utilization  (${quantityFormatter(totalFeeTransactions)} of ${quantityFormatter(
            balances.total,
        )} mAssets)`,
    )
}

export const getLiquidatorInterest = async (
    mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool,
    savingsManager: SavingsManager,
    fromBlock: BlockInfo,
    toBlock: BlockInfo,
    quantityFormatter: QuantityFormatter,
): Promise<{ total: BN; count: number }> => {
    const filter = await savingsManager.filters.LiquidatorDeposited(mAsset.address, null)
    const logs = await savingsManager.queryFilter(filter, fromBlock.blockNumber, toBlock.blockNumber)

    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        console.log(`${log.blockNumber} ${log.transactionHash} ${quantityFormatter(log.args.amount)}`)
        count += 1
        total = total.add(log.args.amount)
    })

    return { total, count }
}

export const getCollectedInterest = async (
    bAssets: Token[],
    mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool,
    savingsManager: SavingsManager,
    fromBlock: BlockInfo,
    toBlock: BlockInfo,
    quantityFormatter: QuantityFormatter,
    savingsBalance: BN,
): Promise<TxSummary> => {
    // Get MintedMulti events where the mAsset is the minter
    const filter = await mAsset.filters.MintedMulti(mAsset.address, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock.blockNumber, toBlock.blockNumber)

    console.log(`\nCollected Interest between ${fromBlock.blockTime.toUTCString()} and ${toBlock.blockTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity")
    let total = BN.from(0)
    let tradingFees = BN.from(0)
    let countTradingFees = 0
    const platformFees: BN[] = bAssets.map(() => BN.from(0))
    let totalPlatformInterest = BN.from(0)
    let countPlatformInterest = 0
    let count = 0
    logs.forEach((log) => {
        // Ignore MintMulti events not from collectInterest and collectPlatformInterest
        if (log.args.inputs.length) return
        // Calculate the quantity of interest collected
        // For mAssets:
        // - Trading fees = mAssetQuantity
        // - Platform fees = mAssetQuantity
        // For Feeder Pools:
        // - Trading fees = log.args.output
        // - Platform fees = sum of the input quantities as log.args.output is 0
        let quantity = BN.from(0)
        if (log.args.mAssetQuantity !== undefined) {
            quantity = log.args.mAssetQuantity
        } else if (log.args.output && log.args.output.gt(0)) {
            quantity = log.args.output
        } else {
            quantity = log.args.inputQuantities.reduce((sum, input) => sum + input, 0)
        }
        console.log(`${log.blockNumber} ${log.transactionHash} ${quantityFormatter(quantity)}`)
        if (log.args.inputQuantities.length) {
            countPlatformInterest += 1
            log.args.inputQuantities.forEach((inputQuantity, i) => {
                const scaledFee = applyDecimals(inputQuantity, bAssets[i].decimals)
                platformFees[i] = platformFees[i].add(scaledFee)
                totalPlatformInterest = totalPlatformInterest.add(scaledFee)
                console.log(`   ${bAssets[i].symbol.padEnd(4)} ${quantityFormatter(inputQuantity, bAssets[i].decimals)}`)
            })
        } else {
            countTradingFees += 1
            tradingFees = tradingFees.add(quantity)
        }

        total = total.add(quantity)
        count += 1
    })
    const { total: liquidatorInterest, count: countLiquidator } = await getLiquidatorInterest(
        mAsset,
        savingsManager,
        fromBlock,
        toBlock,
        quantityFormatter,
    )
    total = total.add(liquidatorInterest)

    if (total.eq(0)) {
        console.log("No interest was collected")
        return {
            count,
            total,
            fees: BN.from(0),
        }
    }

    const tradingFeesApy = calcApy(fromBlock.blockTime, toBlock.blockTime, tradingFees, savingsBalance)
    console.log(
        `Trading fees           ${quantityFormatter(tradingFees)} ${formatUnits(tradingFees.mul(10000).div(total), 2)}% ${formatUnits(
            tradingFeesApy,
            2,
        )}APY`,
    )
    const totalPlatformApy = calcApy(fromBlock.blockTime, toBlock.blockTime, totalPlatformInterest, savingsBalance)
    console.log(
        `Platform interest      ${quantityFormatter(totalPlatformInterest)} ${formatUnits(
            totalPlatformInterest.mul(10000).div(total),
            2,
        )}% ${formatUnits(totalPlatformApy, 2)}APY`,
    )
    // Avoid div by 0
    totalPlatformInterest = totalPlatformInterest.gt(0) ? totalPlatformInterest : BN.from(1)
    bAssets.forEach((bAsset, i) => {
        const platformFeeApy = calcApy(fromBlock.blockTime, toBlock.blockTime, platformFees[i], savingsBalance)
        console.log(
            `   ${bAsset.symbol.padEnd(4)} ${quantityFormatter(platformFees[i])} ${formatUnits(
                platformFees[i].mul(10000).div(totalPlatformInterest),
                2,
            )}% ${formatUnits(platformFeeApy, 2)}APY`,
        )
    })

    const totalLiquidatorApy = calcApy(fromBlock.blockTime, toBlock.blockTime, liquidatorInterest, savingsBalance)
    console.log(
        `Liquidator interest    ${quantityFormatter(liquidatorInterest)} ${formatUnits(
            liquidatorInterest.mul(10000).div(total),
            2,
        )}% ${formatUnits(totalLiquidatorApy, 2)}APY`,
    )

    const totalApy = calcApy(fromBlock.blockTime, toBlock.blockTime, total, savingsBalance)
    console.log(`Total interest         ${quantityFormatter(total)} ${formatUnits(totalApy, 2)}APY`)
    console.log(
        `Interest collections: ${countTradingFees} trading fee, ${countPlatformInterest} platform interest, ${countLiquidator} liquidator`,
    )
    return {
        count,
        total,
        fees: BN.from(0),
    }
}
