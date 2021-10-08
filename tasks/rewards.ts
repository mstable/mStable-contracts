/* eslint-disable no-restricted-syntax */
import { BN, simpleToExactAmount } from "@utils/math"
import { subtask, task, types } from "hardhat/config"
import { RewardsDistributorEth__factory } from "types/generated/factories/RewardsDistributorEth__factory"
import { RewardsDistributor__factory } from "types/generated/factories/RewardsDistributor__factory"
import { formatUnits } from "ethers/lib/utils"
import { Comptroller__factory, Liquidator__factory } from "types"
import rewardsFiles from "./balancer-mta-rewards/20210817.json"
import { Chain, logTxDetails, USDC, usdFormatter } from "./utils"
import { getAaveTokens, getAlcxTokens, getBlock, getCompTokens } from "./utils/snap-utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, getChainAddress, resolveAddress, resolveToken } from "./utils/networkAddressFactory"
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

subtask("rewards", "Get Compound and Aave platform reward tokens")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const block = await getBlock(hre.ethers, taskArgs.block)

        console.log(`\nGetting platform tokens at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)

        await getCompTokens(signer, block)
        await getAaveTokens(signer, block)
        await getAlcxTokens(signer, block)
    })
task("rewards").setAction(async (_, __, runSuper) => {
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
        await logTxDetails(tx, "claim COMP")
    })
task("liq-claim-comp").setAction(async (_, __, runSuper) => {
    await runSuper()
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
        if (hre.network.name === "hardhat") {
            const tx = await liquidator.triggerLiquidation(bAsset.integrator)
            await logTxDetails(tx, `trigger liquidation for ${taskArgs.basset}`)
        } else {
            // Send via Flashbots
            const tx = await liquidator.populateTransaction.triggerLiquidation(bAsset.integrator)
            await sendPrivateTransaction(tx, signer)
        }
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
        if (hre.network.name === "hardhat") {
            const tx = await liquidator.triggerLiquidationAave()
            await logTxDetails(tx, `trigger liquidation for Aave`)
        } else {
            // Send via Flashbots
            const tx = await liquidator.populateTransaction.triggerLiquidationAave()
            await sendPrivateTransaction(tx, signer)
        }
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
