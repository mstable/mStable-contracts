import { formatUnits } from "@ethersproject/units"
import debug from "debug"
import { Contract, ContractFactory, ContractReceipt, ContractTransaction, Overrides } from "ethers"

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
