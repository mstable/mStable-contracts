/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Signer } from "ethers"

import { Masset, MassetManager__factory, Masset__factory, SavingsManager__factory } from "types/generated"
import { BN } from "@utils/math"
import { MusdEth__factory } from "types/generated/factories/MusdEth__factory"
import { MusdLegacy__factory } from "types/generated/factories/MusdLegacy__factory"
import { MusdLegacy } from "types/generated/MusdLegacy"
import { MusdEth } from "types/generated/MusdEth"
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
} from "./utils/snap-utils"
import { Token, sUSD, USDC, DAI, USDT, PUSDT, PUSDC, PDAI, mUSD, PmUSD, MmUSD, RmUSD, Chain } from "./utils/tokens"
import { usdFormatter } from "./utils/quantity-formatters"
import { getSwapRates } from "./utils/rates-utils"
import { getSigner } from "./utils"
import { getChain, getChainAddress } from "./utils/networkAddressFactory"

const mUsdBassets: Token[] = [sUSD, USDC, DAI, USDT]
const mUsdPolygonBassets: Token[] = [PUSDC, PDAI, PUSDT]

// major mUSD upgrade to MusdV3 that changes the ABI
export const musdUpgradeBlock = 12094376

const getMasset = (signer: Signer, networkName: string, block: number): Masset | MusdEth | MusdLegacy => {
    if (networkName === "polygon_mainnet") {
        return Masset__factory.connect(PmUSD.address, signer)
    }
    if (networkName === "polygon_testnet") {
        return Masset__factory.connect(MmUSD.address, signer)
    }
    if (networkName === "ropsten") {
        return MusdEth__factory.connect(RmUSD.address, signer)
    }
    // The block mUSD was upgraded to the latest Masset with contract name (Musdv3)
    if (block < musdUpgradeBlock) {
        return MusdLegacy__factory.connect(mUSD.address, signer)
    }
    return MusdEth__factory.connect(mUSD.address, signer)
}

task("mUSD-storage", "Dumps mUSD's storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, types.int)
    .addOptionalParam("type", "Type of storage to report. token, basset, config or all.", "all", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre)

        const blockNumber = taskArgs.block ? taskArgs.block : await hre.ethers.provider.getBlockNumber()
        console.log(`Block number ${blockNumber}`)

        const mAsset = getMasset(signer, hre.network.name, blockNumber)

        if (["token", "all"].includes(taskArgs.type)) await dumpTokenStorage(mAsset, blockNumber)
        if (["basset", "all"].includes(taskArgs.type)) await dumpBassetStorage(mAsset, blockNumber)
        if (["config", "all"].includes(taskArgs.type)) await dumpConfigStorage(mAsset, blockNumber)
    })

task("mUSD-snap", "Snaps mUSD")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12094461, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre)
        const chain = getChain(hre)
        const { network, ethers } = hre

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

        const { fromBlock, toBlock } = await getBlockRange(hre.ethers, taskArgs.from, taskArgs.to)

        const mAsset = getMasset(signer, network.name, toBlock.blockNumber)
        const savingsManagerAddress = getChainAddress("SavingsManager", chain)
        const savingsManager = SavingsManager__factory.connect(savingsManagerAddress, signer)

        const bAssets = network.name.includes("polygon") ? mUsdPolygonBassets : mUsdBassets

        let accounts = []
        if (chain === Chain.mainnet) {
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
        } else if (chain === Chain.polygon) {
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

        await getCollectedInterest(bAssets, mAsset, savingsManager, fromBlock, toBlock, usdFormatter, balances.save)

        await snapSave("mUSD", signer, chain, toBlock.blockNumber)

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
    .addOptionalParam("swapSize", "Swap size to compare rates with Curve", 10000, types.float)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre)
        const chain = getChain(hre)

        const block = await getBlock(hre.ethers, taskArgs.block)
        const mAsset = await getMasset(signer, hre.network.name, block.blockNumber)

        console.log(`\nGetting rates for mUSD at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        const bAssets = chain === Chain.polygon ? mUsdPolygonBassets : mUsdBassets

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(bAssets, bAssets, mAsset, block.blockNumber, usdFormatter, BN.from(taskArgs.swapSize), chain)
        await snapConfig(mAsset, block.blockNumber)
    })

task("mUSD-BassetAdded", "Lists the BassetAdded events from a mAsset")
    .addOptionalParam("masset", "Token symbol of mAsset. eg mUSD or mBTC", "mUSD", types.string)
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 10148031, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre)
        const chain = await getChain(hre)

        const { fromBlock, toBlock } = await getBlockRange(hre.ethers, taskArgs.from, taskArgs.to)

        const mAsset = await getMasset(signer, hre.network.name, toBlock.blockNumber)
        const massetManagerAddress = getChainAddress("MassetManager", chain)
        const manager = MassetManager__factory.connect(massetManagerAddress, signer)

        const filter = await manager.filters.BassetAdded()
        filter.address = mAsset.address
        const logs = await mAsset.queryFilter(filter, fromBlock.blockNumber, toBlock.blockNumber)

        console.log(`${await mAsset.symbol()} ${mAsset.address}`)
        if (logs.length === 0)
            console.error(`Failed to find any BassetAdded events between blocks ${fromBlock.blockNumber} and ${toBlock.blockNumber}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        logs.forEach((log: any) => {
            console.log(`Basset added at block ${log.blockNumber} in tx ${log.blockHash}`)
        })
    })

module.exports = {}
