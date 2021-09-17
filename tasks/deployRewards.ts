import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { ONE_WEEK } from "@utils/constants"

import { simpleToExactAmount } from "@utils/math"
import { BoostedDualVault__factory, BoostDirectorV2__factory, BoostDirectorV2 } from "../types/generated"
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
        "Comma separated list of vault underlying token symbols, eg RmUSD,RmBTC",
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
    .addOptionalParam("stakingToken", "Symbol of staking token. eg MTA, BAL, RMTA, mUSD, RmUSD", "MTA", types.string)
    .addOptionalParam("rewardsToken", "Symbol of rewards token. eg MTA or RMTA for Ropsten", "MTA", types.string)
    .addOptionalParam("priceCoeff", "Price coefficient without 18 decimal places. eg 1 or 4800", 1, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)

        const vaultData: VaultData = {
            boosted: taskArgs.boosted,
            name: taskArgs.vaultName,
            symbol: taskArgs.vaultSymbol,
            priceCoeff: simpleToExactAmount(taskArgs.priceCoeff),
            stakingToken: resolveAddress(taskArgs.stakingToken, chain),
            rewardToken: resolveAddress(taskArgs.rewardsToken, chain),
        }

        await deployVault(hre, vaultData)
    })

task("StakedToken.deploy", "Deploys a Staked Token behind a proxy")
    .addOptionalParam("rewardsToken", "Symbol of rewards token. eg MTA or RMTA for Ropsten", "MTA", types.string)
    .addOptionalParam("stakedToken", "Symbol of staked token. eg MTA, RMTA, mBPT or RmBPT", "MTA", types.string)
    .addOptionalParam("balToken", "Symbol of balancer token. eg BAL or RBAL", "BAL", types.string)
    .addOptionalParam("balPoolId", "Balancer Pool Id", "0001", types.string)
    .addOptionalParam("name", "Staked Token name", "Staked MTA", types.string)
    .addOptionalParam("symbol", "Staked Token symbol", "stkMTA", types.string)
    .addOptionalParam("cooldown", "Number of seconds for the cooldown period", ONE_WEEK.mul(3).toNumber(), types.int)
    .addOptionalParam("unstakeWindow", "Number of seconds for the unstake window", ONE_WEEK.mul(2).toNumber(), types.int)
    .addOptionalParam("proxy", "Deploys a proxy contract", false, types.boolean)
    .setAction(async (taskArgs, hre) => {
        const deployer = await getSignerAccount(hre, taskArgs.speed)

        const stakingTokenData: StakedTokenData = {
            rewardsTokenSymbol: taskArgs.rewardsToken,
            stakedTokenSymbol: taskArgs.stakedToken,
            balTokenSymbol: taskArgs.balToken,
            cooldown: taskArgs.cooldown,
            unstakeWindow: taskArgs.unstakeWindow,
            name: taskArgs.name,
            symbol: taskArgs.symbol,
        }
        await deployStakingToken(stakingTokenData, deployer, hre, taskArgs.proxy)
    })

export {}
