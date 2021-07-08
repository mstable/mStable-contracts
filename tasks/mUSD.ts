/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Signer } from "ethers"

import { Masset, Masset__factory, SavingsManager__factory } from "types/generated"
import { BN } from "@utils/math"
import { MusdEth } from "types/generated/MusdEth"
import { MusdEth__factory } from "types/generated/factories/MusdEth__factory"
import { dumpBassetStorage, dumpConfigStorage, dumpTokenStorage } from "./utils/storage-utils"
import {
    getMultiRedemptions,
    getBlock,
    getBlockRange,
    getBasket,
    snapConfig,
    getMints,
    getMultiMints,
    getSwaps,
    getRedemptions,
    outputFees,
    getBalances,
    snapSave,
    getCollectedInterest,
    getCompTokens,
    getAaveTokens,
} from "./utils/snap-utils"
import { Token, sUSD, USDC, DAI, USDT, PUSDT, PUSDC, PDAI, mUSD, PmUSD, MmUSD, RmUSD } from "./utils/tokens"
import { usdFormatter } from "./utils/quantity-formatters"
import { getSwapRates } from "./utils/rates-utils"
import { getSigner } from "./utils"
import { getNetworkAddress } from "./utils/networkAddressFactory"

const mUsdBassets: Token[] = [sUSD, USDC, DAI, USDT]
const mUsdPolygonBassets: Token[] = [PUSDC, PDAI, PUSDT]

const getMasset = (signer: Signer, networkName: string): Masset | MusdEth => {
    if (networkName === "polygon_mainnet") {
        return Masset__factory.connect(PmUSD.address, signer)
    }
    if (networkName === "polygon_testnet") {
        return Masset__factory.connect(MmUSD.address, signer)
    }
    if (networkName === "ropsten") {
        return MusdEth__factory.connect(RmUSD.address, signer)
    }
    return MusdEth__factory.connect(mUSD.address, signer)
}

task("mUSD-storage", "Dumps mUSD's storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, { ethers, network }) => {
        const signer = await getSigner(ethers)

        const toBlockNumber = taskArgs.block ? taskArgs.block : await ethers.provider.getBlockNumber()
        console.log(`Block number ${toBlockNumber}`)

        const mAsset = getMasset(signer, network.name)

        await dumpTokenStorage(mAsset, toBlockNumber)
        await dumpBassetStorage(mAsset, toBlockNumber)
        await dumpConfigStorage(mAsset, toBlockNumber)
    })

task("mUSD-snap", "Snaps mUSD")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12094461, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, { ethers, network }) => {
        const signer = await getSigner(ethers)

        let exposedValidator
        if (!["mainnet", "polygon_mainnet"].includes(network.name)) {
            console.log("Not a mainnet chain")

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

        const mAsset = getMasset(signer, network.name)
        const savingsManagerAddress = getNetworkAddress("SavingsManager", network.name)
        const savingsManager = SavingsManager__factory.connect(savingsManagerAddress, signer)

        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        const bAssets = network.name.includes("polygon") ? mUsdPolygonBassets : mUsdBassets

        let accounts = []
        if (network.name === "mainnet") {
            accounts = [
                {
                    name: "imUSD",
                    address: mUSD.savings,
                },
                {
                    name: "Iron Bank",
                    address: "0xbe86e8918dfc7d3cb10d295fc220f941a1470c5c",
                },
                {
                    name: "Curve mUSD",
                    address: "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6",
                },
                {
                    name: "mStable DAO",
                    address: "0x3dd46846eed8D147841AE162C8425c08BD8E1b41",
                },
                {
                    name: "Balancer ETH/mUSD 50/50 #2",
                    address: "0xe036cce08cf4e23d33bc6b18e53caf532afa8513",
                },
            ]
        } else if (network.name === "polygon_mainnet") {
            accounts = [
                {
                    name: "imUSD",
                    address: PmUSD.savings,
                },
            ]
        }

        const mintSummary = await getMints(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)
        const mintMultiSummary = await getMultiMints(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)
        const swapSummary = await getSwaps(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)
        const redeemSummary = await getRedemptions(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)
        const redeemMultiSummary = await getMultiRedemptions(bAssets, mAsset, fromBlock.blockNumber, toBlock.blockNumber, usdFormatter)

        await snapConfig(mAsset, toBlock.blockNumber)

        await getBasket(
            mAsset,
            bAssets.map((b) => b.symbol),
            "mUSD",
            usdFormatter,
            toBlock.blockNumber,
            undefined,
            exposedValidator,
        )

        const balances = await getBalances(mAsset, accounts, usdFormatter, toBlock.blockNumber)

        const collectedInterestSummary = await getCollectedInterest(
            bAssets,
            mAsset,
            savingsManager,
            fromBlock,
            toBlock,
            usdFormatter,
            balances.save,
        )

        await snapSave(signer, network.name, toBlock.blockNumber)

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
    .setAction(async (taskArgs, { ethers, network }) => {
        const signer = await getSigner(ethers)

        const mAsset = await getMasset(signer, network.name)
        const block = await getBlock(ethers, taskArgs.block)

        console.log(`\nGetting rates for mUSD at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        const bAssets = network.name.includes("polygon") ? mUsdPolygonBassets : mUsdBassets

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(bAssets, bAssets, mAsset, block.blockNumber, usdFormatter, network.name, BN.from(taskArgs.swapSize))
        await snapConfig(mAsset, block.blockNumber)
    })

task("rewards", "Get Compound and Aave platform reward tokens")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, { ethers }) => {
        const signer = await getSigner(ethers)

        const block = await getBlock(ethers, taskArgs.block)

        console.log(`\nGetting platform tokens at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        await getCompTokens(signer, block)
        await getAaveTokens(signer, block)
    })

module.exports = {}
