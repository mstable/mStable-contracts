/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { BN, simpleToExactAmount } from "@utils/math"
import { DelayedProxyAdmin__factory } from "types"
import { Contract } from "@ethersproject/contracts"
import { ONE_DAY } from "@utils/constants"
import { expect } from "chai"
import { BigNumberish, Signer } from "ethers"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"
import { Chain, deployContract, logTxDetails } from "./utils"
import { verifyEtherscan } from "./utils/etherscan"

interface UserBalance {
    user: string
    balance: BigNumberish
}
interface VaultData {
    underlyingTokenSymbol: string
    stakingTokenType: "savings" | "feederPool"
    priceCoeff?: BN
    platformToken?: string
    name: string
    symbol: string
    userBal: UserBalance
}

const boostCoeff = 9
const btcPriceCoeff = simpleToExactAmount(48000)
const vaults: VaultData[] = [
    {
        underlyingTokenSymbol: "mBTC",
        stakingTokenType: "savings",
        priceCoeff: btcPriceCoeff.div(10),
        name: "imBTC Vault",
        symbol: "v-imBTC",
        userBal: {
            user: "0x25953c127efd1e15f4d2be82b753d49b12d626d7",
            balance: simpleToExactAmount(172),
        },
    },
    {
        underlyingTokenSymbol: "GUSD",
        stakingTokenType: "feederPool",
        name: "mUSD/GUSD fPool Vault",
        symbol: "v-fPmUSD/GUSD",
        userBal: {
            user: "0xf794CF2d946BC6eE6eD905F47db211EBd451Aa5F",
            balance: simpleToExactAmount(425000),
        },
    },
    {
        underlyingTokenSymbol: "BUSD",
        stakingTokenType: "feederPool",
        name: "mUSD/BUSD fPool Vault",
        symbol: "v-fPmUSD/BUSD",
        userBal: {
            user: "0xc09111f9d094d07fc013fd45c4081510ca4275cf",
            balance: simpleToExactAmount(1400000),
        },
    },
    {
        underlyingTokenSymbol: "HBTC",
        stakingTokenType: "feederPool",
        priceCoeff: btcPriceCoeff,
        name: "mBTC/HBTC fPool Vault",
        symbol: "v-fPmBTC/HBTC",
        userBal: {
            user: "0x8d0f5678557192e23d1da1c689e40f25c063eaa5",
            balance: simpleToExactAmount(2.4),
        },
    },
    {
        underlyingTokenSymbol: "TBTC",
        stakingTokenType: "feederPool",
        priceCoeff: btcPriceCoeff,
        name: "mBTC/TBTC fPool Vault",
        symbol: "v-fPmBTC/TBTC",
        userBal: {
            user: "0x6f500bb95ee1cf1a92e45f7697fabb2d477087af",
            balance: simpleToExactAmount(2.2),
        },
    },
    {
        underlyingTokenSymbol: "alUSD",
        stakingTokenType: "feederPool",
        name: "mUSD/alUSD fPool Vault",
        symbol: "v-fPmUSD/alUSD",
        platformToken: "ALCX",
        userBal: {
            user: "0x97020c9ec66e0f59231918b1d2f167a66026aff2",
            balance: simpleToExactAmount(1200000),
        },
    },
    {
        underlyingTokenSymbol: "mUSD",
        stakingTokenType: "savings",
        priceCoeff: simpleToExactAmount(1, 17),
        name: "imUSD Vault",
        symbol: "v-imUSD",
        userBal: {
            user: "0x7606ccf1c5f2a908423eb8dd2fa5d82a12255700",
            balance: simpleToExactAmount(68000),
        },
    },
]

// Post upgrade verification tasks
const vaultVerification = async (hre, signer: Signer, chain: Chain) => {
    const nexusAddress = getChainAddress("Nexus", chain)
    const boostDirectorAddress = getChainAddress("BoostDirector", chain)
    const rewardTokenAddress = resolveAddress("MTA", chain)

    for (const vault of vaults) {
        const vaultProxyAddress = resolveAddress(vault.underlyingTokenSymbol, chain, "vault")
        const contractName = vault.platformToken ? "BoostedDualVault" : "BoostedSavingsVault"
        const vaultFactory = await hre.ethers.getContractFactory(
            `contracts/legacy/v-${vault.underlyingTokenSymbol}.sol:${contractName}`,
            signer,
        )
        const proxy = await vaultFactory.attach(vaultProxyAddress)

        console.log(`About to verify the ${vault.underlyingTokenSymbol} vault`)

        if (vault.underlyingTokenSymbol !== "mUSD") {
            expect(await proxy.name(), `${vault.underlyingTokenSymbol} vault name`).to.eq(vault.name)
            expect(await proxy.symbol(), `${vault.underlyingTokenSymbol} vault symbol`).to.eq(vault.symbol)
            expect(await proxy.decimals(), `${vault.underlyingTokenSymbol} decimals`).to.eq(18)
        }
        expect(await proxy.nexus(), `${vault.underlyingTokenSymbol} vault nexus`).to.eq(nexusAddress)
        expect(await proxy.boostDirector(), `${vault.underlyingTokenSymbol} vault boost director`).to.eq(boostDirectorAddress)
        expect(await proxy.getRewardToken(), `${vault.underlyingTokenSymbol} vault reward token`).to.eq(rewardTokenAddress)
        expect(await proxy.priceCoeff(), `${vault.underlyingTokenSymbol} vault priceCoeff`).to.eq(
            vault.priceCoeff ? vault.priceCoeff : simpleToExactAmount(1),
        )
        if (vault.underlyingTokenSymbol === "alUSD") {
            expect(await proxy.getPlatformToken(), `${vault.underlyingTokenSymbol} vault platform token`).to.eq(
                resolveAddress(vault.platformToken, chain),
            )
        }
        expect(await proxy.balanceOf(vault.userBal.user), `${vault.underlyingTokenSymbol} vault user balance`).to.gt(vault.userBal.balance)
        expect(await proxy.totalSupply(), `${vault.underlyingTokenSymbol} vault total supply`).to.gt(0)
    }
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

        const nexusAddress = getChainAddress("Nexus", chain)
        const boostDirectorAddress = getChainAddress("BoostDirector", chain)
        const rewardTokenAddress = resolveAddress("MTA", chain)
        const delayedProxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)

        for (const vault of vaults) {
            const stakingTokenAddress = resolveAddress(vault.underlyingTokenSymbol, chain, vault.stakingTokenType)
            const vaultProxyAddress = resolveAddress(vault.underlyingTokenSymbol, chain, "vault")
            const contractName = vault.platformToken ? "BoostedDualVault" : "BoostedSavingsVault"

            const priceCoeff = vault.priceCoeff ? vault.priceCoeff : simpleToExactAmount(1)
            let vaultImpl: Contract
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let constructorArguments: any[]
            if (vault.underlyingTokenSymbol === "mUSD") {
                const vaultFactory = await hre.ethers.getContractFactory(
                    `contracts/legacy/v-${vault.underlyingTokenSymbol}.sol:${contractName}`,
                )
                vaultImpl = await deployContract(vaultFactory.connect(signer), `${vault.underlyingTokenSymbol} vault`)
            } else if (vault.platformToken) {
                const platformTokenAddress = resolveAddress(vault.platformToken, chain)
                constructorArguments = [
                    nexusAddress,
                    stakingTokenAddress,
                    boostDirectorAddress,
                    priceCoeff,
                    boostCoeff,
                    rewardTokenAddress,
                    platformTokenAddress,
                ]
                const vaultFactory = await hre.ethers.getContractFactory(
                    `contracts/legacy/v-${vault.underlyingTokenSymbol}.sol:${contractName}`,
                )
                vaultImpl = await deployContract(vaultFactory.connect(signer), `${vault.underlyingTokenSymbol} vault`, constructorArguments)
            } else {
                constructorArguments = [nexusAddress, stakingTokenAddress, boostDirectorAddress, priceCoeff, boostCoeff, rewardTokenAddress]
                const vaultFactory = await hre.ethers.getContractFactory(`contracts/legacy/v-mBTC.sol:${contractName}`)
                vaultImpl = await deployContract(vaultFactory.connect(signer), `${vault.underlyingTokenSymbol} vault`, constructorArguments)
            }

            if (hre.network.name === "hardhat") {
                const proxyAdmin = DelayedProxyAdmin__factory.connect(delayedProxyAdminAddress, governor)
                // the contracts have already been initialized so don't need to call it again
                const tx = await proxyAdmin.proposeUpgrade(vaultProxyAddress, vaultImpl.address, "0x")
                await logTxDetails(tx, `${vault.underlyingTokenSymbol} proposeUpgrade`)
                // increaseTime fails with "You probably tried to import the "hardhat" module from your config or a file imported from it."
                // await increaseTime(ONE_WEEK)

                // TODO use increaseTime instead of the following
                await hre.ethers.provider.send("evm_increaseTime", [ONE_DAY.mul(8).toNumber()])
                await hre.ethers.provider.send("evm_mine", [])

                const tx2 = await proxyAdmin.acceptUpgradeRequest(vaultProxyAddress)
                await logTxDetails(tx2, `${vault.underlyingTokenSymbol} acceptUpgradeRequest`)
            } else {
                await verifyEtherscan(hre, {
                    address: vaultImpl.address,
                    constructorArguments,
                })
                console.log(`Delayed Proxy Admin contract ${delayedProxyAdminAddress}`)
                console.log(`${vault.underlyingTokenSymbol} proposeUpgrade tx args: proxy ${vaultProxyAddress}, impl ${vaultImpl.address}`)
            }
        }

        await vaultVerification(hre, signer, chain)
    })

task("LegacyVault.check", "Checks the vaults post upgrade")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        await vaultVerification(hre, signer, chain)
    })

export {}
