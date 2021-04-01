/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import { btcBassets, capFactor, contracts, startingCap } from "@utils/btcConstants"
import { Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { task, types } from "hardhat/config"
import { Masset, Masset__factory } from "types/generated"
import { BN } from "@utils/math"
import { dumpBassetStorage, dumpConfigStorage, dumpTokenStorage } from "./utils/storage-utils"
import {
    getMultiRedemptions,
    getBlockRange,
    getBasket,
    getBlock,
    snapConfig,
    Balances,
    getMints,
    getMultiMints,
    getRedemptions,
    getSwaps,
    outputFees,
} from "./utils/snap-utils"
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

const getMasset = (signer: Signer, contractAddress = "0x945Facb997494CC2570096c74b5F66A3507330a1"): Masset =>
    Masset__factory.connect(contractAddress, signer)

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

        const mintSummary = await getMints(mBtcBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)
        const mintMultiSummary = await getMultiMints(mBtcBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)
        const redeemSummary = await getRedemptions(mBtcBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)
        const redeemMultiSummary = await getMultiRedemptions(mBtcBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)
        const swapSummary = await getSwaps(mBtcBassets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)

        outputFees(
            mintSummary,
            mintMultiSummary,
            swapSummary,
            redeemSummary,
            redeemMultiSummary,
            balances,
            fromBlock.blockTime,
            toBlock.blockTime,
            btcFormatter,
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
