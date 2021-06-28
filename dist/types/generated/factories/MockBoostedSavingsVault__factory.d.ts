import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { MockBoostedSavingsVault, MockBoostedSavingsVaultInterface } from "../MockBoostedSavingsVault";
export declare class MockBoostedSavingsVault__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(_boostDirector: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<MockBoostedSavingsVault>;
    getDeployTransaction(_boostDirector: string, overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): MockBoostedSavingsVault;
    connect(signer: Signer): MockBoostedSavingsVault__factory;
    static readonly bytecode = "0x60a060405234801561001057600080fd5b506040516102e83803806102e883398101604081905261002f91610044565b60601b6001600160601b031916608052610072565b600060208284031215610055578081fd5b81516001600160a01b038116811461006b578182fd5b9392505050565b60805160601c610253610095600039600081816071015260e201526102536000f3fe608060405234801561001057600080fd5b50600436106100415760003560e01c80632f90ce4614610046578063b43082ec1461006c578063cf7bf6b7146100ab575b600080fd5b6100596100543660046101d7565b6100c0565b6040519081526020015b60405180910390f35b6100937f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b039091168152602001610063565b6100be6100b93660046101d7565b6101a0565b005b60405163f8b2cb4f60e01b81526001600160a01b0382811660048301526000917f00000000000000000000000000000000000000000000000000000000000000009091169063f8b2cb4f90602401602060405180830381600087803b15801561012857600080fd5b505af115801561013c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906101609190610205565b90507fabd23dd011113861738620acd8e5cbec0577c8c8b3d7566e2a615e0c01ff333f8160405161019391815260200190565b60405180910390a1919050565b6040516001600160a01b038216907fa31b3b303c759fa7ee31d89a1a6fb7eb704d8fe5c87aa4f60f54468ff121bee890600090a250565b6000602082840312156101e8578081fd5b81356001600160a01b03811681146101fe578182fd5b9392505050565b600060208284031215610216578081fd5b505191905056fea2646970667358221220d3abced7e3999631931dcf43034d634aa682eb352179c0faf75c4e916c2bea2064736f6c63430008020033";
    static readonly abi: ({
        inputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
        anonymous?: undefined;
        name?: undefined;
        outputs?: undefined;
    } | {
        anonymous: boolean;
        inputs: {
            indexed: boolean;
            internalType: string;
            name: string;
            type: string;
        }[];
        name: string;
        type: string;
        stateMutability?: undefined;
        outputs?: undefined;
    } | {
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
        anonymous?: undefined;
    })[];
    static createInterface(): MockBoostedSavingsVaultInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): MockBoostedSavingsVault;
}
