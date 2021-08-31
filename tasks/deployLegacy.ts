/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"

import { BN, simpleToExactAmount } from "@utils/math"
import { DelayedProxyAdmin__factory } from "types"
import { Contract } from "@ethersproject/contracts"
import { ONE_DAY } from "@utils/constants"
import { formatUnits } from "ethers/lib/utils"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils"

interface VaultData {
    underlyingTokenSymbol: string
    stakingTokenType: "savings" | "feederPool"
    priceCoeff?: BN
    platformToken?: string
}

task("LegacyVault.deploy", "Deploys a vault contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const governorAddress = resolveAddress("Governor", chain)
        if (hre.network.name === "hardhat") {
            // TODO use impersonate function instead of the following
            // impersonate fails with "You probably tried to import the "hardhat" module from your config or a file imported from it."
            await hre.network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [governorAddress],
            })
            await hre.network.provider.request({
                method: "hardhat_setBalance",
                params: [governorAddress, "0x8AC7230489E80000"],
            })
        }
        const governor = hre.ethers.provider.getSigner(governorAddress)

        const boostCoeff = 48
        const btcPriceCoeff = simpleToExactAmount(48000)
        const nexusAddress = getChainAddress("Nexus", chain)
        const boostDirectorAddress = getChainAddress("BoostDirector", chain)
        const rewardTokenAddress = resolveAddress("MTA", chain)
        const delayedProxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)

        const vaults: VaultData[] = [
            {
                underlyingTokenSymbol: "mBTC",
                stakingTokenType: "savings",
                priceCoeff: btcPriceCoeff.div(10),
            },
            {
                underlyingTokenSymbol: "GUSD",
                stakingTokenType: "feederPool",
            },
            {
                underlyingTokenSymbol: "BUSD",
                stakingTokenType: "feederPool",
            },
            {
                underlyingTokenSymbol: "alUSD",
                stakingTokenType: "feederPool",
                platformToken: "ALCX",
            },
            {
                underlyingTokenSymbol: "HBTC",
                stakingTokenType: "feederPool",
                priceCoeff: btcPriceCoeff,
            },
            {
                underlyingTokenSymbol: "TBTC",
                stakingTokenType: "feederPool",
                priceCoeff: btcPriceCoeff,
            },
            {
                underlyingTokenSymbol: "mUSD",
                stakingTokenType: "savings",
                priceCoeff: simpleToExactAmount(1, 17),
            },
        ]

        for (const vault of vaults) {
            const stakingTokenAddress = resolveAddress(vault.underlyingTokenSymbol, chain, vault.stakingTokenType)
            const vaultProxyAddress = resolveAddress(vault.underlyingTokenSymbol, chain, "vault")
            const contractName = vault.platformToken ? "BoostedDualVault" : "BoostedSavingsVault"
            const vaultFactory = await hre.ethers.getContractFactory(
                `contracts/legacy/v-${vault.underlyingTokenSymbol}.sol:${contractName}`,
                signer,
            )
            const priceCoeff = vault.priceCoeff ? vault.priceCoeff : simpleToExactAmount(1)
            let vaultImpl: Contract
            if (vault.platformToken) {
                const platformTokenAddress = resolveAddress(vault.platformToken, chain)
                vaultImpl = await vaultFactory.deploy(
                    nexusAddress,
                    stakingTokenAddress,
                    boostDirectorAddress,
                    priceCoeff,
                    boostCoeff,
                    rewardTokenAddress,
                    platformTokenAddress,
                )
            } else {
                vaultImpl = await vaultFactory.deploy(
                    nexusAddress,
                    stakingTokenAddress,
                    boostDirectorAddress,
                    priceCoeff,
                    boostCoeff,
                    rewardTokenAddress,
                )
            }

            if (hre.network.name === "hardhat") {
                const proxyAdmin = DelayedProxyAdmin__factory.connect(delayedProxyAdminAddress, governor)
                // the contracts have already been initialised so don't need to call it again
                const tx = await proxyAdmin.proposeUpgrade(vaultProxyAddress, vaultImpl.address, "0x")
                await logTxDetails(tx, "proposeUpgrade")
                // increaseTime fails with "You probably tried to import the "hardhat" module from your config or a file imported from it."
                // await increaseTime(ONE_WEEK)

                // TODO use increaseTime instead of the following
                await hre.ethers.provider.send("evm_increaseTime", [ONE_DAY.mul(8).toNumber()])
                await hre.ethers.provider.send("evm_mine", [])

                const tx2 = await proxyAdmin.acceptUpgradeRequest(vaultProxyAddress)
                await logTxDetails(tx2, "acceptUpgradeRequest")

                const proxy = await vaultFactory.attach(vaultProxyAddress).connect(signer)
                console.log(`Name: ${await proxy.name()}`)
                console.log(`Symbol: ${await proxy.symbol()}`)
                console.log(`Total Supply: ${formatUnits(await proxy.totalSupply())}`)
                console.log(`Nexus: ${await proxy.nexus()}`)
                console.log(`boostDirector: ${await proxy.boostDirector()}`)
                console.log(`priceCoeff: ${formatUnits(await proxy.priceCoeff())}`)
                console.log(`rewardToken: ${await proxy.getRewardToken()}`)
                console.log(`user balance ${await proxy.balanceOf("0x8d0f5678557192e23d1da1c689e40f25c063eaa5")}`)
                console.log(`user raw balance ${await proxy.rawBalanceOf("0x8d0f5678557192e23d1da1c689e40f25c063eaa5")}`)
                if (vault.underlyingTokenSymbol === "alUSD") {
                    console.log(`platformToken: ${await proxy.getPlatformToken()}`)
                }
            } else {
                console.log(`Delayed Proxy Admin contract ${delayedProxyAdminAddress}`)
                console.log(`proposeUpgrade tx args: proxy ${vaultProxyAddress}, impl ${vaultImpl.address}`)
            }
        }
    })

// TODO post upgrade verification tasks

export {}
