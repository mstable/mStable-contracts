import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { Poker, PokerInterface } from "../Poker";
export declare class Poker__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<Poker>;
    getDeployTransaction(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): Poker;
    connect(signer: Signer): Poker__factory;
    static readonly bytecode = "0x608060405234801561001057600080fd5b50610411806100206000396000f3fe608060405234801561001057600080fd5b506004361061002b5760003560e01c8063e05c2cee14610030575b600080fd5b61004361003e366004610213565b610045565b005b805160005b818110156101f257600083828151811061007457634e487b7160e01b600052603260045260246000fd5b602090810291909101015180519091506001600160a01b0381166100d55760405162461bcd60e51b8152602060048201526013602482015272626c616e6b207661756c74206164647265737360681b60448201526064015b60405180910390fd5b602082015151819060005b818110156101da5760008560200151828151811061010e57634e487b7160e01b600052603260045260246000fd5b6020026020010151905060006001600160a01b0316816001600160a01b0316141561016b5760405162461bcd60e51b815260206004820152600d60248201526c626c616e6b206164647265737360981b60448201526064016100cc565b60405163cf7bf6b760e01b81526001600160a01b03828116600483015285169063cf7bf6b790602401600060405180830381600087803b1580156101ae57600080fd5b505af11580156101c2573d6000803e3d6000fd5b505050505080806101d29061039e565b9150506100e0565b505050505080806101ea9061039e565b91505061004a565b505050565b80356001600160a01b038116811461020e57600080fd5b919050565b60006020808385031215610225578182fd5b67ffffffffffffffff808435111561023b578283fd5b8335840185601f82011261024d578384fd5b61025f61025a823561037a565b610349565b8135815283810190848301865b843581101561033b57813585016040818c03601f1901121561028c578889fd5b6102966040610349565b6102a18983016101f7565b81526040820135888111156102b4578a8bfd5b8083019250508b603f8301126102c857898afd5b888201356102d861025a8261037a565b808282528b82019150604085018f60408e860288010111156102f8578d8efd5b8d95505b838610156103215761030d816101f7565b835260019590950194918c01918c016102fc565b50838c01525050855250928601929086019060010161026c565b509098975050505050505050565b604051601f8201601f1916810167ffffffffffffffff81118282101715610372576103726103c5565b604052919050565b600067ffffffffffffffff821115610394576103946103c5565b5060209081020190565b60006000198214156103be57634e487b7160e01b81526011600452602481fd5b5060010190565b634e487b7160e01b600052604160045260246000fdfea26469706673582212201429e1fcfcf05c33c73f22341e7312447162274e94d9fa3c0869a71d0605d23564736f6c63430008020033";
    static readonly abi: {
        inputs: {
            components: {
                internalType: string;
                name: string;
                type: string;
            }[];
            internalType: string;
            name: string;
            type: string;
        }[];
        name: string;
        outputs: any[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): PokerInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): Poker;
}
