import { BigNumberish } from "@ethersproject/bignumber"
import { Contract } from "@ethersproject/contracts"
import { formatBytes32String } from "@ethersproject/strings"
import { Signer } from "ethers"
import { Account } from "types/common"
import { HardhatRuntimeEnvironment } from "hardhat/types/runtime"
import {
    AssetProxy__factory,
    InstantProxyAdmin__factory,
    PlatformTokenVendorFactory__factory,
    L2BridgeRecipient,
    L2BridgeRecipient__factory,
    BridgeForwarder,
    BridgeForwarder__factory,
    QuestManager__factory,
    SignatureVerifier__factory,
    StakedTokenBPT__factory,
    StakedTokenMTA__factory,
} from "types/generated"
import { deployContract } from "./deploy-utils"
import { verifyEtherscan } from "./etherscan"
import { getChain, getChainAddress, resolveAddress } from "./networkAddressFactory"

export interface StakedTokenData {
    rewardsTokenSymbol: string
    stakedTokenSymbol: string
    balTokenSymbol?: string
    cooldown: BigNumberish
    name: string
    symbol: string
}

export interface StakedTokenDeployAddresses {
    stakedToken: string
    stakedTokenImpl: string
    questManager?: string
    signatureVerifier?: string
    platformTokenVendorFactory?: string
    proxyAdminAddress: string
    initData: string
}

export const deployStakingToken = async (
    stakedTokenData: StakedTokenData,
    deployer: Account,
    hre: HardhatRuntimeEnvironment,
    deployProxy = false,
    overrides?: StakedTokenDeployAddresses,
    overrideSigner?: string,
): Promise<StakedTokenDeployAddresses> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const rewardsDistributorAddress = resolveAddress("RewardsDistributor", chain)
    const rewardsTokenAddress = resolveAddress(stakedTokenData.rewardsTokenSymbol, chain)
    const stakedTokenAddress = resolveAddress(stakedTokenData.stakedTokenSymbol, chain)
    const questMasterAddress = resolveAddress("QuestMaster", chain)
    const questSignerAddress = overrideSigner ?? resolveAddress("QuestSigner", chain)
    const delayedProxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)

    let proxyAdminAddress = overrides?.proxyAdminAddress ?? getChainAddress("ProxyAdmin", chain)
    if (!proxyAdminAddress) {
        const proxyAdmin = await deployContract(new InstantProxyAdmin__factory(deployer.signer), "InstantProxyAdmin")
        await proxyAdmin.transferOwnership(resolveAddress("ProtocolDAO", chain))
        proxyAdminAddress = proxyAdmin.address
    }

    let signatureVerifierAddress = overrides?.signatureVerifier ?? getChainAddress("SignatureVerifier", chain)
    if (!signatureVerifierAddress) {
        const signatureVerifier = await deployContract(new SignatureVerifier__factory(deployer.signer), "SignatureVerifier")
        signatureVerifierAddress = signatureVerifier.address

        await verifyEtherscan(hre, {
            address: signatureVerifierAddress,
            contract: "contracts/governance/staking/deps/SignatureVerifier.sol:SignatureVerifier",
        })
    }

    let questManagerAddress = overrides?.questManager ?? getChainAddress("QuestManager", chain)
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

        const constructorArguments = [questManagerImpl.address, delayedProxyAdminAddress, data]
        const questManagerProxy = await deployContract(new AssetProxy__factory(deployer.signer), "AssetProxy", constructorArguments)
        questManagerAddress = questManagerProxy.address
    }

    let platformTokenVendorFactoryAddress = overrides?.platformTokenVendorFactory ?? getChainAddress("PlatformTokenVendorFactory", chain)
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
    let constructorArguments: [string, string, string, string, BigNumberish, [string, string]?, string?, string?]
    let stakedTokenImpl: Contract
    let data: string
    if (rewardsTokenAddress === stakedTokenAddress) {
        constructorArguments = [nexusAddress, rewardsTokenAddress, questManagerAddress, rewardsTokenAddress, stakedTokenData.cooldown]

        stakedTokenImpl = await deployContract(
            new StakedTokenMTA__factory(stakedTokenLibraryAddresses, deployer.signer),
            "StakedTokenMTA",
            constructorArguments,
        )
        data = stakedTokenImpl.interface.encodeFunctionData("initialize", [
            formatBytes32String(stakedTokenData.name),
            formatBytes32String(stakedTokenData.symbol),
            rewardsDistributorAddress,
        ])
    } else {
        const balAddress = resolveAddress(stakedTokenData.balTokenSymbol, chain)

        const balPoolId = resolveAddress("BalancerStakingPoolId", chain)
        const balancerVaultAddress = resolveAddress("BalancerVault", chain)
        const balancerGaugeAddress = resolveAddress("mBPT", chain, "gauge")

        constructorArguments = [
            nexusAddress,
            rewardsTokenAddress,
            questManagerAddress,
            stakedTokenAddress,
            stakedTokenData.cooldown,
            [balAddress, balancerVaultAddress],
            balPoolId,
            balancerGaugeAddress,
        ]

        console.log(`Staked Token BPT contract size ${StakedTokenBPT__factory.bytecode.length / 2} bytes`)

        stakedTokenImpl = await deployContract(
            new StakedTokenBPT__factory(stakedTokenLibraryAddresses, deployer.signer),
            "StakedTokenBPT",
            constructorArguments,
        )

        const priceCoeff = 49631
        data = stakedTokenImpl.interface.encodeFunctionData("initialize", [
            formatBytes32String(stakedTokenData.name),
            formatBytes32String(stakedTokenData.symbol),
            rewardsDistributorAddress,
            priceCoeff,
        ])
    }

    await verifyEtherscan(hre, {
        address: stakedTokenImpl.address,
        constructorArguments,
        libraries: {
            PlatformTokenVendorFactory: platformTokenVendorFactoryAddress,
        },
    })

    let proxy: Contract
    if (deployProxy) {
        proxy = await deployContract(new AssetProxy__factory(deployer.signer), "AssetProxy", [
            stakedTokenImpl.address,
            proxyAdminAddress,
            data,
        ])
    } else if (rewardsTokenAddress === stakedTokenAddress) {
        proxy = stakedTokenImpl.attach(resolveAddress("StokedTokenMTA", chain))
    } else {
        proxy = stakedTokenImpl.attach(resolveAddress("StakedTokenBPT", chain))
    }

    console.log(`Governor needs to call setBalRecipient`)

    return {
        stakedToken: proxy?.address,
        stakedTokenImpl: stakedTokenImpl.address,
        questManager: questManagerAddress,
        signatureVerifier: signatureVerifierAddress,
        platformTokenVendorFactory: platformTokenVendorFactoryAddress,
        proxyAdminAddress,
        initData: data,
    }
}

export const deployBridgeForwarder = async (
    signer: Signer,
    nexusAddress: string,
    rewardTokenAddress: string,
    bridgeTokenLockerAddress: string,
    rootChainManagerAddress: string,
    childRecipient1Address: string,
    emissionsController: string,
): Promise<BridgeForwarder> => {
    const impl = await deployContract(new BridgeForwarder__factory(signer), "BridgeForwarder", [
        nexusAddress,
        rewardTokenAddress,
        bridgeTokenLockerAddress,
        rootChainManagerAddress,
        childRecipient1Address,
    ])

    // Proxy
    const data = impl.interface.encodeFunctionData("initialize", [emissionsController])
    const delayedProxyAdminAddress = resolveAddress("DelayedProxyAdmin")
    const proxy = await deployContract(new AssetProxy__factory(signer), "AssetProxy", [impl.address, delayedProxyAdminAddress, data])

    const rootRecipient = new BridgeForwarder__factory(signer).attach(proxy.address)

    return rootRecipient
}

export const deployL2BridgeRecipient = async (
    signer: Signer,
    bridgedRewardTokenAddress: string,
    childEmissionsController: string,
): Promise<L2BridgeRecipient> => {
    const childRecipient = await deployContract<L2BridgeRecipient>(new L2BridgeRecipient__factory(signer), "L2BridgeRecipient", [
        bridgedRewardTokenAddress,
        childEmissionsController,
    ])

    return childRecipient
}
