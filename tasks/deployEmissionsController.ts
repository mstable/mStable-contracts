import "ts-node/register"
import "tsconfig-paths/register"

import { task, types } from "hardhat/config"
import { MockRootChainManager__factory } from "types/generated"
import { getSigner } from "./utils/signerFactory"
import {
    deployBridgeForwarder,
    deployEmissionsController,
    deployL2BridgeRecipients,
    deployL2EmissionsController,
    deployRevenueBuyBack,
} from "./utils/emissions-utils"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { deployContract } from "./utils/deploy-utils"
import { Chain } from "./utils/tokens"

task("deploy-emissions-polly", "Deploys L2EmissionsController and L2 Bridge Recipients for Polygon mUSD Vault and FRAX Farm")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const l2EmissionsController = await deployL2EmissionsController(signer, hre)

        await deployL2BridgeRecipients(signer, hre, l2EmissionsController.address)

        console.log(`Set L2EmissionsController contract name in networkAddressFactory to ${l2EmissionsController.address}`)
    })

task("deploy-emissions")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const emissionsController = await deployEmissionsController(signer, hre)

        console.log(`Set RewardsDistributor in the networkAddressFactory to ${emissionsController.address}`)
    })

task("deploy-bridge-forwarders", "Deploys Polygon mUSD Vault and FRAX BridgeForwarders on mainnet")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const l2Chain = chain === Chain.mainnet ? Chain.polygon : Chain.mumbai
        const mUSDBridgeRecipientAddress = resolveAddress("mUSD", l2Chain, "bridgeRecipient")
        await deployBridgeForwarder(signer, hre, mUSDBridgeRecipientAddress)

        if (chain === Chain.mainnet) {
            const fraxBridgeRecipientAddress = resolveAddress("FRAX", l2Chain, "bridgeRecipient")
            await deployBridgeForwarder(signer, hre, fraxBridgeRecipientAddress)
        }
    })

task("deploy-revenue-buy-back")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const revenueRecipient = await deployRevenueBuyBack(signer, hre)

        console.log(`Set RevenueRecipient to ${revenueRecipient.address}`)
    })

task("deploy-mock-root-chain-manager", "Deploys a mocked Polygon PoS Bridge")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        await deployContract(new MockRootChainManager__factory(signer), "MockRootChainManager")
    })

module.exports = {}
