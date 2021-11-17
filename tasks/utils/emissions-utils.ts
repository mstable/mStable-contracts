import { Signer } from "@ethersproject/abstract-signer"
import {
    AssetProxy__factory,
    BridgeForwarder,
    BridgeForwarder__factory,
    EmissionsController,
    EmissionsController__factory,
    L2BridgeRecipient,
    L2BridgeRecipient__factory,
    L2EmissionsController,
    L2EmissionsController__factory,
    RevenueBuyBack,
    RevenueBuyBack__factory,
} from "types/generated"
import { deployContract } from "./deploy-utils"
import { verifyEtherscan } from "./etherscan"
import { getChain, resolveAddress } from "./networkAddressFactory"
import { Chain } from "./tokens"

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const deployEmissionsController = async (signer: Signer, hre: any): Promise<EmissionsController> => {
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
            resolveAddress("tBTCv2", chain, "vault"),
            resolveAddress("HBTC", chain, "vault"),
            resolveAddress("VisorRouter", chain),
        ]
        caps = [10, 10, 0, 0, 0, 0, 0, 0, 0, 0]
        notifies = [true, true, true, true, true, true, true, true, true, false]
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
        A: -166000,
        B: 180000,
        C: -180000,
        D: 166000,
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

export const deployL2EmissionsController = async (signer: Signer, hre: any): Promise<L2EmissionsController> => {
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
    hre: any,
    l2EmissionsControllerAddress: string,
): Promise<L2BridgeRecipient[]> => {
    const chain = getChain(hre)

    const mtaAddress = resolveAddress("MTA", chain)
    const constructorArguments = [mtaAddress, l2EmissionsControllerAddress]

    const mUSDBridgeRecipient = await deployContract<L2BridgeRecipient>(
        new L2BridgeRecipient__factory(signer),
        "mUSD Vault Bridge Recipient",
        [mtaAddress, l2EmissionsControllerAddress],
    )
    console.log(`Set PmUSD bridgeRecipient to ${mUSDBridgeRecipient.address}`)
    await verifyEtherscan(hre, {
        address: mUSDBridgeRecipient.address,
        constructorArguments,
        contract: "contracts/emissions/L2BridgeRecipient.sol:L2BridgeRecipient",
    })

    const fraxBridgeRecipient = await deployContract<L2BridgeRecipient>(
        new L2BridgeRecipient__factory(signer),
        "FRAX Farm Bridge Recipient",
        [mtaAddress, l2EmissionsControllerAddress],
    )
    console.log(`Set PFRAX bridgeRecipient to ${fraxBridgeRecipient.address}`)
    await verifyEtherscan(hre, {
        address: fraxBridgeRecipient.address,
        constructorArguments,
        contract: "contracts/emissions/L2BridgeRecipient.sol:L2BridgeRecipient",
    })

    return [mUSDBridgeRecipient, fraxBridgeRecipient]
}

export const deployBridgeForwarder = async (signer: Signer, hre: any, bridgeRecipientAddress: string): Promise<BridgeForwarder> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const rootChainManagerAddress = resolveAddress("RootChainManager", chain)
    const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)
    const emissionsControllerAddress = resolveAddress("RewardsDistributor", chain)

    const constructorArguments = [nexusAddress, mtaAddress, rootChainManagerAddress, bridgeRecipientAddress]
    const bridgeForrwarderImpl = await deployContract(
        new BridgeForwarder__factory(signer),
        "mUSD Vault Bridge Forwarder",
        constructorArguments,
    )

    // Deploy proxy and initialize
    const initializeData = bridgeForrwarderImpl.interface.encodeFunctionData("initialize", [emissionsControllerAddress])
    const proxy = await deployContract(new AssetProxy__factory(signer), "AssetProxy", [
        bridgeForrwarderImpl.address,
        proxyAdminAddress,
        initializeData,
    ])
    const bridgeForwarder = new BridgeForwarder__factory(signer).attach(proxy.address)

    console.log(`\nSet bridgeForwarder to ${bridgeForwarder.address}`)
    console.log(`Governor calls EmissionsController.addDial ${emissionsControllerAddress} with params:`)
    console.log(`recipient ${bridgeForwarder.address}, cap 0, notify true`)

    // wait 10 seconds
    await sleep(10000)

    await verifyEtherscan(hre, {
        address: bridgeForrwarderImpl.address,
        constructorArguments,
        contract: "contracts/emissions/BridgeForwarder.sol:BridgeForwarder",
    })

    return bridgeForwarder
}

export const deployRevenueBuyBack = async (signer: Signer, hre: any): Promise<RevenueBuyBack> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const uniswapRouterAddress = resolveAddress("UniswapRouterV3", chain)
    const emissionsControllerAddress = resolveAddress("RewardsDistributor", chain)
    const devOpsAddress = resolveAddress("OperationsSigner", chain)

    // Deploy RevenueBuyBack
    const constructorArguments: [string, string, string, string] = [
        nexusAddress,
        mtaAddress,
        uniswapRouterAddress,
        emissionsControllerAddress,
    ]
    const revenueBuyBack = await new RevenueBuyBack__factory(signer).deploy(...constructorArguments)
    await revenueBuyBack.initialize(devOpsAddress, [0, 1])

    await verifyEtherscan(hre, {
        address: revenueBuyBack.address,
        constructorArguments,
        contract: "contracts/buy-and-make/RevenueBuyBack.sol:RevenueBuyBack",
    })

    return revenueBuyBack
}
