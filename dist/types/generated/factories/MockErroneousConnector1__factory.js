"use strict";
/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockErroneousConnector1__factory = void 0;
const ethers_1 = require("ethers");
const _abi = [
    {
        inputs: [
            {
                internalType: "address",
                name: "_save",
                type: "address",
            },
            {
                internalType: "address",
                name: "_mUSD",
                type: "address",
            },
        ],
        stateMutability: "nonpayable",
        type: "constructor",
    },
    {
        inputs: [],
        name: "checkBalance",
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
                internalType: "uint256",
                name: "_amount",
                type: "uint256",
            },
        ],
        name: "deposit",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [],
        name: "poke",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "uint256",
                name: "_amount",
                type: "uint256",
            },
        ],
        name: "withdraw",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [],
        name: "withdrawAll",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
];
const _bytecode = "0x608060405234801561001057600080fd5b5060405161064f38038061064f83398101604081905261002f9161007c565b600080546001600160a01b039384166001600160a01b031991821617909155600180549290931691161790556100ae565b80516001600160a01b038116811461007757600080fd5b919050565b6000806040838503121561008e578182fd5b61009783610060565b91506100a560208401610060565b90509250929050565b610592806100bd6000396000f3fe608060405234801561001057600080fd5b50600436106100575760003560e01c8063181783581461005c5780632e1a7d4d14610066578063853828b614610079578063b6b55f2514610081578063c71daccb14610094575b600080fd5b6100646100a9565b005b610064610074366004610489565b61011d565b6100646101df565b61006461008f366004610489565b610323565b60025460405190815260200160405180910390f35b600354429015610118576000600354826100c3919061052f565b905060006100d66407620d06ef83610510565b90506000670de0b6b3a7640000826002546100f19190610510565b6100fb91906104f0565b9050806002600082825461010f91906104d8565b90915550505050505b600355565b60035442901561018c57600060035482610137919061052f565b9050600061014a6407620d06ef83610510565b90506000670de0b6b3a7640000826002546101659190610510565b61016f91906104f0565b9050806002600082825461018391906104d8565b90915550505050505b60038190556000546001600160a01b031633146101c45760405162461bcd60e51b81526004016101bb906104a1565b60405180910390fd5b81600260008282546101d6919061052f565b90915550505050565b60035442901561024e576000600354826101f9919061052f565b9050600061020c6407620d06ef83610510565b90506000670de0b6b3a7640000826002546102279190610510565b61023191906104f0565b9050806002600082825461024591906104d8565b90915550505050505b60038190556000546001600160a01b0316331461027d5760405162461bcd60e51b81526004016101bb906104a1565b60015460005460025460405163a9059cbb60e01b81526001600160a01b039283166004820152602481019190915291169063a9059cbb90604401602060405180830381600087803b1580156102d157600080fd5b505af11580156102e5573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906103099190610462565b506002805490600061031b838061052f565b909155505050565b6003544290156103925760006003548261033d919061052f565b905060006103506407620d06ef83610510565b90506000670de0b6b3a76400008260025461036b9190610510565b61037591906104f0565b9050806002600082825461038991906104d8565b90915550505050505b60038190556000546001600160a01b031633146103c15760405162461bcd60e51b81526004016101bb906104a1565b6001546000546040516323b872dd60e01b81526001600160a01b039182166004820152306024820152604481018590529116906323b872dd90606401602060405180830381600087803b15801561041757600080fd5b505af115801561042b573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525081019061044f9190610462565b5081600260008282546101d691906104d8565b600060208284031215610473578081fd5b81518015158114610482578182fd5b9392505050565b60006020828403121561049a578081fd5b5035919050565b60208082526017908201527f4f6e6c7920534156452063616e2063616c6c2074686973000000000000000000604082015260600190565b600082198211156104eb576104eb610546565b500190565b60008261050b57634e487b7160e01b81526012600452602481fd5b500490565b600081600019048311821515161561052a5761052a610546565b500290565b60008282101561054157610541610546565b500390565b634e487b7160e01b600052601160045260246000fdfea26469706673582212208d2f68e43fc457939ff387ecf0f0405e32bdc6370de5f8dcc24fc19c43e8151264736f6c63430008020033";
class MockErroneousConnector1__factory extends ethers_1.ContractFactory {
    constructor(signer) {
        super(_abi, _bytecode, signer);
    }
    deploy(_save, _mUSD, overrides) {
        return super.deploy(_save, _mUSD, overrides || {});
    }
    getDeployTransaction(_save, _mUSD, overrides) {
        return super.getDeployTransaction(_save, _mUSD, overrides || {});
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
exports.MockErroneousConnector1__factory = MockErroneousConnector1__factory;
MockErroneousConnector1__factory.bytecode = _bytecode;
MockErroneousConnector1__factory.abi = _abi;
//# sourceMappingURL=MockErroneousConnector1__factory.js.map