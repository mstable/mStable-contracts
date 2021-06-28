import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { MockTrigger, MockTriggerInterface } from "../MockTrigger";
export declare class MockTrigger__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<MockTrigger>;
    getDeployTransaction(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): MockTrigger;
    connect(signer: Signer): MockTrigger__factory;
    static readonly bytecode = "0x608060405234801561001057600080fd5b5061011b806100206000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c8063b92814d814602d575b600080fd5b603c6038366004609b565b603e565b005b60405163b350df5d60e01b81526001600160a01b03828116600483015283169063b350df5d90602401600060405180830381600087803b158015608057600080fd5b505af11580156093573d6000803e3d6000fd5b505050505050565b6000806040838503121560ac578182fd5b823560b58160ce565b9150602083013560c38160ce565b809150509250929050565b6001600160a01b038116811460e257600080fd5b5056fea264697066735822122013eddb5b6eaa2eacf40c0a89b0f0297d253d707960a85760ee65a2e3e23657d964736f6c63430008020033";
    static readonly abi: {
        inputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        name: string;
        outputs: any[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): MockTriggerInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): MockTrigger;
}
