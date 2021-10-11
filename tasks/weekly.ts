/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import { task, types } from "hardhat/config"
import { getSigner } from "./utils/signerFactory"
import { alUSD, BUSD, GUSD, HBTC, isToken, mBPT, mBTC, MTA, mUSD, PMTA, PmUSD, TBTC, Token } from "./utils"
import { ContractNames } from "./utils/networkAddressFactory"

task("distribute-mta-mainnet", "Distributes MTA rewards on Mainnet")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async ({ speed }, hre) => {
        const signer = await getSigner(hre)
        const signerAddress = await signer.getAddress()
        const rewardSymbol = MTA.symbol
        const vaultsOrPools: Array<Token | ContractNames> = [MTA, mBPT, mUSD, mBTC, alUSD, BUSD, GUSD, HBTC, TBTC]
        const mtaAmounts = [32500, 20000, 14933.23, 6633.17, 12954.38, 18288.1, 22244.11, 19791.17, 12987.84]
        const vaultNames = [
            "Staking V2 MTA   ",
            "Staking V2 mBPT  ",
            "imUSD Vault      ",
            "imBTC Vault      ",
            "alUSD Feeder Pool",
            "BUSD Feeder Pool ",
            "GUSD Feeder Pool ",
            "HBTC Feeder Pool ",
            "TBTC Feeder Pool ",
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

        console.log("\n\nDistribute MTA to vaults")
        await hre.run("dis-rewards", {
            vaultAssets: symbolOrNamesCommaSeparated,
            mtaAmounts: mtaAmountsCommaSeparated,
            speed,
        })

        console.log("\n\nTransfer 5k MTA to Visor Finance")
        const visorAmount = 5000
        await hre.run("token-transfer", {
            asset: "MTA",
            recipient: "VisorRouter",
            amount: visorAmount,
            speed,
        })

        console.log(`\nDiscord announcement`)
        let total = visorAmount
        vaultNames.forEach((name, i) => {
            total += mtaAmounts[i]
            console.log(`- ${name} ${mtaAmounts[i].toLocaleString().padStart(10)} MTA`)
        })
        console.log(`- Visor Finance     ${visorAmount.toLocaleString().padStart(10)} MTA`)
        console.log(`TOTAL rewards on ETH L1 ${total.toLocaleString()} MTA`)
    })

task("distribute-mta-polygon", "Distributes MTA and Matic rewards on Polygon")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async ({ speed }, hre) => {
        const signer = await getSigner(hre)
        const signerAddress = await signer.getAddress()
        const rewardSymbol = PMTA.symbol
        const vaultsOrPools: Array<Token | ContractNames> = [PmUSD]
        const mtaAmounts = [17360]
        const platformAmounts = []

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
        console.log(`\nRelay accounts MTA balance before distribution`)
        await hre.run("token-balance", {
            token: rewardSymbol,
            owner: signerAddress,
        })

        console.log("\n")
        await hre.run("dis-rewards", {
            vaultAssets: symbolOrNamesCommaSeparated,
            mtaAmounts: mtaAmountsCommaSeparated,
            platformAmounts: platformAmountsCommaSeparated,
            speed,
        })

        console.log("\n\nTransfer 10k MTA to FRAX")
        const fraxAmount = 10000
        await hre.run("token-transfer", {
            asset: "PMTA",
            recipient: "FraxVault",
            amount: fraxAmount,
            speed,
        })
    })
