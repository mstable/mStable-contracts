/* eslint-disable no-restricted-syntax */
import { BN, simpleToExactAmount } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import { formatUnits } from "ethers/lib/utils"
import { TransactionResponse } from "@ethersproject/providers"
import { Collector__factory, Liquidator__factory } from "types/generated"
import { Comptroller__factory } from "types/generated/factories/Comptroller__factory"
import rewardsFiles from "./balancer-mta-rewards/20210817.json"
import { logTxDetails, mBTC, mUSD, USDC, usdFormatter } from "./utils"
import { getAaveTokens, getAlcxTokens, getBlock, getCompTokens } from "./utils/snap-utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress, resolveToken } from "./utils/networkAddressFactory"
import { sendPrivateTransaction } from "./utils/flashbots"

task("sum-rewards", "Totals the rewards in a disperse json file")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async () => {
        let total = BN.from(0)
        let count = 0
        const rewardsSorted = Object.fromEntries(Object.entries(rewardsFiles).sort(([, a], [, b]) => parseFloat(a) - parseFloat(b)))

        for (const [address, amount] of Object.entries(rewardsSorted)) {
            total = total.add(simpleToExactAmount(amount))
            count += 1
            console.log(`address ${address} ${amount}`)
        }
        console.log(`Total ${usdFormatter(total)}`)
        console.log(`Count ${count}`)
    })

subtask("rewards", "Get Compound and Aave platform reward tokens")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const block = await getBlock(hre.ethers, taskArgs.block)

        console.log(`\nGetting platform tokens at block ${block.blockNumber}, ${block.blockTime}`)

        await getCompTokens(signer, block)
        await getAaveTokens(signer, block)
        await getAlcxTokens(signer, block)
    })
task("rewards").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("collect-interest-dist", "Collects and distributes mAsset interest").setAction(async (taskArgs, hre) => {
    const signer = await getSigner(hre, taskArgs.speed)
    const chain = getChain(hre)

    const collector = Collector__factory.connect(resolveAddress("Collector", chain), signer)

    const tx = await collector.distributeInterest([mUSD.address, mBTC.address], false)
    await logTxDetails(tx, `collect fees from mUSD and mBTC`)
})
task("collect-interest-dist").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-claim-comp", "Claimed COMP to the integration contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const compControllerAddress = resolveAddress("CompController", chain)
        const compController = Comptroller__factory.connect(compControllerAddress, signer)
        const tx = await compController["claimComp(address,address[])"](USDC.integrator, [USDC.liquidityProvider])
        const receipt = await logTxDetails(tx, "claim COMP")
        const event = receipt.events.find((e) => e.event === "DistributedSupplierComp")
        console.log(`Claimed ${formatUnits(event.args[2])} COMP`)
    })
task("liq-claim-comp").setAction(async (taskArgs, hre, runSuper) => {
    const signer = await getSigner(hre, taskArgs.speed)

    let block = await getBlock(hre.ethers, "latest")

    console.log(`\nGetting platform tokens at block ${block.blockNumber}, ${block.blockTime}`)

    await getCompTokens(signer, block)

    await runSuper()

    block = await getBlock(hre.ethers, "latest")

    console.log(`\nGetting platform tokens at block ${block.blockNumber}, ${block.blockTime}`)

    await getCompTokens(signer, block)
})

subtask("liq-trig", "Triggers a liquidation of a integration contract")
    .addOptionalParam("basset", "Token symbol of bAsset that is integrated to a platform. eg USDC, WBTC, GUSD, alUSD", "USDC", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const bAsset = await resolveToken(taskArgs.basset, chain, "integrator")

        const liquidatorAddress = await resolveAddress("Liquidator", chain)
        const liquidator = Liquidator__factory.connect(liquidatorAddress, signer)
        let tx: TransactionResponse
        if (hre.network.name === "hardhat") {
            tx = await liquidator.triggerLiquidation(bAsset.integrator)
        } else {
            // Send via Flashbots
            const populatedTx = await liquidator.populateTransaction.triggerLiquidation(bAsset.integrator)
            tx = await sendPrivateTransaction(populatedTx, signer)
        }
        await logTxDetails(tx, `trigger liquidation for ${taskArgs.basset}`)
    })
task("liq-trig").setAction(async (_, hre, runSuper) => {
    await runSuper()
})

subtask("liq-trig-aave", "Triggers a liquidation of stkAAVE")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const liquidatorAddress = await resolveAddress("Liquidator", chain)
        const liquidator = Liquidator__factory.connect(liquidatorAddress, signer)
        let tx: TransactionResponse
        if (hre.network.name === "hardhat") {
            tx = await liquidator.triggerLiquidationAave()
        } else {
            // Send via Flashbots
            const populatedTx = await liquidator.populateTransaction.triggerLiquidationAave()
            tx = await sendPrivateTransaction(populatedTx, signer)
        }
        await logTxDetails(tx, `trigger liquidation for Aave`)
    })
task("liq-trig-aave").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liq-claim-aave", "Call liquidator to claim stkAAVE")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const liquidatorAddress = await resolveAddress("Liquidator", chain)
        const liquidator = Liquidator__factory.connect(liquidatorAddress, signer)
        const tx = await liquidator.claimStakedAave()
        await logTxDetails(tx, "claim Aave")
    })
task("liq-claim-aave").setAction(async (_, __, runSuper) => {
    await runSuper()
})
