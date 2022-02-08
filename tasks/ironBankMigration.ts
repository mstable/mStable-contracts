import "ts-node/register"
import "tsconfig-paths/register"

import { task, types } from "hardhat/config"
import { DudIntegration, DudIntegration__factory, DudPlatform, DudPlatform__factory } from "types/generated"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { mUSD } from "./utils/tokens"
import { verifyEtherscan } from "./utils/etherscan"

task("deploy-dud-contracts", "Deploys dud platform and integration contracts for migration mUSD migration from Iron Bank")
    .addParam("feeder", "Token symbol or address of the Feeder Pool.", undefined, types.string, false)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const feederPoolAddress = resolveAddress(taskArgs.feeder, chain, "feederPool")

        const platformConstructorArgs = [nexusAddress, mUSD.address]
        const dudPlatform = await deployContract<DudPlatform>(new DudPlatform__factory(signer), "DudPlatform", platformConstructorArgs)

        await verifyEtherscan(hre, {
            address: dudPlatform.address,
            constructorArguments: platformConstructorArgs,
            contract: "contracts/masset/peripheral/DudPlatform.sol:DudPlatform",
        })

        const integrationConstructorArgs = [nexusAddress, feederPoolAddress, mUSD.address, dudPlatform.address]
        const dudIntegration = await deployContract<DudIntegration>(
            new DudIntegration__factory(signer),
            "DudIntegration",
            integrationConstructorArgs,
        )
        const tx1 = await dudIntegration["initialize()"]()
        await logTxDetails(tx1, "DudIntegration.initialize")

        await verifyEtherscan(hre, {
            address: dudIntegration.address,
            constructorArguments: integrationConstructorArgs,
            contract: "contracts/masset/peripheral/DudIntegration.sol:DudIntegration",
        })

        const tx2 = await dudPlatform.initialize(dudIntegration.address)
        await logTxDetails(tx2, "DudPlatform.initialize")
    })

module.exports = {}
