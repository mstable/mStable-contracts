import { CLIArgumentType } from "hardhat/src/types/index";
import { Contract, Signer } from "ethers";
import { Overrides } from "@ethersproject/contracts";
import { Provider, TransactionRequest } from "@ethersproject/providers";
/**
 * Hardhat task CLI argument types
 */
export declare const params: {
    address: CLIArgumentType<string>;
    addressArray: CLIArgumentType<string[]>;
};
/**
 * Send a transaction (with given args) and return the result, with logging
 * @param contract      Ethers contract with signer
 * @param func          Function name to call
 * @param description   Description of call (optional)
 * @param args          Arguments for call
 */
export declare const sendTx: <TContract extends Contract, TFunc extends keyof TContract["functions"]>(contract: TContract, func: TFunc, description?: string, ...args: Parameters<TContract["functions"][TFunc]>) => Promise<ReturnType<TContract["functions"][TFunc]>>;
declare class ContractFactory<TContract> {
    deploy(overrides?: Overrides): Promise<TContract>;
    getDeployTransaction(overrides?: Overrides): TransactionRequest;
    attach(address: string): TContract;
    static connect(address: string, signerOrProvider: Signer | Provider): Contract;
}
interface ContractFactoryConstructor<C> extends Function {
    new (signer?: Signer): ContractFactory<C>;
}
/**
 * Deploy a transaction (with given args) and wait for it to complete, with logging
 * @param deployer     Ethers signer to deploy with
 * @param Factory      Ethers/Typechain contract factory
 * @param description  Description of deployment
 * @param args         Required arguments for deploy transaction
 */
export declare const deployTx: <C>(deployer: Signer, Factory: ContractFactoryConstructor<C>, description: string, overrides?: Overrides) => Promise<C>;
export {};
