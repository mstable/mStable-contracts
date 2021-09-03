import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { ONE_WEEK } from "@utils/constants"

import { Contract } from "@ethersproject/contracts"
import { formatBytes32String } from "ethers/lib/utils"
import { simpleToExactAmount } from "@utils/math"
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
import { verifyEtherscan } from "./utils/etherscan"

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
        const stakingToken = resolveToken(taskArgs.stakingToken, chain)

        const boostDirector: BoostDirectorV2 = await deployContract(new BoostDirectorV2__factory(signer), "BoostDirector", [
            nexusAddress,
            stakingToken.address,
        ])

        const vaultSymbols = taskArgs.vaults.split(",")
        const vaultAddresses = vaultSymbols.map((symbol) => resolveAddress(symbol, chain, "vault"))
        const tx = await boostDirector.initialize(vaultAddresses)
        await logTxDetails(tx, "initialize BoostDirector")

        await verifyEtherscan(hre, {
            address: boostDirector.address,
            constructorArguments: [nexusAddress, stakingToken.address],
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
    .addOptionalParam("stakedToken", "Symbol of staked token. eg MTA, BAL, RMTA, RBAL", "MTA", types.string)
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

            await verifyEtherscan(hre, {
                address: signatureVerifierAddress,
                contract: "contracts/governance/staking/deps/SignatureVerifier.sol:SignatureVerifier",
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

            await verifyEtherscan(hre, {
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

            await verifyEtherscan(hre, {
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

            await verifyEtherscan(hre, {
                address: platformTokenVendorFactoryAddress,
                constructorArguments: [],
            })
        }

        const stakedTokenLibraryAddresses = {
            "contracts/rewards/staking/PlatformTokenVendorFactory.sol:PlatformTokenVendorFactory": platformTokenVendorFactoryAddress,
        }
        let constructorArguments: any[]
        let stakedTokenImpl: Contract
        let data: string
        if (stakedTokenAddress === rewardsTokenAddress) {
            constructorArguments = [
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
            data = stakedTokenImpl.interface.encodeFunctionData("initialize", [
                formatBytes32String(taskArgs.name),
                formatBytes32String(taskArgs.symbol),
                rewardsDistributorAddress,
            ])
        } else {
            const balPoolIdStr = taskArgs.balPoolId || "1"
            const balPoolId = formatBytes32String(balPoolIdStr)

            const balancerVaultAddress = resolveAddress("BalancerVault", chain)
            const balancerRecipientAddress = resolveAddress("BalancerRecipient", chain)

            constructorArguments = [
                nexusAddress,
                rewardsTokenAddress,
                questManagerAddress,
                stakedTokenAddress,
                taskArgs.cooldown,
                taskArgs.unstakeWindow,
                [stakedTokenAddress, balancerVaultAddress],
                balPoolId,
            ]

            console.log(`Staked Token BPT contract size ${StakedTokenBPT__factory.bytecode.length / 2} bytes`)

            stakedTokenImpl = await deployContract(
                new StakedTokenBPT__factory(stakedTokenLibraryAddresses, deployer.signer),
                "StakedTokenBPT",
                constructorArguments,
            )

            data = stakedTokenImpl.interface.encodeFunctionData("initialize", [
                formatBytes32String(taskArgs.name),
                formatBytes32String(taskArgs.symbol),
                rewardsDistributorAddress,
                balancerRecipientAddress,
            ])
        }

        await verifyEtherscan(hre, {
            address: stakedTokenImpl.address,
            constructorArguments,
            libraries: {
                PlatformTokenVendorFactory: platformTokenVendorFactoryAddress,
            },
        })

        const proxy = await deployContract(new AssetProxy__factory(deployer.signer), "AssetProxy", [
            stakedTokenImpl.address,
            deployer.address,
            data,
        ])

        await verifyEtherscan(hre, {
            address: proxy.address,
            contract: "contracts/upgradability/Proxies.sol:AssetProxy",
            constructorArguments: [stakedTokenImpl.address, deployer.address, data],
        })
    })

export {}
