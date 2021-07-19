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
        const vaultsOrPools: Array<Token | ContractNames> = [mUSD, mBTC, GUSD, BUSD, alUSD, HBTC, TBTC, MTA, "UniswapV2-MTA/WETH"]
        const mtaAmounts = [23278.21, 9016.99, 43980.33, 23324.25, 30180.15, 16966.51, 14729.57, 40000, 5000]

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
