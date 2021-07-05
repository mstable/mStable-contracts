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
} from "./utils/snap-utils"
import { Token, renBTC, sBTC, WBTC, mBTC, TBTC, HBTC } from "./utils/tokens"
import { getSwapRates } from "./utils/rates-utils"
import { getSigner } from "./utils/defender-utils"
import { SavingsManager__factory } from "types/generated"
import { getNetworkAddress } from "./utils/networkAddressFactory"

const bAssets: Token[] = [renBTC, sBTC, WBTC]

const btcFormatter = (amount, decimals = 18, pad = 7, displayDecimals = 3): string => {
    const string2decimals = parseFloat(formatUnits(amount, decimals)).toFixed(displayDecimals)
    // Add thousands separator
    return string2decimals.replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(pad)
}

const getMasset = (signer: Signer, contractAddress = mBTC.address): MusdEth => MusdEth__factory.connect(contractAddress, signer)

task("mBTC-storage", "Dumps mBTC's storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, { ethers }) => {
        const toBlockNumber = taskArgs.to ? taskArgs.to : await ethers.provider.getBlockNumber()
        console.log(`Block number ${toBlockNumber}`)
        const signer = await getSigner(ethers)

        const mAsset = getMasset(signer)

        await dumpTokenStorage(mAsset, toBlockNumber)
        await dumpBassetStorage(mAsset, toBlockNumber)
        await dumpConfigStorage(mAsset, toBlockNumber)
    })

task("mBTC-snap", "Get the latest data from the mBTC contracts")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12094461, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, { ethers, network }) => {
        const signer = await getSigner(ethers)

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
        const savingsManagerAddress = getNetworkAddress("SavingsManager", network.name)
        const savingsManager = SavingsManager__factory.connect(savingsManagerAddress, signer)

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
                    address: mBTC.savings,
                },
                {
                    name: "Sushi Pool",
                    address: contracts.mainnet.sushiPool,
                },
                {
                    name: "tBTC Feeder Pool",
                    address: TBTC.feederPool,
                },
                {
                    name: "HBTC Feeder Pool",
                    address: HBTC.feederPool,
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
    .setAction(async (taskArgs, { ethers, network }) => {
        const signer = await getSigner(ethers)

        const mAsset = await getMasset(signer)
        const block = await getBlock(ethers, taskArgs.block)

        console.log(`\nGetting rates for mBTC at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(bAssets, bAssets, mAsset, block.blockNumber, btcFormatter, network.name, BN.from(taskArgs.swapSize))
        await snapConfig(mAsset, block.blockNumber)
    })

module.exports = {}
