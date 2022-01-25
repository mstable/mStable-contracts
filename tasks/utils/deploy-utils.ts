import { BytesLike } from "@ethersproject/bytes"
import { formatUnits } from "@ethersproject/units"
import { ONE_WEEK } from "@utils/constants"
import { increaseTime } from "@utils/time"
import debug from "debug"
import { Contract, ContractFactory, ContractReceipt, ContractTransaction, Overrides, Signer } from "ethers"
import { DelayedProxyAdmin } from "types/generated"

export const deployContract = async <T extends Contract>(
    contractFactory: ContractFactory,
    contractName = "Contract",
    constructorArgs: Array<unknown> = [],
    overrides: Overrides = {},
): Promise<T> => {
    const contract = (await contractFactory.deploy(...constructorArgs, overrides)) as T
    console.log(
        `Deploying ${contractName} contract with hash ${contract.deployTransaction.hash} from ${
            contract.deployTransaction.from
        } with gas price ${contract.deployTransaction.gasPrice.toNumber() / 1e9} Gwei`,
    )
    const receipt = await contract.deployTransaction.wait()
    const txCost = receipt.gasUsed.mul(contract.deployTransaction.gasPrice)
    const abiEncodedConstructorArgs = contract.interface.encodeDeploy(constructorArgs)
    console.log(
        `Deployed ${contractName} to ${contract.address} in block ${receipt.blockNumber}, using ${
            receipt.gasUsed
        } gas costing ${formatUnits(txCost)} ETH`,
    )
    console.log(`ABI encoded args: ${abiEncodedConstructorArgs.slice(2)}`)
    return contract
}

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
    // console.log("delayedProxyAdmin.request.implementation", request.implementation )

    // accept upgrade
    await delayedProxyAdmin.acceptUpgradeRequest(proxyAddress)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxyUpgraded = (contractFactory as any).connect(proxyAddress, signer)

    return proxyUpgraded
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const logger = (...args: string[]) => debug(`mstable:${args.join(":")}`)

export const logTxDetails = async (tx: ContractTransaction, method: string): Promise<ContractReceipt> => {
    console.log(`Sent ${method} transaction with hash ${tx.hash} from ${tx.from} with gas price ${tx.gasPrice?.toNumber() / 1e9} Gwei`)
    const receipt = await tx.wait()

    // Calculate tx cost in Wei
    const txCost = receipt.gasUsed.mul(tx.gasPrice ?? 0)
    console.log(`Processed ${method} tx in block ${receipt.blockNumber}, using ${receipt.gasUsed} gas costing ${formatUnits(txCost)} ETH`)

    return receipt
}
