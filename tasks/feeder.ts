/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Signer } from "ethers"

import { FeederPool, FeederPool__factory, Masset } from "types/generated"
import { BN } from "@utils/math"
import { ONE_YEAR } from "@utils/constants"
import { dumpConfigStorage, dumpFassetStorage, dumpTokenStorage } from "./utils/storage-utils"
import { Balances, getBlock, getBlockRange, getBasket, snapConfig, TxSummary } from "./utils/snap-utils"
import { Token, sUSD, USDC, DAI, USDT, mUSD, GUSD, tokens } from "./utils/tokens"
import { btcFormatter, QuantityFormatter, usdFormatter } from "./utils/quantity-formatters"
import { getSwapRates } from "./utils/rates-utils"

const mpBassets: Token[] = [sUSD, USDC, DAI, USDT]
const fpBassets: Token[] = [mUSD, GUSD]

/**
                    Swap Rates
*/

const getBalances = async (mAsset: Masset | FeederPool, toBlock: number): Promise<Balances> => {
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

const getFeederPool = (signer: Signer, contractAddress: string): FeederPool => {
    const linkedAddress = {
        // FeederManager
        __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: "0x90aE544E8cc76d2867987Ee4f5456C02C50aBd8B",
        // FeederLogic
        __$7791d1d5b7ea16da359ce352a2ac3a881c$__: "0x2837C77527c37d61D9763F53005211dACB4125dE",
    }
    const feederPoolFactory = new FeederPool__factory(linkedAddress, signer)
    return feederPoolFactory.attach(contractAddress)
}

// const getMints = async (mAsset: Masset | FeederPool, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
//     const filter = await mAsset.filters.Minted(null, null, null, null, null)
//     const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

//     console.log(`\nMints since block ${fromBlock} at ${startTime.toUTCString()}`)
//     console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity")
//     let total = BN.from(0)
//     let count = 0
//     logs.forEach((log) => {
//         const inputBasset = fpBassets.find((b) => b.address === log.args.input)
//         console.log(`${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)} ${formatUsd(log.args.mAssetQuantity)}`)
//         total = total.add(log.args.mAssetQuantity)
//         count += 1
//     })
//     console.log(`Count ${count}, Total ${formatUsd(total)}`)
//     return {
//         count,
//         total,
//         fees: BN.from(0),
//     }
// }

// const getMultiMints = async (mAsset: Masset | FeederPool, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
//     const filter = await mAsset.filters.MintedMulti(null, null, null, null, null)
//     const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

//     console.log(`\nMulti Mints since block ${fromBlock} at ${startTime.toUTCString()}`)
//     console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity")
//     let total = BN.from(0)
//     let count = 0
//     logs.forEach((log) => {
//         // Ignore nMintMulti events from collectInterest and collectPlatformInterest
//         if (!log.args.inputs.length) return
//         const inputBassets = log.args.inputs.map((input) => bAssets.find((b) => b.address === input))
//         console.log(`${log.blockNumber} ${log.transactionHash} ${formatUsd(log.args.mAssetQuantity)}`)
//         inputBassets.forEach((bAsset, i) => {
//             console.log(`   ${bAsset.symbol.padEnd(4)} ${formatUsd(log.args.inputQuantities[i], bAsset.decimals)}`)
//         })
//         total = total.add(log.args.mAssetQuantity)
//         count += 1
//     })
//     console.log(`Count ${count}, Total ${formatUsd(total)}`)
//     return {
//         count,
//         total,
//         fees: BN.from(0),
//     }
// }

// const getSwaps = async (mAsset: Masset | FeederPool, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
//     const filter = await mAsset.filters.Swapped(null, null, null, null, null, null)
//     const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

//     console.log(`\nSwaps since block ${fromBlock} at ${startTime.toUTCString()}`)
//     console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Input Output     Quantity      Fee")
//     // Scaled bAsset quantities
//     let total = BN.from(0)
//     let fees = BN.from(0)
//     let count = 0
//     logs.forEach((log) => {
//         const inputBasset = bAssets.find((b) => b.address === log.args.input)
//         const outputBasset = bAssets.find((b) => b.address === log.args.output)
//         console.log(
//             `${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)}  ${outputBasset.symbol.padEnd(4)} ${formatUsd(
//                 log.args.outputAmount,
//                 outputBasset.decimals,
//             )} ${formatUsd(log.args.scaledFee, 18, 8)}`,
//         )
//         total = total.add(applyDecimals(log.args.outputAmount, outputBasset.decimals))
//         fees = fees.add(log.args.scaledFee)
//         count += 1
//     })
//     console.log(`Count ${count}, Total ${formatUsd(total)}`)

//     return {
//         count,
//         total,
//         fees,
//     }
// }

// const getRedemptions = async (mAsset: Masset | FeederPool, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
//     const filter = await mAsset.filters.Redeemed(null, null, null, null, null, null)
//     const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

//     console.log(`\nRedemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
//     console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity      Fee")
//     let total = BN.from(0)
//     let fees = BN.from(0)
//     let count = 0
//     logs.forEach((log) => {
//         const outputBasset = bAssets.find((b) => b.address === log.args.output)
//         console.log(
//             `${log.blockNumber} ${log.transactionHash} ${outputBasset.symbol.padEnd(4)} ${formatUsd(log.args.mAssetQuantity)} ${formatUsd(
//                 log.args.scaledFee,
//                 18,
//                 8,
//             )}`,
//         )
//         total = total.add(log.args.mAssetQuantity)
//         fees = fees.add(log.args.scaledFee)
//         count += 1
//     })
//     console.log(`Count ${count}, Total ${formatUsd(total)}`)

//     return {
//         count,
//         total,
//         fees,
//     }
// }

// const getMultiRedemptions = async (
//     mAsset: Masset | FeederPool,
//     fromBlock: number,
//     startTime: Date,
//     toBlock: number,
// ): Promise<TxSummary> => {
//     const filter = await mAsset.filters.RedeemedMulti(null, null, null, null, null, null)
//     const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

//     console.log(`\nMulti Redemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
//     console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity      Fee")
//     let total = BN.from(0)
//     let fees = BN.from(0)
//     let count = 0
//     logs.forEach((log) => {
//         const outputBassets = log.args.outputs.map((output) => bAssets.find((b) => b.address === output))
//         console.log(
//             `${log.blockNumber} ${log.transactionHash} ${formatUsd(log.args.mAssetQuantity)} ${formatUsd(log.args.scaledFee, 18, 8)}`,
//         )
//         outputBassets.forEach((bAsset, i) => {
//             console.log(`   ${bAsset.symbol.padEnd(4)} ${formatUsd(log.args.outputQuantity[i], bAsset.decimals)}`)
//         })
//         total = total.add(log.args.mAssetQuantity)
//         fees = fees.add(log.args.scaledFee)
//         count += 1
//     })
//     console.log(`Count ${count}, Total ${formatUsd(total)}`)

//     return {
//         count,
//         total,
//         fees,
//     }
// }

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

task("feeder-storage", "Dumps feeder contract storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, types.int)
    .addOptionalParam("address", "Contract address of the feeder pool.", "0x48c59199Da51B7E30Ea200a74Ea07974e62C4bA7", types.string)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre
        console.log(`Feeder snap for address ${taskArgs.address}`)

        const { blockNumber } = await getBlock(ethers, taskArgs.block)

        const [signer] = await ethers.getSigners()
        const pool = getFeederPool(signer, taskArgs.address)

        await dumpTokenStorage(pool, blockNumber)
        await dumpFassetStorage(pool, blockNumber)
        await dumpConfigStorage(pool, blockNumber)
    })

task("feeder-snap", "Gets feeder transactions over a period of time")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12094461, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .addOptionalParam("address", "Contract address of the feeder pool.", "0x48c59199Da51B7E30Ea200a74Ea07974e62C4bA7", types.string)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre
        console.log(`Feeder snap for address ${taskArgs.address}`)

        const [signer] = await ethers.getSigners()
        const pool = getFeederPool(signer, taskArgs.address)

        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        await getBasket(
            pool,
            fpBassets.map((b) => b.symbol),
            fpBassets[1].symbol,
            usdFormatter,
        )
        await snapConfig(pool, toBlock.blockNumber)

        const balances = await getBalances(pool, toBlock.blockNumber)

        // const mintSummary = await getMints(pool, fromBlockNumber, startTime, toBlockNumber)
        // const mintMultiSummary = await getMultiMints(pool, fromBlockNumber, startTime, toBlockNumber)
        // const swapSummary = await getSwaps(pool, fromBlockNumber, startTime, toBlockNumber)
        // const redeemSummary = await getRedemptions(pool, fromBlockNumber, startTime, toBlockNumber)
        // const redeemMultiSummary = await getMultiRedemptions(pool, fromBlockNumber, startTime, toBlockNumber)

        // outputFees(mintSummary, mintMultiSummary, swapSummary, redeemSummary, redeemMultiSummary, balances, startTime, endTime)
    })

task("feeder-rates", "Feeder rate comparison to Curve")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .addOptionalParam("swapSize", "Swap size to compare rates with Curve", undefined, types.float)
    .addParam("fasset", "Token symbol of the feeder pool asset.", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre
        const [signer] = await ethers.getSigners()

        const block = await getBlock(ethers, taskArgs.block)

        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) {
            console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`)
            process.exit(1)
        }
        console.log(`\nGetting rates for feeder pool ${fAsset.symbol} at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)
        const feederPool = getFeederPool(signer, fAsset.feederPool)

        const mAsset = tokens.find((t) => t.symbol === fAsset.parent)
        const fpAssets = [fAsset, mAsset]

        // Get the bAssets for the main pool. eg bAssets in mUSD or mBTC
        // These are the assets that are not feeder pools and parent matches the fAsset's parent
        const mpAssets = tokens.filter((t) => t.parent === fAsset.parent && !t.feederPool)

        let quantityFormatter: QuantityFormatter
        let swapSize: BN
        if (fAsset.quantityFormatter === "USD") {
            quantityFormatter = usdFormatter
            swapSize = taskArgs.swapSize || 10000
        } else if (fAsset.quantityFormatter === "BTC") {
            quantityFormatter = btcFormatter
            swapSize = taskArgs.swapSize || 1
        }

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(fpAssets, fpAssets, feederPool, block.blockNumber, quantityFormatter, swapSize)
        await getSwapRates([fAsset], mpAssets, feederPool, block.blockNumber, quantityFormatter, swapSize)
        await getSwapRates(mpAssets, [fAsset], feederPool, block.blockNumber, quantityFormatter, swapSize)
        await snapConfig(feederPool, block.blockNumber)
    })

module.exports = {}
