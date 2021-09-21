import { subtask, task, types } from "hardhat/config"
import { StakedTokenMTA__factory, StakedToken__factory } from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "@ethersproject/units"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

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
