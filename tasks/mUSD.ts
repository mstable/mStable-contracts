/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Signer } from "ethers"

import { Masset } from "types/generated"
import { BN, applyDecimals } from "@utils/math"
import { MassetLibraryAddresses, Masset__factory } from "types/generated/factories/Masset__factory"
import { ONE_YEAR } from "@utils/constants"
import { dumpBassetStorage, dumpConfigStorage, dumpTokenStorage } from "./utils/storage-utils"
import { TxSummary, getBlock, getBlockRange, getBasket, snapConfig, Balances } from "./utils/snap-utils"
import { Token, sUSD, USDC, DAI, USDT } from "./utils/tokens"
import { usdFormatter } from "./utils/quantity-formatters"
import { getSwapRates } from "./utils/rates-utils"

const mUsdBassets: Token[] = [sUSD, USDC, DAI, USDT]

const getBalances = async (mAsset: Masset, toBlock: number): Promise<Balances> => {
    const mAssetBalance = await mAsset.totalSupply({
        blockTag: toBlock,
    })
    const savingBalance = await mAsset.balanceOf("0x30647a72dc82d7fbb1123ea74716ab8a317eac19", {
        blockTag: toBlock,
    })
    const curveMusdBalance = await mAsset.balanceOf("0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6", {
        blockTag: toBlock,
    })
    const mStableDAOBalance = await mAsset.balanceOf("0x3dd46846eed8D147841AE162C8425c08BD8E1b41", {
        blockTag: toBlock,
    })
    const balancerETHmUSD5050Balance = await mAsset.balanceOf("0xe036cce08cf4e23d33bc6b18e53caf532afa8513", {
        blockTag: toBlock,
    })
    const otherBalances = mAssetBalance.sub(savingBalance).sub(curveMusdBalance).sub(mStableDAOBalance).sub(balancerETHmUSD5050Balance)

    console.log("\nmUSD Holders")
    console.log(`imUSD                      ${usdFormatter(savingBalance)} ${savingBalance.mul(100).div(mAssetBalance)}%`)
    console.log(`Curve mUSD                 ${usdFormatter(curveMusdBalance)} ${curveMusdBalance.mul(100).div(mAssetBalance)}%`)
    console.log(`mStable DAO                ${usdFormatter(mStableDAOBalance)} ${mStableDAOBalance.mul(100).div(mAssetBalance)}%`)
    console.log(
        `Balancer ETH/mUSD 50/50 #2 ${usdFormatter(balancerETHmUSD5050Balance)} ${balancerETHmUSD5050Balance.mul(100).div(mAssetBalance)}%`,
    )
    console.log(`Others                     ${usdFormatter(otherBalances)} ${otherBalances.mul(100).div(mAssetBalance)}%`)

    const surplus = await mAsset.surplus({
        blockTag: toBlock,
    })
    console.log(`Surplus                    ${usdFormatter(surplus)}`)
    console.log(`Total                      ${usdFormatter(mAssetBalance)}`)

    return {
        total: mAssetBalance,
        save: savingBalance,
        earn: curveMusdBalance,
    }
}

const getMasset = (deployer: Signer, contractAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5"): Masset => {
    const linkedAddress: MassetLibraryAddresses = {
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: "0x1E91F826fa8aA4fa4D3F595898AF3A64dd188848", // Masset Manager
    }
    const mUsdV3Factory = new Masset__factory(linkedAddress, deployer)
    return mUsdV3Factory.attach(contractAddress)
}

const getMints = async (bAssets: Token[], mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.Minted(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nMints since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = bAssets.find((b) => b.address === log.args.input)
        console.log(`${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)} ${usdFormatter(log.args.mAssetQuantity)}`)
        total = total.add(log.args.mAssetQuantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${usdFormatter(total)}`)
    return {
        count,
        total,
        fees: BN.from(0),
    }
}

const getMultiMints = async (bAssets: Token[], mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.MintedMulti(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nMulti Mints since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        // Ignore nMintMulti events from collectInterest and collectPlatformInterest
        if (!log.args.inputs.length) return
        const inputBassets = log.args.inputs.map((input) => bAssets.find((b) => b.address === input))
        console.log(`${log.blockNumber} ${log.transactionHash} ${usdFormatter(log.args.mAssetQuantity)}`)
        inputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(4)} ${usdFormatter(log.args.inputQuantities[i], bAsset.decimals)}`)
        })
        total = total.add(log.args.mAssetQuantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${usdFormatter(total)}`)
    return {
        count,
        total,
        fees: BN.from(0),
    }
}

const getSwaps = async (bAssets: Token[], mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.Swapped(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nSwaps since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Input Output     Quantity      Fee")
    // Scaled bAsset quantities
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = bAssets.find((b) => b.address === log.args.input)
        const outputBasset = bAssets.find((b) => b.address === log.args.output)
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)}  ${outputBasset.symbol.padEnd(4)} ${usdFormatter(
                log.args.outputAmount,
                outputBasset.decimals,
            )} ${usdFormatter(log.args.scaledFee, 18, 8)}`,
        )
        total = total.add(applyDecimals(log.args.outputAmount, outputBasset.decimals))
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${usdFormatter(total)}`)

    return {
        count,
        total,
        fees,
    }
}

const getRedemptions = async (
    bAssets: Token[],
    mAsset: Masset,
    fromBlock: number,
    startTime: Date,
    toBlock: number,
): Promise<TxSummary> => {
    const filter = await mAsset.filters.Redeemed(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nRedemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity      Fee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBasset = bAssets.find((b) => b.address === log.args.output)
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${outputBasset.symbol.padEnd(4)} ${usdFormatter(
                log.args.mAssetQuantity,
            )} ${usdFormatter(log.args.scaledFee, 18, 8)}`,
        )
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${usdFormatter(total)}`)

    return {
        count,
        total,
        fees,
    }
}

const getMultiRedemptions = async (
    bAssets: Token[],
    mAsset: Masset,
    fromBlock: number,
    startTime: Date,
    toBlock: number,
): Promise<TxSummary> => {
    const filter = await mAsset.filters.RedeemedMulti(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nMulti Redemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity      Fee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBassets = log.args.outputs.map((output) => bAssets.find((b) => b.address === output))
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${usdFormatter(log.args.mAssetQuantity)} ${usdFormatter(log.args.scaledFee, 18, 8)}`,
        )
        outputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(4)} ${usdFormatter(log.args.outputQuantity[i], bAsset.decimals)}`)
        })
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${usdFormatter(total)}`)

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
    endTime: Date,
) => {
    const totalFees = redeems.fees.add(multiRedeems.fees).add(swaps.fees)
    if (totalFees.eq(0)) {
        console.log(`\nNo fees since ${startTime.toUTCString()}`)
        return
    }
    const totalTransactions = mints.total.add(multiMints.total).add(redeems.total).add(multiRedeems.total).add(swaps.total)
    const totalFeeTransactions = redeems.total.add(multiRedeems.total).add(swaps.total)
    console.log(`\nFees since ${startTime.toUTCString()}`)
    console.log("              #     mUSD Volume      Fees    %")
    console.log(
        `Mints         ${mints.count.toString().padEnd(2)} ${usdFormatter(mints.total)} ${usdFormatter(mints.fees, 18, 9)} ${mints.fees
            .mul(100)
            .div(totalFees)
            .toString()
            .padStart(3)}%`,
    )
    console.log(
        `Multi Mints   ${multiMints.count.toString().padEnd(2)} ${usdFormatter(multiMints.total)} ${usdFormatter(
            multiMints.fees,
            18,
            9,
        )} ${multiMints.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Redeems       ${redeems.count.toString().padEnd(2)} ${usdFormatter(redeems.total)} ${usdFormatter(
            redeems.fees,
            18,
            9,
        )} ${redeems.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Multi Redeems ${multiRedeems.count.toString().padEnd(2)} ${usdFormatter(multiRedeems.total)} ${usdFormatter(
            multiRedeems.fees,
            18,
            9,
        )} ${multiRedeems.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Swaps         ${swaps.count.toString().padEnd(2)} ${usdFormatter(swaps.total)} ${usdFormatter(swaps.fees, 18, 9)} ${swaps.fees
            .mul(100)
            .div(totalFees)
            .toString()
            .padStart(3)}%`,
    )
    const periodSeconds = BN.from(endTime.valueOf() - startTime.valueOf()).div(1000)
    const liquidityUtilization = totalFeeTransactions.mul(100).div(balances.total)
    const totalApy = totalFees.mul(100).mul(ONE_YEAR).div(balances.save).div(periodSeconds)
    console.log(`Total Txs        ${usdFormatter(totalTransactions)}`)
    console.log(`Savings          ${usdFormatter(balances.save)} ${usdFormatter(totalFees, 18, 9)} APY ${totalApy}%`)
    console.log(
        `${liquidityUtilization}% liquidity utilization  (${usdFormatter(totalFeeTransactions)} of ${usdFormatter(balances.total)} mUSD)`,
    )
}

task("mUSD-storage", "Dumps mUSD's storage data")
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

task("mUSD-snap", "Snaps mUSD")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12094461, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre
        const [signer] = await ethers.getSigners()

        const mUSD = getMasset(signer)

        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        await getBasket(
            mUSD,
            mUsdBassets.map((b) => b.symbol),
            "mUSD",
            usdFormatter,
        )
        await snapConfig(mUSD, fromBlock.blockNumber)

        const balances = await getBalances(mUSD, toBlock.blockNumber)

        const mintSummary = await getMints(mUsdBassets, mUSD, fromBlock.blockNumber, fromBlock.blockTime, toBlock.blockNumber)
        const mintMultiSummary = await getMultiMints(mUsdBassets, mUSD, fromBlock.blockNumber, fromBlock.blockTime, toBlock.blockNumber)
        const swapSummary = await getSwaps(mUsdBassets, mUSD, fromBlock.blockNumber, fromBlock.blockTime, toBlock.blockNumber)
        const redeemSummary = await getRedemptions(mUsdBassets, mUSD, fromBlock.blockNumber, fromBlock.blockTime, toBlock.blockNumber)
        const redeemMultiSummary = await getMultiRedemptions(
            mUsdBassets,
            mUSD,
            fromBlock.blockNumber,
            fromBlock.blockTime,
            toBlock.blockNumber,
        )

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

task("mUSD-rates", "mUSD rate comparison to Curve")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .addOptionalParam("swapSize", "Swap size to compare rates with Curve", 10000, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre
        const [signer] = await ethers.getSigners()

        const mAsset = await getMasset(signer)
        const block = await getBlock(ethers, taskArgs.block)

        console.log(`\nGetting rates for mUSD at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(mUsdBassets, mUsdBassets, mAsset, block.blockNumber, usdFormatter, BN.from(taskArgs.swapSize))
        await snapConfig(mAsset, block.blockNumber)
    })

module.exports = {}
