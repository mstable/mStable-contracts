export const contractNames = [
    "Nexus",
    "DelayedProxyAdmin",
    "ProtocolDAO",
    "Governor",
    "FundManager",
    "mStableDAO",
    "SavingsManager",
    "Liquidator",
    "RewardsDistributor",
    "BoostDirector",
    "Collector",
    "Ejector",
    "Poker",
    "SaveWrapper",
    "RevenueRecipient",
    "FeederManager",
    "FeederLogic",
    "FeederWrapper",
    "FeederInterestValidator",
    "AaveIncentivesController",
    "AaveLendingPoolAddressProvider",
    "QuickSwapRouter",
] as const
export type ContractNames = typeof contractNames[number]

export const getNetworkAddress = (contractName: ContractNames, networkName = "mainnet", hardhatConfig?: string): string => {
    if (networkName === "mainnet" || hardhatConfig === "tasks-fork.config.ts") {
        switch (contractName) {
            case "Nexus":
                return "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3"
            case "DelayedProxyAdmin":
                return "0x5C8eb57b44C1c6391fC7a8A0cf44d26896f92386"
            case "ProtocolDAO":
            case "Governor":
                return "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
            case "FundManager":
                return "0x437e8c54db5c66bb3d80d2ff156e9bfe31a017db"
            case "mStableDAO":
                return "0x3dd46846eed8D147841AE162C8425c08BD8E1b41"
            case "SavingsManager":
                return "0x9781C4E9B9cc6Ac18405891DF20Ad3566FB6B301"
            case "Liquidator":
                return "0xe595D67181D701A5356e010D9a58EB9A341f1DbD"
            case "RewardsDistributor":
                return "0x04dfDfa471b79cc9E6E8C355e6C71F8eC4916C50"
            case "BoostDirector":
                return "0x8892d7A5e018cdDB631F4733B5C1654e9dE10aaF"
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
            case "FeederManager":
                return "0x90aE544E8cc76d2867987Ee4f5456C02C50aBd8B"
            case "FeederLogic":
                return "0x2837C77527c37d61D9763F53005211dACB4125dE"
            case "FeederWrapper":
                return "0x7C1fD068CE739A4687BEe9F69e5FD2275C7372d4"
            case "FeederInterestValidator":
                return "0xf1049aeD858C4eAd6df1de4dbE63EF607CfF3262"
            default:
        }
    } else if (networkName === "polygon_mainnet" || hardhatConfig === "tasks-fork-polygon.config.ts") {
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
            default:
        }
    } else if (networkName === "polygon_testnet") {
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
    } else if (networkName === "ropsten") {
        switch (contractName) {
            case "Nexus":
                return "0xeD04Cd19f50F893792357eA53A549E23Baf3F6cB"
            case "DelayedProxyAdmin":
                return "0x2d369F83E9DC764a759a74e87a9Bc542a2BbfdF0"
            default:
        }
    }

    throw Error(
        `Failed to find contract address for contract name ${contractName} on the ${networkName} network and config Hardhat ${hardhatConfig}`,
    )
}
