import axios from "axios"
import { task, types } from "hardhat/config"
import {
    IEjector__factory,
    PAaveIntegration__factory,
    PLiquidator__factory,
    SavingsManager__factory,
    RewardsDistributor__factory,
    StakingRewards__factory,
    ERC20__factory,
} from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { PMTA, PmUSD, PWMATIC, tokens } from "./utils/tokens"
import { getSigner } from "./utils/defender-utils"
import { logTxDetails } from "./utils/deploy-utils"
import { getNetworkAddress } from "./utils/networkAddressFactory"
import { usdFormatter } from "./utils"

task("eject-stakers", "Ejects expired stakers from Meta staking contract (vMTA)")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, { ethers, hardhatArguments, network }) => {
        const signer = await getSigner(ethers, taskArgs.speed)

        const ejectorAddress = getNetworkAddress("Ejector", network.name, hardhatArguments.config)
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
    .setAction(async (taskArgs, { ethers, hardhatArguments, network }) => {
        const asset = tokens.find((t) => t.symbol === taskArgs.asset)
        if (!asset) {
            console.error(`Failed to find main or feeder pool asset with token symbol ${taskArgs.asset}`)
            process.exit(1)
        }

        const signer = await getSigner(ethers, taskArgs.speed)
        const savingsManagerAddress = getNetworkAddress("SavingsManager", network.name, hardhatArguments.config)
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
    .setAction(async (taskArgs, { ethers, hardhatArguments, network }) => {
        const signer = await getSigner(ethers, taskArgs.speed)

        const aave = PAaveIntegration__factory.connect(PmUSD.integrator, signer)
        const aaveTx = await aave.claimRewards({ gasLimit: 200000 })
        await logTxDetails(aaveTx, "claimRewards")

        const liquidatorAddress = getNetworkAddress("Liquidator", network.name, hardhatArguments.config)
        const liquidator = PLiquidator__factory.connect(liquidatorAddress, signer)
        const liquidatorTx = await liquidator.triggerLiquidation(PmUSD.integrator, { gasLimit: 2000000 })
        await logTxDetails(liquidatorTx, "triggerLiquidation")

        const savingsManagerAddress = getNetworkAddress("SavingsManager", network.name, hardhatArguments.config)
        const savingsManager = SavingsManager__factory.connect(savingsManagerAddress, signer)
        const savingsManagerTx = await savingsManager.collectAndStreamInterest(PmUSD.address, {
            gasLimit: 2000000,
        })
        await logTxDetails(savingsManagerTx, "collectAndStreamInterest")
    })

task("polly-stake-imusd", "Stakes imUSD into the v-imUSD vault on Polygon")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, { ethers }) => {
        const signer = await getSigner(ethers, taskArgs.speed)

        const amount = simpleToExactAmount(20)
        const imUSD = ERC20__factory.connect(PmUSD.savings, signer)
        const tx1 = await imUSD.approve(PmUSD.vault, amount)
        await logTxDetails(tx1, "Relay approves v-imUSD vault to transfer imUSD")

        const vault = StakingRewards__factory.connect(PmUSD.vault, signer)

        const tx2 = await vault["stake(uint256)"](amount)
        await logTxDetails(tx2, `stake ${usdFormatter(amount)} imUSD in v-imUSD vault`)
    })

task("polly-dis-rewards", "Distributes MTA and WMATIC rewards to vaults on Polygon")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .addOptionalParam("mtaAmount", "MTA tokens", 20833, types.int)
    .addOptionalParam("wmaticAmount", "WMATIC tokens", 18666, types.int)
    .setAction(async (taskArgs, { ethers, hardhatArguments, network }) => {
        const signer = await getSigner(ethers, taskArgs.speed)
        const mtaAmount = simpleToExactAmount(taskArgs.mtaAmount)
        const wmaticAmount = simpleToExactAmount(taskArgs.wmaticAmount)

        const rewardsDistributorAddress = getNetworkAddress("RewardsDistributor", network.name, hardhatArguments.config)
        const rewardsDistributor = RewardsDistributor__factory.connect(rewardsDistributorAddress, signer)

        const mtaToken = ERC20__factory.connect(PMTA.address, signer)
        const tx1 = await mtaToken.approve(rewardsDistributorAddress, mtaAmount)
        await logTxDetails(tx1, `Relay account approve RewardsDistributor contract to transfer ${usdFormatter(mtaAmount)} MTA`)

        const wmaticToken = ERC20__factory.connect(PWMATIC.address, signer)
        const tx2 = await wmaticToken.approve(rewardsDistributorAddress, wmaticAmount)
        await logTxDetails(tx2, `Relay account approve RewardsDistributor contract to transfer ${usdFormatter(wmaticAmount)} WMATIC`)

        const tx3 = await rewardsDistributor.distributeRewards([PmUSD.vault], [mtaAmount], [wmaticAmount])
        await logTxDetails(tx3, `distributeRewards ${usdFormatter(mtaAmount)} MTA and ${usdFormatter(wmaticAmount)} WMATIC`)
    })

module.exports = {}
