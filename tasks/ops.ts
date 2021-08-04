import axios from "axios"
import { subtask, task, types } from "hardhat/config"
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
import { BN, simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { Chain, PmUSD, PUSDC, tokens } from "./utils/tokens"
import { getSigner, getSignerAccount } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
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

subtask("dis-rewards", "Distributes MTA rewards to a mStable vault and 3rd party pools")
    .addParam(
        "vaultAssets",
        "Comma separated list of token symbols for vault assets or contract names for pools with no spaces. eg mUSD,MTA,GUSD,UniswapV2-MTA/WETH",
        undefined,
        types.string,
    )
    .addParam(
        "mtaAmounts",
        "Comma separated list of MTA amounts with no spaces. eg 23278.21,16966.51,30180.15,23324.25",
        undefined,
        types.string,
    )
    .addOptionalParam(
        "platformAmounts",
        "Comma separated list of platform reward, eg WMATIC, amounts with no spaces. eg 20832,15000",
        undefined,
        types.string,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        // Validate the comma separated params
        const vaultSymbols = taskArgs.vaultAssets.split(",")
        const mtaAmounts = taskArgs.mtaAmounts.split(",")
        const platformAmounts = taskArgs.platformAmounts?.split(",") || []
        if (vaultSymbols.length === 0) throw Error(`Must be at least one vault asset or pool`)
        if (vaultSymbols.length !== mtaAmounts.length)
            throw Error(
                `${vaultSymbols.length} vault assets ${taskArgs.vaultAssets} does not match the ${mtaAmounts.length} MTA amounts ${taskArgs.amounts}.`,
            )
        if (chain === Chain.polygon && vaultSymbols.length !== platformAmounts.length)
            throw Error(
                `${vaultSymbols.length} vault assets ${taskArgs.vaultAssets} does not match the ${platformAmounts.length} platform amounts ${taskArgs.platformAmounts}.`,
            )

        // Resolve the vault addresses from the asset symbols
        const vaultsAddresses = vaultSymbols.map((symbol) => resolveAddress(symbol, chain, "vault"))

        // Convert the MTA amounts to BN amounts to 18 decimal places
        let mtaAmountsTotal = BN.from(0)
        const mtaAmountsBN = mtaAmounts.map((amount) => {
            const amountBN = simpleToExactAmount(amount)
            mtaAmountsTotal = mtaAmountsTotal.add(amountBN)
            return amountBN
        })

        // Convert the platform amounts to BN amounts to 18 decimal places
        let platformAmountsTotal = BN.from(0)
        const platformAmountsBN = platformAmounts.map((amount) => {
            const amountBN = simpleToExactAmount(amount)
            platformAmountsTotal = platformAmountsTotal.add(amountBN)
            return amountBN
        })

        if (chain === Chain.mainnet) {
            const rewardsDistributorAddress = getChainAddress("RewardsDistributor", chain)
            const rewardsDistributor = RewardsDistributorEth__factory.connect(rewardsDistributorAddress, signer)

            const tx = await rewardsDistributor.distributeRewards(vaultsAddresses, mtaAmountsBN)
            await logTxDetails(
                tx,
                `distribute ${formatUnits(mtaAmountsTotal)} MTA to ${vaultsAddresses.length} vaults or pools ${
                    taskArgs.vaultAssets
                } with MTA amounts ${taskArgs.mtaAmounts}`,
            )
        } else if (chain === Chain.polygon) {
            const rewardsDistributorAddress = getChainAddress("RewardsDistributor", chain)
            const rewardsDistributor = RewardsDistributor__factory.connect(rewardsDistributorAddress, signer)

            const tx = await rewardsDistributor.distributeRewards(vaultsAddresses, mtaAmountsBN, platformAmountsBN)
            await logTxDetails(
                tx,
                `distribute ${formatUnits(mtaAmountsTotal)} MTA and ${platformAmountsTotal} platform rewards to ${
                    vaultsAddresses.length
                } vaults or pools ${taskArgs.vaultAssets} with MTA amounts ${taskArgs.mtaAmounts} and platform amounts ${
                    taskArgs.platformAmounts
                }`,
            )
        }
    })
task("dis-rewards").setAction(async (_, __, runSuper) => {
    await runSuper()
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
            console.log(`Upgraded at block ${log.blockNumber} to ${log.args.implementation} in tx in ${log.blockHash}`)
        })
    })

task("vault-stake", "Stake into a vault")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addParam("amount", "Amount to be staked", undefined, types.float)
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
    .addParam("amount", "Amount to be withdrawn", undefined, types.float)
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

module.exports = {}
