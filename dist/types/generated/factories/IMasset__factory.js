"use strict";
/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMasset__factory = void 0;
const ethers_1 = require("ethers");
const _abi = [
    {
        inputs: [
            {
                internalType: "address",
                name: "",
                type: "address",
            },
        ],
        name: "bAssetIndexes",
        outputs: [
            {
                internalType: "uint8",
                name: "",
                type: "uint8",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "collectInterest",
        outputs: [
            {
                internalType: "uint256",
                name: "swapFeesGained",
                type: "uint256",
            },
            {
                internalType: "uint256",
                name: "newSupply",
                type: "uint256",
            },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [],
        name: "collectPlatformInterest",
        outputs: [
            {
                internalType: "uint256",
                name: "mintAmount",
                type: "uint256",
            },
            {
                internalType: "uint256",
                name: "newSupply",
                type: "uint256",
            },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [],
        name: "getBasket",
        outputs: [
            {
                internalType: "bool",
                name: "",
                type: "bool",
            },
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
                internalType: "address",
                name: "_token",
                type: "address",
            },
        ],
        name: "getBasset",
        outputs: [
            {
                components: [
                    {
                        internalType: "address",
                        name: "addr",
                        type: "address",
                    },
                    {
                        internalType: "address",
                        name: "integrator",
                        type: "address",
                    },
                    {
                        internalType: "bool",
                        name: "hasTxFee",
                        type: "bool",
                    },
                    {
                        internalType: "enum BassetStatus",
                        name: "status",
                        type: "uint8",
                    },
                ],
                internalType: "struct BassetPersonal",
                name: "personal",
                type: "tuple",
            },
            {
                components: [
                    {
                        internalType: "uint128",
                        name: "ratio",
                        type: "uint128",
                    },
                    {
                        internalType: "uint128",
                        name: "vaultBalance",
                        type: "uint128",
                    },
                ],
                internalType: "struct BassetData",
                name: "data",
                type: "tuple",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "getBassets",
        outputs: [
            {
                components: [
                    {
                        internalType: "address",
                        name: "addr",
                        type: "address",
                    },
                    {
                        internalType: "address",
                        name: "integrator",
                        type: "address",
                    },
                    {
                        internalType: "bool",
                        name: "hasTxFee",
                        type: "bool",
                    },
                    {
                        internalType: "enum BassetStatus",
                        name: "status",
                        type: "uint8",
                    },
                ],
                internalType: "struct BassetPersonal[]",
                name: "personal",
                type: "tuple[]",
            },
            {
                components: [
                    {
                        internalType: "uint128",
                        name: "ratio",
                        type: "uint128",
                    },
                    {
                        internalType: "uint128",
                        name: "vaultBalance",
                        type: "uint128",
                    },
                ],
                internalType: "struct BassetData[]",
                name: "data",
                type: "tuple[]",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address[]",
                name: "_inputs",
                type: "address[]",
            },
            {
                internalType: "uint256[]",
                name: "_inputQuantities",
                type: "uint256[]",
            },
        ],
        name: "getMintMultiOutput",
        outputs: [
            {
                internalType: "uint256",
                name: "mintOutput",
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
                name: "_input",
                type: "address",
            },
            {
                internalType: "uint256",
                name: "_inputQuantity",
                type: "uint256",
            },
        ],
        name: "getMintOutput",
        outputs: [
            {
                internalType: "uint256",
                name: "mintOutput",
                type: "uint256",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "getPrice",
        outputs: [
            {
                internalType: "uint256",
                name: "price",
                type: "uint256",
            },
            {
                internalType: "uint256",
                name: "k",
                type: "uint256",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address[]",
                name: "_outputs",
                type: "address[]",
            },
            {
                internalType: "uint256[]",
                name: "_outputQuantities",
                type: "uint256[]",
            },
        ],
        name: "getRedeemExactBassetsOutput",
        outputs: [
            {
                internalType: "uint256",
                name: "mAssetAmount",
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
                name: "_output",
                type: "address",
            },
            {
                internalType: "uint256",
                name: "_mAssetQuantity",
                type: "uint256",
            },
        ],
        name: "getRedeemOutput",
        outputs: [
            {
                internalType: "uint256",
                name: "bAssetOutput",
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
                name: "_input",
                type: "address",
            },
            {
                internalType: "address",
                name: "_output",
                type: "address",
            },
            {
                internalType: "uint256",
                name: "_inputQuantity",
                type: "uint256",
            },
        ],
        name: "getSwapOutput",
        outputs: [
            {
                internalType: "uint256",
                name: "swapOutput",
                type: "uint256",
            },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address[]",
                name: "_bAssets",
                type: "address[]",
            },
            {
                internalType: "address",
                name: "_newIntegration",
                type: "address",
            },
        ],
        name: "migrateBassets",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "_input",
                type: "address",
            },
            {
                internalType: "uint256",
                name: "_inputQuantity",
                type: "uint256",
            },
            {
                internalType: "uint256",
                name: "_minOutputQuantity",
                type: "uint256",
            },
            {
                internalType: "address",
                name: "_recipient",
                type: "address",
            },
        ],
        name: "mint",
        outputs: [
            {
                internalType: "uint256",
                name: "mintOutput",
                type: "uint256",
            },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address[]",
                name: "_inputs",
                type: "address[]",
            },
            {
                internalType: "uint256[]",
                name: "_inputQuantities",
                type: "uint256[]",
            },
            {
                internalType: "uint256",
                name: "_minOutputQuantity",
                type: "uint256",
            },
            {
                internalType: "address",
                name: "_recipient",
                type: "address",
            },
        ],
        name: "mintMulti",
        outputs: [
            {
                internalType: "uint256",
                name: "mintOutput",
                type: "uint256",
            },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "_output",
                type: "address",
            },
            {
                internalType: "uint256",
                name: "_mAssetQuantity",
                type: "uint256",
            },
            {
                internalType: "uint256",
                name: "_minOutputQuantity",
                type: "uint256",
            },
            {
                internalType: "address",
                name: "_recipient",
                type: "address",
            },
        ],
        name: "redeem",
        outputs: [
            {
                internalType: "uint256",
                name: "outputQuantity",
                type: "uint256",
            },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address[]",
                name: "_outputs",
                type: "address[]",
            },
            {
                internalType: "uint256[]",
                name: "_outputQuantities",
                type: "uint256[]",
            },
            {
                internalType: "uint256",
                name: "_maxMassetQuantity",
                type: "uint256",
            },
            {
                internalType: "address",
                name: "_recipient",
                type: "address",
            },
        ],
        name: "redeemExactBassets",
        outputs: [
            {
                internalType: "uint256",
                name: "mAssetRedeemed",
                type: "uint256",
            },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "uint256",
                name: "_mAssetQuantity",
                type: "uint256",
            },
            {
                internalType: "uint256[]",
                name: "_minOutputQuantities",
                type: "uint256[]",
            },
            {
                internalType: "address",
                name: "_recipient",
                type: "address",
            },
        ],
        name: "redeemMasset",
        outputs: [
            {
                internalType: "uint256[]",
                name: "outputQuantities",
                type: "uint256[]",
            },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "uint256",
                name: "_cacheSize",
                type: "uint256",
            },
        ],
        name: "setCacheSize",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "uint256",
                name: "_swapFee",
                type: "uint256",
            },
            {
                internalType: "uint256",
                name: "_redemptionFee",
                type: "uint256",
            },
        ],
        name: "setFees",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "_bAsset",
                type: "address",
            },
            {
                internalType: "bool",
                name: "_flag",
                type: "bool",
            },
        ],
        name: "setTransferFeesFlag",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            {
                internalType: "address",
                name: "_input",
                type: "address",
            },
            {
                internalType: "address",
                name: "_output",
                type: "address",
            },
            {
                internalType: "uint256",
                name: "_inputQuantity",
                type: "uint256",
            },
            {
                internalType: "uint256",
                name: "_minOutputQuantity",
                type: "uint256",
            },
            {
                internalType: "address",
                name: "_recipient",
                type: "address",
            },
        ],
        name: "swap",
        outputs: [
            {
                internalType: "uint256",
                name: "swapOutput",
                type: "uint256",
            },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
];
class IMasset__factory {
    static createInterface() {
        return new ethers_1.utils.Interface(_abi);
    }
    static connect(address, signerOrProvider) {
        return new ethers_1.Contract(address, _abi, signerOrProvider);
    }
}
exports.IMasset__factory = IMasset__factory;
IMasset__factory.abi = _abi;
//# sourceMappingURL=IMasset__factory.js.map