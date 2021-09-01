import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { DEAD_ADDRESS, ONE_DAY, ONE_WEEK } from "@utils/constants"

import { formatBytes32String } from "ethers/lib/utils"
import { params } from "./taskUtils"
import {
    AssetProxy__factory,
    BoostedDualVault__factory,
    SignatureVerifier__factory,
    PlatformTokenVendorFactory__factory,
    StakedTokenMTA__factory,
    QuestManager__factory,
    StakedTokenBPT__factory,
    BoostDirectorV2__factory,
    BoostDirectorV2,
} from "../types/generated"
import { getChain, getChainAddress, resolveAddress, resolveToken } from "./utils/networkAddressFactory"
import { getSignerAccount, getSigner } from "./utils/signerFactory"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { deployVault, VaultData } from "./utils/feederUtils"

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
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexusAddress = getChainAddress("Nexus", chain)
        const stakingToken = resolveToken(taskArgs.stakingToken, chain)

        const boostDirector: BoostDirectorV2 = await deployContract(new BoostDirectorV2__factory(signer), "BoostDirector", [
            nexusAddress,
            stakingToken.address,
        ])

        const tx = await boostDirector.initialize([
            resolveAddress("mUSD", chain, "vault"),
            resolveAddress("mBTC", chain, "vault"),
            resolveAddress("GUSD", chain, "vault"),
            resolveAddress("BUSD", chain, "vault"),
            resolveAddress("HBTC", chain, "vault"),
            resolveAddress("TBTC", chain, "vault"),
            resolveAddress("alUSD", chain, "vault"),
        ])
        await logTxDetails(tx, "initialize BoostDirector")

        await hre.run("verify:verify", {
            address: boostDirector.address,
            constructorArguments: [nexusAddress, stakingToken.address],
        })
    })

task("Vault.deploy", "Deploys a vault contract")
    .addParam("boosted", "True if a mainnet boosted vault", true, types.boolean)
    .addParam("vaultName", "Vault name", undefined, types.string, false)
    .addParam("vaultSymbol", "Vault symbol", undefined, types.string, false)
    .addOptionalParam("stakingToken", "Symbol of staking token. eg MTA, BAL, RMTA", "MTA", types.string)
    .addOptionalParam("rewardsToken", "Symbol of rewards token. eg MTA or RMTA for Ropsten", "MTA", types.string)
    .addParam("priceCoefficient", "Price coefficient", undefined, types.string, false)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const vaultData: VaultData = {
            boosted: taskArgs.boosted,
            name: taskArgs.vaultName,
            symbol: taskArgs.vaultSymbol,
            priceCoeff: taskArgs.priceCoefficient,
            stakingToken: resolveAddress(taskArgs.stakingToken, chain),
            rewardToken: resolveAddress(taskArgs.rewardsToken, chain),
        }

        await deployVault(signer, vaultData, chain)
    })

task("StakedToken.deploy", "Deploys a Staked Token behind a proxy")
    .addOptionalParam("rewardsToken", "Symbol of rewards token. eg MTA or RMTA for Ropsten", "MTA", types.string)
    .addOptionalParam("stakedToken", "Symbol of staked token. eg MTA, BAL, RMTA", "MTA", types.string)
    .addOptionalParam("balPoolId", "Balancer Pool Id", "0001", types.string)
    .addOptionalParam("questMaster", "Address of account that administrates quests", undefined, params.address)
    .addOptionalParam("questSigner", "Address of account that signs completed quests", undefined, params.address)
    .addOptionalParam("name", "Staked Token name", "Voting MTA V2", types.string)
    .addOptionalParam("symbol", "Staked Token symbol", "vMTA", types.string)
    .addOptionalParam("cooldown", "Number of seconds for the cooldown period", ONE_WEEK.mul(3).toNumber(), types.int)
    .addOptionalParam("unstakeWindow", "Number of seconds for the unstake window", ONE_WEEK.toNumber(), types.int)
    .setAction(async (taskArgs, hre) => {
        const deployer = await getSignerAccount(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexusAddress = getChainAddress("Nexus", chain)
        const rewardsDistributorAddress = getChainAddress("RewardsDistributor", chain)
        const rewardsTokenAddress = resolveAddress(taskArgs.rewardsToken, chain)
        const stakedTokenAddress = resolveAddress(taskArgs.stakedToken, chain)
        const questMasterAddress = taskArgs.questMasterAddress || getChainAddress("QuestMaster", chain)
        const questSignerAddress = taskArgs.questSignerAddress || getChainAddress("QuestSigner", chain)

        let signatureVerifierAddress = getChainAddress("SignatureVerifier", chain)
        if (!signatureVerifierAddress) {
            const signatureVerifier = await deployContract(new SignatureVerifier__factory(deployer.signer), "SignatureVerifier")
            signatureVerifierAddress = signatureVerifier.address

            await hre.run("verify:verify", {
                address: signatureVerifierAddress,
                contract: "SignatureVerifier",
                constructorArguments: [],
            })
        }

        let questManagerAddress = getChainAddress("QuestManager", chain)
        if (!questManagerAddress) {
            const questManagerLibraryAddresses = {
                "contracts/governance/staking/deps/SignatureVerifier.sol:SignatureVerifier": signatureVerifierAddress,
            }
            const questManagerImpl = await deployContract(
                new QuestManager__factory(questManagerLibraryAddresses, deployer.signer),
                "QuestManager",
                [nexusAddress],
            )
            const data = questManagerImpl.interface.encodeFunctionData("initialize", [questMasterAddress, questSignerAddress])

            await hre.run("verify:verify", {
                address: questManagerImpl.address,
                contract: "contracts/governance/staking/QuestManager.sol:QuestManager",
                constructorArguments: [nexusAddress],
                libraries: {
                    SignatureVerifier: signatureVerifierAddress,
                },
            })

            const constructorArguments = [questManagerImpl.address, deployer.address, data]
            const questManagerProxy = await deployContract(new AssetProxy__factory(deployer.signer), "AssetProxy", constructorArguments)
            questManagerAddress = questManagerProxy.address

            await hre.run("verify:verify", {
                address: questManagerAddress,
                contract: "contracts/upgradability/Proxies.sol:AssetProxy",
                constructorArguments,
            })
        }

        let platformTokenVendorFactoryAddress = getChainAddress("PlatformTokenVendorFactory", chain)
        if (!platformTokenVendorFactoryAddress) {
            const platformTokenVendorFactory = await deployContract(
                new PlatformTokenVendorFactory__factory(deployer.signer),
                "PlatformTokenVendorFactory",
            )
            platformTokenVendorFactoryAddress = platformTokenVendorFactory.address

            await hre.run("verify:verify", {
                address: platformTokenVendorFactoryAddress,
                constructorArguments: [],
            })
        }

        const stakedTokenLibraryAddresses = {
            "contracts/rewards/staking/PlatformTokenVendorFactory.sol:PlatformTokenVendorFactory": platformTokenVendorFactoryAddress,
        }
        let stakedTokenImpl
        if (stakedTokenAddress === rewardsTokenAddress) {
            const constructorArguments = [
                nexusAddress,
                rewardsTokenAddress,
                questManagerAddress,
                rewardsTokenAddress,
                taskArgs.cooldown,
                taskArgs.unstakeWindow,
            ]

            stakedTokenImpl = await deployContract(
                new StakedTokenMTA__factory(stakedTokenLibraryAddresses, deployer.signer),
                "StakedTokenMTA",
                constructorArguments,
            )

            await hre.run("verify:verify", {
                address: stakedTokenImpl.address,
                constructorArguments,
                libraries: {
                    PlatformTokenVendorFactory: platformTokenVendorFactoryAddress,
                },
            })
        } else {
            const balPoolIdStr = taskArgs.balPoolId || "1"
            const balPoolId = formatBytes32String(balPoolIdStr)

            const constructorArguments = [
                nexusAddress,
                rewardsTokenAddress,
                questManagerAddress,
                stakedTokenAddress,
                taskArgs.cooldown,
                taskArgs.unstakeWindow,
                [DEAD_ADDRESS, DEAD_ADDRESS, DEAD_ADDRESS],
                balPoolId,
            ]

            stakedTokenImpl = await deployContract(
                new StakedTokenBPT__factory(stakedTokenLibraryAddresses, deployer.signer),
                "StakedTokenBPT",
                constructorArguments,
            )

            await hre.run("verify:verify", {
                address: stakedTokenImpl.address,
                constructorArguments,
                libraries: {
                    PlatformTokenVendorFactory: platformTokenVendorFactoryAddress,
                },
            })
        }

        const data = stakedTokenImpl.interface.encodeFunctionData("initialize", [taskArgs.name, taskArgs.symbol, rewardsDistributorAddress])
        const proxy = await deployContract(new AssetProxy__factory(deployer.signer), "AssetProxy", [
            stakedTokenImpl.address,
            deployer.address,
            data,
        ])

        await hre.run("verify:verify", {
            address: proxy.address,
            contract: "contracts/upgradability/Proxies.sol:AssetProxy",
            constructorArguments: [stakedTokenImpl.address, deployer.address, data],
        })
    })

export {}
