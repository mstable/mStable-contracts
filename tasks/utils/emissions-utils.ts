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
} from "types/generated"
import { deployContract } from "./deploy-utils"
import { verifyEtherscan } from "./etherscan"
import { getChain, resolveAddress } from "./networkAddressFactory"

export const deployEmissionsController = async (signer: Signer, hre: any): Promise<EmissionsController> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const mtaStakingAddress = resolveAddress("StakedTokenMTA", chain)
    const mbptStakingAddress = resolveAddress("StakedTokenBPT", chain)
    const dialRecipients = [
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
    const caps = [10, 10, 0, 0, 0, 0, 0, 0, 0, 0]
    const notifies = [true, true, true, true, true, true, true, true, true, false]

    const defaultConfig = {
        A: -166000,
        B: 180000,
        C: -180000,
        D: 166000,
        EPOCHS: 312,
    }

    // Deploy logic contract
    const emissionsControllerImpl = await deployContract(new EmissionsController__factory(signer), "EmissionsController", [
        nexusAddress,
        mtaAddress,
        defaultConfig,
    ])

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

    // await verifyEtherscan(hre, {
    //     address: emissionsController.address,
    // })

    return emissionsController
}

export const deployL2EmissionsController = async (signer: Signer, hre: any): Promise<L2EmissionsController> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)
    const mtaAddress = resolveAddress("PMTA", chain)

    // Deploy logic contract
    const l2EmissionsControllerImpl = await deployContract(new L2EmissionsController__factory(signer), "EmissionsController", [
        nexusAddress,
        mtaAddress,
    ])

    // Deploy proxy and initialize
    const initializeData = l2EmissionsControllerImpl.interface.encodeFunctionData("initialize", [])
    const proxy = await deployContract(new AssetProxy__factory(signer), "AssetProxy", [
        l2EmissionsControllerImpl.address,
        proxyAdminAddress,
        initializeData,
    ])
    const l2EmissionsController = new L2EmissionsController__factory(signer).attach(proxy.address)

    await verifyEtherscan(hre, {
        address: l2EmissionsController.address,
    })

    return l2EmissionsController
}

export const deployL2BridgeRecipients = async (
    signer: Signer,
    hre: any,
    l2EmissionsControllerAddress: string,
): Promise<L2BridgeRecipient[]> => {
    const chain = getChain(hre)

    const mtaAddress = resolveAddress("PMTA", chain)

    const mUSDBridgeRecipient = await deployContract<L2BridgeRecipient>(
        new L2BridgeRecipient__factory(signer),
        "mUSD Vault Bridge Recipient",
        [mtaAddress, l2EmissionsControllerAddress],
    )
    console.log(`mUSD Vault L2 Bridge Recipient ${mUSDBridgeRecipient.address}`)
    await verifyEtherscan(hre, {
        address: mUSDBridgeRecipient.address,
    })

    const fraxBridgeRecipient = await deployContract<L2BridgeRecipient>(
        new L2BridgeRecipient__factory(signer),
        "FRAX Farm Bridge Recipient",
        [mtaAddress, l2EmissionsControllerAddress],
    )
    console.log(`FRAX Farm L2 Bridge Recipient ${fraxBridgeRecipient.address}`)
    await verifyEtherscan(hre, {
        address: fraxBridgeRecipient.address,
    })

    return [mUSDBridgeRecipient, fraxBridgeRecipient]
}

export const deployBridgeForwarder = async (signer: Signer, hre: any, bridgeRecipientAddress: string): Promise<BridgeForwarder> => {
    const chain = getChain(hre)

    const nexusAddress = resolveAddress("Nexus", chain)
    const mtaAddress = resolveAddress("MTA", chain)
    const rootChainManagerAddress = resolveAddress("RootChainManager", chain)
    const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)
    const emissionsControllerAddress = resolveAddress("EmissionsController", chain)

    const bridgeForrwarderImpl = await deployContract(new BridgeForwarder__factory(signer), "mUSD Vault Bridge Forwarder", [
        nexusAddress,
        mtaAddress,
        rootChainManagerAddress,
        bridgeRecipientAddress,
    ])

    // Deploy proxy and initialize
    const initializeData = bridgeForrwarderImpl.interface.encodeFunctionData("initialize", [emissionsControllerAddress])
    const proxy = await deployContract(new AssetProxy__factory(signer), "AssetProxy", [
        bridgeForrwarderImpl.address,
        proxyAdminAddress,
        initializeData,
    ])
    const bridgeForwarder = new BridgeForwarder__factory(signer).attach(proxy.address)

    await verifyEtherscan(hre, {
        address: bridgeForwarder.address,
    })

    return bridgeForwarder
}
