import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { DeadToken, DeadTokenInterface } from "../DeadToken";
export declare class DeadToken__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<DeadToken>;
    getDeployTransaction(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): DeadToken;
    connect(signer: Signer): DeadToken__factory;
    static readonly bytecode = "0x60806040526000805460ff19166012179055348015601c57600080fd5b50607c8061002b6000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c8063313ce56714602d575b600080fd5b6000546040805160ff9092168252519081900360200190f3fea2646970667358221220eb60c1a607acd916badadb9e53addd02cad714acc094b694f47d2a6accc8147e64736f6c63430008020033";
    static readonly abi: {
        inputs: any[];
        name: string;
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): DeadTokenInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): DeadToken;
}
