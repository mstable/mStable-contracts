import { Contract, ContractFactory, ContractTransaction } from "ethers"
import { formatUnits } from "@ethersproject/units"

export const deployContract = async <T extends Contract>(
    contractFactory: ContractFactory,
    contractName = "Contract",
    contractorArgs: Array<unknown> = [],
): Promise<T> => {
    console.log(`Deploying ${contractName}`)
    const contract = (await contractFactory.deploy(...contractorArgs)) as T
    const contractReceipt = await contract.deployTransaction.wait()
    const ethUsed = contractReceipt.gasUsed.mul(contract.deployTransaction.gasPrice)
    const abiEncodedConstructorArgs = contract.interface.encodeDeploy(contractorArgs)
    console.log(`Deployed ${contractName} to ${contract.address}, gas used ${contractReceipt.gasUsed}, eth ${formatUnits(ethUsed)}`)
    console.log(`ABI encoded args: ${abiEncodedConstructorArgs}`)
    return contract
}

export const logTxDetails = async (tx: ContractTransaction, method: string): Promise<void> => {
    console.log(`Send ${method} transaction with hash ${tx.hash} from ${tx.from} with gas price ${tx.gasPrice.toNumber() / 1e9} Gwei`)
    const receipt = await tx.wait()

    // Calculate tx cost in Wei
    const txCost = receipt.gasUsed.mul(tx.gasPrice)
    console.log(`Processed ${method} tx in block ${receipt.blockNumber}, using ${receipt.gasUsed} gas costing ${formatUnits(txCost)} ETH`)
}
