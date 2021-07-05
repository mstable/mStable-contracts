import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Signer } from "ethers"

import { ERC20__factory, FeederPool, FeederPool__factory, IERC20__factory, Masset } from "types/generated"
import { BN, simpleToExactAmount } from "@utils/math"
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
    getSavingsManager,
    getCollectedInterest,
} from "./utils/snap-utils"
import { PFRAX, PmUSD, Token, tokens } from "./utils/tokens"
import { btcFormatter, QuantityFormatter, usdFormatter } from "./utils/quantity-formatters"
import { getSwapRates } from "./utils/rates-utils"
import { getSigner } from "./utils/defender-utils"
import { logTxDetails } from "./utils"
import { getNetworkAddress } from "./utils/networkAddressFactory"

const getBalances = async (mAsset: Masset | FeederPool, toBlock: number, asset: Token): Promise<Balances> => {
    const mAssetBalance = await mAsset.totalSupply({
        blockTag: toBlock,
    })
    const vaultBalance = await mAsset.balanceOf(asset.vault, {
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
        __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: getNetworkAddress("FeederManager"),
        // FeederLogic
        __$7791d1d5b7ea16da359ce352a2ac3a881c$__: getNetworkAddress("FeederLogic"),
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
    .addParam("fasset", "Token symbol of the feeder pool asset.  eg HBTC, TBTC, GUSD or BUSD", undefined, types.string, false)
    .setAction(async (taskArgs, { ethers }) => {
        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) {
            console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`)
            process.exit(1)
        }

        const { blockNumber } = await getBlock(ethers, taskArgs.block)

        const signer = await getSigner(ethers)
        const pool = getFeederPool(signer, fAsset.feederPool)

        await dumpTokenStorage(pool, blockNumber)
        await dumpFassetStorage(pool, blockNumber)
        await dumpConfigStorage(pool, blockNumber)
    })

task("feeder-snap", "Gets feeder transactions over a period of time")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12146627, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, TBTC, GUSD or BUSD", undefined, types.string, false)
    .setAction(async (taskArgs, { ethers, network }) => {
        const signer = await getSigner(ethers)
        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) {
            console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`)
            process.exit(1)
        }
        console.log(`\nGetting snap for feeder pool ${fAsset.symbol} from block ${fromBlock.blockNumber}, to ${toBlock.blockNumber}`)
        const mAsset = tokens.find((t) => t.symbol === fAsset.parent)
        const fpAssets = [mAsset, fAsset]

        const feederPool = getFeederPool(signer, fAsset.feederPool)
        const savingsManager = getSavingsManager(signer, network.name)

        const { quantityFormatter } = getQuantities(fAsset, taskArgs.swapSize)

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

        await snapConfig(feederPool, toBlock.blockNumber)
        await getBasket(
            feederPool,
            fpAssets.map((b) => b.symbol),
            mAsset.symbol,
            usdFormatter,
            toBlock.blockNumber,
        )

        const balances = await getBalances(feederPool, toBlock.blockNumber, fAsset)

        const collectedInterestSummary = await getCollectedInterest(
            fpAssets,
            feederPool,
            savingsManager,
            fromBlock,
            toBlock,
            quantityFormatter,
            balances.save,
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
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, TBTC, GUSD or BUSD", undefined, types.string, false)
    .setAction(async (taskArgs, { ethers, network }) => {
        const signer = await getSigner(ethers)

        const block = await getBlock(ethers, taskArgs.block)

        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) {
            console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`)
            process.exit(1)
        }
        console.log(`\nGetting rates for feeder pool ${fAsset.symbol} at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)
        const feederPool = getFeederPool(signer, fAsset.feederPool)

        const mAsset = tokens.find((t) => t.symbol === fAsset.parent)
        const fpAssets = [mAsset, fAsset]

        // Get the bAssets for the main pool. eg bAssets in mUSD or mBTC
        // These are the assets that are not feeder pools and parent matches the fAsset's parent
        const mpAssets = tokens.filter((t) => t.parent === fAsset.parent && !t.feederPool)

        const { quantityFormatter, swapSize } = getQuantities(fAsset, taskArgs.swapSize)

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(fpAssets, fpAssets, feederPool, block.blockNumber, quantityFormatter, network.name, swapSize)
        await getSwapRates([fAsset], mpAssets, feederPool, block.blockNumber, quantityFormatter, network.name, swapSize)
        await getSwapRates(mpAssets, [fAsset], feederPool, block.blockNumber, quantityFormatter, network.name, swapSize)
        await snapConfig(feederPool, block.blockNumber)
    })

task("frax-post-deploy", "Mint FRAX Feeder Pool").setAction(async (_, { ethers }) => {
    const signer = await getSigner(ethers)

    const frax = ERC20__factory.connect(PFRAX.address, signer)
    const fraxFp = FeederPool__factory.connect(PFRAX.feederPool, signer)
    const musd = await IERC20__factory.connect(PmUSD.address, signer)

    const approveAmount = simpleToExactAmount(100)
    const bAssetAmount = simpleToExactAmount(10)
    const minAmount = simpleToExactAmount(9)

    let tx = await frax.approve(PFRAX.feederPool, approveAmount)
    await logTxDetails(tx, "approve FRAX")

    tx = await musd.approve(PFRAX.feederPool, approveAmount)
    await logTxDetails(tx, "approve mUSD")

    tx = await fraxFp.mintMulti([PFRAX.address, PmUSD.address], [bAssetAmount, bAssetAmount], minAmount, await signer.getAddress())
    await logTxDetails(tx, "mint FRAX FP")
})

module.exports = {}
