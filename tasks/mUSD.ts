/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Contract, Signer } from "ethers"

import { Masset, Masset__factory } from "types/generated"
import { BN } from "@utils/math"
import { MusdEth } from "types/generated/MusdEth"
import mUsdEthAbi from "../contracts/masset/versions/mUsdEth.json"
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
    getSavingsManager,
} from "./utils/snap-utils"
import { Token, sUSD, USDC, DAI, USDT, PUSDT, PUSDC, PDAI } from "./utils/tokens"
import { usdFormatter } from "./utils/quantity-formatters"
import { getSwapRates } from "./utils/rates-utils"

const mUsdBassets: Token[] = [sUSD, USDC, DAI, USDT]
const mUsdPolygonBassets: Token[] = [PUSDC, PDAI, PUSDT]

const getMasset = (signer: Signer, networkName: string): Masset | MusdEth => {
    if (networkName === "polygon_mainnet") {
        return Masset__factory.connect("0xE840B73E5287865EEc17d250bFb1536704B43B21", signer)
    }
    if (networkName === "polygon_testnet") {
        return Masset__factory.connect("0x0f7a5734f208A356AB2e5Cf3d02129c17028F3cf", signer)
    }
    if (networkName === "ropsten") {
        return new Contract("0x4E1000616990D83e56f4b5fC6CC8602DcfD20459", mUsdEthAbi, signer) as MusdEth
    }
    return new Contract("0xe2f2a5C287993345a840Db3B0845fbC70f5935a5", mUsdEthAbi, signer) as MusdEth
}

task("mUSD-storage", "Dumps mUSD's storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre
        const [signer] = await ethers.getSigners()

        const toBlockNumber = taskArgs.to ? taskArgs.to : await ethers.provider.getBlockNumber()
        console.log(`Block number ${toBlockNumber}`)

        const mAsset = getMasset(signer, hre.network.name)

        await dumpTokenStorage(mAsset, toBlockNumber)
        await dumpBassetStorage(mAsset, toBlockNumber)
        await dumpConfigStorage(mAsset, toBlockNumber)
    })

task("mUSD-snap", "Snaps mUSD")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12094461, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers, network } = hre
        const [signer] = await ethers.getSigners()

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

        const mAsset = getMasset(signer, hre.network.name)
        const savingsManager = getSavingsManager(signer, hre.network.name)

        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        const bAssets = hre.network.name.includes("polygon") ? mUsdPolygonBassets : mUsdBassets

        let accounts = []
        if (network.name === "mainnet") {
            accounts = [
                {
                    name: "imUSD",
                    address: "0x30647a72dc82d7fbb1123ea74716ab8a317eac19",
                },
                {
                    name: "Curve mUSD",
                    address: "0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6",
                },
                {
                    name: "BUSD Feeder Pool",
                    address: "0xfe842e95f8911dcc21c943a1daa4bd641a1381c6",
                },
                {
                    name: "GUSD Feeder Pool",
                    address: "0x4fb30c5a3ac8e85bc32785518633303c4590752d",
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
                    address: "0x5290Ad3d83476CA6A2b178Cd9727eE1EF72432af",
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

        await snapSave(signer, hre.network.name, toBlock.blockNumber)

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

        const mAsset = await getMasset(signer, hre.network.name)
        const block = await getBlock(ethers, taskArgs.block)

        console.log(`\nGetting rates for mUSD at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        const bAssets = hre.network.name.includes("polygon") ? mUsdPolygonBassets : mUsdBassets

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(bAssets, bAssets, mAsset, block.blockNumber, usdFormatter, hre.network.name, BN.from(taskArgs.swapSize))
        await snapConfig(mAsset, block.blockNumber)
    })

module.exports = {}
