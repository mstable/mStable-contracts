/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import { task, types } from "hardhat/config"
import { getSigner } from "./utils/signerFactory"
import { alUSD, AssetAddressTypes, BUSD, GUSD, HBTC, isToken, mBTC, MTA, mUSD, PMTA, PmUSD, PWMATIC, TBTC, Token } from "./utils"
import { ContractNames } from "./utils/networkAddressFactory"

task("distribute-mta-mainnet", "Distributes MTA rewards on Mainnet")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async ({ speed }, hre) => {
        const signer = await getSigner(hre)
        const signerAddress = await signer.getAddress()
        const rewardSymbol = MTA.symbol
        const ownerTokenType: AssetAddressTypes = "vault"
        const vaultsOrPools: Array<Token | ContractNames> = [MTA, "UniswapV2-MTA/WETH", mUSD, mBTC, alUSD, BUSD, GUSD, HBTC, TBTC]
        const mtaAmounts = [40000, 5000, 21438.03, 10857.17, 33129.65, 18353.39, 32464.07, 30693.72, 14539.97]
        const vaultNames = [
            "Staking V1 rewards",
            "MTA / WETH Uniswap v2",
            "imUSD Vault",
            "imBTC Vault",
            "alUSD Feeder Pool",
            "BUSD Feeder Pool",
            "GUSD Feeder Pool",
            "HBTC Feeder Pool",
            "TBTC Feeder Pool",
        ]

        // Create a comma separated list of token symbols and amounts
        const symbolOrNames = vaultsOrPools.map((v) => {
            if (!isToken(v)) return v
            return v.symbol
        })
        const symbolOrNamesCommaSeparated = symbolOrNames.join()
        const mtaAmountsCommaSeparated = mtaAmounts.join()

        console.log(`\nRelay accounts MTA balance before distribution`)
        await hre.run("token-balance", {
            token: rewardSymbol,
            owner: signerAddress,
        })

        console.log(`\nVault and pool MTA balances before distribution`)
        for (const symbolOrName of symbolOrNames) {
            await hre.run("token-balance", {
                owner: symbolOrName,
                token: rewardSymbol,
                ownerTokenType,
            })
        }

        console.log("\n\n")
        await hre.run("dis-rewards", {
            vaultAssets: symbolOrNamesCommaSeparated,
            mtaAmounts: mtaAmountsCommaSeparated,
            speed,
        })

        console.log(`\nVault and pool MTA balances after distribution`)
        for (const symbolOrName of symbolOrNames) {
            await hre.run("token-balance", {
                owner: symbolOrName,
                token: rewardSymbol,
                ownerTokenType,
            })
        }

        console.log(`\nDiscord announcement`)
        vaultNames.forEach((name, i) => {
            console.log(`- ${name} ${mtaAmounts[i]} MTA`)
        })
    })

task("distribute-mta-polygon", "Distributes MTA and Matic rewards on Polygon")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async ({ speed }, hre) => {
        const signer = await getSigner(hre)
        const signerAddress = await signer.getAddress()
        const rewardSymbol = PMTA.symbol
        const platformRewardSymbol = PWMATIC.symbol
        const vaultsOrPools: Array<Token | ContractNames> = [PmUSD]
        const mtaAmounts = [20832]
        const platformAmounts = [18666]

        // Create a comma separated list of token symbols and amounts
        const symbolOrNames = vaultsOrPools.map((v) => {
            if (!isToken(v)) return v
            return v.symbol
        })
        const symbolOrNamesCommaSeparated = symbolOrNames.join()
        const mtaAmountsCommaSeparated = mtaAmounts.join()
        const platformAmountsCommaSeparated = platformAmounts.join()

        await hre.run("token-allowance", {
            token: rewardSymbol,
            owner: signerAddress,
            spender: "RewardsDistributor",
        })
        await hre.run("token-allowance", {
            token: platformRewardSymbol,
            owner: signerAddress,
            spender: "RewardsDistributor",
        })
        console.log(`\nRelay accounts MTA balance before distribution`)
        await hre.run("token-balance", {
            token: rewardSymbol,
            owner: signerAddress,
        })
        console.log(`Relay accounts WMATIC balance before distribution`)
        await hre.run("token-balance", {
            token: platformRewardSymbol,
            owner: signerAddress,
        })

        console.log(`\nVault MTA and WMATIC balances before distribution`)
        for (const symbolOrName of symbolOrNames) {
            await hre.run("token-balance", {
                token: rewardSymbol,
                owner: symbolOrName,
                ownerTokenType: "vault",
            })
            await hre.run("token-balance", {
                token: platformRewardSymbol,
                owner: symbolOrName,
                ownerTokenType: "platformTokenVendor",
            })
        }

        console.log("\n\n")
        await hre.run("dis-rewards", {
            vaultAssets: symbolOrNamesCommaSeparated,
            mtaAmounts: mtaAmountsCommaSeparated,
            platformAmounts: platformAmountsCommaSeparated,
            speed,
        })

        console.log(`\nVault MTA and WMATIC balances after distribution`)
        for (const symbolOrName of symbolOrNames) {
            await hre.run("token-balance", {
                token: rewardSymbol,
                owner: symbolOrName,
                ownerTokenType: "vault",
            })
            await hre.run("token-balance", {
                token: platformRewardSymbol,
                owner: symbolOrName,
                ownerTokenType: "platformTokenVendor",
            })
        }
    })
