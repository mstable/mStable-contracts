"use strict";
/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Nexus__factory = void 0;
const ethers_1 = require("ethers");
const _abi = [
    {
        inputs: [
            {
                internalType: "address",
                name: "_governorAddr",
                type: "address",
            },
        ],
        stateMutability: "nonpayable",
        type: "constructor",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "governor",
                type: "address",
            },
            {
                indexed: true,
                internalType: "address",
                name: "proposed",
                type: "address",
            },
        ],
        name: "GovernorChangeCancelled",
        type: "event",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "proposedGovernor",
                type: "address",
            },
        ],
        name: "GovernorChangeClaimed",
        type: "event",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "governor",
                type: "address",
            },
            {
                indexed: true,
                internalType: "address",
                name: "proposed",
                type: "address",
            },
        ],
        name: "GovernorChangeRequested",
        type: "event",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "address",
                name: "previousGovernor",
                type: "address",
            },
            {
                indexed: true,
                internalType: "address",
                name: "newGovernor",
                type: "address",
            },
        ],
        name: "GovernorChanged",
        type: "event",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "key",
                type: "bytes32",
            },
            {
                indexed: false,
                internalType: "address",
                name: "addr",
                type: "address",
            },
            {
                indexed: false,
                internalType: "bool",
                name: "isLocked",
                type: "bool",
            },
        ],
        name: "ModuleAdded",
        type: "event",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "key",
                type: "bytes32",
            },
        ],
        name: "ModuleCancelled",
        type: "event",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "key",
                type: "bytes32",
            },
        ],
        name: "ModuleLockCancelled",
        type: "event",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "key",
                type: "bytes32",
            },
        ],
        name: "ModuleLockEnabled",
        type: "event",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "key",
                type: "bytes32",
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "timestamp",
                type: "uint256",
            },
        ],
        name: "ModuleLockRequested",
        type: "event",
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: "bytes32",
                name: "key",
                type: "bytes32",
            },
            {
                indexed: false,
                internalType: "address",
                name: "addr",
                type: "address",
            },
            {
                indexed: false,
                internalType: "uint256",
                name: "timestamp",
                type: "uint256",
            },
        ],
        name: "ModuleProposed",
        type: "event",
    },
    {
        inputs: [],
        name: "UPGRADE_DELAY",
        outputs: [
            {
                internalType: "uint256",
                name: "",
                type: "uint256",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "_key",
                type: "bytes32",
            },
        ],
        name: "acceptProposedModule",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32[]",
                name: "_keys",
                type: "bytes32[]",
            },
        ],
        name: "acceptProposedModules",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [],
        name: "cancelGovernorChange",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "_key",
                type: "bytes32",
            },
        ],
        name: "cancelLockModule",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "_key",
                type: "bytes32",
            },
        ],
        name: "cancelProposedModule",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "",
                type: "address",
            },
        ],
        name: "changeGovernor",
        outputs: [],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "claimGovernorChange",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [],
        name: "delay",
        outputs: [
            {
                internalType: "uint256",
                name: "",
                type: "uint256",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "_key",
                type: "bytes32",
            },
        ],
        name: "getModule",
        outputs: [
            {
                internalType: "address",
                name: "addr",
                type: "address",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "governor",
        outputs: [
            {
                internalType: "address",
                name: "",
                type: "address",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32[]",
                name: "_keys",
                type: "bytes32[]",
            },
            {
                internalType: "address[]",
                name: "_addresses",
                type: "address[]",
            },
            {
                internalType: "bool[]",
                name: "_isLocked",
                type: "bool[]",
            },
            {
                internalType: "address",
                name: "_governorAddr",
                type: "address",
            },
        ],
        name: "initialize",
        outputs: [
            {
                internalType: "bool",
                name: "",
                type: "bool",
            },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [],
        name: "initialized",
        outputs: [
            {
                internalType: "bool",
                name: "",
                type: "bool",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "isGovernor",
        outputs: [
            {
                internalType: "bool",
                name: "",
                type: "bool",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "_key",
                type: "bytes32",
            },
        ],
        name: "lockModule",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "_key",
                type: "bytes32",
            },
        ],
        name: "moduleExists",
        outputs: [
            {
                internalType: "bool",
                name: "",
                type: "bool",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "",
                type: "bytes32",
            },
        ],
        name: "modules",
        outputs: [
            {
                internalType: "address",
                name: "addr",
                type: "address",
            },
            {
                internalType: "bool",
                name: "isLocked",
                type: "bool",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "_key",
                type: "bytes32",
            },
            {
                internalType: "address",
                name: "_addr",
                type: "address",
            },
        ],
        name: "proposeModule",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [],
        name: "proposedGovernor",
        outputs: [
            {
                internalType: "address",
                name: "",
                type: "address",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "",
                type: "bytes32",
            },
        ],
        name: "proposedLockModules",
        outputs: [
            {
                internalType: "uint256",
                name: "",
                type: "uint256",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "",
                type: "bytes32",
            },
        ],
        name: "proposedModules",
        outputs: [
            {
                internalType: "address",
                name: "newAddress",
                type: "address",
            },
            {
                internalType: "uint256",
                name: "timestamp",
                type: "uint256",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "_proposedGovernor",
                type: "address",
            },
        ],
        name: "requestGovernorChange",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "bytes32",
                name: "_key",
                type: "bytes32",
            },
        ],
        name: "requestLockModule",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [],
        name: "requestTime",
        outputs: [
            {
                internalType: "uint256",
                name: "",
                type: "uint256",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
];
const _bytecode = "0x6080604052600180546001600160a01b0319169055600060028190556003556008805460ff191690553480156200003557600080fd5b50604051620019b0380380620019b08339810160408190526200005891620001a9565b600080546001600160a01b0319163317808255604051839262093a809284926001600160a01b0391909116919060008051602062001990833981519152908290a3620000a48162000107565b5060008111620000fb5760405162461bcd60e51b815260206004820152601f60248201527f44656c6179206d7573742062652067726561746572207468616e207a65726f0060448201526064015b60405180910390fd5b60025550620001d99050565b6001600160a01b0381166200015f5760405162461bcd60e51b815260206004820152601f60248201527f474f563a206e657720476f7665726e6f722069732061646472657373283029006044820152606401620000f2565b600080546040516001600160a01b03808516939216916000805160206200199083398151915291a3600080546001600160a01b0319166001600160a01b0392909216919091179055565b600060208284031215620001bb578081fd5b81516001600160a01b0381168114620001d2578182fd5b9392505050565b6117a780620001e96000396000f3fe608060405234801561001057600080fd5b50600436106101585760003560e01c806385acd641116100c3578063b0b6cc1a1161007c578063b0b6cc1a1461031d578063c7af335214610371578063d7e0842a14610385578063d7fd0e7714610398578063e4c0aaf4146103a1578063efa2f3a2146103b457610158565b806385acd641146102ab5780638a11a370146102d45780638c33c19c146102e757806394ccb137146102ef57806397f5fea614610302578063ad339d7a1461031557610158565b8063381042c811610115578063381042c81461020d57806347fe8b1d146102205780636921ea411461022a5780636a42b8f81461023d5780636a89934b146102465780636d4e19911461029857610158565b8063099c47bc1461015d57806309ea14aa146101725780630c340a2414610185578063158ef93e146101af578063165ed306146101cc57806328066b86146101fa575b600080fd5b61017061016b36600461154f565b6103c7565b005b61017061018036600461168f565b610410565b6000546001600160a01b03165b6040516001600160a01b0390911681526020015b60405180910390f35b6008546101bc9060ff1681565b60405190151581526020016101a6565b6101ec6101da366004611677565b60076020526000908152604090205481565b6040519081526020016101a6565b610170610208366004611677565b61063e565b6101bc61021b3660046115b0565b610677565b6101ec62093a8081565b610170610238366004611570565b6108cd565b6101ec60025481565b610279610254366004611677565b600660205260009081526040902080546001909101546001600160a01b039091169082565b604080516001600160a01b0390931683526020830191909152016101a6565b6101706102a6366004611677565b610990565b6101926102b9366004611677565b6000908152600460205260409020546001600160a01b031690565b600154610192906001600160a01b031681565b610170610a6b565b6101bc6102fd366004611677565b610aaa565b610170610310366004611677565b610ae7565b610170610c3c565b61035261032b366004611677565b6004602052600090815260409020546001600160a01b03811690600160a01b900460ff1682565b604080516001600160a01b0390931683529015156020830152016101a6565b6101bc6000546001600160a01b0316331490565b610170610393366004611677565b610cf5565b6101ec60035481565b6101706103af36600461154f565b610dd1565b6101706103c2366004611677565b610e49565b6103db6000546001600160a01b0316331490565b6104005760405162461bcd60e51b81526004016103f7906116f1565b60405180910390fd5b4260035561040d81610f0f565b50565b6104246000546001600160a01b0316331490565b6104405760405162461bcd60e51b81526004016103f7906116f1565b816104845760405162461bcd60e51b81526020600482015260146024820152734b6579206d757374206e6f74206265207a65726f60601b60448201526064016103f7565b6001600160a01b0381166104da5760405162461bcd60e51b815260206004820152601c60248201527f4d6f64756c652061646472657373206d757374206e6f7420626520300000000060448201526064016103f7565b600082815260046020526040902054600160a01b900460ff16156105105760405162461bcd60e51b81526004016103f7906116ba565b6000828152600460205260409020546001600160a01b038281169116141561057a5760405162461bcd60e51b815260206004820152601f60248201527f4d6f64756c6520616c7265616479206861732073616d6520616464726573730060448201526064016103f7565b60008281526006602052604090206001810154156105da5760405162461bcd60e51b815260206004820152601760248201527f4d6f64756c6520616c72656164792070726f706f73656400000000000000000060448201526064016103f7565b80546001600160a01b0319166001600160a01b0383169081178255426001830181905560408051928352602083019190915284917fa5917e6bf5563219e2772cffe6989d6f2ef8235ab280ab88f8c37479562e58a3910160405180910390a2505050565b6106526000546001600160a01b0316331490565b61066e5760405162461bcd60e51b81526004016103f7906116f1565b61040d81611056565b600061068d6000546001600160a01b0316331490565b6106a95760405162461bcd60e51b81526004016103f7906116f1565b60085460ff16156106fc5760405162461bcd60e51b815260206004820152601c60248201527f4e6578757320697320616c726561647920696e697469616c697a65640000000060448201526064016103f7565b868061073d5760405162461bcd60e51b815260206004820152601060248201526f139bc81ad95e5cc81c1c9bdd9a59195960821b60448201526064016103f7565b80861461078c5760405162461bcd60e51b815260206004820152601960248201527f496e73756666696369656e74206164647265737320646174610000000000000060448201526064016103f7565b8084146107db5760405162461bcd60e51b815260206004820152601c60248201527f496e73756666696369656e74206c6f636b65642073746174757365730000000060448201526064016103f7565b60005b818110156108915761087f8a8a8381811061080957634e487b7160e01b600052603260045260246000fd5b9050602002013589898481811061083057634e487b7160e01b600052603260045260246000fd5b9050602002016020810190610845919061154f565b88888581811061086557634e487b7160e01b600052603260045260246000fd5b905060200201602081019061087a9190611657565b611110565b8061088981611740565b9150506107de565b506000546001600160a01b038481169116146108b0576108b083611271565b50506008805460ff19166001908117909155979650505050505050565b6108e16000546001600160a01b0316331490565b6108fd5760405162461bcd60e51b81526004016103f7906116f1565b808061093e5760405162461bcd60e51b815260206004820152601060248201526f4b65797320617272617920656d70747960801b60448201526064016103f7565b60005b8181101561098a5761097884848381811061096c57634e487b7160e01b600052603260045260246000fd5b90506020020135611056565b8061098281611740565b915050610941565b50505050565b6109a46000546001600160a01b0316331490565b6109c05760405162461bcd60e51b81526004016103f7906116f1565b6000818152600760205260409020546109d890611322565b610a155760405162461bcd60e51b815260206004820152600e60248201526d2232b630bc903737ba1037bb32b960911b60448201526064016103f7565b6000818152600460209081526040808320805460ff60a01b1916600160a01b17905560079091528082208290555182917f097d0a4360ac95150faf267a7b4a999756a69238c2c7023cac729d81f0b733a391a250565b610a7f6000546001600160a01b0316331490565b610a9b5760405162461bcd60e51b81526004016103f7906116f1565b6000600355610aa8611349565b565b60008115801590610ad157506000828152600460205260409020546001600160a01b031615155b15610ade57506001610ae2565b5060005b919050565b610afb6000546001600160a01b0316331490565b610b175760405162461bcd60e51b81526004016103f7906116f1565b610b2081610aaa565b610b605760405162461bcd60e51b8152602060048201526011602482015270135bd91d5b19481b5d5cdd08195e1a5cdd607a1b60448201526064016103f7565b600081815260046020526040902054600160a01b900460ff1615610b965760405162461bcd60e51b81526004016103f7906116ba565b60008181526007602052604090205415610bea5760405162461bcd60e51b8152602060048201526015602482015274131bd8dac8185b1c9958591e481c1c9bdc1bdcd959605a1b60448201526064016103f7565b600081815260076020526040908190204290819055905182917f57456e8dc47899fbd8a75be3129514a3e4cca602e26b766d4bbb821975c4375891610c3191815260200190565b60405180910390a250565b6001546001600160a01b03163314610c965760405162461bcd60e51b815260206004820152601f60248201527f53656e646572206973206e6f742070726f706f73656420676f7665726e6f720060448201526064016103f7565b600254600354610ca69190611728565b421015610ce65760405162461bcd60e51b815260206004820152600e60248201526d2232b630bc903737ba1037bb32b960911b60448201526064016103f7565b610cee611436565b6000600355565b610d096000546001600160a01b0316331490565b610d255760405162461bcd60e51b81526004016103f7906116f1565b60008181526006602052604090206001015480610d845760405162461bcd60e51b815260206004820152601960248201527f50726f706f736564206d6f64756c65206e6f7420666f756e640000000000000060448201526064016103f7565b60008281526006602052604080822080546001600160a01b03191681556001018290555183917f4dd889c845f5a942b8304764283938168000b8f4903940690beb685ca2fc16cc91a25050565b610de56000546001600160a01b0316331490565b610e015760405162461bcd60e51b81526004016103f7906116f1565b60405162461bcd60e51b815260206004820152601960248201527f446972656374206368616e6765206e6f7420616c6c6f7765640000000000000060448201526064016103f7565b610e5d6000546001600160a01b0316331490565b610e795760405162461bcd60e51b81526004016103f7906116f1565b600081815260076020526040902054610ed45760405162461bcd60e51b815260206004820152601d60248201527f4d6f64756c65206c6f636b2072657175657374206e6f7420666f756e6400000060448201526064016103f7565b6000818152600760205260408082208290555182917f3d670309414f84151711e0ac2795a2b1686580ad9faca995492166a486255db391a250565b610f236000546001600160a01b0316331490565b610f3f5760405162461bcd60e51b81526004016103f7906116f1565b6001600160a01b038116610f955760405162461bcd60e51b815260206004820152601f60248201527f50726f706f73656420676f7665726e6f7220697320616464726573732830290060448201526064016103f7565b6001546001600160a01b031615610fee5760405162461bcd60e51b815260206004820152601d60248201527f50726f706f73656420676f7665726e6f7220616c72656164792073657400000060448201526064016103f7565b600180546001600160a01b0319166001600160a01b03831690811790915561101e6000546001600160a01b031690565b6001600160a01b03167fa48c163cc46eb28aba8bdb525da18f15a83020cc18f439c933d79ea3ad9b50bb60405160405180910390a350565b600081815260066020908152604091829020825180840190935280546001600160a01b031683526001015490820181905261109090611322565b6110dc5760405162461bcd60e51b815260206004820152601d60248201527f4d6f64756c6520757067726164652064656c6179206e6f74206f76657200000060448201526064016103f7565b600082815260066020526040812080546001600160a01b0319168155600101819055815161110c91849190611110565b5050565b6001600160a01b038216600090815260056020526040902054156111765760405162461bcd60e51b815260206004820152601d60248201527f4d6f64756c6573206d757374206861766520756e69717565206164647200000060448201526064016103f7565b600083815260046020526040902054600160a01b900460ff16156111ac5760405162461bcd60e51b81526004016103f7906116ba565b6000838152600460205260409020546001600160a01b031680156111e4576001600160a01b0381166000908152600560205260408120555b60008481526004602090815260408083208054861515600160a01b810260ff60a01b196001600160a01b038b166001600160a01b031990941684171617909255808552600584529382902088905581519384529183019190915285917f7bf901a62d0edd068a4e74518eb8241133713d384171c7d0a3b7f6eb5c04095d910160405180910390a250505050565b6001600160a01b0381166112c75760405162461bcd60e51b815260206004820152601f60248201527f474f563a206e657720476f7665726e6f7220697320616464726573732830290060448201526064016103f7565b600080546040516001600160a01b03808516939216917fde4b3f61490b74c0ed6237523974fe299126bbbf8a8a7482fd220104c59b0c8491a3600080546001600160a01b0319166001600160a01b0392909216919091179055565b60008082118015610ad1575061133b62093a8083611728565b4210610ade57506001610ae2565b61135d6000546001600160a01b0316331490565b6113795760405162461bcd60e51b81526004016103f7906116f1565b6001546001600160a01b03166113d15760405162461bcd60e51b815260206004820152601960248201527f50726f706f73656420476f7665726e6f72206e6f74207365740000000000000060448201526064016103f7565b6001546001600160a01b03166113ef6000546001600160a01b031690565b6001600160a01b03167f2f7bb10f75b8694ea78291d7ca4c9f2a75bc45f0f97046164ad3ee984bdf4bba60405160405180910390a3600180546001600160a01b0319169055565b6001546001600160a01b031633146114905760405162461bcd60e51b815260206004820152601f60248201527f53656e646572206973206e6f742070726f706f73656420676f7665726e6f720060448201526064016103f7565b6001546114a5906001600160a01b0316611271565b6001546040516001600160a01b03909116907f0ad714cb5607f3b529b5d3292190925ae992a77b291e39ec09c390d4787896ba90600090a2600180546001600160a01b0319169055565b80356001600160a01b0381168114610ae257600080fd5b60008083601f840112611517578182fd5b50813567ffffffffffffffff81111561152e578182fd5b602083019150836020808302850101111561154857600080fd5b9250929050565b600060208284031215611560578081fd5b611569826114ef565b9392505050565b60008060208385031215611582578081fd5b823567ffffffffffffffff811115611598578182fd5b6115a485828601611506565b90969095509350505050565b60008060008060008060006080888a0312156115ca578283fd5b873567ffffffffffffffff808211156115e1578485fd5b6115ed8b838c01611506565b909950975060208a0135915080821115611605578485fd5b6116118b838c01611506565b909750955060408a0135915080821115611629578485fd5b506116368a828b01611506565b90945092506116499050606089016114ef565b905092959891949750929550565b600060208284031215611668578081fd5b81358015158114611569578182fd5b600060208284031215611688578081fd5b5035919050565b600080604083850312156116a1578182fd5b823591506116b1602084016114ef565b90509250929050565b60208082526017908201527f4d6f64756c65206d75737420626520756e6c6f636b6564000000000000000000604082015260600190565b6020808252601f908201527f474f563a2063616c6c6572206973206e6f742074686520476f7665726e6f7200604082015260600190565b6000821982111561173b5761173b61175b565b500190565b60006000198214156117545761175461175b565b5060010190565b634e487b7160e01b600052601160045260246000fdfea26469706673582212207ea1b7000c16354a344db47b85fa57e1e51f4bc2519ebb35a5bea3fbf244b06664736f6c63430008020033de4b3f61490b74c0ed6237523974fe299126bbbf8a8a7482fd220104c59b0c84";
class Nexus__factory extends ethers_1.ContractFactory {
    constructor(signer) {
        super(_abi, _bytecode, signer);
    }
    deploy(_governorAddr, overrides) {
        return super.deploy(_governorAddr, overrides || {});
    }
    getDeployTransaction(_governorAddr, overrides) {
        return super.getDeployTransaction(_governorAddr, overrides || {});
    }
    attach(address) {
        return super.attach(address);
    }
    connect(signer) {
        return super.connect(signer);
    }
    static createInterface() {
        return new ethers_1.utils.Interface(_abi);
    }
    static connect(address, signerOrProvider) {
        return new ethers_1.Contract(address, _abi, signerOrProvider);
    }
}
exports.Nexus__factory = Nexus__factory;
Nexus__factory.bytecode = _bytecode;
Nexus__factory.abi = _abi;
//# sourceMappingURL=Nexus__factory.js.map