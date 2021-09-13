/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import "ts-node/register"
import "tsconfig-paths/register"

import { task, types } from "hardhat/config"
import {
    FeederPool__factory,
    CompoundIntegration__factory,
    CompoundIntegration,
    AlchemixIntegration,
    AlchemixIntegration__factory,
    FeederWrapper__factory,
} from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { ALCX, alUSD, BUSD, CREAM, cyMUSD, GUSD, mUSD, tokens } from "./utils/tokens"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { getSigner } from "./utils/signerFactory"
import { deployFeederPool, deployVault, FeederData, VaultData } from "./utils/feederUtils"
import { getChain, getChainAddress } from "./utils/networkAddressFactory"

task("deployFeederPool", "Deploy Feeder Pool")
    .addParam("masset", "Token symbol of mAsset. eg mUSD or PmUSD for Polygon", "mUSD", types.string)
    .addParam("fasset", "Token symbol of Feeder Pool asset. eg GUSD, WBTC, PFRAX for Polygon", "alUSD", types.string)
    .addOptionalParam("a", "Amplitude coefficient (A)", 100, types.int)
    .addOptionalParam("min", "Minimum asset weight of the basket as a percentage. eg 10 for 10% of the basket.", 10, types.int)
    .addOptionalParam("max", "Maximum asset weight of the basket as a percentage. eg 90 for 90% of the basket.", 90, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const mAsset = tokens.find((t) => t.symbol === taskArgs.masset)
        if (!mAsset) throw Error(`Could not find mAsset token with symbol ${taskArgs.masset}`)
        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) throw Error(`Could not find Feeder Pool token with symbol ${taskArgs.fasset}`)

        if (taskArgs.a < 10 || taskArgs.min > 5000) throw Error(`Invalid amplitude coefficient (A) ${taskArgs.a}`)
        if (taskArgs.min < 0 || taskArgs.min > 50) throw Error(`Invalid min limit ${taskArgs.min}`)
        if (taskArgs.max < 50 || taskArgs.max > 100) throw Error(`Invalid max limit ${taskArgs.min}`)

        const poolData: FeederData = {
            mAsset,
            fAsset,
            name: `${mAsset.symbol}/${fAsset.symbol} Feeder Pool`,
            symbol: `fP${mAsset.symbol}/${fAsset.symbol}`,
            config: {
                a: taskArgs.a,
                limits: {
                    min: simpleToExactAmount(taskArgs.min, 16),
                    max: simpleToExactAmount(taskArgs.max, 16),
                },
            },
        }

        // Deploy Feeder Pool
        await deployFeederPool(signer, poolData, chain)
    })

task("deployAlcxInt", "Deploy Alchemix integration contract for alUSD Feeder Pool")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexusAddress = getChainAddress("Nexus", chain)
        const alchemixStakingPoolsAddress = getChainAddress("AlchemixStakingPool", chain)

        const alchemixIntegration = await deployContract<AlchemixIntegration>(
            new AlchemixIntegration__factory(signer),
            "Alchemix alUSD Integration",
            [nexusAddress, alUSD.feederPool, ALCX.address, alchemixStakingPoolsAddress, alUSD.address],
        )

        const tx = await alchemixIntegration.initialize()
        logTxDetails(tx, "initialize Alchemix integration")

        const fp = FeederPool__factory.connect(alUSD.feederPool, signer)
        const migrateData = fp.interface.encodeFunctionData("migrateBassets", [[alUSD.address], alchemixIntegration.address])
        console.log(`migrateBassets data:\n${migrateData}`)
    })

task("deployVault", "Deploy Feeder Pool with boosted dual vault")
    .addParam("name", "Token name of the vault. eg mUSD/alUSD fPool Vault", undefined, types.string)
    .addParam("symbol", "Token symbol of the vault. eg v-fPmUSD/alUSD", undefined, types.string)
    .addParam("boosted", "Rewards are boosted by staked MTA (vMTA)", undefined, types.boolean)
    .addParam(
        "stakingToken",
        "Symbol of token that is being staked. Feeder Pool is just the fAsset. eg mUSD, PmUSD, MTA, GUSD, alUSD",
        undefined,
        types.string,
    )
    .addParam("rewardToken", "Token symbol of reward. eg MTA or PMTA for Polygon", undefined, types.string)
    .addOptionalParam("dualRewardToken", "Token symbol of second reward. eg WMATIC, ALCX, QI", undefined, types.string)
    .addOptionalParam("price", "Price coefficient is the value of the mAsset in USD. eg mUSD/USD = 1, mBTC/USD", 1, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)

        if (taskArgs.name?.length < 4) throw Error(`Invalid token name ${taskArgs.name}`)
        if (taskArgs.symbol?.length <= 0 || taskArgs.symbol?.length > 14) throw Error(`Invalid token symbol ${taskArgs.name}`)
        if (taskArgs.boosted === undefined) throw Error(`Invalid boolean boost ${taskArgs.boosted}`)

        const stakingToken = tokens.find((t) => t.symbol === taskArgs.stakingToken && t.chain === chain)
        if (!stakingToken) throw Error(`Could not find staking token with symbol ${taskArgs.stakingToken}`)

        // Staking Token is for Feeder Pool, Savings Vault or the token itself. eg
        // alUSD will stake feeder pool in a v-fPmUSD/alUSD vault
        // mUSD will stake savings vault in a v-imUSD vault
        // MTA will stake MTA in a v-MTA vault
        const stakingTokenAddress = stakingToken.feederPool || stakingToken.savings || stakingToken.address

        const rewardToken = tokens.find((t) => t.symbol === taskArgs.rewardToken && t.chain === chain)
        if (!rewardToken) throw Error(`Could not find reward token with symbol ${taskArgs.rewardToken}`)

        if (taskArgs.price < 0 || taskArgs.price >= simpleToExactAmount(1)) throw Error(`Invalid price coefficient ${taskArgs.price}`)

        const dualRewardToken = tokens.find((t) => t.symbol === taskArgs.dualRewardToken)

        const vaultData: VaultData = {
            boosted: taskArgs.boosted,
            name: taskArgs.name,
            symbol: taskArgs.symbol,
            priceCoeff: simpleToExactAmount(taskArgs.price),
            stakingToken: stakingTokenAddress,
            rewardToken: rewardToken.address,
            dualRewardToken: dualRewardToken?.address,
        }

        await deployVault(hre, vaultData)
    })

task("FeederWrapper-deploy", "Deploy a new FeederWrapper").setAction(async (taskArgs, hre) => {
    const deployer = await getSigner(hre)
    await deployContract(new FeederWrapper__factory(deployer), "FeederWrapper")
})

task("deployIronBank", "Deploys mUSD Iron Bank (CREAM) integration contracts for GUSD and BUSD Feeder Pools")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const nexusAddress = getChainAddress("Nexus", chain)

        // CREAM's ABI is the same as Compound so can use the CompoundIntegration contract
        const gusdIntegration = await deployContract<CompoundIntegration>(
            new CompoundIntegration__factory(signer),
            "CREAM Integration for GUSD FP",
            [nexusAddress, GUSD.feederPool, CREAM.address],
        )
        let tx = await gusdIntegration.initialize([mUSD.address], [cyMUSD.address])
        await logTxDetails(tx, "initialize GUSD Iron Bank integration")

        const busdIntegration = await deployContract<CompoundIntegration>(
            new CompoundIntegration__factory(signer),
            "CREAM Integration for BUSD FP",
            [nexusAddress, BUSD.feederPool, CREAM.address],
        )
        tx = await busdIntegration.initialize([mUSD.address], [cyMUSD.address])
        await logTxDetails(tx, "initialize BUSD Iron Bank integration")

        // This will be done via the delayedProxyAdmin on mainnet
        // Governor approves Liquidator to spend the reward (CREAM) token
        const approveRewardTokenData = await gusdIntegration.interface.encodeFunctionData("approveRewardToken")
        console.log(`\napproveRewardToken data for GUSD and BUSD: ${approveRewardTokenData}`)

        const gudsFp = FeederPool__factory.connect(GUSD.address, signer)
        const gusdMigrateBassetsData = await gudsFp.interface.encodeFunctionData("migrateBassets", [
            [mUSD.address],
            gusdIntegration.address,
        ])
        console.log(`GUSD Feeder Pool migrateBassets tx data: ${gusdMigrateBassetsData}`)

        const budsFp = FeederPool__factory.connect(BUSD.address, signer)
        const busdMigrateBassetsData = await budsFp.interface.encodeFunctionData("migrateBassets", [
            [mUSD.address],
            busdIntegration.address,
        ])
        console.log(`BUSD Feeder Pool migrateBassets tx data: ${busdMigrateBassetsData}`)
    })

module.exports = {}
