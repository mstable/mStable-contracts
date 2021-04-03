import { CLIArgumentType } from "hardhat/src/types/index"
import { isValidAddress } from "ethereumjs-util"
import { HardhatError } from "hardhat/internal/core/errors"
import { ERRORS } from "hardhat/internal/core/errors-list"
import { Contract, Signer } from "ethers"
import { Overrides } from "@ethersproject/contracts"
import { Provider, TransactionRequest, TransactionReceipt } from "@ethersproject/providers"
import chalk from "chalk"

/**
 * Hardhat task CLI argument types
 */
export const params = {
    address: {
        name: "address",
        parse: (argName, strValue) => strValue,
        validate: (argName: string, value: unknown): void => {
            const isValid = typeof value === "string" && isValidAddress(value)

            if (!isValid) {
                throw new HardhatError(ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
                    value,
                    name: argName,
                    type: "address",
                })
            }
        },
    } as CLIArgumentType<string>,
    addressArray: {
        name: "address[]",
        parse: (argName, strValue) => strValue.split(","),
        validate: (argName: string, value: unknown): void => {
            const isValid = Array.isArray(value) && value.every(isValidAddress)

            if (!isValid) {
                throw new HardhatError(ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
                    value,
                    name: argName,
                    type: "address[]",
                })
            }
        },
    } as CLIArgumentType<string[]>,
}

/**
 * Send a transaction (with given args) and return the result, with logging
 * @param contract      Ethers contract with signer
 * @param func          Function name to call
 * @param description   Description of call (optional)
 * @param args          Arguments for call
 */
export const sendTx = async <TContract extends Contract, TFunc extends keyof TContract["functions"]>(
    contract: TContract,
    func: TFunc,
    description?: string,
    ...args: Parameters<TContract["functions"][TFunc]>
): Promise<ReturnType<TContract["functions"][TFunc]>> => {
    console.log(chalk.blue(`Sending transaction${description ? `: ${description}` : ""}`))
    if (args.length) {
        console.log(chalk.blue(`Using: ${chalk.yellow(contract.address)}:${chalk.blue(func as string)}{ ${chalk.blue(args.join(", "))} }`))
    }

    const tx = await contract.functions[func as string](...args)

    console.log(chalk.blue(`Transaction: ${chalk.yellow(tx.hash)}`))

    const receipt = await tx.wait()

    console.log(chalk.blue(`${chalk.greenBright("Confirmed.")} Gas used ${chalk.yellow(receipt.gasUsed)}`))

    return receipt
}

declare class ContractFactory<TContract> {
    deploy(overrides?: Overrides): Promise<TContract>
    getDeployTransaction(overrides?: Overrides): TransactionRequest
    attach(address: string): TContract
    static connect(address: string, signerOrProvider: Signer | Provider): Contract
}

// Can't use declare class
interface ContractFactoryConstructor<C> extends Function {
    // eslint-disable-next-line @typescript-eslint/no-misused-new
    new (signer?: Signer): ContractFactory<C>
}

/**
 * Deploy a transaction (with given args) and wait for it to complete, with logging
 * @param deployer     Ethers signer to deploy with
 * @param Factory      Ethers/Typechain contract factory
 * @param description  Description of deployment
 * @param args         Required arguments for deploy transaction
 */
export const deployTx = async <C>(
    deployer: Signer,
    Factory: ContractFactoryConstructor<C>,
    description: string,
    ...args: Parameters<ContractFactory<C>["deploy"]>
): Promise<C> => {
    console.log(chalk.blue(`Deploying: ${description}`))
    if (args.length) {
        console.log(chalk.blue(`Using: { ${chalk.yellow(args.join(", "))} }`))
    }

    const deployment = (await new Factory(deployer).deploy(...args)) as C & {
        deployTransaction: { wait(): Promise<TransactionReceipt> }
        deployed(): Promise<{ address: string }>
    }

    await deployment.deployed()
    const receipt = await deployment.deployTransaction.wait()

    console.log(chalk.blue(`Deploy transaction: ${chalk.yellow(receipt.transactionHash)}. Gas used ${chalk.yellow(receipt.gasUsed)}`))

    console.log(chalk.greenBright(`Deployed to ${chalk.yellow(receipt.contractAddress)}`))

    return deployment as C
}
