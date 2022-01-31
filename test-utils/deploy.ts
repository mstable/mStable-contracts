import { BytesLike } from "@ethersproject/bytes"
import { ONE_WEEK } from "@utils/constants"
import { increaseTime } from "@utils/time"
import { Contract, ContractFactory, Signer } from "ethers"
import { DelayedProxyAdmin } from "types/generated"

export const upgradeContract = async <T extends Contract>(
    contractFactory: ContractFactory,
    implementation: Contract,
    proxyAddress: string,
    signer: Signer,
    delayedProxyAdmin: DelayedProxyAdmin,
    upgradeData: BytesLike = [],
): Promise<T> => {
    await delayedProxyAdmin.proposeUpgrade(proxyAddress, implementation.address, upgradeData)

    const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
        proxyAddress,
        implementation.address,
        upgradeData,
    ])

    console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedProxyAdmin.address}, data:\n${proposeUpgradeData}`)

    await increaseTime(ONE_WEEK.add(60))

    // check request is correct
    const request = await delayedProxyAdmin.requests(proxyAddress)
    if (request.implementation !== implementation.address) throw new Error("Upgrade request incorrect")

    // accept upgrade
    await delayedProxyAdmin.acceptUpgradeRequest(proxyAddress)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxyUpgraded = (contractFactory as any).connect(proxyAddress, signer)

    return proxyUpgraded
}
