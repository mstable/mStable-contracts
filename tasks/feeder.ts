/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Signer } from "ethers"

import { FeederPool, FeederPool__factory, Masset } from "types/generated"
import { BN } from "@utils/math"
import { dumpConfigStorage, dumpFassetStorage, dumpTokenStorage } from "./utils/storage-utils"
import {
    getMultiRedemptions,
    Balances,
    getBlock,
    getBlockRange,
    getBasket,
    snapConfig,
    getMints,
    getMultiMints,
    getSwaps,
    getRedemptions,
    outputFees,
} from "./utils/snap-utils"
import { Token, tokens } from "./utils/tokens"
import { btcFormatter, QuantityFormatter, usdFormatter } from "./utils/quantity-formatters"
import { getSwapRates } from "./utils/rates-utils"

const getBalances = async (mAsset: Masset | FeederPool, toBlock: number, asset: Token): Promise<Balances> => {
    const mAssetBalance = await mAsset.totalSupply({
        blockTag: toBlock,
    })
    const vaultBalance = await mAsset.balanceOf(asset.saving, {
        blockTag: toBlock,
    })
    const otherBalances = mAssetBalance.sub(vaultBalance)

    console.log("\nHolders")
    console.log(`Vault                      ${usdFormatter(vaultBalance)} ${vaultBalance.mul(100).div(mAssetBalance)}%`)
    console.log(`Others                     ${usdFormatter(otherBalances)} ${otherBalances.mul(100).div(mAssetBalance)}%`)
    console.log(`Total                      ${usdFormatter(mAssetBalance)}`)

    return {
        total: mAssetBalance,
        save: vaultBalance,
        earn: BN.from(0),
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

const getQuantities = (fAsset: Token, _swapSize?: number): { quantityFormatter: QuantityFormatter; swapSize: number } => {
    let quantityFormatter: QuantityFormatter
    let swapSize: number
    if (fAsset.quantityFormatter === "USD") {
        quantityFormatter = usdFormatter
        swapSize = _swapSize || 10000
    } else if (fAsset.quantityFormatter === "BTC") {
        quantityFormatter = btcFormatter
        swapSize = _swapSize || 1
    }
    return {
        quantityFormatter,
        swapSize,
    }
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
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12146627, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .addParam("fasset", "Token symbol of the feeder pool asset.", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre

        const [signer] = await ethers.getSigners()
        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) {
            console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`)
            process.exit(1)
        }
        console.log(`\nGetting snap for feeder pool ${fAsset.symbol} from block ${fromBlock.blockNumber}, to ${toBlock.blockNumber}`)
        const mAsset = tokens.find((t) => t.symbol === fAsset.parent)
        const fpAssets = [fAsset, mAsset]

        const feederPool = getFeederPool(signer, fAsset.feederPool)

        const { quantityFormatter } = getQuantities(fAsset, taskArgs.swapSize)

        await getBasket(
            feederPool,
            fpAssets.map((b) => b.symbol),
            mAsset.symbol,
            usdFormatter,
        )
        await snapConfig(feederPool, toBlock.blockNumber)

        const balances = await getBalances(feederPool, toBlock.blockNumber, fAsset)

        const mintSummary = await getMints(tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter)
        const mintMultiSummary = await getMultiMints(tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter)
        const swapSummary = await getSwaps(tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter)
        const redeemSummary = await getRedemptions(tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter)
        const redeemMultiSummary = await getMultiRedemptions(
            tokens,
            feederPool,
            fromBlock.blockNumber,
            toBlock.blockNumber,
            quantityFormatter,
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
            quantityFormatter,
        )
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

        const { quantityFormatter, swapSize } = getQuantities(fAsset, taskArgs.swapSize)

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(fpAssets, fpAssets, feederPool, block.blockNumber, quantityFormatter, swapSize)
        await getSwapRates([fAsset], mpAssets, feederPool, block.blockNumber, quantityFormatter, swapSize)
        await getSwapRates(mpAssets, [fAsset], feederPool, block.blockNumber, quantityFormatter, swapSize)
        await snapConfig(feederPool, block.blockNumber)
    })

module.exports = {}
