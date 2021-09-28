import { subtask, task, types } from "hardhat/config"
import { BoostedVault__factory, StakingRewards__factory } from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { getSignerAccount } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { usdFormatter } from "./utils/quantity-formatters"
import { getBlock } from "./utils/snap-utils"

subtask("vault-snap", "Dumps user data for a vault")
    .addParam("user", "Address or contract name of user", undefined, types.string)
    .addOptionalParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", "mUSD", types.string)
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const userAddress = resolveAddress(taskArgs.user, chain)
        const block = await getBlock(hre.ethers, taskArgs.block)
        const overrides = {
            blockTag: block.blockNumber,
        }
        console.log(`\nGetting vault data for user ${taskArgs.user} at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        const vaultAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const vault = BoostedVault__factory.connect(vaultAddress, signerAccount.signer)

        // Balances
        const rawBalance = await vault.rawBalanceOf(userAddress, overrides)
        const boostedBalance = await vault.balanceOf(userAddress, overrides)
        console.log(`Raw balance     ${usdFormatter(rawBalance)}`)
        console.log(`Boosted balance ${usdFormatter(boostedBalance)}`)

        // Boost
        if (rawBalance.gt(0)) {
            const effectiveBoost = boostedBalance.mul(10000).div(rawBalance)
            const boost = await vault.getBoost(userAddress, overrides)
            console.log(`Effective boost ${formatUnits(effectiveBoost, 4).padStart(14)}x`)
            console.log(`getBoost        ${formatUnits(boost, 18).padStart(14)}x`)
        }

        // Rewards
        const rewardsUnclaimed = await vault.unclaimedRewards(userAddress, overrides)
        const rewardsClaimed = await vault.userClaim(userAddress, overrides)
        const rewardsEarned = await vault.earned(userAddress, overrides)
        const userData = await vault.userData(userAddress, overrides)

        console.log(`Unclaimed   ${usdFormatter(rewardsUnclaimed.amount)}`)
        console.log(`Claimed     ${usdFormatter(rewardsClaimed)}`)
        console.log(`Earned      ${usdFormatter(rewardsEarned)}`)
        console.log(`Last action ${new Date(userData.lastAction.toNumber() * 1000)}`)
        if (rewardsUnclaimed.first.gt(0)) {
            console.log(`First claim ${new Date(rewardsUnclaimed.first.toNumber() * 1000)}`)
            console.log(`Last claim  ${new Date(rewardsUnclaimed.last.toNumber() * 1000)}`)
        }

        if (hre.network.name === "hardhat") {
            await vault.pokeBoost(userAddress)
            const boost = await vault.getBoost(userAddress)
            console.log(`getBoost after poke ${formatUnits(boost, 18).padStart(14)}x`)
        }
    })
task("vault-snap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-stake", "Stake into a vault")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addParam("amount", "Amount to be staked", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const vaultAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const vault = StakingRewards__factory.connect(vaultAddress, signerAccount.signer)

        const amount = simpleToExactAmount(taskArgs.amount)

        const tx = await vault["stake(uint256)"](amount)
        await logTxDetails(tx, `${signerAccount.address} stakes ${amount} ${taskArgs.asset} in vault`)
    })
task("vault-stake").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-withdraw", "Withdraw from a vault")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addParam("amount", "Amount to be withdrawn", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const vaultAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const vault = StakingRewards__factory.connect(vaultAddress, signerAccount.signer)

        const amount = simpleToExactAmount(taskArgs.amount)

        const tx = await vault.withdraw(amount)
        await logTxDetails(tx, `${signerAccount.address} withdraw ${amount} ${taskArgs.asset} from vault`)
    })
task("vault-withdraw").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-exit", "Exit from vault claiming rewards")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const vaultAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const vault = StakingRewards__factory.connect(vaultAddress, signerAccount.signer)

        const tx = await vault.exit()
        await logTxDetails(tx, `${signerAccount.address} exits ${taskArgs.asset} vault`)
    })
task("vault-exit").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vault-claim", "Claim rewards from vault")
    .addParam("asset", "Symbol of the asset that has a mStable vault. eg mUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const vaultAddress = resolveAddress(taskArgs.asset, chain, "vault")
        const vault = StakingRewards__factory.connect(vaultAddress, signerAccount.signer)

        const tx = await vault.claimReward()
        await logTxDetails(tx, `${signerAccount.address} claim rewards from ${taskArgs.asset} vault`)
    })
task("vault-claim").setAction(async (_, __, runSuper) => {
    await runSuper()
})

module.exports = {}
