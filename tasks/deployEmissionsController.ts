import "ts-node/register"
import "tsconfig-paths/register"

import { task, types } from "hardhat/config"
import { MockRootChainManager__factory } from "types/generated"
import { getSigner } from "./utils/signerFactory"
import {
    deployBasicForwarder,
    deployBridgeForwarder,
    deployDisperseForwarder,
    deployVotiumBribeForwarder,
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
        console.log(`Set L2EmissionsController contract name in networkAddressFactory to ${l2EmissionsController.address}`)

        const bridgeRecipient = await deployL2BridgeRecipients(signer, hre, l2EmissionsController.address)
        console.log(`Set PmUSD bridgeRecipient to ${bridgeRecipient.address}`)

        const disperseForwarder = await deployDisperseForwarder(signer, hre)
        console.log(`Set PBAL bridgeRecipient to ${disperseForwarder.address}`)
    })

task("deploy-emissions")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const emissionsController = await deployEmissionsController(signer, hre)

        console.log(`Set RewardsDistributor in the networkAddressFactory to ${emissionsController.address}`)
    })

task("deploy-bridge-forwarder", "Deploys a BridgeForwarder contract on mainnet for Polygon dials.")
    .addParam(
        "token",
        "Token on the Polygon network that is configured with `bridgeRecipient`. eg mUSD, FRAX, BAL.",
        undefined,
        types.string,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const l2Chain = chain === Chain.mainnet ? Chain.polygon : Chain.mumbai
        const bridgeRecipientAddress = resolveAddress(taskArgs.token, l2Chain, "bridgeRecipient")
        await deployBridgeForwarder(signer, hre, bridgeRecipientAddress)
    })

task("deploy-basic-forwarder", "Deploys a basic rewards forwarder from the emissions controller.")
    .addParam("recipient", "Contract or EOA that will receive the MTA rewards.", undefined, types.string)
    .addOptionalParam("owner", "Contract owner to transfer ownership to after deployment.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const emissionsControllerAddress = resolveAddress("EmissionsController", chain)
        await deployBasicForwarder(signer, emissionsControllerAddress, taskArgs.recipient, hre, taskArgs.owner)
    })

task("deploy-votium-forwarder", "Deploys a Votium forwarder from the emissions controller.")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const votiumBribeForwarder = await deployVotiumBribeForwarder(signer, hre)
        console.log(`Set VotiumForwarder contract name in networkAddressFactory to ${votiumBribeForwarder.address}`)
    })

task("deploy-revenue-buy-back")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const revenueRecipient = await deployRevenueBuyBack(signer, hre)

        console.log(`Governor call SavingsManager.setRevenueRecipient to ${revenueRecipient.address} for mUSD and mBTC`)
        console.log(`Governor call setMassetConfig for mUSD and mBTC`)
    })

task("deploy-mock-root-chain-manager", "Deploys a mocked Polygon PoS Bridge")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        await deployContract(new MockRootChainManager__factory(signer), "MockRootChainManager")
    })

module.exports = {}
