import { DEAD_ADDRESS } from "@utils/constants"
import { ethereumAddress } from "@utils/regex"
import { AssetAddressTypes, Chain, Token, tokens } from "./tokens"

export const contractNames = [
    "Nexus",
    "DelayedProxyAdmin",
    "ProxyAdmin",
    "ProtocolDAO",
    "Governor",
    "FundManager",
    "mStableDAO",
    "BadgerSafe",
    "SavingsManager",
    "Liquidator",
    "RewardsDistributor",
    "BoostDirector",
    "VoterProxy",
    "Collector",
    "Ejector",
    "Poker",
    "SaveWrapper",
    "RevenueRecipient",
    "MassetManager",
    "FeederManager",
    "FeederLogic",
    "FeederWrapper",
    "FeederInterestValidator",
    "BasketManager", // Legacy mUSD contract
    "SignatureVerifier",
    "QuestManager",
    "QuestMaster",
    "QuestSigner",
    "StakedTokenMTA",
    "StakedTokenBPT",
    "PlatformTokenVendorFactory",
    "BalancerVault",
    "BalancerRecipient",
    "BalancerStakingPoolId",
    "AaveIncentivesController",
    "AaveLendingPoolAddressProvider",
    "AlchemixStakingPool",
    "CompController",
    "CurveRegistryExchange",
    "QuickSwapRouter",
    "UniswapRouterV3",
    "UniswapQuoterV3",
    "UniswapEthToken",
    "UniswapV2-MTA/WETH",
    "MStableYieldSource", // Used for PoolTogether
    "OperationsSigner",
    "ENSRegistrarController",
    "ENSResolver",
    "FraxVault",
    "VisorRouter",
] as const
export type ContractNames = typeof contractNames[number]

export interface HardhatRuntime {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethers?: any
    hardhatArguments?: {
        config?: string
    }
    network?: {
        name: string
    }
}

export const getChainAddress = (contractName: ContractNames, chain: Chain): string => {
    if (chain === Chain.mainnet) {
        switch (contractName) {
            case "Nexus":
                return "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3"
            case "DelayedProxyAdmin":
                return "0x5C8eb57b44C1c6391fC7a8A0cf44d26896f92386"
            case "ProxyAdmin":
                return "0x3517F5a251d56C768789c22E989FAa7d906b5a13"
            case "ProtocolDAO":
            case "Governor":
                return "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
            case "BadgerSafe":
                return "0xCa045cC466f14C33a516D98abcab5C55C2f5112c"
            case "BalancerRecipient":
            case "FundManager":
                return "0x437E8C54Db5C66Bb3D80D2FF156e9bfe31a017db"
            case "mStableDAO":
                return "0x3dd46846eed8D147841AE162C8425c08BD8E1b41"
            case "SavingsManager":
                return "0x9781C4E9B9cc6Ac18405891DF20Ad3566FB6B301"
            case "Liquidator":
                return "0xe595D67181D701A5356e010D9a58EB9A341f1DbD"
            case "RewardsDistributor":
                return "0x04dfDfa471b79cc9E6E8C355e6C71F8eC4916C50"
            case "BoostDirector":
                return "0xBa05FD2f20AE15B0D3f20DDc6870FeCa6ACd3592"
            case "VoterProxy":
                return "0x10D96b1Fd46Ce7cE092aA905274B8eD9d4585A6E"
            case "Collector":
                return "0x3F63e5bbB53e46F8B21F67C25Bf2dd78BC6C0e43"
            case "Ejector":
                return "0x71061E3F432FC5BeE3A6763Cd35F50D3C77A0434"
            case "Poker":
                return "0x8E1Fd7F5ea7f7760a83222d3d470dFBf8493A03F"
            case "SaveWrapper":
                return "0x0CA7A25181FC991e3cC62BaC511E62973991f325"
            case "RevenueRecipient":
                return "0xA7824292efDee1177a1C1BED0649cfdD6114fed5"
            case "MassetManager":
                return "0x1E91F826fa8aA4fa4D3F595898AF3A64dd188848"
            case "FeederManager":
                return "0x90aE544E8cc76d2867987Ee4f5456C02C50aBd8B"
            case "FeederLogic":
                return "0x2837C77527c37d61D9763F53005211dACB4125dE"
            case "FeederWrapper":
                return "0x7C1fD068CE739A4687BEe9F69e5FD2275C7372d4"
            case "FeederInterestValidator":
                return "0xf1049aeD858C4eAd6df1de4dbE63EF607CfF3262"
            case "QuestMaster":
                return "0x3dd46846eed8D147841AE162C8425c08BD8E1b41"
            case "QuestSigner":
                return "0xfe99964d9677d7dfb66c5ca609b64f710d2808b8"
            case "BalancerVault":
                return "0xBA12222222228d8Ba445958a75a0704d566BF2C8"
            case "BalancerStakingPoolId":
                return "0xe2469f47ab58cf9cf59f9822e3c5de4950a41c49000200000000000000000089"
            case "BasketManager":
                return "0x66126B4aA2a1C07536Ef8E5e8bD4EfDA1FdEA96D"
            case "SignatureVerifier":
                return "0xC973413fe4944682910b97b261456EB9633A4756"
            case "QuestManager":
                return "0x861f12764780896FD783eA615Dd55Df0FF865752"
            case "PlatformTokenVendorFactory":
                return "0xfB73476911c5E84556a5bf953644B7ef50F6CBC5"
            case "StakedTokenMTA":
                return "0x8f2326316eC696F6d023E37A9931c2b2C177a3D7"
            case "StakedTokenBPT":
                return "0xeFbe22085D9f29863Cfb77EEd16d3cC0D927b011"
            case "AaveIncentivesController":
                return "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5"
            case "AaveLendingPoolAddressProvider":
                return "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5"
            case "AlchemixStakingPool":
                return "0xAB8e74017a8Cc7c15FFcCd726603790d26d7DeCa"
            case "CompController":
                return "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B"
            case "CurveRegistryExchange":
                return "0xD1602F68CC7C4c7B59D686243EA35a9C73B0c6a2"
            case "UniswapRouterV3":
                return "0xE592427A0AEce92De3Edee1F18E0157C05861564"
            case "UniswapQuoterV3":
                return "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"
            case "UniswapEthToken":
                return "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
            case "UniswapV2-MTA/WETH":
                return "0x9B4abA35b35EEE7481775cCB4055Ce4e176C9a6F"
            case "MStableYieldSource":
                return "0xdB4C9f763A4B13CF2830DFe7c2854dADf5b96E99"
            case "OperationsSigner":
                return "0xb81473f20818225302b8fffb905b53d58a793d84"
            case "ENSRegistrarController":
                return "0x283Af0B28c62C092C9727F1Ee09c02CA627EB7F5"
            case "ENSResolver":
                return "0x4976fb03c32e5b8cfe2b6ccb31c09ba78ebaba41"
            case "VisorRouter":
                return "0xF3f4F4e17cC65BDC36A36fDa5283F8D8020Ad0a4"
            default:
        }
    } else if (chain === Chain.polygon) {
        switch (contractName) {
            case "Nexus":
                return "0x3C6fbB8cbfCB75ecEC5128e9f73307f2cB33f2f6"
            case "DelayedProxyAdmin":
                return "0xCb6E4B67f2cac15c284AB49B6a4A671cdfe66711"
            case "ProtocolDAO":
            case "Governor":
                return "0x4aA2Dd5D5387E4b8dcf9b6Bfa4D9236038c3AD43"
            case "FundManager":
                return "0x437e8c54db5c66bb3d80d2ff156e9bfe31a017db"
            case "SavingsManager":
                return "0x10bFcCae079f31c451033798a4Fd9D2c33Ea5487"
            case "Liquidator":
                return "0x9F1C06CC13EDc7691a2Cf02E31FaAA64d57867e2"
            case "RewardsDistributor":
                return "0x3e9d19ee1893B07e22165C54c205702C90C70847"
            case "SaveWrapper":
                return "0x299081f52738A4204C3D58264ff44f6F333C6c88"
            case "FeederManager":
                return "0xa0adbAcBc179EF9b1a9436376a590b72d1d7bfbf"
            case "FeederLogic":
                return "0xc929E040b6C8F2fEFE6B45c6bFEB55508554F3E2"
            case "FeederInterestValidator":
                return "0x4A268958BC2f0173CDd8E0981C4c0a259b5cA291"
            case "AaveIncentivesController":
                return "0x357D51124f59836DeD84c8a1730D72B749d8BC23"
            case "AaveLendingPoolAddressProvider":
                return "0xd05e3E715d945B59290df0ae8eF85c1BdB684744"
            case "QuickSwapRouter":
                return "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff"
            case "MStableYieldSource":
                return "0x13bA0402f5047324B4279858298F56c30EA98753"
            case "OperationsSigner":
                return "0xdccb7a6567603af223c090be4b9c83eced210f18"
            case "FraxVault":
                return "0xc425Fd9Ed3C892d849C9E1a971516da1C1B29696"
            default:
        }
    } else if (chain === Chain.mumbai) {
        switch (contractName) {
            case "Nexus":
                return "0xCB4aabDb4791B35bDc9348bb68603a68a59be28E"
            case "DelayedProxyAdmin":
                return "0x41E4fF04e6f931f6EA71C7138A79a5B2B994eF19"
            case "ProtocolDAO":
            case "Governor":
                return "0xE1304aA964C5119C98E8AE554F031Bf3B21eC836"
            case "SavingsManager":
                return "0x86818a2EACcDC6e1C2d7A301E4Ebb394a3c61b85"
            case "Liquidator":
                return "0x42fdF7abe24387b786ca317B46945F2792A964e1"
            case "SaveWrapper":
                return "0xeB2A92Cc1A9dC337173B10cAbBe91ecBc805C98B"
            default:
        }
    } else if (chain === Chain.ropsten) {
        switch (contractName) {
            case "Nexus":
                return "0xeD04Cd19f50F893792357eA53A549E23Baf3F6cB"
            case "DelayedProxyAdmin":
                return "0x2d369F83E9DC764a759a74e87a9Bc542a2BbfdF0"
            case "BoostDirector":
                return "0x363FDC050722e74C5549C11B7d2c9d68FB9D7411"
            case "SignatureVerifier":
                return "0x3Bf48139e7C714ADA37C97Cd29e0F04D9673494a"
            case "QuestManager":
                return "0x3e8aa84E846EEb89392E99d44cD51acA668ae7BA"
            case "StakedTokenMTA":
                return "0xc3DCB920C30D4a4222220250DD2E8bA0c5A40d51"
            case "StakedTokenBPT":
                return "0x96a3Ee762022be1EA48Fc35DB46169a6182ba5c8"
            case "PlatformTokenVendorFactory":
                return "0x91fdDea51aD5A4e050c2A34e209284344206aF8e"
            case "BalancerVault":
                return "0xBA12222222228d8Ba445958a75a0704d566BF2C8"
            case "BalancerRecipient":
                return DEAD_ADDRESS
            case "BalancerStakingPoolId":
                return `0x021c343c6180f03ce9e48fae3ff432309b9af199000200000000000000000001`
            case "QuestMaster":
                return "0x04617083205b2fdd18b15bcf60d06674c6e2c1dc"
            case "QuestSigner":
                return "0x04617083205b2fdd18b15bcf60d06674c6e2c1dc"
            case "RewardsDistributor":
                return DEAD_ADDRESS
            default:
        }
    }

    return undefined
}

export const getChain = (hre: HardhatRuntime = {}): Chain => {
    if (hre?.network.name === "mainnet" || hre?.hardhatArguments?.config === "tasks-fork.config.ts") {
        return Chain.mainnet
    }
    if (hre?.network.name === "polygon_mainnet" || hre?.hardhatArguments?.config === "tasks-fork-polygon.config.ts") {
        return Chain.polygon
    }
    if (hre?.network.name === "polygon_testnet") {
        return Chain.mumbai
    }
    if (hre?.network.name === "ropsten") {
        return Chain.ropsten
    }
    return Chain.mainnet
}

export const getNetworkAddress = (contractName: ContractNames, hre: HardhatRuntime = {}): string => {
    const chain = getChain(hre)
    return getChainAddress(contractName, chain)
}

// Singleton instances of different contract names and token symbols
const resolvedAddressesInstances: { [contractNameSymbol: string]: { [tokenType: string]: string } } = {}

// Update the singleton instance so we don't need to resolve this next time
const updateResolvedAddresses = (addressContractNameSymbol: string, tokenType: AssetAddressTypes, address: string) => {
    if (resolvedAddressesInstances[addressContractNameSymbol]) {
        resolvedAddressesInstances[addressContractNameSymbol][tokenType] = address
    } else {
        resolvedAddressesInstances[addressContractNameSymbol] = { [tokenType]: address }
    }
}

// Resolves a contract name or token symbol to an ethereum address
export const resolveAddress = (
    addressContractNameSymbol: string,
    chain = Chain.mainnet,
    tokenType: AssetAddressTypes = "address",
): string => {
    let address = addressContractNameSymbol
    // If not an Ethereum address
    if (!addressContractNameSymbol.match(ethereumAddress)) {
        // If previously resolved then return from singleton instances
        if (resolvedAddressesInstances[addressContractNameSymbol]?.[tokenType])
            return resolvedAddressesInstances[addressContractNameSymbol][tokenType]

        // If an mStable contract name
        address = getChainAddress(addressContractNameSymbol as ContractNames, chain)

        if (!address) {
            // If a token Symbol
            const token = tokens.find((t) => t.symbol === addressContractNameSymbol && t.chain === chain)
            if (!token)
                throw Error(`Invalid approve address, token symbol or contract name "${addressContractNameSymbol}" for chain ${chain}`)
            if (!token[tokenType])
                throw Error(`Can not find token type "${tokenType}" for "${addressContractNameSymbol}" on chain ${chain}`)

            address = token[tokenType]
            console.log(`Resolved asset with symbol "${addressContractNameSymbol}" and type "${tokenType}" to address ${address}`)

            // Update the singleton instance so we don't need to resolve this next time
            updateResolvedAddresses(addressContractNameSymbol, tokenType, address)
            return address
        }

        console.log(`Resolved contract name "${addressContractNameSymbol}" to address ${address}`)

        // Update the singleton instance so we don't need to resolve this next time
        updateResolvedAddresses(addressContractNameSymbol, tokenType, address)

        return address
    }
    return address
}

// Singleton instances of different contract names and token symbols
const resolvedTokenInstances: { [address: string]: { [tokenType: string]: Token } } = {}

export const resolveToken = (symbol: string, chain = Chain.mainnet, tokenType: AssetAddressTypes = "address"): Token => {
    // If previously resolved then return from singleton instances
    if (resolvedTokenInstances[symbol]?.[tokenType]) return resolvedTokenInstances[symbol][tokenType]

    // If a token Symbol
    const token = tokens.find((t) => t.symbol === symbol && t.chain === chain)
    if (!token) throw Error(`Can not find token symbol ${symbol} on chain ${chain}`)
    if (!token[tokenType]) throw Error(`Can not find token type "${tokenType}" for ${symbol} on chain ${chain}`)

    console.log(`Resolved token symbol ${symbol} and type "${tokenType}" to address ${token[tokenType]}`)

    if (resolvedTokenInstances[symbol]) {
        resolvedTokenInstances[symbol][tokenType] = token
    } else {
        resolvedTokenInstances[symbol] = { [tokenType]: token }
    }

    return token
}
