/* eslint-disable no-restricted-syntax */
import "ts-node/register"
import "tsconfig-paths/register"

import { subtask, task, types } from "hardhat/config"
import {
    AaveV2Integration__factory,
    DelayedProxyAdmin__factory,
    Liquidator,
    Liquidator__factory,
    Masset__factory,
    PAaveIntegration,
    PAaveIntegration__factory,
} from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { encodeUniswapPath } from "@utils/peripheral/uniswap"
import { ZERO_ADDRESS } from "@utils/constants"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { AAVE, ALCX, Chain, COMP, DAI, stkAAVE, tokens } from "./utils/tokens"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

task("integration-aave-deploy", "Deploys an instance of AaveV2Integration contract")
    .addParam(
        "asset",
        "Symbol of the mAsset or Feeder Pool providing liquidity to the integration. eg mUSD, PmUSD, GUSD or alUSD",
        undefined,
        types.string,
    )
    .addParam("rewards", "Symbol of the platform rewards. eg COMP, AAVE, stkAAVE, ALCX", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const nexusAddress = getChainAddress("Nexus", chain)
        const platformAddress = getChainAddress("AaveLendingPoolAddressProvider", chain)

        const liquidityProviderAddress = resolveAddress(taskArgs.asset, chain)
        const rewardsTokenAddress = resolveAddress(taskArgs.rewards, chain)

        // Deploy
        await deployContract(new AaveV2Integration__factory(signer), "AaveV2Integration", [
            nexusAddress,
            liquidityProviderAddress,
            platformAddress,
            rewardsTokenAddress,
        ])
    })

task("integration-paave-deploy", "Deploys mUSD and mBTC instances of PAaveIntegration")
    .addParam(
        "asset",
        "Symbol of the mAsset or Feeder Pool providing liquidity to the integration. eg mUSD, PmUSD, GUSD or alUSD",
        undefined,
        types.string,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const deployer = await getSigner(hre, taskArgs.speed)

        const nexusAddress = getChainAddress("Nexus", chain)
        const platformAddress = getChainAddress("AaveLendingPoolAddressProvider", chain)
        const aaveIncentivesControllerAddress = getChainAddress("AaveIncentivesController", chain)

        const liquidityProviderAddress = resolveAddress(taskArgs.asset, chain)
        const rewardsTokenAddress = resolveAddress(taskArgs.rewards, chain)

        // TODO need to get the list of bAssets from
        const bAssets = [DAI]
        const bAssetAddresses = bAssets.map((b) => b.address)
        const aTokens = bAssets.map((b) => b.liquidityProvider)

        // Deploy
        const integration = await deployContract<PAaveIntegration>(new PAaveIntegration__factory(deployer), "PAaveIntegration for mUSD", [
            nexusAddress,
            liquidityProviderAddress,
            platformAddress,
            rewardsTokenAddress,
            aaveIncentivesControllerAddress,
        ])
        const tx = await integration.initialize(bAssetAddresses, aTokens)
        await logTxDetails(tx, "mUsdPAaveIntegration.initialize")

        const approveRewardTokenData = integration.interface.encodeFunctionData("approveRewardToken")
        console.log(`\napproveRewardToken data: ${approveRewardTokenData}`)

        const mAsset = await Masset__factory.connect(liquidityProviderAddress, deployer)

        for (const bAsset of bAssets) {
            const migrateData = mAsset.interface.encodeFunctionData("migrateBassets", [[bAsset.address], integration.address])
            console.log(`${bAsset.symbol} migrateBassets data: ${migrateData}`)
        }
    })

subtask("liquidator-deploy", "Deploys new Liquidator contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        if (chain !== Chain.mainnet) throw Error("Task can only run against mainnet or a mainnet fork")

        const nexusAddress = getChainAddress("Nexus", chain)
        const liquidatorAddress = getChainAddress("Liquidator", chain)
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const uniswapRouterV3Address = getChainAddress("UniswapRouterV3", chain)
        const uniswapQuoterV3Address = getChainAddress("UniswapQuoterV3", chain)

        // Deploy the new implementation
        const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(signer), "Liquidator", [
            nexusAddress,
            stkAAVE.address,
            AAVE.address,
            uniswapRouterV3Address,
            uniswapQuoterV3Address,
            COMP.address,
            ALCX.address,
        ])

        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = liquidatorImpl.interface.encodeFunctionData("upgrade")
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            liquidatorAddress,
            liquidatorImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })

task("liquidator-deploy").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("liquidator-create", "Creates a liquidation of a platform reward")
    .addParam("asset", "Symbol of the mAsset or Feeder Pool. eg mUSD, PmUSD, mBTC, alUSD, HBTC", undefined, types.string)
    .addParam("rewardToken", "Symbol of the platform reward token. eg COMP, AAVE, stkAAVE, ALCX", undefined, types.string)
    .addParam("bAsset", "Symbol of the bAsset purchased from the rewards. eg USDC, WBTC, alUSD", undefined, types.string)
    .addOptionalParam("maxAmount", "Max amount of bAssets to liquidate. 20,000 USDC from selling COMP", undefined, types.int)
    .addParam("minReturn", "Min amount of bAssets for one reward token from swap. Amount does not include decimals.", undefined, types.int)
    .addParam("aave", "Flag if integration with Aave or not.", undefined, types.boolean)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const liquidatorAddress = getChainAddress("Liquidator", chain)
        const uniswapEthToken = getChainAddress("UniswapEthToken", chain)

        const liquidator = Liquidator__factory.connect(liquidatorAddress, signer)

        const assetToken = tokens.find((t) => t.symbol === taskArgs.asset && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${taskArgs.asset}`)
        const integrationAddress = assetToken.integrator
        // If asset is linked to a Feeder Pool, then use a zero address
        const mAssetAddress = assetToken.feederPool ? ZERO_ADDRESS : assetToken.address

        const rewardToken = tokens.find((t) => t.symbol === taskArgs.rewardToken && t.chain === chain)
        if (!rewardToken) throw Error(`Could not find reward token with symbol ${taskArgs.rewardToken}`)
        const bAssetToken = tokens.find((t) => t.symbol === taskArgs.bAsset && t.chain === chain)
        if (!bAssetToken) throw Error(`Could not find bAsset with symbol ${taskArgs.bAsset}`)

        // Output tx data for createLiquidation
        const uniswapPath = encodeUniswapPath([rewardToken.address, uniswapEthToken, bAssetToken.address], [3000, 3000])
        const createData = liquidator.interface.encodeFunctionData("createLiquidation", [
            integrationAddress,
            rewardToken.address,
            bAssetToken.address,
            uniswapPath.encoded,
            uniswapPath.encodedReversed,
            simpleToExactAmount(taskArgs.minReturn),
            simpleToExactAmount(taskArgs.minReturn, bAssetToken.decimals),
            mAssetAddress,
            taskArgs.aave,
        ])
        console.log(`\ncreateLiquidation of ${rewardToken.symbol} from ${assetToken.symbol} to ${liquidatorAddress}, data:\n${createData}`)
    })

task("liquidator-create").setAction(async (_, __, runSuper) => {
    await runSuper()
})

module.exports = {}
