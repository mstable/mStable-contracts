"use strict";
/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IRevenueRecipient__factory = void 0;
const ethers_1 = require("ethers");
const _abi = [
    {
        inputs: [
            {
                internalType: "address[]",
                name: "_mAssets",
                type: "address[]",
            },
            {
                internalType: "uint256[]",
                name: "_percentages",
                type: "uint256[]",
            },
        ],
        name: "depositToPool",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "_mAsset",
                type: "address",
            },
            {
                internalType: "uint256",
                name: "_amount",
                type: "uint256",
            },
        ],
        name: "notifyRedistributionAmount",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
];
class IRevenueRecipient__factory {
    static createInterface() {
        return new ethers_1.utils.Interface(_abi);
    }
    static connect(address, signerOrProvider) {
        return new ethers_1.Contract(address, _abi, signerOrProvider);
    }
}
exports.IRevenueRecipient__factory = IRevenueRecipient__factory;
IRevenueRecipient__factory.abi = _abi;
//# sourceMappingURL=IRevenueRecipient__factory.js.map