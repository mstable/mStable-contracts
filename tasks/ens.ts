import { subtask, task, types } from "hardhat/config"
import { randomBytes } from "crypto"
import { ONE_YEAR } from "@utils/constants"
import { EnsEthRegistrarController__factory } from "types/generated/factories/EnsEthRegistrarController__factory"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, getChainAddress } from "./utils/networkAddressFactory"

subtask("ens-commit", "Registers a commitment to claiming an ENS domain")
    .addParam("domain", "Domain name without the .eth extension.", "mstable", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const controllerAddress = getChainAddress("ENSRegistrarController", chain)
        const controller = EnsEthRegistrarController__factory.connect(controllerAddress, signer)

        // Generate a random value to mask our commitment
        const buf = randomBytes(32)
        const secret = `0x${buf.toString("hex")}`

        const domainName = taskArgs.domain
        const commitment = await controller.makeCommitment(domainName, signerAddress, secret)
        console.log(`Comitting to ENS domain ${domainName}.eth with secret ${secret}, owner ${signerAddress} and commitment ${commitment}`)

        const tx = await controller.commit(commitment)
        logTxDetails(tx, "commit")
    })
task("ens-commit").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("ens-register", "Registers an ENS domain")
    .addParam("domain", "Domain name without the .eth extension.", "mstable", types.string)
    .addParam("secret", "Secret from the previous commit transaction", undefined, types.string)
    .addOptionalParam("years", "Number of years to register the domain.", 1, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const controllerAddress = getChainAddress("ENSRegistrarController", chain)
        const resolveAddress = getChainAddress("ENSResolver", chain)
        const controller = EnsEthRegistrarController__factory.connect(controllerAddress, signer)

        const domainName = taskArgs.domain
        const { secret, years } = taskArgs

        console.log(
            `Registering ENS domain ${domainName}.eth with secret ${secret}, ENS resolver ${resolveAddress}, owner ${signerAddress}`,
        )
        const tx = await controller.registerWithConfig(
            domainName,
            signerAddress,
            ONE_YEAR.mul(years),
            secret,
            resolveAddress,
            signerAddress,
        )

        logTxDetails(tx, "registerWithConfig ")
    })
task("ens-register").setAction(async (_, __, runSuper) => {
    await runSuper()
})

module.exports = {}
