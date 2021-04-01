/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import { Bassets, btcBassets, capFactor, contracts, getBassetFromAddress, startingCap } from "@utils/btcConstants"
import { ONE_YEAR } from "@utils/constants"
import { applyDecimals, BN } from "@utils/math"
import { Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { task, types } from "hardhat/config"
import { Masset, Masset__factory } from "types/generated"
import { dumpBassetStorage, dumpConfigStorage, dumpTokenStorage } from "./utils/storage-utils"
import { getBlockRange, getBasket, getBlock, snapConfig, Balances, TxSummary } from "./utils/snap-utils"
import { Token, renBTC, sBTC, WBTC } from "./utils/tokens"
import { getSwapRates } from "./utils/rates-utils"

const mBtcBassets: Token[] = [renBTC, sBTC, WBTC]

const btcFormatter = (amount, decimals = 18, pad = 7, displayDecimals = 3): string => {
    const string2decimals = parseFloat(formatUnits(amount, decimals)).toFixed(displayDecimals)
    // Add thousands separator
    return string2decimals.replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(pad)
}

const getBalances = async (mAsset: Masset, toBlock: number): Promise<Balances> => {
    const mAssetBalance = await mAsset.totalSupply({
        blockTag: toBlock,
    })
    const savingBalance = await mAsset.balanceOf(contracts.mainnet.imBTC, {
        blockTag: toBlock,
    })
    const sushiPoolBalance = await mAsset.balanceOf(contracts.mainnet.sushiPool, {
        blockTag: toBlock,
    })
    const mStableFundManagerBalance = await mAsset.balanceOf(contracts.mainnet.fundManager, {
        blockTag: toBlock,
    })
    const otherBalances = mAssetBalance.sub(savingBalance).sub(sushiPoolBalance).sub(mStableFundManagerBalance)

    console.log("\nmBTC Holders")
    console.log(`imBTC                ${formatUnits(savingBalance).padEnd(20)} ${savingBalance.mul(100).div(mAssetBalance)}%`)
    console.log(`Sushi Pool           ${formatUnits(sushiPoolBalance).padEnd(20)} ${sushiPoolBalance.mul(100).div(mAssetBalance)}%`)
    console.log(
        `mStable Fund Manager ${formatUnits(mStableFundManagerBalance).padEnd(20)} ${mStableFundManagerBalance
            .mul(100)
            .div(mAssetBalance)}%`,
    )
    console.log(`Others               ${formatUnits(otherBalances).padEnd(20)} ${otherBalances.mul(100).div(mAssetBalance)}%`)

    return {
        total: mAssetBalance,
        save: savingBalance,
        earn: sushiPoolBalance,
    }
}

const getMints = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.Minted(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nMints since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset Masset Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = getBassetFromAddress(log.args.input)
        console.log(`${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(6)} ${formatUnits(log.args.mAssetQuantity)}`)
        total = total.add(log.args.mAssetQuantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)
    return {
        count,
        total,
        fees: BN.from(0),
    }
}

const getMultiMints = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.MintedMulti(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nMulti Mints since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Masset Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        // Ignore nMintMulti events from collectInterest and collectPlatformInterest
        if (!log.args.inputs.length) return
        const inputBassets: Bassets[] = log.args.inputs.map((input) => getBassetFromAddress(input))
        console.log(`${log.blockNumber} ${log.transactionHash} ${formatUnits(log.args.mAssetQuantity)}`)
        inputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(6)} ${formatUnits(log.args.inputQuantities[i], bAsset.decimals).padEnd(21)}`)
        })
        total = total.add(log.args.mAssetQuantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)
    return {
        count,
        total,
        fees: BN.from(0),
    }
}

const getRedemptions = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.Redeemed(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nRedemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset Masset Quantity\tFee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBasset = getBassetFromAddress(log.args.output)
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${outputBasset.symbol.padEnd(6)} ${formatUnits(
                log.args.mAssetQuantity,
            )} ${formatUnits(log.args.scaledFee)}`,
        )
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)

    return {
        count,
        total,
        fees,
    }
}

const getMultiRedemptions = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.RedeemedMulti(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nMulti Redemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Masset Quantity\t Fee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBassets: Bassets[] = log.args.outputs.map((output) => getBassetFromAddress(output))
        console.log(`${log.blockNumber} ${log.transactionHash} ${formatUnits(log.args.mAssetQuantity)} ${formatUnits(log.args.scaledFee)}`)
        outputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(6)} ${formatUnits(log.args.outputQuantity[i], bAsset.decimals).padEnd(21)}`)
        })
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)

    return {
        count,
        total,
        fees,
    }
}

const getSwaps = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.Swapped(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nSwaps since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Input  Output Output Quantity\tFee")
    // Scaled bAsset quantities
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = getBassetFromAddress(log.args.input)
        const outputBasset = getBassetFromAddress(log.args.output)
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(6)} ${outputBasset.symbol.padEnd(6)} ${formatUnits(
                log.args.outputAmount,
                outputBasset.decimals,
            ).padEnd(21)} ${formatUnits(log.args.scaledFee)}`,
        )
        total = total.add(applyDecimals(log.args.outputAmount, outputBasset.decimals))
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)

    return {
        count,
        total,
        fees,
    }
}

const outputFees = (
    mints: TxSummary,
    multiMints: TxSummary,
    swaps: TxSummary,
    redeems: TxSummary,
    multiRedeems: TxSummary,
    balances: Balances,
    startTime: Date,
    currentTime: Date,
) => {
    const totalFees = redeems.fees.add(multiRedeems.fees).add(swaps.fees)
    if (totalFees.eq(0)) {
        console.log(`\nNo fees since ${startTime.toUTCString()}`)
        return
    }
    const totalTransactions = mints.total.add(multiMints.total).add(redeems.total).add(multiRedeems.total).add(swaps.total)
    const totalFeeTransactions = redeems.total.add(multiRedeems.total).add(swaps.total)
    console.log(`\nFees since ${startTime.toUTCString()}`)
    console.log("              #  mBTC Volume\t     Fees\t\t  Fee %")
    console.log(
        `Mints         ${mints.count.toString().padEnd(2)} ${formatUnits(mints.total).padEnd(22)} ${formatUnits(mints.fees).padEnd(
            20,
        )} ${mints.fees.mul(100).div(totalFees)}%`,
    )
    console.log(
        `Multi Mints   ${multiMints.count.toString().padEnd(2)} ${formatUnits(multiMints.total).padEnd(22)} ${formatUnits(
            multiMints.fees,
        ).padEnd(20)} ${multiMints.fees.mul(100).div(totalFees)}%`,
    )
    console.log(
        `Redeems       ${redeems.count.toString().padEnd(2)} ${formatUnits(redeems.total).padEnd(22)} ${formatUnits(redeems.fees).padEnd(
            20,
        )} ${redeems.fees.mul(100).div(totalFees)}%`,
    )
    console.log(
        `Multi Redeems ${multiRedeems.count.toString().padEnd(2)} ${formatUnits(multiRedeems.total).padEnd(22)} ${formatUnits(
            multiRedeems.fees,
        ).padEnd(20)} ${multiRedeems.fees.mul(100).div(totalFees)}%`,
    )
    console.log(
        `Swaps         ${swaps.count.toString().padEnd(2)} ${formatUnits(swaps.total).padEnd(22)} ${formatUnits(swaps.fees).padEnd(
            20,
        )} ${swaps.fees.mul(100).div(totalFees)}%`,
    )
    const periodSeconds = BN.from(currentTime.valueOf() - startTime.valueOf()).div(1000)
    const liquidityUtilization = totalFeeTransactions.mul(100).div(balances.total)
    const totalApy = totalFees.mul(100).mul(ONE_YEAR).div(balances.save).div(periodSeconds)
    console.log(`Total Txs     ${formatUnits(totalTransactions).padEnd(22)}`)
    console.log(`Savings       ${formatUnits(balances.save).padEnd(22)} ${formatUnits(totalFees).padEnd(20)} APY ${totalApy}%`)
    console.log(
        `${liquidityUtilization}% liquidity utilization  (${formatUnits(totalFeeTransactions)} of ${formatUnits(balances.total)} mBTC)`,
    )
}

const getMasset = (signer: Signer, contractAddress = "0x945Facb997494CC2570096c74b5F66A3507330a1"): Masset => {
    const linkedAddress = {
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: contracts.mainnet.Manager,
    }
    const mMassetFactory = new Masset__factory(linkedAddress, signer)
    return mMassetFactory.attach(contractAddress)
}

task("mBTC-storage", "Dumps mBTC's storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre

        const toBlockNumber = taskArgs.to ? taskArgs.to : await ethers.provider.getBlockNumber()
        console.log(`Block number ${toBlockNumber}`)
        const [signer] = await ethers.getSigners()

        const mAsset = getMasset(signer)

        await dumpTokenStorage(mAsset, toBlockNumber)
        await dumpBassetStorage(mAsset, toBlockNumber)
        await dumpConfigStorage(mAsset, toBlockNumber)
    })

task("mBTC-snap", "Get the latest data from the mBTC contracts")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 11840520, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre

        const [signer] = await ethers.getSigners()

        const mAsset = getMasset(signer)

        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        const tvlConfig = {
            startingCap,
            capFactor,
            invariantValidatorAddress: contracts.mainnet.InvariantValidator,
        }
        await getBasket(
            mAsset,
            btcBassets.map((b) => b.symbol),
            "mBTC",
            btcFormatter,
            tvlConfig,
        )
        await snapConfig(mAsset, fromBlock.blockNumber)

        const balances = await getBalances(mAsset, fromBlock.blockNumber)

        const mintSummary = await getMints(mAsset, fromBlock.blockNumber, fromBlock.blockTime, toBlock.blockNumber)
        const mintMultiSummary = await getMultiMints(mAsset, fromBlock.blockNumber, fromBlock.blockTime, toBlock.blockNumber)
        const redeemSummary = await getRedemptions(mAsset, fromBlock.blockNumber, fromBlock.blockTime, toBlock.blockNumber)
        const redeemMultiSummary = await getMultiRedemptions(mAsset, fromBlock.blockNumber, fromBlock.blockTime, toBlock.blockNumber)
        const swapSummary = await getSwaps(mAsset, fromBlock.blockNumber, fromBlock.blockTime, toBlock.blockNumber)

        outputFees(
            mintSummary,
            mintMultiSummary,
            swapSummary,
            redeemSummary,
            redeemMultiSummary,
            balances,
            fromBlock.blockTime,
            toBlock.blockTime,
        )
    })

task("mBTC-rates", "mBTC rate comparison to Curve")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .addOptionalParam("swapSize", "Swap size to compare rates with Curve", 1, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre
        const [signer] = await ethers.getSigners()

        const mAsset = await getMasset(signer)
        const block = await getBlock(ethers, taskArgs.block)

        console.log(`\nGetting rates for mBTC at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(mBtcBassets, mBtcBassets, mAsset, block.blockNumber, btcFormatter, BN.from(taskArgs.swapSize))
        await snapConfig(mAsset, block.blockNumber)
    })

module.exports = {}
