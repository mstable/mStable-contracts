import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { RevenueForwarder__factory } from "types/generated"
import { deployContract } from "./utils/deploy-utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

task("deploy-RevenueForwarder")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const nexus = resolveAddress("Nexus", chain)
        const musd = resolveAddress("mUSD", chain, "address")
        const keeper = "0xdccb7a6567603af223c090be4b9c83eced210f18"
        const forwarder = "0xd0f0F590585384AF7AB420bE1CFB3A3F8a82D775"

        await deployContract(new RevenueForwarder__factory(signer), "RevenueForwarder", [nexus, musd, keeper, forwarder])
    })

module.exports = {}
