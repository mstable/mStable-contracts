import "ts-node/register"
import "tsconfig-paths/register"

import { task, types } from "hardhat/config"
import { getSigner } from "./utils/signerFactory"
import {
    deployBridgeForwarder,
    deployEmissionsController,
    deployL2BridgeRecipients,
    deployL2EmissionsController,
} from "./utils/emissions-utils"
import { resolveAddress } from "./utils/networkAddressFactory"
import { Chain } from "./utils/tokens"

task("deploy-emissions-polly", "Deploys L2EmissionsController and L2 Bridge Recipients for Polygon mUSD Vault and FRAX Farm")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const l2EmissionsController = await deployL2EmissionsController(signer, hre)

        await deployL2BridgeRecipients(signer, hre, l2EmissionsController.address)
    })

task("deploy-emissions")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        await deployEmissionsController(signer, hre)
    })

task("deploy-bridge-forwarders", "Deploys Polygon mUSD Vault and FRAX BridgeForwarders on mainnet")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const mUSDBridgeRecipientAddress = resolveAddress("PmUSD", Chain.polygon, "bridgeRecipient")
        await deployBridgeForwarder(signer, hre, mUSDBridgeRecipientAddress)

        const fraxBridgeRecipientAddress = resolveAddress("PFRAX", Chain.polygon, "bridgeRecipient")
        await deployBridgeForwarder(signer, hre, fraxBridgeRecipientAddress)
    })

module.exports = {}
