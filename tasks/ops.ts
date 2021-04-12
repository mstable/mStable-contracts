import { Signer } from "ethers"
import { task, types } from "hardhat/config"
import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers"
import { ISavingsManager, ISavingsManager__factory } from "types/generated"
import { formatUnits } from "@ethersproject/units"
import { tokens } from "./utils/tokens"

const getSavingsManager = (signer: Signer, contractAddress = "0x9781c4e9b9cc6ac18405891df20ad3566fb6b301"): ISavingsManager =>
    ISavingsManager__factory.connect(contractAddress, signer)

task("collect-interest", "Collects and streams interest from platforms")
    .addParam(
        "asset",
        "Token symbol of main or feeder pool asset. eg mUSD, mBTC, fpmBTC/HBTC or fpmUSD/GUSD",
        undefined,
        types.string,
        false,
    )
    .setAction(async (taskArgs) => {
        const asset = tokens.find((t) => t.symbol === taskArgs.asset)
        if (!asset) {
            console.error(`Failed to find main or feeder pool asset with token symbol ${taskArgs.asset}`)
            process.exit(1)
        }

        if (!process.env.DEFENDER_API_KEY || !process.env.DEFENDER_API_SECRET) {
            console.error(`Defender env vars DEFENDER_API_KEY and/or DEFENDER_API_SECRET have not been set`)
            process.exit(1)
        }
        const credentials = {
            apiKey: process.env.DEFENDER_API_KEY,
            apiSecret: process.env.DEFENDER_API_SECRET,
        }
        const provider = new DefenderRelayProvider(credentials)
        const signer = new DefenderRelaySigner(credentials, provider, { speed: "safeLow" })

        const savingManager = getSavingsManager(signer)

        const lastBatchCollected = await savingManager.lastBatchCollected(asset.address)
        const lastBatchDate = new Date(lastBatchCollected.mul(1000).toNumber())
        console.log(`The last interest collection was ${lastBatchDate.toUTCString()}, epoch ${lastBatchCollected} seconds`)

        const currentEpoc = new Date().getTime() / 1000
        if (currentEpoc - lastBatchCollected.toNumber() < 60 * 60 * 6) {
            console.error(`Can not run again as the last run was less then 6 hours ago`)
            process.exit(2)
        }

        const tx = await savingManager.collectAndStreamInterest(asset.address)
        console.log(
            `Send collectAndStreamInterest transaction with hash ${tx.hash} from ${tx.from} with gas price ${
                tx.gasPrice.toNumber() / 1e9
            } Gwei`,
        )
        const receipt = await tx.wait()
        // Calculate tx cost in Wei
        const txCost = receipt.gasUsed.mul(tx.gasPrice)
        console.log(
            `Processed collectAndStreamInterest tx in block ${receipt.blockNumber}, using ${receipt.gasUsed} gas costing ${formatUnits(
                txCost,
            )} ETH`,
        )
    })

module.exports = {}
