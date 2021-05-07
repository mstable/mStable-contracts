import { Contract, ContractFactory } from "ethers"
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
