import { task, types } from "hardhat/config"
import {
    PAaveIntegration__factory,
    PLiquidator__factory,
    SavingsManager__factory,
    AssetProxy__factory,
    QuestManager__factory,
} from "types/generated"
import { QuestType } from "types/stakedToken"
import axios from "axios"
import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers"
import { PmUSD, PUSDC, tokens } from "./utils/tokens"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
import { getBlockRange } from "./utils/snap-utils"
import { getPrivateTxDetails } from "./utils/taichi"
import { signQuestUsers } from "./utils/quest-utils"

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        const signer = await getSigner(hre, taskArgs.speed, false, taskArgs.pk)
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
        const tx = await questManager.addQuest(type, taskArgs.multiplier, expiry)
        await logTxDetails(tx, `Add ${taskArgs.type} quest with ${taskArgs.multiplier} multiplier`)
    })

task("quest-complete-queue", "Completes all user quests in the quests queue")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .addParam("signerKey", "Signer API key", undefined, types.string, false)
    .addParam("signerSecret", "Signer API secret", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const opsSigner = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const questManagerAddress = await resolveAddress("QuestManager", chain)
        const questManager = QuestManager__factory.connect(questManagerAddress, opsSigner)

        // get users who have completed quests from the queue
        const response = await axios.post("https://europe-west1-mstable-questbook.cloudfunctions.net/questbook", {
            query: `query { queue { userId ethereumId } }`,
        })
        const { queue } = response?.data?.data
        if (!queue) {
            console.log(response?.data)
            throw Error(`Failed to get quests from queue`)
        }
        if (queue.length === 0) {
            console.error(`No user completed quests`)
            process.exit(0)
        }
        // filter users to just the migration quest
        const migrationQuestId = 0
        const completedMigrationQuests = queue.filter((quest) => quest.ethereumId === migrationQuestId)
        const completedMigrationUsers = completedMigrationQuests.map((quest) => quest.userId)

        // Need to filter out any users that completed the quest themselves
        const hasCompletedPromises = completedMigrationUsers.map((user) => questManager.hasCompleted(user, migrationQuestId))
        const hasCompleted = await Promise.all(hasCompletedPromises)
        const filteredUsers = completedMigrationUsers.filter((user, i) => hasCompleted[i] === false)
        console.log(hasCompleted)

        console.log(`About to complete ${filteredUsers.length} users: ${filteredUsers}`)

        // Get Quest Signer from Defender
        const credentials = {
            apiKey: taskArgs.signerKey,
            apiSecret: taskArgs.signerSecret,
        }
        const provider = new DefenderRelayProvider(credentials)
        const questSigner = new DefenderRelaySigner(credentials, provider, { speed: taskArgs.speed })

        // Quest Signer signs the users as having completed the migration quest
        const sig = await signQuestUsers(0, filteredUsers, questSigner)

        // Complete the quests in the Quest Manager contract
        const tx = await questManager.completeQuestUsers(0, filteredUsers, sig)
        await logTxDetails(tx, "complete quest users")
    })

task("priv-status", "Gets the status of a private Taichi transaction.")
    .addParam("hash", "Transaction hash", undefined, types.string, false)
    .setAction(async (taskArgs) => {
        await getPrivateTxDetails(taskArgs.hash)
    })
