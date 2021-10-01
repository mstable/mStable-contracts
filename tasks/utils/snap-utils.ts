/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { Signer } from "ethers"
import { fullScale, ONE_DAY, ONE_WEEK, ONE_YEAR } from "@utils/constants"
import { applyDecimals, applyRatio, BN, simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import {
    ERC20__factory,
    ExposedMassetLogic,
    FeederPool,
    IAaveIncentivesController__factory,
    IAlchemixStakingPools__factory,
    IUniswapV2Router02__factory,
    IUniswapV3Quoter__factory,
    Liquidator__factory,
    Masset,
    SavingsContract__factory,
    SavingsManager,
    ValidatorWithTVLCap__factory,
} from "types/generated"
import { MusdEth } from "types/generated/MusdEth"
import { encodeUniswapPath } from "@utils/peripheral/uniswap"
import { AaveStakedTokenV2__factory } from "types/generated/factories/AaveStakedTokenV2__factory"
import { Comptroller__factory } from "types/generated/factories/Comptroller__factory"
import { MusdLegacy } from "types/generated/MusdLegacy"
import { QuantityFormatter, usdFormatter } from "./quantity-formatters"
import { AAVE, ALCX, alUSD, Chain, COMP, DAI, GUSD, stkAAVE, sUSD, Token, USDC, USDT, WBTC } from "./tokens"
import { getChainAddress, resolveAddress } from "./networkAddressFactory"

const comptrollerAddress = "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B"
const uniswapEthToken = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
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
export function isFeederPool(asset: Masset | MusdEth | MusdLegacy | FeederPool): asset is FeederPool {
    return (asset as FeederPool).redeemProportionately !== undefined
}

// Only the mUSD deployed to Ethereum mainnet has the surplus function
export function isMusdEth(asset: Masset | MusdEth | MusdLegacy | FeederPool): asset is MusdEth {
    return (asset as MusdEth).surplus !== undefined
}

// mUSD before upgrade to the MusdV3 contract 0x15B2838Cd28cc353Afbe59385db3F366D8945AEe at block 12094376
// mUSD implementations are
// Initialized at block 10148035 to 0xB83A5a51df21321b365c918832E7E8f5DE686f7E
// Upgraded at block 10463013 to 0xE4c5b1765BF420016027177289908C5A3Ea7668E
// Upgraded at block 11516027 to 0xE0d0D052d5B1082E52C6b8422Acd23415c3DF1c4
// Upgraded at block 12094376 to 0x15B2838Cd28cc353Afbe59385db3F366D8945AEe
export function isMusdLegacy(asset: Masset | MusdEth | MusdLegacy | FeederPool): asset is MusdLegacy {
    return (asset as MusdLegacy).getBasketManager !== undefined
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const getBlock = async (ethers, _blockNumber?: number): Promise<BlockInfo> => {
    const blockNumber = _blockNumber || (await ethers.provider.getBlockNumber())
    const toBlock = await ethers.provider.getBlock(blockNumber)
    const blockTime = new Date(toBlock.timestamp * 1000)

    return {
        blockNumber,
        blockTime,
    }
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
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

export const snapConfig = async (asset: Masset | MusdEth | MusdLegacy | FeederPool, toBlock: number): Promise<void> => {
    let ampData
    if (isMusdLegacy(asset)) return
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

export const snapSave = async (symbol: string, signer: Signer, chain: Chain, toBlock: number): Promise<void> => {
    const savingContractAddress = resolveAddress(symbol, chain, "savings")
    const savingsContract = new SavingsContract__factory(signer).attach(savingContractAddress)
    const exchangeRate = await savingsContract.exchangeRate({
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
    asset: Masset | MusdEth | MusdLegacy | FeederPool,
    bAssetSymbols: string[],
    mAssetName = "mBTC",
    quantityFormatter: QuantityFormatter,
    toBlock: number,
    tvlConfig?: TvlConfig,
    exposedLogic?: ExposedMassetLogic,
): Promise<void> => {
    if (isMusdLegacy(asset)) return
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
    if (isMusdEth(asset)) {
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

    if (exposedLogic) {
        const config = {
            supply: mAssetSupply,
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
    mAsset: Masset | MusdEth | MusdLegacy,
    accounts: { name: string; address: string }[],
    quantityFormatter: QuantityFormatter,
    toBlock: number,
): Promise<Balances> => {
    if (isMusdLegacy(mAsset)) {
        return {
            total: BN.from(0),
            save: BN.from(0),
            earn: BN.from(0),
        }
    }
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
    mAsset: Masset | MusdEth | MusdLegacy | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    const filter = mAsset.filters.Minted(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log("\nMints")
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log: any) => {
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
    mAsset: Masset | MusdEth | MusdLegacy | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    const filter = mAsset.filters.MintedMulti(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log("\nMulti Mints")
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log: any) => {
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
    mAsset: Masset | MusdEth | MusdLegacy | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    const filter = mAsset.filters.Swapped(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log("\nSwaps")
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Input Output     Quantity      Fee")
    // Scaled bAsset quantities
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log: any) => {
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
    mAsset: Masset | MusdEth | MusdLegacy | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    const filter = mAsset.filters.Redeemed(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log("\nRedemptions")
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity      Fee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log: any) => {
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
    mAsset: Masset | MusdEth | MusdLegacy | FeederPool,
    fromBlock: number,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
): Promise<TxSummary> => {
    if (isMusdLegacy(mAsset)) {
        return {
            count: 0,
            total: BN.from(0),
            fees: BN.from(0),
        }
    }
    const filter = mAsset.filters.RedeemedMulti(null, null, null, null, null, null)
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
    mAsset: Masset | MusdEth | MusdLegacy | FeederPool,
    savingsManager: SavingsManager,
    fromBlock: BlockInfo,
    toBlock: BlockInfo,
    quantityFormatter: QuantityFormatter,
): Promise<{ total: BN; count: number }> => {
    const filter = savingsManager.filters.LiquidatorDeposited(mAsset.address, null)
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
    mAsset: Masset | MusdEth | MusdLegacy | FeederPool,
    savingsManager: SavingsManager,
    fromBlock: BlockInfo,
    toBlock: BlockInfo,
    quantityFormatter: QuantityFormatter,
    savingsBalance: BN,
): Promise<TxSummary> => {
    // Get MintedMulti events where the mAsset is the minter
    const filter = mAsset.filters.MintedMulti(mAsset.address, null, null, null, null)
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
    logs.forEach((log: any) => {
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
            quantity = log.args.inputQuantities.reduce((sum, input, i) => {
                const scaledFee = applyDecimals(input, bAssets[i].decimals)
                platformFees[i] = platformFees[i].add(scaledFee)
                return sum.add(scaledFee)
            }, BN.from(0))
        }
        console.log(`${log.blockNumber} ${log.transactionHash} ${quantityFormatter(quantity)}`)
        if (log.args.inputQuantities.length) {
            countPlatformInterest += 1
            totalPlatformInterest = totalPlatformInterest.add(quantity)
            log.args.inputQuantities.forEach((inputQuantity, i) => {
                console.log(`   ${bAssets[i].symbol.padEnd(4)} ${quantityFormatter(inputQuantity, bAssets[i]?.decimals || 18)}`)
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
        `Platform rewards       ${quantityFormatter(liquidatorInterest)} ${formatUnits(
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

export const quoteSwap = async (
    signer: Signer,
    from: Token,
    to: Token,
    inAmount: BN,
    toBlock: BlockInfo,
    path?: string[],
    fees = [3000, 3000],
): Promise<{
    outAmount: BN
    exchangeRate: BN
}> => {
    // Get USDC value from Uniswap
    const uniswapPath = path || [from.address, uniswapEthToken, to.address]
    let outAmount: BN
    if (toBlock.blockNumber > 12364832) {
        // Use Uniswap V3
        const encodedPath = encodeUniswapPath(uniswapPath, fees)
        const quoter = IUniswapV3Quoter__factory.connect("0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", signer)
        outAmount = await quoter.callStatic.quoteExactInput(encodedPath.encoded, inAmount, { blockTag: toBlock.blockNumber })
    } else {
        // Use Uniswap v2
        const router = IUniswapV2Router02__factory.connect("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", signer)
        const output = await router.getAmountsOut(inAmount, uniswapPath, { blockTag: toBlock.blockNumber })
        outAmount = output[2]
    }
    // exchange rate = out amount / 10**(out decimals) / in amount * (10**to decimals)
    const exchangeRate = outAmount.div(simpleToExactAmount(1, to.decimals)).mul(simpleToExactAmount(1, from.decimals)).div(inAmount)
    return { outAmount, exchangeRate }
}

export const getCompTokens = async (
    signer: Signer,
    toBlock: BlockInfo,
    quantityFormatter = usdFormatter,
    chain = Chain.mainnet,
): Promise<void> => {
    const comptroller = Comptroller__factory.connect(comptrollerAddress, signer)
    const compToken = ERC20__factory.connect(COMP.address, signer)

    let totalComp = BN.from(0)

    console.log(`\nCOMP accrued`)
    // Get COMP that can be claimed
    const compAccrued = await comptroller.compAccrued(USDC.integrator, { blockTag: toBlock.blockNumber })
    totalComp = totalComp.add(compAccrued)
    console.log(`USDC        ${quantityFormatter(compAccrued)}`)

    // Get COMP in mUSD integration
    const compIntegrationBal = await compToken.balanceOf(USDC.integrator, { blockTag: toBlock.blockNumber })
    totalComp = totalComp.add(compIntegrationBal)
    console.log(`Integration ${quantityFormatter(compIntegrationBal)}`)

    // Get COMP in mUSD liquidator
    const liquidatorAddress = getChainAddress("Liquidator", chain)
    const compLiquidatorBal = await compToken.balanceOf(liquidatorAddress, { blockTag: toBlock.blockNumber })
    totalComp = totalComp.add(compLiquidatorBal)
    console.log(`Liquidator  ${quantityFormatter(compLiquidatorBal)}`)

    const compUsdc = await quoteSwap(signer, COMP, USDC, totalComp, toBlock)
    console.log(`Total       ${quantityFormatter(totalComp)} ${quantityFormatter(compUsdc.outAmount, USDC.decimals)} USDC`)
    console.log(`COMP/USDC exchange rate: ${compUsdc.exchangeRate}`)

    const liquidator = await Liquidator__factory.connect(liquidatorAddress, signer)
    const liqData = await liquidator.liquidations(USDC.integrator)
    console.log(`Min COMP/USDC rate ${formatUnits(liqData.minReturn, USDC.decimals)}`)
    const nextRunFromTimestamp = liqData.lastTriggered.add(ONE_WEEK)
    console.log(`Next run ${new Date(nextRunFromTimestamp.toNumber() * 1000)}`)
}

export const getAaveTokens = async (
    signer: Signer,
    toBlock: BlockInfo,
    quantityFormatter = usdFormatter,
    chain = Chain.mainnet,
): Promise<void> => {
    const stkAaveToken = AaveStakedTokenV2__factory.connect(stkAAVE.address, signer)
    const aaveToken = ERC20__factory.connect(AAVE.address, signer)
    const aaveIncentivesAddress = getChainAddress("AaveIncentivesController", chain)
    const aaveIncentives = IAaveIncentivesController__factory.connect(aaveIncentivesAddress, signer)

    const liquidatorAddress = getChainAddress("Liquidator", chain)
    const liquidator = await Liquidator__factory.connect(liquidatorAddress, signer)

    let totalStkAaveAndAave = BN.from(0)

    if (toBlock.blockNumber <= 12319489) {
        console.log(`\nbefore stkAAVE`)
        return
    }

    // Get accrued stkAave for each integration contract that is still to be claimed from the  controller
    console.log(`\nstkAAVE accrued and unclaimed`)
    let totalUnclaimed = BN.from(0)
    const integrationTokens = [[DAI, USDT], [GUSD], [WBTC]]
    for (const bAssets of integrationTokens) {
        const bAssetSymbols = bAssets.reduce((symbols, token) => `${symbols}${token.symbol} `, "")
        const aTokens = bAssets.map((t) => t.liquidityProvider)
        const accruedBal = await aaveIncentives.getRewardsBalance(aTokens, bAssets[0].integrator, {
            blockTag: toBlock.blockNumber,
        })
        totalUnclaimed = totalUnclaimed.add(accruedBal)
        console.log(`${bAssetSymbols.padEnd(10)} ${quantityFormatter(accruedBal)}`)
    }
    console.log(`Total      ${quantityFormatter(totalUnclaimed)}`)
    totalStkAaveAndAave = totalStkAaveAndAave.add(totalUnclaimed)

    // Get stkAAVE balances in liquidators
    console.log(`\nstkAAVE claimed by integrations`)
    let totalClaimedstkAave = BN.from(0)
    for (const bAssets of integrationTokens) {
        const bAssetSymbols = bAssets.reduce((symbols, token) => `${symbols}${token.symbol} `, "")
        const integrationData = await liquidator.liquidations(bAssets[0].integrator, { blockTag: toBlock.blockNumber })
        totalClaimedstkAave = totalClaimedstkAave.add(integrationData.aaveBalance)
        console.log(`${bAssetSymbols.padEnd(10)} ${quantityFormatter(integrationData.aaveBalance)}`)
    }
    console.log(`Total              ${quantityFormatter(totalClaimedstkAave, 18, 6)}`)
    const liquidatorTotalBalance = await liquidator.totalAaveBalance({ blockTag: toBlock.blockNumber })
    console.log(`Total Aave Balance ${quantityFormatter(liquidatorTotalBalance, 18, 6)}`)

    // Get stkAave and AAVE in liquidity manager
    const liquidatorStkAaveBal = await stkAaveToken.balanceOf(liquidatorAddress, { blockTag: toBlock.blockNumber })
    const liquidatorAaveBal = await aaveToken.balanceOf(liquidatorAddress, { blockTag: toBlock.blockNumber })
    console.log(`\nLiquidator actual stkAAVE ${quantityFormatter(liquidatorStkAaveBal)}`)
    console.log(`Liquidator actual AAVE    ${quantityFormatter(liquidatorAaveBal)}`)
    totalStkAaveAndAave = totalStkAaveAndAave.add(liquidatorStkAaveBal)
    totalStkAaveAndAave = totalStkAaveAndAave.add(liquidatorAaveBal)

    let aaveUsdc: {
        outAmount: BN
        exchangeRate: BN
    }
    if (liquidatorStkAaveBal.gt(0)) {
        aaveUsdc = await quoteSwap(signer, AAVE, USDC, liquidatorStkAaveBal, toBlock)
        console.log(`\nLiquidator ${quantityFormatter(liquidatorStkAaveBal)} ${quantityFormatter(aaveUsdc.outAmount, USDC.decimals)} USDC`)
    } else {
        const reasonableAaveAmount = simpleToExactAmount(25)
        aaveUsdc = await quoteSwap(signer, AAVE, USDC, reasonableAaveAmount, toBlock)
        console.log(`\nLiquidator ${quantityFormatter(liquidatorStkAaveBal)}`)
    }

    const totalUSDC = totalStkAaveAndAave.mul(aaveUsdc.exchangeRate).div(simpleToExactAmount(1, AAVE.decimals - USDC.decimals))
    console.log(`Total      ${quantityFormatter(totalStkAaveAndAave)} ${quantityFormatter(totalUSDC, USDC.decimals)} USDC`)
    console.log(`AAVE/USDC exchange rate: ${aaveUsdc.exchangeRate}`)

    // Get AAVE/USDC exchange rate
    const liqData = await liquidator.liquidations(USDT.integrator, { blockTag: toBlock.blockNumber })
    console.log(`Min AAVE/USDC rate ${formatUnits(liqData.minReturn, USDC.decimals)}`)

    // Get next unlock window
    const cooldownStart = await stkAaveToken.stakersCooldowns(liquidatorAddress, { blockTag: toBlock.blockNumber })
    const cooldownEnd = cooldownStart.add(ONE_DAY.mul(10))
    const colldownEndDate = new Date(cooldownEnd.toNumber() * 1000)
    console.log(`next stkAAVE unlock ${colldownEndDate.toUTCString()} (${cooldownEnd})`)

    // Get unclaimed rewards
    const integrations = [
        {
            desc: "DAI, USDT & sUSD",
            integrator: DAI.integrator,
        },
        {
            desc: "GUSD",
            integrator: GUSD.integrator,
        },
        {
            desc: "WBTC",
            integrator: WBTC.integrator,
        },
    ]
    console.log("\nstkAAVE unclaimed (no accrued)")
    const unclaimedRewardsPromises = integrations.map((i) =>
        aaveIncentives.getUserUnclaimedRewards(i.integrator, { blockTag: toBlock.blockNumber }),
    )
    const unclaimedRewards = await Promise.all(unclaimedRewardsPromises)
    let totalUnclaimedRewards = BN.from(0)
    integrations.forEach((integration, i) => {
        console.log(`${integration.desc.padEnd(10)}${quantityFormatter(unclaimedRewards[i])}`)
        totalUnclaimedRewards = totalUnclaimedRewards.add(unclaimedRewards[i])
    })
    console.log(`Total     ${quantityFormatter(totalUnclaimedRewards)}`)

    // Get accrued stkAave for the old Aave V2 integration contract,
    // which is still used by sUSD. No longer used by DAI and USDT
    console.log(`\nstkAAVE unclaimable (integration contract can not claim)`)
    const unclaimableRewards = await aaveIncentives.getUserUnclaimedRewards(sUSD.integrator, {
        blockTag: toBlock.blockNumber,
    })
    console.log(`Old Aave V2 ${quantityFormatter(unclaimableRewards)}`)
}

export const getAlcxTokens = async (
    signer: Signer,
    toBlock: BlockInfo,
    quantityFormatter = usdFormatter,
    chain = Chain.mainnet,
): Promise<void> => {
    const poolId = 0
    const alchemixStakingPoolsAddress = getChainAddress("AlchemixStakingPool", chain)
    const alchemixStakingPools = IAlchemixStakingPools__factory.connect(alchemixStakingPoolsAddress, signer)
    const alcxToken = ERC20__factory.connect(ALCX.address, signer)

    let totalComp = BN.from(0)

    console.log(`\nALCX accrued`)
    // Get ALCX that can be claimed
    const alcxAccrued = await alchemixStakingPools.getStakeTotalUnclaimed(alUSD.integrator, poolId, { blockTag: toBlock.blockNumber })
    totalComp = totalComp.add(alcxAccrued)
    console.log(`alUSD       ${quantityFormatter(alcxAccrued)}`)

    // Get ALCX in Alchemix integration
    const alchemixIntegrationBal = await alcxToken.balanceOf(alUSD.integrator, { blockTag: toBlock.blockNumber })
    totalComp = totalComp.add(alchemixIntegrationBal)
    console.log(`Integration ${quantityFormatter(alchemixIntegrationBal)}`)

    // Get ALCX in Liquidator
    const liquidatorAddress = getChainAddress("Liquidator", chain)
    const compLiquidatorBal = await alcxToken.balanceOf(liquidatorAddress, { blockTag: toBlock.blockNumber })
    totalComp = totalComp.add(compLiquidatorBal)
    console.log(`Liquidator  ${quantityFormatter(compLiquidatorBal)}`)

    try {
        const alcxUsdc = await quoteSwap(
            signer,
            ALCX,
            alUSD,
            totalComp,
            toBlock,
            [ALCX.address, uniswapEthToken, DAI.address, alUSD.address],
            [10000, 3000, 500],
        )
        console.log(`Total       ${quantityFormatter(totalComp)} ${quantityFormatter(alcxUsdc.outAmount)} alUSD`)
        console.log(`ALCX/USDC exchange rate: ${alcxUsdc.exchangeRate}`)
    } catch (err) {
        console.log(`Total       ${quantityFormatter(totalComp)}`)
        console.error(`Failed to get ALCX to alUSD rate.`)
    }
}
