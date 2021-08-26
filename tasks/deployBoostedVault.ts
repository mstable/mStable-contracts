import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { DEAD_ADDRESS, ONE_DAY, ONE_WEEK } from "@utils/constants"

import { params } from "./taskUtils"
import {
    AssetProxy__factory,
    BoostedVault__factory,
    BoostedDualVault__factory,
    SignatureVerifier__factory,
    PlatformTokenVendorFactory__factory,
    StakedTokenMTA__factory,
    QuestManager__factory,
} from "../types/generated"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
import { getSignerAccount } from "./utils/signerFactory"
import { deployContract } from "./utils/deploy-utils"

task("getBytecode-BoostedDualVault").setAction(async () => {
    const size = BoostedDualVault__factory.bytecode.length / 2 / 1000
    if (size > 24.576) {
        console.error(`BoostedDualVault size is ${size} kb: ${size - 24.576} kb too big`)
    } else {
        console.log(`BoostedDualVault = ${size} kb`)
    }
})

task("BoostedVault.deploy", "Deploys a BoostedVault")
    .addParam("nexus", "Nexus address", undefined, params.address, false)
    .addParam("proxyAdmin", "ProxyAdmin address", undefined, params.address, false)
    .addParam("rewardsDistributor", "RewardsDistributor address", undefined, params.address, false)
    .addParam("stakingToken", "Staking token address", undefined, params.address, false)
    .addParam("rewardsToken", "Rewards token address", undefined, params.address, false)
    .addParam("vaultName", "Vault name", undefined, types.string, false)
    .addParam("vaultSymbol", "Vault symbol", undefined, types.string, false)
    .addParam("boostCoefficient", "Boost coefficient", undefined, types.string, false)
    .addParam("priceCoefficient", "Price coefficient", undefined, types.string, false)
    .setAction(
        async (
            {
                boostCoefficient,
                nexus,
                priceCoefficient,
                proxyAdmin,
                rewardsDistributor,
                rewardsToken,
                vaultName,
                vaultSymbol,
                stakingToken,
            }: {
                boostCoefficient: string
                nexus: string
                priceCoefficient: string
                proxyAdmin: string
                rewardsDistributor: string
                rewardsToken: string
                vaultName: string
                vaultSymbol: string
                stakingToken: string
            },
            { ethers },
        ) => {
            const [deployer] = await ethers.getSigners()

            const implementation = await new BoostedVault__factory(deployer).deploy(
                nexus,
                stakingToken,
                DEAD_ADDRESS,
                priceCoefficient,
                boostCoefficient,
                rewardsToken,
            )
            const receipt = await implementation.deployTransaction.wait()
            console.log(`Deployed Vault Implementation to ${implementation.address}. gas used ${receipt.gasUsed}`)

            const data = implementation.interface.encodeFunctionData("initialize", [rewardsDistributor, vaultName, vaultSymbol])

            const assetProxy = await new AssetProxy__factory(deployer).deploy(implementation.address, proxyAdmin, data)
            const assetProxyDeployReceipt = await assetProxy.deployTransaction.wait()

            await new BoostedVault__factory(deployer).attach(assetProxy.address)

            console.log(`Deployed Vault Proxy to ${assetProxy.address}. gas used ${assetProxyDeployReceipt.gasUsed}`)
        },
    )

task("StakedToken.deploy", "Deploys a Staked Token behind a proxy")
    .addOptionalParam("rewardsToken", "Rewards token address", "MTA", types.string)
    .addOptionalParam("questMaster", "Address of account that administrates quests", undefined, params.address)
    .addOptionalParam("questSigner", "Address of account that signs completed quests", undefined, params.address)
    .addOptionalParam("name", "Staked Token name", "Voting MTA V2", types.string)
    .addOptionalParam("symbol", "Staked Token symbol", "vMTA", types.string)
    .setAction(async (taskArgs, hre) => {
        const deployer = await getSignerAccount(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexusAddress = getChainAddress("Nexus", chain)
        const rewardsDistributorAddress = getChainAddress("RewardsDistributor", chain)
        const rewardsTokenAddress = resolveAddress(taskArgs.rewardsToken, chain)
        const questMasterAddress = taskArgs.questMasterAddress || getChainAddress("QuestMaster", chain)
        const questSignerAddress = taskArgs.questSignerAddress || getChainAddress("QuestSigner", chain)

        let signatureVerifierAddress = getChainAddress("SignatureVerifier", chain)
        if (!signatureVerifierAddress) {
            const signatureVerifier = await deployContract(new SignatureVerifier__factory(deployer.signer), "SignatureVerifier")
            signatureVerifierAddress = signatureVerifier.address
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
            const questManagerProxy = await deployContract(new AssetProxy__factory(deployer.signer), "AssetProxy", [
                questManagerImpl.address,
                deployer.address,
                data,
            ])
            questManagerAddress = questManagerProxy.address
        }

        let platformTokenVendorFactoryAddress = getChainAddress("PlatformTokenVendorFactory", chain)
        if (!platformTokenVendorFactoryAddress) {
            const platformTokenVendorFactory = await deployContract(
                new PlatformTokenVendorFactory__factory(deployer.signer),
                "PlatformTokenVendorFactory",
            )
            platformTokenVendorFactoryAddress = platformTokenVendorFactory.address
        }

        const stakedTokenLibraryAddresses = {
            "contracts/rewards/staking/PlatformTokenVendorFactory.sol:PlatformTokenVendorFactory": platformTokenVendorFactoryAddress,
        }
        const stakedTokenMTAFactory = new StakedTokenMTA__factory(stakedTokenLibraryAddresses, deployer.signer)
        console.log(`Staked Token MTA contract size ${StakedTokenMTA__factory.bytecode.length / 2} bytes`)
        const stakedTokenImpl = await deployContract(stakedTokenMTAFactory, "StakedTokenMTA", [
            nexusAddress,
            rewardsTokenAddress,
            questManagerAddress,
            rewardsTokenAddress,
            ONE_WEEK,
            ONE_DAY.mul(2),
        ])

        const data = stakedTokenImpl.interface.encodeFunctionData("initialize", [taskArgs.name, taskArgs.symbol, rewardsDistributorAddress])
        await deployContract(new AssetProxy__factory(deployer.signer), "AssetProxy", [stakedTokenImpl.address, deployer.address, data])
    })

export {}
