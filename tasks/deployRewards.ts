import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { ONE_WEEK } from "@utils/constants"

import { simpleToExactAmount } from "@utils/math"
import {
    BoostedDualVault__factory,
    BoostDirectorV2__factory,
    BoostDirectorV2,
    StakedTokenBatcher__factory,
    StakedTokenBPT__factory,
} from "../types/generated"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
import { getSignerAccount, getSigner } from "./utils/signerFactory"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { deployVault, VaultData } from "./utils/feederUtils"
import { verifyEtherscan } from "./utils/etherscan"
import { deployStakingToken, StakedTokenData } from "./utils/rewardsUtils"

task("getBytecode-BoostedDualVault").setAction(async () => {
    const size = BoostedDualVault__factory.bytecode.length / 2 / 1000
    if (size > 24.576) {
        console.error(`BoostedDualVault size is ${size} kb: ${size - 24.576} kb too big`)
    } else {
        console.log(`BoostedDualVault = ${size} kb`)
    }
})

task("BoostDirector.deploy", "Deploys a new BoostDirector")
    .addOptionalParam("stakingToken", "Symbol of the staking token", "MTA", types.string)
    .addOptionalParam(
        "vaults",
        "Comma separated list of vault underlying token symbols, eg mUSD,mBTC",
        "mUSD,mBTC,GUSD,BUSD,alUSD,HBTC,TBTC",
        types.string,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexusAddress = getChainAddress("Nexus", chain)

        const boostDirector: BoostDirectorV2 = await deployContract(new BoostDirectorV2__factory(signer), "BoostDirector", [nexusAddress])

        const vaultSymbols = taskArgs.vaults.split(",")
        const vaultAddresses = vaultSymbols.map((symbol) => resolveAddress(symbol, chain, "vault"))
        const tx = await boostDirector.initialize(vaultAddresses)
        await logTxDetails(tx, "initialize BoostDirector")

        await verifyEtherscan(hre, {
            address: boostDirector.address,
            constructorArguments: [nexusAddress],
        })
    })

task("Vault.deploy", "Deploys a vault contract")
    .addParam("boosted", "True if a mainnet boosted vault", true, types.boolean)
    .addParam("vaultName", "Vault name", undefined, types.string, false)
    .addParam("vaultSymbol", "Vault symbol", undefined, types.string, false)
    .addOptionalParam("stakingToken", "Symbol of staking token. eg MTA, BAL or mUSD", "MTA", types.string)
    .addOptionalParam("stakingType", "'address' or 'feederPool'", "feederPool", types.string)
    .addOptionalParam("rewardsToken", "Symbol of rewards token. eg MTA", "MTA", types.string)
    .addOptionalParam("dualRewardsToken", "Symbol of dual rewards token. eg WMATIC", undefined, types.string)
    .addOptionalParam("priceCoeff", "Price coefficient without 18 decimal places. eg 1 or 4800", 1, types.int)
    .addOptionalParam("boostCoeff", "Boost coefficient", 9, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)

        const vaultData: VaultData = {
            boosted: taskArgs.boosted,
            name: taskArgs.vaultName,
            symbol: taskArgs.vaultSymbol,
            priceCoeff: simpleToExactAmount(taskArgs.priceCoeff),
            stakingToken: resolveAddress(taskArgs.stakingToken, chain, taskArgs.stakingType),
            rewardToken: resolveAddress(taskArgs.rewardsToken, chain),
            dualRewardToken: taskArgs.dualRewardsToken ? resolveAddress(taskArgs.dualRewardsToken, chain) : undefined,
            boostCoeff: taskArgs.boostCoeff,
        }

        await deployVault(hre, vaultData)
    })

task("StakedToken.deploy", "Deploys a Staked Token behind a proxy")
    .addOptionalParam("rewardsToken", "Symbol of rewards token. eg MTA", "MTA", types.string)
    .addOptionalParam("stakedToken", "Symbol of staked token. eg MTA or mBPT", "MTA", types.string)
    .addOptionalParam("balToken", "Symbol of balancer token. eg BAL", "BAL", types.string)
    .addOptionalParam("name", "Staked Token name", "Staked MTA", types.string)
    .addOptionalParam("symbol", "Staked Token symbol", "stkMTA", types.string)
    .addOptionalParam("cooldown", "Number of seconds for the cooldown period", ONE_WEEK.mul(3).toNumber(), types.int)
    .addOptionalParam("proxy", "Deploys a proxy contract", false, types.boolean)
    .setAction(async (taskArgs, hre) => {
        const deployer = await getSignerAccount(hre, taskArgs.speed)

        const stakingTokenData: StakedTokenData = {
            rewardsTokenSymbol: taskArgs.rewardsToken,
            stakedTokenSymbol: taskArgs.stakedToken,
            balTokenSymbol: taskArgs.balToken,
            cooldown: taskArgs.cooldown,
            name: taskArgs.name,
            symbol: taskArgs.symbol,
        }
        await deployStakingToken(stakingTokenData, deployer, hre, taskArgs.proxy)
    })

task("StakedTokenBPT.deploy", "Deploys a Staked Token mBPT behind a proxy")
    .addOptionalParam("cooldown", "Number of seconds for the cooldown period", ONE_WEEK.mul(3).toNumber(), types.int)
    .addOptionalParam("proxy", "Deploys a proxy contract", false, types.boolean)
    .setAction(async (taskArgs, hre) => {
        const deployer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const rewardsTokenAddress = resolveAddress("MTA", chain)
        const stakedTokenAddress = resolveAddress("mBPT", chain)
        const questManagerAddress = await resolveAddress("QuestManager", chain)
        const balAddress = resolveAddress("BAL", chain)
        const balPoolId = resolveAddress("BalancerStakingPoolId", chain)
        const balancerVaultAddress = resolveAddress("BalancerVault", chain)
        const balancerGaugeAddress = resolveAddress("mBPT", chain, "gauge")

        const cooldown = taskArgs.cooldown

        const constructorArguments = [
            nexusAddress,
            rewardsTokenAddress,
            questManagerAddress,
            stakedTokenAddress,
            cooldown,
            [balAddress, balancerVaultAddress],
            balPoolId,
            balancerGaugeAddress,
        ]

        console.log(`Staked Token BPT contract size ${StakedTokenBPT__factory.bytecode.length / 2} bytes`)

        const stakedTokenImpl = await deployContract(new StakedTokenBPT__factory(deployer), "StakedTokenBPT", constructorArguments)
        // const stakedTokenImpl = StakedTokenBPT__factory.connect("0x83b59FBC79b8e40b68927daa02AC24F8879D8417", deployer)

        await verifyEtherscan(hre, {
            address: stakedTokenImpl.address,
            constructorArguments,
        })
    })

task("StakedTokenBatcher.deploy", "Deploys a Staked Token Batcher")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const stakedTokenBatcher = await deployContract(new StakedTokenBatcher__factory(signer), "StakedTokenBatcher", [])
        await verifyEtherscan(hre, {
            address: stakedTokenBatcher.address,
            contract: "contracts/governance/staking/StakedTokenBatcher.sol:StakedTokenBatcher",
        })
    })
export {}
