import { Signer } from "@ethersproject/abstract-signer"
import { BN } from "@utils/math"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import {
    AssetProxy__factory,
    BasicRewardsForwarder,
    BasicRewardsForwarder__factory,
    BridgeForwarder,
    BridgeForwarder__factory,
    DisperseForwarder,
    DisperseForwarder__factory,
    VotiumBribeForwarder,
    VotiumBribeForwarder__factory,
    EmissionsController,
    EmissionsController__factory,
    L2BridgeRecipient,
    L2BridgeRecipient__factory,
    L2EmissionsController,
    L2EmissionsController__factory,
    RevenueBuyBack,
    RevenueBuyBack__factory,
    RevenueSplitBuyBack__factory,
    RevenueSplitBuyBack,
    BalRewardsForwarder,
    BalRewardsForwarder__factory,
} from "types/generated"
import { deployContract, logTxDetails } from "./deploy-utils"
import { verifyEtherscan } from "./etherscan"
import { getChain, resolveAddress } from "./networkAddressFactory"
import { Chain } from "./tokens"

export const deployEmissionsController = async (signer: Signer, hre: HardhatRuntimeEnvironment): Promise<EmissionsController> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const mtaStakingAddress = resolveAddress("StakedTokenMTA", chain)
    const mbptStakingAddress = resolveAddress("StakedTokenBPT", chain)

    let dialRecipients: string[]
    let caps: number[]
    let notifies: boolean[]
    if (chain === Chain.mainnet) {
        dialRecipients = [
            mtaStakingAddress,
            mbptStakingAddress,
            resolveAddress("mUSD", chain, "vault"),
            resolveAddress("mBTC", chain, "vault"),
            resolveAddress("GUSD", chain, "vault"),
            resolveAddress("BUSD", chain, "vault"),
            resolveAddress("alUSD", chain, "vault"),
            resolveAddress("RAI", chain, "vault"), // 7
            resolveAddress("FEI", chain, "vault"), // 8
            resolveAddress("HBTC", chain, "vault"), // 9
            resolveAddress("tBTCv2", chain, "vault"), // 10
        ]
        caps = dialRecipients.map((_, i) => {
            if (i < 2) return 10
            return 0
        })
        notifies = dialRecipients.map(() => true)
    } else if (chain === Chain.ropsten) {
        dialRecipients = [
            mtaStakingAddress,
            mbptStakingAddress,
            resolveAddress("mUSD", chain, "vault"),
            resolveAddress("mBTC", chain, "vault"),
        ]
        caps = [10, 10, 0, 0]
        notifies = [true, true, true, true]
    } else {
        throw Error("Chain must be mainnet or Ropsten")
    }

    const defaultConfig = {
        A: -166000000000000,
        B: 168479942061125,
        C: -168479942061125,
        D: 166000000000000,
        EPOCHS: 312,
    }

    // Deploy logic contract
    const constructorArguments = [nexusAddress, mtaAddress, defaultConfig]
    const emissionsControllerImpl = await deployContract(
        new EmissionsController__factory(signer),
        "EmissionsController Implementation",
        constructorArguments,
    )
    // Deploy proxy and initialize
    const initializeData = emissionsControllerImpl.interface.encodeFunctionData("initialize", [
        dialRecipients,
        caps,
        notifies,
        [mtaStakingAddress, mbptStakingAddress],
    ])
    const proxy = await deployContract(new AssetProxy__factory(signer), "AssetProxy", [
        emissionsControllerImpl.address,
        proxyAdminAddress,
        initializeData,
    ])
    const emissionsController = new EmissionsController__factory(signer).attach(proxy.address)

    await verifyEtherscan(hre, {
        address: emissionsControllerImpl.address,
        constructorArguments,
        contract: "contracts/emissions/EmissionsController.sol:EmissionsController",
    })

    return emissionsController
}

export const deployBasicForwarder = async (
    signer: Signer,
    emissionsControllerAddress: string,
    recipient: string,
    hre: HardhatRuntimeEnvironment,
    owner?: string,
): Promise<BasicRewardsForwarder> => {
    const chain = getChain(hre)
    const nexusAddress = resolveAddress("Nexus", chain)
    const rewardsAddress = resolveAddress("MTA", chain)
    const recipientAddress = resolveAddress(recipient, chain)
    const ownerAddress = owner ? resolveAddress(owner, chain) : undefined

    const constructorArguments = [nexusAddress, rewardsAddress]
    const forwarder = await deployContract<BasicRewardsForwarder>(new BasicRewardsForwarder__factory(signer), "BasicRewardsForwarder", [
        nexusAddress,
        rewardsAddress,
    ])
    const tx1 = await forwarder.initialize(emissionsControllerAddress, recipientAddress)
    await logTxDetails(tx1, "initialize")

    if (ownerAddress) {
        const tx2 = await forwarder.transferOwnership(ownerAddress)
        await logTxDetails(tx2, "transferOwnership")
    }

    await verifyEtherscan(hre, {
        address: forwarder.address,
        constructorArguments,
        contract: "contracts/emissions/BasicRewardsForwarder.sol:BasicRewardsForwarder",
    })

    return forwarder
}

export const deployL2EmissionsController = async (signer: Signer, hre: HardhatRuntimeEnvironment): Promise<L2EmissionsController> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)
    const mtaAddress = resolveAddress("MTA", chain)

    // Deploy logic contract
    const constructorArguments = [nexusAddress, mtaAddress]
    const l2EmissionsControllerImpl = await deployContract(
        new L2EmissionsController__factory(signer),
        "L2EmissionsController Implementation",
        constructorArguments,
    )

    // Deploy proxy and initialize
    const initializeData = l2EmissionsControllerImpl.interface.encodeFunctionData("initialize", [])
    const proxy = await deployContract(new AssetProxy__factory(signer), "AssetProxy", [
        l2EmissionsControllerImpl.address,
        proxyAdminAddress,
        initializeData,
    ])
    const l2EmissionsController = new L2EmissionsController__factory(signer).attach(proxy.address)

    await verifyEtherscan(hre, {
        address: l2EmissionsControllerImpl.address,
        constructorArguments,
        contract: "contracts/emissions/L2EmissionsController.sol:L2EmissionsController",
    })

    return l2EmissionsController
}

export const deployL2BridgeRecipients = async (
    signer: Signer,
    hre: HardhatRuntimeEnvironment,
    l2EmissionsControllerAddress: string,
): Promise<L2BridgeRecipient> => {
    const chain = getChain(hre)
    const mtaAddress = resolveAddress("MTA", chain)
    const constructorArguments = [mtaAddress, l2EmissionsControllerAddress]

    const bridgeRecipient = await deployContract<L2BridgeRecipient>(new L2BridgeRecipient__factory(signer), "L2BridgeRecipient", [
        mtaAddress,
        l2EmissionsControllerAddress,
    ])

    await verifyEtherscan(hre, {
        address: bridgeRecipient.address,
        constructorArguments,
        contract: "contracts/emissions/L2BridgeRecipient.sol:L2BridgeRecipient",
    })

    return bridgeRecipient
}

export const deployDisperseForwarder = async (signer: Signer, hre: HardhatRuntimeEnvironment): Promise<DisperseForwarder> => {
    const chain = getChain(hre)
    const nexusAddress = resolveAddress("Nexus", chain)
    const disperseAddress = resolveAddress("Disperse", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const constructorArguments = [nexusAddress, mtaAddress, disperseAddress]

    const disperseForwarder = await deployContract<DisperseForwarder>(
        new DisperseForwarder__factory(signer),
        "DisperseForwarder",
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: disperseForwarder.address,
        constructorArguments,
        contract: "contracts/emissions/DisperseForwarder.sol:DisperseForwarder",
    })

    return disperseForwarder
}

export const deployVotiumBribeForwarder = async (signer: Signer, hre: HardhatRuntimeEnvironment): Promise<VotiumBribeForwarder> => {
    const chain = getChain(hre)
    const nexusAddress = resolveAddress("Nexus", chain)
    const votiumBribeAddress = resolveAddress("VotiumBribe", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const constructorArguments = [nexusAddress, mtaAddress, votiumBribeAddress]

    const votiumBribeForwarder = await deployContract<VotiumBribeForwarder>(
        new VotiumBribeForwarder__factory(signer),
        "VotiumBribeForwarder",
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: votiumBribeForwarder.address,
        constructorArguments,
        contract: "contracts/emissions/VotiumBribeForwarder.sol:VotiumBribeForwarder",
    })

    return votiumBribeForwarder
}

export const deployBridgeForwarder = async (
    signer: Signer,
    hre: HardhatRuntimeEnvironment,
    bridgeRecipientAddress: string,
    _emissionsControllerAddress?: string,
): Promise<BridgeForwarder> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)
    const tokenBridgeAddress = resolveAddress("PolygonPoSBridge", chain)
    const rootChainManagerAddress = resolveAddress("PolygonRootChainManager", chain)
    const emissionsControllerAddress = _emissionsControllerAddress || resolveAddress("EmissionsController", chain)

    const constructorArguments = [nexusAddress, mtaAddress, tokenBridgeAddress, rootChainManagerAddress, bridgeRecipientAddress]
    const bridgeForwarderImpl = await deployContract(new BridgeForwarder__factory(signer), "Vault Bridge Forwarder", constructorArguments)

    // Deploy proxy and initialize
    const initializeData = bridgeForwarderImpl.interface.encodeFunctionData("initialize", [emissionsControllerAddress])
    const proxy = await deployContract(new AssetProxy__factory(signer), "AssetProxy", [
        bridgeForwarderImpl.address,
        proxyAdminAddress,
        initializeData,
    ])
    const bridgeForwarder = new BridgeForwarder__factory(signer).attach(proxy.address)

    console.log(`\nSet bridgeForwarder to ${bridgeForwarder.address}`)
    console.log(`Governor calls EmissionsController.addDial ${emissionsControllerAddress} with params:`)
    console.log(`recipient ${bridgeForwarder.address}, cap 0, notify true`)

    await verifyEtherscan(hre, {
        address: bridgeForwarderImpl.address,
        constructorArguments,
        contract: "contracts/emissions/BridgeForwarder.sol:BridgeForwarder",
    })

    return bridgeForwarder
}

export const deployRevenueBuyBack = async (
    signer: Signer,
    hre: HardhatRuntimeEnvironment,
    _emissionsControllerAddress?: string,
): Promise<RevenueBuyBack> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const uniswapRouterAddress = resolveAddress("UniswapRouterV3", chain)
    const emissionsControllerAddress = _emissionsControllerAddress || resolveAddress("EmissionsController", chain)

    // Deploy RevenueBuyBack
    const constructorArguments: [string, string, string, string] = [
        nexusAddress,
        mtaAddress,
        uniswapRouterAddress,
        emissionsControllerAddress,
    ]
    const revenueBuyBack = await deployContract<RevenueBuyBack>(new RevenueBuyBack__factory(signer), "RevenueBuyBack", constructorArguments)
    const tx = await revenueBuyBack.initialize([0, 1])
    await logTxDetails(tx, "RevenueBuyBack.initialize")

    await verifyEtherscan(hre, {
        address: revenueBuyBack.address,
        constructorArguments,
        contract: "contracts/buy-and-make/RevenueBuyBack.sol:RevenueBuyBack",
    })

    return revenueBuyBack
}

export const deploySplitRevenueBuyBack = async (
    signer: Signer,
    hre: HardhatRuntimeEnvironment,
    protocolFee: BN,
): Promise<RevenueSplitBuyBack> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const uniswapRouterAddress = resolveAddress("UniswapRouterV3", chain)
    const emissionsControllerAddress = resolveAddress("EmissionsController", chain)
    const treasuryAddress = resolveAddress("mStableDAO", chain)

    // Deploy RevenueBuyBack
    const constructorArguments: [string, string, string, string] = [
        nexusAddress,
        mtaAddress,
        uniswapRouterAddress,
        emissionsControllerAddress,
    ]
    const revenueBuyBack = await deployContract<RevenueSplitBuyBack>(
        new RevenueSplitBuyBack__factory(signer),
        "RevenueSplitBuyBack",
        constructorArguments,
    )
    const tx = await revenueBuyBack.initialize([0, 1], treasuryAddress, protocolFee)
    await logTxDetails(tx, "RevenueSplitBuyBack.initialize")

    await verifyEtherscan(hre, {
        address: revenueBuyBack.address,
        constructorArguments,
        contract: "contracts/buy-and-make/RevenueSplitBuyBack.sol:RevenueSplitBuyBack",
    })

    return revenueBuyBack
}

export const deployBalRewardsForwarder = async (
    signer: Signer,
    emissionsControllerAddress: string,
    recipient: string,
    hre: HardhatRuntimeEnvironment,
    owner?: string,
): Promise<BasicRewardsForwarder> => {
    const chain = getChain(hre)
    const nexusAddress = resolveAddress("Nexus", chain)
    const rewardsAddress = resolveAddress("MTA", chain)
    const recipientAddress = resolveAddress(recipient, chain)
    const ownerAddress = owner ? resolveAddress(owner, chain) : undefined

    const constructorArguments = [nexusAddress, rewardsAddress]
    const forwarder = await deployContract<BalRewardsForwarder>(new BalRewardsForwarder__factory(signer), "BalRewardsForwarder", [
        nexusAddress,
        rewardsAddress,
    ])
    const tx1 = await forwarder.initialize(emissionsControllerAddress, recipientAddress)
    await logTxDetails(tx1, "initialize")

    if (ownerAddress) {
        const tx2 = await forwarder.transferOwnership(ownerAddress)
        await logTxDetails(tx2, "transferOwnership")
    }

    await verifyEtherscan(hre, {
        address: forwarder.address,
        constructorArguments,
        contract: "contracts/emissions/BalRewardsForwarder.sol:BalRewardsForwarder",
    })

    return forwarder
}
