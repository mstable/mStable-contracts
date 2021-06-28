import { Signer, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { MusdV2Rebalance, MusdV2RebalanceInterface } from "../MusdV2Rebalance";
export declare class MusdV2Rebalance__factory extends ContractFactory {
    constructor(signer?: Signer);
    deploy(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): Promise<MusdV2Rebalance>;
    getDeployTransaction(overrides?: Overrides & {
        from?: string | Promise<string>;
    }): TransactionRequest;
    attach(address: string): MusdV2Rebalance;
    connect(signer: Signer): MusdV2Rebalance__factory;
    static readonly bytecode = "0x608060405234801561001057600080fd5b506000602081905260017f2a11cb67ca5c7e99dba99b50e02c11472d0f19c22ed5af42a1599a7f57e1c7a481905560027f70cfd5e45bda79ec08cf51b1938a36ea6a53e22bc2d92dc7d6aa23f7c40714275560037fc6521c8ea4247e8beb499344e591b9401fb2807ff9997dd598fd9e56c73a264d55736b175474e89094c44da98b954eedeac495271d0f825260047f5306b8fbe80b30a74098357ee8e26fad8dc069da9011cca5f0870a0a5982e5415580546001600160a01b03191633908117909155604051909182917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0908290a350611e90806101106000396000f3fe608060405234801561001057600080fd5b50600436106100885760003560e01c80638da5cb5b1161005b5780638da5cb5b146100f0578063929272f61461010b578063b82687881461011e578063f2fde38b1461013157610088565b80632856b9621461008d5780636036cba3146100a2578063715018a6146100d55780638b418713146100dd575b600080fd5b6100a061009b366004611aac565b610144565b005b6100c26100b036600461194f565b60006020819052908152604090205481565b6040519081526020015b60405180910390f35b6100a0610188565b6100a06100eb3660046119d5565b6101fc565b6001546040516001600160a01b0390911681526020016100cc565b6100a0610119366004611a6b565b6103c4565b6100c261012c36600461194f565b610448565b6100a061013f36600461194f565b6104c0565b6001546001600160a01b031633146101775760405162461bcd60e51b815260040161016e90611d21565b60405180910390fd5b6101828483836105ab565b50505050565b6001546001600160a01b031633146101b25760405162461bcd60e51b815260040161016e90611d21565b6001546040516000916001600160a01b0316907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0908390a3600180546001600160a01b0319169055565b33731e0447b19bb6ecfdae1e4ae1694b0c3659614e4e1461026b5760405162461bcd60e51b815260206004820152602360248201527f466c6173684c6f616e3a206f6e6c792063616c6c6564206279204479447820706044820152621bdbdb60ea1b606482015260840161016e565b600080808061027c8587018761196b565b6040516370a0823160e01b8152306004820152939750919550935091506000906001600160a01b038616906370a082319060240160206040518083038186803b1580156102c857600080fd5b505afa1580156102dc573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906103009190611ae1565b90508160018151811061032357634e487b7160e01b600052603260045260246000fd5b60200260200101518260008151811061034c57634e487b7160e01b600052603260045260246000fd5b602002602001015161035e9190611d56565b6103688583611dad565b146103ae5760405162461bcd60e51b81526020600482015260166024820152753234b2103737ba1033b2ba10333630b9b4103637b0b760511b604482015260640161016e565b6103b98584846106c4565b505050505050505050565b6001546001600160a01b031633146103ee5760405162461bcd60e51b815260040161016e90611d21565b604080516002808252606082018352600092602083019080368337019050509050828160008151811061043157634e487b7160e01b600052603260045260246000fd5b6020026020010181815250506101828483836105ab565b6001600160a01b038116600090815260208190526040812054806104ae5760405162461bcd60e51b815260206004820152601c60248201527f466c6173684c6f616e3a20556e737570706f7274656420746f6b656e00000000604482015260640161016e565b6104b9600182611dad565b9392505050565b6001546001600160a01b031633146104ea5760405162461bcd60e51b815260040161016e90611d21565b6001600160a01b03811661054f5760405162461bcd60e51b815260206004820152602660248201527f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206160448201526564647265737360d01b606482015260840161016e565b6001546040516001600160a01b038084169216907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e090600090a3600180546001600160a01b0319166001600160a01b0392909216919091179055565b6040516370a0823160e01b81523060048201526000906001600160a01b038516906370a082319060240160206040518083038186803b1580156105ed57600080fd5b505afa158015610601573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906106259190611ae1565b90506000848285856040516020016106409493929190611b78565b604051602081830303815290604052905060008360018151811061067457634e487b7160e01b600052603260045260246000fd5b60200260200101518460008151811061069d57634e487b7160e01b600052603260045260246000fd5b60200260200101516106af9190611d56565b90506106bc868284610d88565b505050505050565b6000816001815181106106e757634e487b7160e01b600052603260045260246000fd5b60200260200101518260008151811061071057634e487b7160e01b600052603260045260246000fd5b60200260200101516107229190611d56565b90508160018151811061074557634e487b7160e01b600052603260045260246000fd5b60200260200101518260008151811061076e57634e487b7160e01b600052603260045260246000fd5b60200260200101516107809190611d56565b8110156107cf5760405162461bcd60e51b815260206004820152601d60248201527f666c617368206c6f616e206e6f74203e3d207377617020696e70757473000000604482015260640161016e565b6107f76001600160a01b03851673e2f2a5c287993345a840db3b0845fbc70f5935a5836110f0565b60008260008151811061081a57634e487b7160e01b600052603260045260246000fd5b60200260200101511115610b3457600073e2f2a5c287993345a840db3b0845fbc70f5935a56001600160a01b0316636e81221c866e085d4780b73119b644ae5ecd22b3768660008151811061087f57634e487b7160e01b600052603260045260246000fd5b60209081029190910101516040516001600160e01b031960e086901b1681526001600160a01b0393841660048201529290911660248301526044820152306064820152608401602060405180830381600087803b1580156108df57600080fd5b505af11580156108f3573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906109179190611ae1565b90506000610926600283611d6e565b90506109566e085d4780b73119b644ae5ecd22b3767345f783cce6b7ff23b2ab2d70e416cdb7d6055f51836110f0565b60006064610965836063611d8e565b61096f9190611d6e565b905060006001600160a01b03881673a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4814156109ad575060016109aa64e8d4a5100083611d6e565b91505b604051635320bf6b60e11b815260036004820152600f82900b602482015260448101849052606481018390527345f783cce6b7ff23b2ab2d70e416cdb7d6055f519063a6417ed690608401600060405180830381600087803b158015610a1257600080fd5b505af1158015610a26573d6000803e3d6000fd5b50610a5b92506e085d4780b73119b644ae5ecd22b376915073ecd5e75afb02efa118af914515d6521aabd189f19050856110f0565b6064610a68846063611d8e565b610a729190611d6e565b9150600190506001600160a01b03881673a0b86991c6218b36c1d19d4a2e9eb0ce3606eb481415610ab257506002610aaf64e8d4a5100083611d6e565b91505b604051635320bf6b60e11b815260006004820152600f82900b6024820152604481018490526064810183905273ecd5e75afb02efa118af914515d6521aabd189f19063a6417ed690608401600060405180830381600087803b158015610b1757600080fd5b505af1158015610b2b573d6000803e3d6000fd5b50505050505050505b600082600181518110610b5757634e487b7160e01b600052603260045260246000fd5b60200260200101511115610d7d57600073e2f2a5c287993345a840db3b0845fbc70f5935a56001600160a01b0316636e81221c8673dac17f958d2ee523a2206206994597c13d831ec786600181518110610bc157634e487b7160e01b600052603260045260246000fd5b60209081029190910101516040516001600160e01b031960e086901b1681526001600160a01b0393841660048201529290911660248301526044820152306064820152608401602060405180830381600087803b158015610c2157600080fd5b505af1158015610c35573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610c599190611ae1565b9050610c8e73dac17f958d2ee523a2206206994597c13d831ec773bebc44782c7db0a1a60cb6fe97d0b483032ff1c7836110f0565b60006064610c9d836063611d8e565b610ca79190611d6e565b905060016001600160a01b038716736b175474e89094c44da98b954eedeac495271d0f1415610cfc575060006064610ce0836063611d8e565b610cea9190611d6e565b610cf99064e8d4a51000611d8e565b91505b604051630f7c084960e21b815260026004820152600f82900b6024820152604481018490526064810183905273bebc44782c7db0a1a60cb6fe97d0b483032ff1c790633df0212490608401600060405180830381600087803b158015610d6157600080fd5b505af1158015610d75573d6000803e3d6000fd5b505050505050505b61018284828561124c565b6001600160a01b03831663095ea7b3731e0447b19bb6ecfdae1e4ae1694b0c3659614e4e610db7856001611d56565b6040516001600160e01b031960e085901b1681526001600160a01b0390921660048301526024820152604401602060405180830381600087803b158015610dfd57600080fd5b505af1158015610e11573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610e359190611ac1565b50604080516001808252818301909252600091816020015b6040805180820190915260008082526020820152815260200190600190039081610e4d5750506040805160038082526080820190925291925060009190602082015b610e9761183c565b815260200190600190039081610e8f5790505090506040518060400160405280306001600160a01b03168152602001600081525082600081518110610eec57634e487b7160e01b600052603260045260246000fd5b602002602001018190525060006040518060800160405280600015158152602001600080811115610f2d57634e487b7160e01b600052602160045260246000fd5b8152602001600081526020018690529050610f4661183c565b600181526000602082015260408101829052610f6187610448565b60608201523060a0820152825181908490600090610f8f57634e487b7160e01b600052603260045260246000fd5b6020026020010181905250610fa261183c565b60088152600060208201523060a082015260e081018690528351819085906001908110610fdf57634e487b7160e01b600052603260045260246000fd5b6020026020010181905250610ff261183c565b60408051608081019091526001815260009060208101828152602001600081526020016110208b6001611d56565b90526000808452602084015260408301819052905061103e8a610448565b60608301523060a0830152855182908790600290811061106e57634e487b7160e01b600052603260045260246000fd5b602090810291909101015260405163a67a6a4560e01b8152731e0447b19bb6ecfdae1e4ae1694b0c3659614e4e9063a67a6a45906110b2908a908a90600401611be0565b600060405180830381600087803b1580156110cc57600080fd5b505af11580156110e0573d6000803e3d6000fd5b5050505050505050505050505050565b8015806111795750604051636eb1769f60e11b81523060048201526001600160a01b03838116602483015284169063dd62ed3e9060440160206040518083038186803b15801561113f57600080fd5b505afa158015611153573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906111779190611ae1565b155b6111e45760405162461bcd60e51b815260206004820152603660248201527f5361666545524332303a20617070726f76652066726f6d206e6f6e2d7a65726f60448201527520746f206e6f6e2d7a65726f20616c6c6f77616e636560501b606482015260840161016e565b6040516001600160a01b03831660248201526044810182905261124790849063095ea7b360e01b906064015b60408051601f198184030181529190526020810180516001600160e01b03166001600160e01b0319909316929092179091526115ba565b505050565b6040516370a0823160e01b81523060048201526000906001600160a01b038516906370a082319060240160206040518083038186803b15801561128e57600080fd5b505afa1580156112a2573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906112c69190611ae1565b90506000816112d685600a611d56565b111561156257816112ea85620f4240611d56565b6112f49190611dad565b604051636eb1769f60e11b81526001600160a01b03858116600483015230602483015291925060009187169063dd62ed3e9060440160206040518083038186803b15801561134157600080fd5b505afa158015611355573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906113799190611ae1565b90508181116113ca5760405162461bcd60e51b815260206004820152601c60248201527f66756e64657220616c6c6f77616e6365203c2073686f727466616c6c00000000604482015260640161016e565b6040516370a0823160e01b81526001600160a01b038581166004830152600091908816906370a082319060240160206040518083038186803b15801561140f57600080fd5b505afa158015611423573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906114479190611ae1565b90508281116114985760405162461bcd60e51b815260206004820152601a60248201527f66756e6465722062616c616e6365203c2073686f727466616c6c000000000000604482015260640161016e565b60006001600160a01b038816736b175474e89094c44da98b954eedeac495271d0f14156114cc575069065a4da25d3016c000005b6001600160a01b03881673a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4814156114f957506406fc23ac005b808411156115495760405162461bcd60e51b815260206004820152601a60248201527f666c6173684c6f616e53686f727466616c6c20746f6f20626967000000000000604482015260640161016e565b61155e6001600160a01b03891687308761168c565b5050505b604080516001600160a01b038781168252602082018790528516818301526060810183905290517fed17e8a4c060e0fc8d8a57a12336e0f718e5018f8377fadbe64c6b5645ea13689181900360800190a15050505050565b600061160f826040518060400160405280602081526020017f5361666545524332303a206c6f772d6c6576656c2063616c6c206661696c6564815250856001600160a01b03166116c49092919063ffffffff16565b805190915015611247578080602001905181019061162d9190611ac1565b6112475760405162461bcd60e51b815260206004820152602a60248201527f5361666545524332303a204552433230206f7065726174696f6e20646964206e6044820152691bdd081cdd58d8d9595960b21b606482015260840161016e565b6040516001600160a01b03808516602483015283166044820152606481018290526101829085906323b872dd60e01b90608401611210565b60606116d384846000856116db565b949350505050565b60608247101561173c5760405162461bcd60e51b815260206004820152602660248201527f416464726573733a20696e73756666696369656e742062616c616e636520666f6044820152651c8818d85b1b60d21b606482015260840161016e565b843b61178a5760405162461bcd60e51b815260206004820152601d60248201527f416464726573733a2063616c6c20746f206e6f6e2d636f6e7472616374000000604482015260640161016e565b600080866001600160a01b031685876040516117a69190611b5c565b60006040518083038185875af1925050503d80600081146117e3576040519150601f19603f3d011682016040523d82523d6000602084013e6117e8565b606091505b50915091506117f8828286611803565b979650505050505050565b606083156118125750816104b9565b8251156118225782518084602001fd5b8160405162461bcd60e51b815260040161016e9190611d0e565b604080516101008101825260008082526020820152908101611880604080516080810190915260008082526020820190815260200160008152602001600081525090565b8152602001600081526020016000815260200160006001600160a01b0316815260200160008152602001606081525090565b600082601f8301126118c2578081fd5b8135602067ffffffffffffffff808311156118df576118df611e1c565b818302604051601f19603f8301168101818110848211171561190357611903611e1c565b60405284815283810192508684018288018501891015611921578687fd5b8692505b85831015611943578035845292840192600192909201918401611925565b50979650505050505050565b600060208284031215611960578081fd5b81356104b981611e45565b60008060008060808587031215611980578283fd5b843561198b81611e45565b93506020850135925060408501356119a281611e45565b9150606085013567ffffffffffffffff8111156119bd578182fd5b6119c9878288016118b2565b91505092959194509250565b60008060008084860360808112156119eb578485fd5b85356119f681611e45565b94506040601f1982011215611a09578384fd5b50602085019250606085013567ffffffffffffffff80821115611a2a578384fd5b818701915087601f830112611a3d578384fd5b813581811115611a4b578485fd5b886020828501011115611a5c578485fd5b95989497505060200194505050565b600080600060608486031215611a7f578283fd5b8335611a8a81611e45565b9250602084013591506040840135611aa181611e45565b809150509250925092565b60008060008060808587031215611980578384fd5b600060208284031215611ad2578081fd5b815180151581146104b9578182fd5b600060208284031215611af2578081fd5b5051919050565b60008151808452611b11816020860160208601611dc4565b601f01601f19169290920160200192915050565b8051151582526020810151611b3981611e32565b60208301526040810151611b4c81611e32565b6040830152606090810151910152565b60008251611b6e818460208701611dc4565b9190910192915050565b6001600160a01b0385811682526020808301869052908416604083015260806060830181905283519083018190526000918481019160a085019190845b81811015611bd157845184529382019392820192600101611bb5565b50919998505050505050505050565b6040808252835182820181905260009190606090818501906020808901865b83811015611c2d57815180516001600160a01b03168652830151838601529386019390820190600101611bff565b5050868303818801528751808452818401925080820284018201898301885b83811015611cfd57601f198784030186528151610160815160098110611c7457611c74611e06565b855281870151878601528a820151611c8e8c870182611b25565b508982015160c081818801526080840151915060e0828189015260a08501519250611cc56101008901846001600160a01b03169052565b908401516101208801529092015161014086018290529150611ce981860183611af9565b978701979450505090840190600101611c4c565b50909b9a5050505050505050505050565b6000602082526104b96020830184611af9565b6020808252818101527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e6572604082015260600190565b60008219821115611d6957611d69611df0565b500190565b600082611d8957634e487b7160e01b81526012600452602481fd5b500490565b6000816000190483118215151615611da857611da8611df0565b500290565b600082821015611dbf57611dbf611df0565b500390565b60005b83811015611ddf578181015183820152602001611dc7565b838111156101825750506000910152565b634e487b7160e01b600052601160045260246000fd5b634e487b7160e01b600052602160045260246000fd5b634e487b7160e01b600052604160045260246000fd5b60018110611e4257611e42611e06565b50565b6001600160a01b0381168114611e4257600080fdfea2646970667358221220391e71ca8faf4cce4cf3d2dad98b734a8cceb249b762ec5d72eeb298b33d20a064736f6c63430008020033";
    static readonly abi: ({
        anonymous: boolean;
        inputs: {
            indexed: boolean;
            internalType: string;
            name: string;
            type: string;
        }[];
        name: string;
        type: string;
        outputs?: undefined;
        stateMutability?: undefined;
    } | {
        inputs: ({
            internalType: string;
            name: string;
            type: string;
            components?: undefined;
        } | {
            components: {
                internalType: string;
                name: string;
                type: string;
            }[];
            internalType: string;
            name: string;
            type: string;
        })[];
        name: string;
        outputs: any[];
        stateMutability: string;
        type: string;
        anonymous?: undefined;
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
    static createInterface(): MusdV2RebalanceInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): MusdV2Rebalance;
}
