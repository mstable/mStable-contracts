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
    AssetProxy__factory,
} from "types/generated"
import { RewardsDistributorEth__factory } from "types/generated/factories/RewardsDistributorEth__factory"
import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { MAX_INT128 } from "@utils/constants"
import { PMTA, PmUSD, PUSDC, PWMATIC, tokens } from "./utils/tokens"
import { getSigner, getSignerAccount } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, getChainAddress } from "./utils/networkAddressFactory"
import { usdFormatter } from "./utils"
import { getAaveTokens, getAlcxTokens, getBlock, getBlockRange, getCompTokens } from "./utils/snap-utils"

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

task("polly-stake-imusd", "Stakes imUSD into the v-imUSD vault on Polygon")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const amount = simpleToExactAmount(20)
        const imUSD = ERC20__factory.connect(PmUSD.savings, signer)
        const tx1 = await imUSD.approve(PmUSD.vault, amount)
        await logTxDetails(tx1, "Relay approves v-imUSD vault to transfer imUSD")

        const vault = StakingRewards__factory.connect(PmUSD.vault, signer)

        const tx2 = await vault["stake(uint256)"](amount)
        await logTxDetails(tx2, `stake ${usdFormatter(amount)} imUSD in v-imUSD vault`)
    })

task("polly-dis-rewards", "Distributes MTA and WMATIC rewards to the imUSD vault on Polygon")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .addOptionalParam("mtaAmount", "MTA tokens", 20833, types.int)
    .addOptionalParam("wmaticAmount", "WMATIC tokens", 18666, types.int)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const mtaAmount = simpleToExactAmount(taskArgs.mtaAmount)
        const wmaticAmount = simpleToExactAmount(taskArgs.wmaticAmount)

        const rewardsDistributorAddress = getChainAddress("RewardsDistributor", chain)
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

task("dis-rewards", "Distributes MTA rewards to a vault on Mainnet")
    .addParam("vaultAsset", "Symbol of asset that is staked. eg mUSD, MTA, GUSD, alUSD", undefined, types.string)
    .addOptionalParam("amount", "MTA tokens", 20833, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const vaultAsset = tokens.find((t) => t.symbol === taskArgs.vaultAsset && t.chain === chain)
        if (!vaultAsset) throw Error(`Could not find vault asset with symbol ${taskArgs.vaultAsset}`)

        const rewardsDistributorAddress = getChainAddress("RewardsDistributor", chain)
        const rewardsDistributor = RewardsDistributorEth__factory.connect(rewardsDistributorAddress, signer)

        const mtaAmount = simpleToExactAmount(taskArgs.amount)

        const tx = await rewardsDistributor.distributeRewards([vaultAsset.vault], [mtaAmount])
        await logTxDetails(
            tx,
            `distributeRewards ${formatUnits(mtaAmount)} MTA to vault with asset ${vaultAsset.symbol} and address ${vaultAsset.vault}`,
        )
    })

task("rewards", "Get Compound and Aave platform reward tokens")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const block = await getBlock(hre.ethers, taskArgs.block)

        console.log(`\nGetting platform tokens at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        await getCompTokens(signer, block)
        await getAaveTokens(signer, block)
        await getAlcxTokens(signer, block)
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
        const signer = await getSigner(hre)

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
            console.log(`Upgraded at block ${log.blockNumber} to ${log.args.implementation}`)
        })
    })

task("vault-stake", "Stake into a vault")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addParam("amount", "Amount to be staked", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const signerAddress = await signer.getAddress()

        const assetSymbol = taskArgs.asset
        const assetToken = tokens.find((t) => t.symbol === assetSymbol && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${assetSymbol}`)
        if (!assetToken.vault) throw Error(`No vault is configured for asset ${assetSymbol}`)

        const vault = StakingRewards__factory.connect(assetToken.vault, signer)

        const amount = simpleToExactAmount(taskArgs.amount)

        const tx = await vault["stake(uint256)"](amount)
        await logTxDetails(tx, `${signerAddress} stakes ${amount} ${assetSymbol} in vault`)
    })

task("vault-withdraw", "Withdraw from a vault")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addParam("amount", "Amount to be withdrawn", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const assetSymbol = taskArgs.asset
        const assetToken = tokens.find((t) => t.symbol === assetSymbol && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${assetSymbol}`)
        if (!assetToken.vault) throw Error(`No vault is configured for asset ${assetSymbol}`)

        const vault = StakingRewards__factory.connect(assetToken.vault, signerAccount.signer)

        const amount = simpleToExactAmount(taskArgs.amount)

        const tx = await vault.withdraw(amount)
        await logTxDetails(tx, `${signerAccount.address} withdraw ${amount} ${assetSymbol} from vault`)
    })

task("vault-exit", "Exit from vault claiming rewards")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const assetSymbol = taskArgs.asset
        const assetToken = tokens.find((t) => t.symbol === assetSymbol && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${assetSymbol}`)
        if (!assetToken.vault) throw Error(`No vault is configured for asset ${assetSymbol}`)

        const vault = StakingRewards__factory.connect(assetToken.vault, signerAccount.signer)

        const tx = await vault.exit()
        await logTxDetails(tx, `${signerAccount.address} exits ${assetSymbol} vault`)
    })

task("vault-claim", "Claim rewards from vault")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const assetSymbol = taskArgs.asset
        const assetToken = tokens.find((t) => t.symbol === assetSymbol && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${assetSymbol}`)
        if (!assetToken.vault) throw Error(`No vault is configured for asset ${assetSymbol}`)

        const vault = StakingRewards__factory.connect(assetToken.vault, signer)

        const tx = await vault.claimReward()
        await logTxDetails(tx, `${signerAddress} claim rewards from ${assetSymbol} vault`)
    })

task("approve", "Approve account to transfer token from the Defender Relay account")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    // TODO support the account being a contract name
    .addParam("account", "Address of the account that is approved to transferFrom", undefined, types.string)
    .addOptionalParam("tokenType", "Token address, savings, vault or feederPool.", "address", types.string)
    .addOptionalParam("amount", "Amount to approve. Default is max unit128", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const assetSymbol = taskArgs.asset
        const assetToken = tokens.find((t) => t.symbol === assetSymbol && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${assetSymbol}`)

        const approveAccount = taskArgs.account
        // TODO validate address using a regex
        if (!approveAccount) throw Error(`Invalid approve address ${approveAccount}`)

        const { tokenType } = taskArgs
        if (!assetToken[tokenType]) throw Error(`Can not fine ${tokenType} for token ${assetSymbol}`)

        const token = ERC20__factory.connect(assetToken[tokenType], signer)

        const amount = taskArgs.amount ? simpleToExactAmount(taskArgs.amount) : MAX_INT128
        const tx = await token.approve(approveAccount, amount)
        await logTxDetails(tx, `${signerAddress} approves ${approveAccount} to transfer ${formatUnits(amount)} ${assetSymbol}`)
    })

module.exports = {}
