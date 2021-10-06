import { subtask, task, types } from "hardhat/config"
import { StakedTokenBPT__factory, StakedTokenMTA__factory, StakedToken__factory } from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "@ethersproject/units"
import { ONE_WEEK } from "@utils/constants"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { usdFormatter } from "./utils/quantity-formatters"

subtask("staked-snap", "Dumps a user's staking token details.")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("user", "Address or contract name of user", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre)
        const chain = getChain(hre)

        const userAddress = resolveAddress(taskArgs.user, chain)

        const tokenType = taskArgs.asset === "MTA" ? "vault" : "address"
        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, tokenType)
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)

        const [rawBalance, cooldownBalance] = await stakingToken.rawBalanceOf(userAddress)
        const boostedBalance = await stakingToken.balanceOf(userAddress)
        const votes = await stakingToken.getVotes(userAddress)
        const effectiveMultiplier = boostedBalance.mul(10000).div(rawBalance)
        const balanceData = await stakingToken.balanceData(userAddress)
        const delegatee = await stakingToken.delegates(userAddress)

        console.log(`Raw balance          ${usdFormatter(rawBalance)}`)
        console.log(`Boosted balance      ${usdFormatter(boostedBalance)}`)
        console.log(`Voting power         ${usdFormatter(votes)}`)
        console.log(`Cooldown balance     ${usdFormatter(cooldownBalance)}`)
        console.log(`Effective multiplier ${formatUnits(effectiveMultiplier, 2).padStart(14)}`)

        // Multipliers
        console.log("\nMultipliers")
        console.log(`Time  ${balanceData.timeMultiplier.toString().padStart(2)}`)
        console.log(`Quest ${balanceData.questMultiplier.toString().padStart(2)}`)

        if (balanceData.cooldownTimestamp > 0) {
            const cooldownEnds = balanceData.cooldownTimestamp + ONE_WEEK.mul(3).toNumber()
            console.log(`\nCooldown ends ${new Date(cooldownEnds * 1000)}`)
            console.log(`Cooldown units ${usdFormatter(balanceData.cooldownUnits)}`)
        }

        console.log(`\nDelegatee ${delegatee}`)
    })
task("staked-snap").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-stake", "Stake MTA or mBPT in V2 Staking Token")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("amount", "Amount to of token to be staked without the token decimals.", undefined, types.float)
    .addParam("delegate", "Address or contract name the voting power will be delegated to.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const tokenType = taskArgs.asset === "MTA" ? "vault" : "address"
        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, tokenType)
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const stakeAmount = simpleToExactAmount(taskArgs.amount)
        let tx
        if (taskArgs.delegate) {
            const delegateAddress = resolveAddress(taskArgs.delegate, chain)
            tx = await stakingToken["stake(uint256,address)"](stakeAmount, delegateAddress)
        } else {
            tx = await stakingToken["stake(uint256)"](stakeAmount)
        }
        await logTxDetails(tx, `Stake ${taskArgs.amount} ${taskArgs.symbol}`)
    })
task("staked-stake").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-cooldown-start", "Start cooldown of V2 staking token")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("amount", "Amount to of token to be staked without the token decimals.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const tokenType = taskArgs.asset === "MTA" ? "vault" : "address"
        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, tokenType)
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const cooldownAmount = simpleToExactAmount(taskArgs.amount)
        const tx = await stakingToken.startCooldown(cooldownAmount)

        await logTxDetails(tx, `Start cooldown for ${taskArgs.amount} ${taskArgs.asset} tokens`)
    })
task("staked-cooldown-start").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-cooldown-end", "End cooldown of V2 staking token")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const tokenType = taskArgs.asset === "MTA" ? "vault" : "address"
        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, tokenType)
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const tx = await stakingToken.endCooldown()

        await logTxDetails(tx, `End cooldown for ${taskArgs.asset} tokens`)
    })
task("staked-cooldown-end").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-withdraw", "Withdraw MTA or mBPT in V2 Staking Token")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("amount", "Amount to of token to be staked without the token decimals.", undefined, types.float)
    .addOptionalParam("recipient", "Address or contract name that will receive the withdrawn tokens.", undefined, types.string)
    .addOptionalParam(
        "fee",
        "True if withdraw fee to be taken from the amount. False if received amount to equal with withdraw amount.",
        true,
        types.boolean,
    )
    .addOptionalParam(
        "cooldown",
        "False if not exiting from a previous cooldown. True if previous cooldown to be ended.",
        false,
        types.boolean,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const tokenType = taskArgs.asset === "MTA" ? "vault" : "address"
        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, tokenType)
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const withdrawAmount = simpleToExactAmount(taskArgs.amount)
        const recipientAddress = taskArgs.recipient ? resolveAddress(taskArgs.recipient, chain) : await signer.getAddress()
        const tx = await stakingToken.withdraw(withdrawAmount, recipientAddress, taskArgs.fee, taskArgs.fee)
        await logTxDetails(tx, `Withdraw ${taskArgs.amount} ${taskArgs.symbol}`)
    })
task("staked-withdraw").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-claim", "Claim MTA rewards from V2 staking token")
    .addOptionalParam("recipient", "Address or contract name that will receive the MTA rewards.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress("MTA", chain, "vault")
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        let tx
        if (taskArgs.recipient) {
            const recipientAddress = taskArgs.recipient ? resolveAddress(taskArgs.recipient, chain) : await signer.getAddress()
            tx = await stakingToken["claimReward(address)"](recipientAddress)
        } else {
            tx = await stakingToken["claimReward()"]()
        }
        const receipt = await logTxDetails(tx, `Claim earned MTA rewards`)
        console.log(`Claimed ${formatUnits(receipt.events[0].args[2])} MTA rewards`)
    })
task("staked-claim").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-compound", "Stake any earned MTA rewards")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress("MTA", chain, "vault")
        const stakingToken = StakedTokenMTA__factory.connect(stakingTokenAddress, signer)
        const tx = await stakingToken.compoundRewards()
        const receipt = await logTxDetails(tx, "Stake earned MTA rewards")
        console.log(`Staked ${formatUnits(receipt.events[0].args[2])} MTA rewards`)
    })
task("staked-compound").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-delegate", "Delegate V2 Staking Tokens")
    .addOptionalParam("asset", "Symbol of staking token. MTA or mBPT", "MTA", types.string)
    .addParam("delegate", "Address or contract name the voting power will be delegated to.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const tokenType = taskArgs.asset === "MTA" ? "vault" : "address"
        const stakingTokenAddress = resolveAddress(taskArgs.asset, chain, tokenType)
        const stakingToken = StakedToken__factory.connect(stakingTokenAddress, signer)
        const delegateAddress = resolveAddress(taskArgs.delegate, chain)
        const tx = await stakingToken.delegate(delegateAddress)
        await logTxDetails(tx, `Delegate voting power to ${taskArgs.delegate}`)
    })
task("staked-delegate").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-update-price-coeff", "Updates the price coefficient on the staked mBPT Token.")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress("mBPT", chain, "vault")
        const stakingToken = StakedTokenBPT__factory.connect(stakingTokenAddress, signer)
        const tx = await stakingToken.fetchPriceCoefficient()
        await logTxDetails(tx, `update price coefficient`)
    })
task("staked-update-price-coeff").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-price-coeff", "Checks the price coefficient on the staked mBPT Token.").setAction(async (taskArgs, hre) => {
    const signer = await getSigner(hre)
    const chain = getChain(hre)

    const stakingTokenAddress = resolveAddress("mBPT", chain, "vault")
    const stakingToken = StakedTokenBPT__factory.connect(stakingTokenAddress, signer)
    const oldPrice = (await stakingToken.priceCoefficient()).toNumber()
    const newPrice = (await stakingToken.getProspectivePriceCoefficient()).toNumber()
    const diffPercentage = ((newPrice - oldPrice) * 100) / oldPrice
    console.log(`Old price ${oldPrice}, new price, diff ${newPrice} ${diffPercentage}%`)
})
task("staked-price-coeff").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("staked-fees", "Converts fees accrued in BPT to MTA, before depositing to the rewards contract.")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const stakingTokenAddress = resolveAddress("mBPT", chain, "vault")
        const stakingToken = StakedTokenBPT__factory.connect(stakingTokenAddress, signer)

        const feesBPT = await stakingToken.pendingBPTFees()
        if (feesBPT.lt(simpleToExactAmount(100))) {
            console.log(`Only ${feesBPT} mBPT in fees so will not convert to MTA`)
            return
        }
        const tx = await stakingToken.convertFees()
        await logTxDetails(tx, `convert mBPT to fees`)
    })
task("staked-fees").setAction(async (_, __, runSuper) => {
    await runSuper()
})
