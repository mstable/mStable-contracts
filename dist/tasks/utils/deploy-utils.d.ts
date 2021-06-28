import { Contract, ContractFactory, ContractReceipt, ContractTransaction } from "ethers";
export declare const deployContract: <T extends Contract>(contractFactory: ContractFactory, contractName?: string, contractorArgs?: Array<unknown>) => Promise<T>;
export declare const logTxDetails: (tx: ContractTransaction, method: string) => Promise<ContractReceipt>;
