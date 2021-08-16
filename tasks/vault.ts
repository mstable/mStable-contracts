import { task, types } from "hardhat/config"
import { StakingRewards__factory } from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { tokens } from "./utils/tokens"
import { getSignerAccount } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain } from "./utils/networkAddressFactory"

task("vault-stake", "Stake into a vault")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addParam("amount", "Amount to be staked", undefined, types.float)
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

        const tx = await vault["stake(uint256)"](amount)
        await logTxDetails(tx, `${signerAccount.address} stakes ${amount} ${assetSymbol} in vault`)
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
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const assetSymbol = taskArgs.asset
        const assetToken = tokens.find((t) => t.symbol === assetSymbol && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${assetSymbol}`)
        if (!assetToken.vault) throw Error(`No vault is configured for asset ${assetSymbol}`)

        const vault = StakingRewards__factory.connect(assetToken.vault, signerAccount.signer)

        const tx = await vault.claimReward()
        await logTxDetails(tx, `${signerAccount.address} claim rewards from ${assetSymbol} vault`)
    })

module.exports = {}
