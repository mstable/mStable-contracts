import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { MockStakingContract, MockStakingContractInterface } from "../MockStakingContract";
export declare class MockStakingContract__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<MockStakingContract>;
    getDeployTransaction(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): MockStakingContract;
    connect(signer: Signer): MockStakingContract__factory;
    static readonly bytecode = "0x608060405234801561001057600080fd5b50610130806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c806370a08231146037578063b46310f6146058575b600080fd5b6046604236600460b6565b6081565b60405190815260200160405180910390f35b607f606336600460d4565b6001600160a01b03909116600090815260208190526040902055565b005b6001600160a01b0381166000908152602081905260409020545b919050565b80356001600160a01b0381168114609b57600080fd5b60006020828403121560c6578081fd5b60cd8260a0565b9392505050565b6000806040838503121560e5578081fd5b60ec8360a0565b94602093909301359350505056fea26469706673582212208d70f8e79282a6542d3378b79be42fe92c91e376294d8885f63c08733741da0d64736f6c63430008020033";
    static readonly abi: {
        inputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        name: string;
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): MockStakingContractInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): MockStakingContract;
}
