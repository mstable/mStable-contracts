/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Signer } from "ethers"

import { Masset } from "types/generated"
import { BN } from "@utils/math"
import { Masset__factory } from "types/generated/factories/Masset__factory"
import { dumpBassetStorage, dumpConfigStorage, dumpTokenStorage } from "./utils/storage-utils"
import {
    getMultiRedemptions,
    getBlock,
    getBlockRange,
    getBasket,
    snapConfig,
    Balances,
    getMints,
    getMultiMints,
    getSwaps,
    getRedemptions,
    outputFees,
} from "./utils/snap-utils"
import { Token, sUSD, USDC, DAI, USDT } from "./utils/tokens"
import { usdFormatter } from "./utils/quantity-formatters"
import { getSwapRates } from "./utils/rates-utils"

const mUsdBassets: Token[] = [sUSD, USDC, DAI, USDT]

const getMasset = (signer: Signer, contractAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5"): Masset =>
    Masset__factory.connect(contractAddress, signer)

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

        const mAsset = getMasset(signer)

        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        await getBasket(
            mAsset,
            mUsdBassets.map((b) => b.symbol),
            "mUSD",
            usdFormatter,
        )
        await snapConfig(mAsset, fromBlock.blockNumber)

        const balances = await getBalances(mAsset, toBlock.blockNumber)

        const mintSummary = await getMints(mUsdBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)
        const mintMultiSummary = await getMultiMints(mUsdBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)
        const swapSummary = await getSwaps(mUsdBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)
        const redeemSummary = await getRedemptions(mUsdBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)
        const redeemMultiSummary = await getMultiRedemptions(mUsdBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)

        outputFees(
            mintSummary,
            mintMultiSummary,
            swapSummary,
            redeemSummary,
            redeemMultiSummary,
            balances,
            fromBlock.blockTime,
            toBlock.blockTime,
            usdFormatter,
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
