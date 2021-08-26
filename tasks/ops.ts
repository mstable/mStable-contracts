import axios from "axios"
import { task, types } from "hardhat/config"
import {
    IEjector__factory,
    PAaveIntegration__factory,
    PLiquidator__factory,
    SavingsManager__factory,
    AssetProxy__factory,
    QuestManager__factory,
} from "types/generated"
import { QuestType } from "types/stakedToken"
import { PmUSD, PUSDC, tokens } from "./utils/tokens"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
import { getBlockRange } from "./utils/snap-utils"

task("eject-stakers", "Ejects expired stakers from Meta staking contract (vMTA)")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const ejectorAddress = getChainAddress("Ejector", chain)
        console.log(`Ejector address ${ejectorAddress}`)
        const ejector = IEjector__factory.connect(ejectorAddress, signer)
        // TODO check the last time the eject was run
        // Check it's been more than 7 days since the last eject has been run

        // get stakers from API
        const response = await axios.get("https://api-dot-mstable.appspot.com/stakers")
        const stakers = response.data.ejected

        if (stakers.length === 0) {
            console.error(`No stakers to eject`)
            process.exit(0)
        }
        console.log(`${stakers.length} stakers to be ejected: ${stakers}`)
        const tx = await ejector.ejectMany(stakers)
        await logTxDetails(tx, "ejectMany")
    })

task("collect-interest", "Collects and streams interest from platforms")
    .addParam(
        "asset",
        "Token symbol of main or feeder pool asset. eg mUSD, mBTC, fpmBTC/HBTC or fpmUSD/GUSD",
        undefined,
        types.string,
        false,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const asset = tokens.find((t) => t.symbol === taskArgs.asset)
        if (!asset) {
            console.error(`Failed to find main or feeder pool asset with token symbol ${taskArgs.asset}`)
            process.exit(1)
        }

        const savingsManagerAddress = getChainAddress("SavingsManager", chain)
        const savingsManager = SavingsManager__factory.connect(savingsManagerAddress, signer)

        const lastBatchCollected = await savingsManager.lastBatchCollected(asset.address)
        const lastBatchDate = new Date(lastBatchCollected.mul(1000).toNumber())
        console.log(`The last interest collection was ${lastBatchDate.toUTCString()}, epoch ${lastBatchCollected} seconds`)

        const currentEpoc = new Date().getTime() / 1000
        if (currentEpoc - lastBatchCollected.toNumber() < 60 * 60 * 6) {
            console.error(`Can not run again as the last run was less then 6 hours ago`)
            process.exit(3)
        }

        const tx = await savingsManager.collectAndStreamInterest(asset.address)
        await logTxDetails(tx, "collectAndStreamInterest")
    })

task("polly-daily", "Runs the daily jobs against the contracts on Polygon mainnet")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const aave = PAaveIntegration__factory.connect(PUSDC.integrator, signer)
        const aaveTx = await aave.claimRewards({ gasLimit: 200000 })
        await logTxDetails(aaveTx, "claimRewards")

        const liquidatorAddress = getChainAddress("Liquidator", chain)
        const liquidator = PLiquidator__factory.connect(liquidatorAddress, signer)
        const liquidatorTx = await liquidator.triggerLiquidation(PUSDC.integrator, { gasLimit: 2000000 })
        await logTxDetails(liquidatorTx, "triggerLiquidation")

        const savingsManagerAddress = getChainAddress("SavingsManager", chain)
        const savingsManager = SavingsManager__factory.connect(savingsManagerAddress, signer)
        const savingsManagerTx = await savingsManager.collectAndStreamInterest(PmUSD.address, {
            gasLimit: 2000000,
        })
        await logTxDetails(savingsManagerTx, "collectAndStreamInterest")
    })

task("proxy-upgrades", "Proxy implementation changes")
    .addParam(
        "asset",
        "Token symbol of main or feeder pool asset. eg mUSD, mBTC, fpmBTC/HBTC or fpmUSD/GUSD",
        undefined,
        types.string,
        false,
    )
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 10148031, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const asset = tokens.find((t) => t.symbol === taskArgs.asset)
        if (!asset) {
            console.error(`Failed to find main or feeder pool asset with token symbol ${taskArgs.asset}`)
            process.exit(1)
        }

        const { fromBlock, toBlock } = await getBlockRange(hre.ethers, taskArgs.from, taskArgs.to)

        const proxy = AssetProxy__factory.connect(asset.address, signer)

        const filter = await proxy.filters.Upgraded()
        const logs = await proxy.queryFilter(filter, fromBlock.blockNumber, toBlock.blockNumber)

        console.log(`${asset.symbol} proxy ${asset.address}`)
        logs.forEach((log: any) => {
            console.log(`Upgraded at block ${log.blockNumber} to ${log.args.implementation} in tx in ${log.blockHash}`)
        })
    })

task("quest-add", "Adds a quest to the staked token")
    .addParam("multiplier", "Quest multiplier. 1 = 1.01x or 1%, 10 = 1.1x or 10%", undefined, types.int, false)
    .addParam("type", "Seasonal or permanent", "seasonal", types.string)
    .addOptionalParam("pk", "Test private key", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, taskArgs.pk)
        const chain = getChain(hre)

        let type: QuestType
        if (taskArgs.type === "seasonal" || taskArgs.type === "s") {
            type = QuestType.SEASONAL
        } else if (taskArgs.type === "permanent" || taskArgs.type === "p") {
            type = QuestType.PERMANENT
        } else {
            throw Error(`Invalid quest type ${taskArgs.type}. Must be either: seasonal, s, permanent or p.`)
        }

        const questManagerAddress = await resolveAddress("QuestManager", chain)
        const questManager = QuestManager__factory.connect(questManagerAddress, signer)
        const expiry = Math.floor(Date.now() / 1000)
        const addQuestData = questManager.interface.encodeFunctionData("addQuest", [type, taskArgs.multiplier, expiry])
        console.log(`Destination ${questManagerAddress}, data: ${addQuestData}`)
        // const tx = await questManager.addQuest(type, taskArgs.multiplier, expiry)
        // await logTxDetails(tx, `Add ${taskArgs.type} quest with ${taskArgs.multiplier} multiplier`)
    })
