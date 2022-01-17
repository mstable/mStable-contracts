import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Unwrapper__factory } from "types/generated"
import { deployContract } from "./utils/deploy-utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

task("deploy-Unwrapper")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const nexus = resolveAddress("Nexus", chain)
        await deployContract(new Unwrapper__factory(signer), "Unwrapper", [nexus])
    })

module.exports = {}
