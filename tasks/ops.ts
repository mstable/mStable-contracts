import axios from "axios"
import { ContractTransaction, Signer } from "ethers"
import { task, types } from "hardhat/config"
import { Speed } from "defender-relay-client"
import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers"
import { ISavingsManager, ISavingsManager__factory, IEjector__factory } from "types/generated"
import { formatUnits } from "@ethersproject/units"
import { tokens } from "./utils/tokens"

const getSavingsManager = (signer: Signer, contractAddress = "0x9781c4e9b9cc6ac18405891df20ad3566fb6b301"): ISavingsManager =>
    ISavingsManager__factory.connect(contractAddress, signer)

const getDefenderSigner = async (speed: Speed = "safeLow"): Promise<Signer> => {
    if (!process.env.DEFENDER_API_KEY || !process.env.DEFENDER_API_SECRET) {
        console.error(`Defender env vars DEFENDER_API_KEY and/or DEFENDER_API_SECRET have not been set`)
        process.exit(1)
    }
    if (!["safeLow", "average", "fast", "fastest"].includes(speed)) {
        console.error(`Defender Relay Speed param must be either 'safeLow', 'average', 'fast' or 'fastest'. Not "${speed}"`)
        process.exit(2)
    }
    const credentials = {
        apiKey: process.env.DEFENDER_API_KEY,
        apiSecret: process.env.DEFENDER_API_SECRET,
    }
    const provider = new DefenderRelayProvider(credentials)
    const signer = new DefenderRelaySigner(credentials, provider, { speed })
    return signer
}

const logTxDetails = async (tx: ContractTransaction, method: string): Promise<void> => {
    console.log(`Send ${method} transaction with hash ${tx.hash} from ${tx.from} with gas price ${tx.gasPrice.toNumber() / 1e9} Gwei`)
    const receipt = await tx.wait()

    // Calculate tx cost in Wei
    const txCost = receipt.gasUsed.mul(tx.gasPrice)
    console.log(`Processed ${method} tx in block ${receipt.blockNumber}, using ${receipt.gasUsed} gas costing ${formatUnits(txCost)} ETH`)
}

task("eject-stakers", "Ejects expired stakers from Meta staking contract (vMTA)")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "safeLow", types.string)
    .setAction(async (taskArgs) => {
        const signer = await getDefenderSigner(taskArgs.speed)

        const ejector = IEjector__factory.connect("0x71061E3F432FC5BeE3A6763Cd35F50D3C77A0434", signer)
        // TODO check the last time the eject was run
        // Check it's been more than 7 days since the last eject has been run

        // get stakers from API
        const response = await axios.get("https://api-dot-mstable.appspot.com/stakers")
        const stakers = response.data.ejected

        if (stakers.length === 0) {
            console.error(`No stakers to eject`)
            process.exit(0)
        }
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
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "safeLow", types.string)
    .setAction(async (taskArgs) => {
        const asset = tokens.find((t) => t.symbol === taskArgs.asset)
        if (!asset) {
            console.error(`Failed to find main or feeder pool asset with token symbol ${taskArgs.asset}`)
            process.exit(1)
        }

        const signer = await getDefenderSigner(taskArgs.speed)
        const savingManager = getSavingsManager(signer)

        const lastBatchCollected = await savingManager.lastBatchCollected(asset.address)
        const lastBatchDate = new Date(lastBatchCollected.mul(1000).toNumber())
        console.log(`The last interest collection was ${lastBatchDate.toUTCString()}, epoch ${lastBatchCollected} seconds`)

        const currentEpoc = new Date().getTime() / 1000
        if (currentEpoc - lastBatchCollected.toNumber() < 60 * 60 * 6) {
            console.error(`Can not run again as the last run was less then 6 hours ago`)
            process.exit(3)
        }

        const tx = await savingManager.collectAndStreamInterest(asset.address)
        await logTxDetails(tx, "collectAndStreamInterest")
    })

module.exports = {}
