import { btcBassets, capFactor, contracts, startingCap } from "@utils/btcConstants"
import { Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { task, types } from "hardhat/config"
import { BN } from "@utils/math"
import { MusdEth__factory } from "types/generated/factories/MusdEth__factory"
import { MusdEth } from "types/generated/MusdEth"
import { dumpBassetStorage, dumpConfigStorage, dumpTokenStorage } from "./utils/storage-utils"
import {
    getMultiRedemptions,
    getBlockRange,
    getBasket,
    getBlock,
    snapConfig,
    getMints,
    getMultiMints,
    getRedemptions,
    getSwaps,
    outputFees,
    getBalances,
    getCollectedInterest,
    getSavingsManager,
} from "./utils/snap-utils"
import { Token, renBTC, sBTC, WBTC } from "./utils/tokens"
import { getSwapRates } from "./utils/rates-utils"

const bAssets: Token[] = [renBTC, sBTC, WBTC]

const btcFormatter = (amount, decimals = 18, pad = 7, displayDecimals = 3): string => {
    const string2decimals = parseFloat(formatUnits(amount, decimals)).toFixed(displayDecimals)
    // Add thousands separator
    return string2decimals.replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(pad)
}

const getMasset = (signer: Signer, contractAddress = "0x945Facb997494CC2570096c74b5F66A3507330a1"): MusdEth =>
    MusdEth__factory.connect(contractAddress, signer)

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
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12094461, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers, network } = hre

        const [signer] = await ethers.getSigners()

        let exposedValidator
        if (network.name !== "mainnet") {
            console.log("Not mainnet")

            const LogicFactory = await ethers.getContractFactory("MassetLogic")
            const logicLib = await LogicFactory.deploy()
            const linkedAddress = {
                libraries: {
                    MassetLogic: logicLib.address,
                },
            }
            const massetFactory = await ethers.getContractFactory("ExposedMassetLogic", linkedAddress)
            exposedValidator = await massetFactory.deploy()
        }

        const mAsset = getMasset(signer)
        const savingsManager = getSavingsManager(signer, hre.network.name)

        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        const mintSummary = await getMints(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)
        const mintMultiSummary = await getMultiMints(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)
        const redeemSummary = await getRedemptions(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)
        const redeemMultiSummary = await getMultiRedemptions(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)
        const swapSummary = await getSwaps(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, btcFormatter)

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
            toBlock.blockNumber,
            tvlConfig,
            exposedValidator,
        )
        await snapConfig(mAsset, toBlock.blockNumber)

        let accounts = []
        if (network.name === "mainnet") {
            accounts = [
                {
                    name: "imBTC",
                    address: contracts.mainnet.imBTC,
                },
                {
                    name: "Sushi Pool",
                    address: contracts.mainnet.sushiPool,
                },
                {
                    name: "tBTC Feeder Pool",
                    address: "0xb61a6f928b3f069a68469ddb670f20eeeb4921e0",
                },
                {
                    name: "HBTC Feeder Pool",
                    address: "0x48c59199da51b7e30ea200a74ea07974e62c4ba7",
                },
                {
                    name: "mStable Fund Manager",
                    address: contracts.mainnet.fundManager,
                },
            ]
        }
        const balances = await getBalances(mAsset, accounts, btcFormatter, toBlock.blockNumber)

        await getCollectedInterest(bAssets, mAsset, savingsManager, fromBlock, toBlock, btcFormatter, balances.save)

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
        await getSwapRates(bAssets, bAssets, mAsset, block.blockNumber, btcFormatter, hre.network.name, BN.from(taskArgs.swapSize))
        await snapConfig(mAsset, block.blockNumber)
    })

module.exports = {}
