/* eslint-disable no-restricted-syntax */
import { BN, simpleToExactAmount } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import { Collector__factory, SavingsManager, SavingsManager__factory, Unliquidator__factory } from "types/generated"
import { Comptroller__factory } from "types/generated/factories/Comptroller__factory"
import rewardsFiles from "./balancer-mta-rewards/20210817.json"
import { btcFormatter, COMP, logTxDetails, mBTC, mUSD, stkAAVE, USDC, usdFormatter, USDT } from "./utils"
import { getAaveTokens, getAlcxTokens, getBlock, getCompTokens } from "./utils/snap-utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress, resolveToken } from "./utils/networkAddressFactory"

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
    const receipt = await logTxDetails(tx, `collect fees from mUSD and mBTC`)
    const savingsManagerAddress = resolveAddress("SavingsManager", chain)
    const savingsManagerEvents = receipt.events?.filter((e) => e.address === savingsManagerAddress)
    const savingsManager = SavingsManager__factory.connect(savingsManagerAddress, signer)
    const parsedEvents = savingsManagerEvents?.map((e) => savingsManager.interface.parseLog(e))
    const musdEvent = parsedEvents.find((e) => e.name === "RevenueRedistributed" && e.args.mAsset === mUSD.address)
    console.log(`mUSD revenue: ${usdFormatter(musdEvent.args.amount)}`)
    const mbtcEvent = parsedEvents.find((e) => e.name === "RevenueRedistributed" && e.args.mAsset === mBTC.address)
    console.log(`mBTC revenue: ${btcFormatter(mbtcEvent.args.amount)}`)
})
task("collect-interest-dist").setAction(async (_, __, runSuper) => {
    await runSuper()
})

task("claim-comp", "Claimed COMP from USDC deposits to Treasury")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const compControllerAddress = resolveAddress("CompController", chain)
        const compController = Comptroller__factory.connect(compControllerAddress, signer)
        const tx1 = await compController["claimComp(address,address[])"](USDC.integrator, [USDC.liquidityProvider])
        const receipt = await logTxDetails(tx1, "claim COMP")
        // Transfer topic
        const event = receipt.events.find((e) => e.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
        console.log(`Claimed ${usdFormatter(BN.from(event.data))} COMP`)

        const unliquidatorAddress = resolveAddress("Unliquidator")
        const unliquidator = Unliquidator__factory.connect(unliquidatorAddress, signer)
        const tx2 = await unliquidator.distributeRewards(USDC.integrator, COMP.address)
        await logTxDetails(tx2, "claimed COMP to treasury")
    })
task("claim-comp").setAction(async (_, __, runSuper) => {
    await runSuper()
})

task("claim-aave", "Call liquidator to claim stkAAVE")
    .addOptionalParam("basset", "Symbol of bAsset in AAVE. eg USDT, WBTC, BUSD or RAI", "USDT", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const basset = resolveToken(taskArgs.basset, chain)

        const liquidatorAddress = await resolveAddress("Unliquidator", chain)
        const unliquidator = Unliquidator__factory.connect(liquidatorAddress, signer)
        const tx = await unliquidator.claimAndDistributeRewards(basset.integrator, stkAAVE.address)
        const receipt = await logTxDetails(tx, `claim stkAAVE from ${taskArgs.basset} integration`)

        // Transfer topic
        const event = receipt.events.find((e) => e.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
        console.log(`Claimed ${usdFormatter(BN.from(event.data))} stkAAVE from ${basset.integrator} integration`)
    })
task("claim-aave").setAction(async (_, __, runSuper) => {
    await runSuper()
})
