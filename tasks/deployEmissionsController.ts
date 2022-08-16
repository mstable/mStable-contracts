import "ts-node/register"
import "tsconfig-paths/register"

import { task, types } from "hardhat/config"
import { MockRootChainManager__factory } from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { getSigner } from "./utils/signerFactory"
import {
    deployBasicForwarder,
    deployBridgeForwarder,
    deployVotiumBribeForwarder,
    deployEmissionsController,
    deployL2BridgeRecipients,
    deployL2EmissionsController,
    deployRevenueBuyBack,
    deploySplitRevenueBuyBack,
    deployBalRewardsForwarder,
    MCCP24_CONFIG,
} from "./utils/emissions-utils"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { deployContract } from "./utils/deploy-utils"
import { Chain } from "./utils/tokens"

task("deploy-emissions-polly", "Deploys L2EmissionsController and L2 Bridge Recipients for Polygon mUSD Vault and FRAX Farm")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const streamerAddress = resolveAddress("BpMTAStreamer", chain)

        const l2EmissionsController = await deployL2EmissionsController(signer, hre)
        console.log(`Set EmissionsController contract name in networkAddressFactory to ${l2EmissionsController.address}`)

        const pmUSDbridgeRecipient = await deployL2BridgeRecipients(signer, hre, l2EmissionsController.address)
        console.log(`Set PmUSD bridgeRecipient to ${pmUSDbridgeRecipient.address}`)

        const pBALridgeRecipient = await deployL2BridgeRecipients(signer, hre, l2EmissionsController.address)
        console.log(`Set PBAL bridgeRecipient to ${pBALridgeRecipient.address}`)

        const forwarder = await deployBalRewardsForwarder(signer, l2EmissionsController.address, streamerAddress, hre)
        console.log(`Invoke EmissionsController.addRecipient(${pBALridgeRecipient.address},${forwarder.address})`)
    })

task("deploy-emissions")
    .addOptionalParam("deployProxy", "Whether deploy proxy or implementation only.", true, types.boolean)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const emissionsController = await deployEmissionsController(signer, hre, taskArgs.deployProxy, MCCP24_CONFIG)

        console.log(`Set EmissionsController in the networkAddressFactory to ${emissionsController.address}`)
    })

task("deploy-bridge-forwarder", "Deploys a BridgeForwarder contract on mainnet for Polygon dials.")
    .addParam(
        "token",
        "Token on the Polygon network that is configured with `bridgeRecipient`. eg mUSD, FRAX, BAL.",
        undefined,
        types.string,
    )
    .addOptionalParam("useProxy", "Deploy with proxy", true, types.boolean)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const l2Chain = chain === Chain.mainnet ? Chain.polygon : Chain.mumbai
        const bridgeRecipientAddress = resolveAddress(taskArgs.token, l2Chain, "bridgeRecipient")
        await deployBridgeForwarder(signer, hre, bridgeRecipientAddress, taskArgs.useProxy)
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

task("deploy-split-revenue-buy-back")
    .addOptionalParam("fee", "Portion of revenue to be sent to treasury as a percentage.", 50, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        const treasuryFee = simpleToExactAmount(taskArgs.fee, 16)

        const revenueRecipient = await deploySplitRevenueBuyBack(signer, hre, treasuryFee)

        console.log(`Governor call RevenueSplitBuyBack.mapBasset for mUSD and mBTC`)
        console.log(`Governor call SavingsManager.setRevenueRecipient to ${revenueRecipient.address} for mUSD and mBTC`)
    })

task("deploy-mock-root-chain-manager", "Deploys a mocked Polygon PoS Bridge")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)

        await deployContract(new MockRootChainManager__factory(signer), "MockRootChainManager")
    })

task("deploy-bal-reward-forwarder", "Deploys a basic rewards forwarder from the emissions controller.")
    .addParam("recipient", "Contract or EOA that will receive the MTA rewards.", undefined, types.string)
    .addOptionalParam("owner", "Contract owner to transfer ownership to after deployment.", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const emissionsControllerAddress = resolveAddress("EmissionsController", chain)
        await deployBalRewardsForwarder(signer, emissionsControllerAddress, taskArgs.recipient, hre, taskArgs.owner)
    })

task("deploy-bridge-recipient", "Deploys L2 Bridge Recipients for Polygon")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const emissionsControllerAddress = resolveAddress("EmissionsController", chain)
        const bridgeRecipient = await deployL2BridgeRecipients(signer, hre, emissionsControllerAddress)
        console.log(`New bridgeRecipient to ${bridgeRecipient.address}`)
    })
module.exports = {}
