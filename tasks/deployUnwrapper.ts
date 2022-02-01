import "ts-node/register"
import "tsconfig-paths/register"
import { DEAD_ADDRESS } from "@utils/constants"
import { Contract, Signer } from "ethers"
import { task, types } from "hardhat/config"
import { Unwrapper__factory, DelayedProxyAdmin__factory } from "types/generated"
// Polygon imUSD Contract
import { SavingsContractImusdPolygon21 } from "types/generated/SavingsContractImusdPolygon21"
import { SavingsContractImusdPolygon21__factory } from "types/generated/factories/SavingsContractImusdPolygon21__factory"
// Polygon imUSD Vault
import { StakingRewardsWithPlatformTokenImusdPolygon2__factory } from "types/generated/factories/StakingRewardsWithPlatformTokenImusdPolygon2__factory"
import { StakingRewardsWithPlatformTokenImusdPolygon2 } from "types/generated/StakingRewardsWithPlatformTokenImusdPolygon2"
// Mainnet imBTC Contract
import { SavingsContractImbtcMainnet21__factory } from "types/generated/factories/SavingsContractImbtcMainnet21__factory"
import { SavingsContractImbtcMainnet21 } from "types/generated/SavingsContractImbtcMainnet21"
// Mainnet imBTC Vault
import { BoostedSavingsVaultImbtcMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImbtcMainnet2__factory"
import { BoostedSavingsVaultImbtcMainnet2 } from "types/generated/BoostedSavingsVaultImbtcMainnet2"
// Mainnet imUSD Contract
import { SavingsContractImusdMainnet21__factory } from "types/generated/factories/SavingsContractImusdMainnet21__factory"
import { SavingsContractImusdMainnet21 } from "types/generated/SavingsContractImusdMainnet21"
// Mainnet imUSD Vault
import { BoostedSavingsVaultImusdMainnet2__factory } from "types/generated/factories/BoostedSavingsVaultImusdMainnet2__factory"
import { BoostedSavingsVaultImusdMainnet2 } from "types/generated/BoostedSavingsVaultImusdMainnet2"

import { deployContract } from "./utils/deploy-utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress, getChainAddress } from "./utils/networkAddressFactory"
import { Chain } from "./utils/tokens"
import { verifyEtherscan } from "./utils/etherscan"

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const approveUnwrapperTokens = async (chain: Chain, unwrapper: Contract, governor: Signer) => {
    // Mainnet and Polygon
    const fraxFeederPool = resolveAddress("FRAX", chain, "feederPool")
    const musdAddress = resolveAddress("mUSD", chain)

    let routers = []
    let tokens = []

    if (chain === Chain.polygon) {
        routers = [fraxFeederPool]
        tokens = [musdAddress]
    } else {
        const alusdFeederPool = resolveAddress("alUSD", chain, "feederPool")
        const gusdFeederPool = resolveAddress("GUSD", chain, "feederPool")
        const busdFeederPool = resolveAddress("BUSD", chain, "feederPool")
        const raiFeederPool = resolveAddress("RAI", chain, "feederPool")
        const feiFeederPool = resolveAddress("FEI", chain, "feederPool")

        const hbtcFeederPool = resolveAddress("HBTC", chain, "feederPool")
        const tbtcv2FeederPool = resolveAddress("tBTCv2", chain, "feederPool")
        const mbtcAddress = resolveAddress("mBTC", chain)

        routers = [alusdFeederPool, gusdFeederPool, busdFeederPool, raiFeederPool, feiFeederPool, hbtcFeederPool, tbtcv2FeederPool]
        tokens = [musdAddress, musdAddress, musdAddress, musdAddress, musdAddress, mbtcAddress, mbtcAddress, mbtcAddress]
    }
    // approve tokens for router
    await unwrapper.connect(governor).approve(routers, tokens)
}

task("deploy-unwrapper", "Deploy Unwrapper multi-chain")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const nexus = resolveAddress("Nexus", chain)
        const constructorArguments = [nexus]
        // Deploy step 1 - Deploy Unwrapper
        const unwrapper = await deployContract(new Unwrapper__factory(signer), "Unwrapper", constructorArguments)

        await verifyEtherscan(hre, {
            address: unwrapper.address,
            contract: "contracts/savings/peripheral/Unwrapper.sol:Unwrapper",
            constructorArguments,
        })

        // Deploy step 2 - Approve tokens
        // approveUnwrapperTokens(chain, unwrapper, signer)
    })

task("upgrade-imusd-polygon", "Upgrade Polygon imUSD save contract imUSD")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        if (chain !== Chain.polygon) throw Error("Task can only run against polygon or a polygon fork")

        const musdAddress = resolveAddress("mUSD", chain)
        const imusdAddress = resolveAddress("mUSD", chain, "savings")
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const nexusAddress = getChainAddress("Nexus", chain)
        const unwrapperAddress = getChainAddress("Unwrapper", chain)
        const constructorArguments = [nexusAddress, musdAddress, unwrapperAddress]

        // Deploy step 1 - Save Vault
        const saveContractImpl = await deployContract<SavingsContractImusdPolygon21>(
            new SavingsContractImusdPolygon21__factory(signer),
            "mStable: mUSD Savings Contract (imUSD)",
            constructorArguments,
        )
        await verifyEtherscan(hre, {
            address: saveContractImpl.address,
            contract: "contracts/legacy-upgraded/imusd-polygon-21.sol:SavingsContract_imusd_polygon_21",
            constructorArguments,
        })

        // Deploy step 2 - Propose upgrade
        // Update the Save Contract proxy to point to the new implementation using the delayed proxy admin
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the  proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = []
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            imusdAddress,
            saveContractImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })

task("upgrade-vimusd-polygon", "Upgrade Polygon imUSD staking contract v-imUSD")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        if (chain !== Chain.polygon) throw Error("Task can only run against polygon or a polygon fork")

        // const musdAddress = resolveAddress("mUSD", chain )
        const imusdAddress = resolveAddress("mUSD", chain, "savings")
        const imusdVaultAddress = resolveAddress("mUSD", chain, "vault")
        const mtaAddress = resolveAddress("MTA", chain)
        const wmaticAddress = resolveAddress("WMATIC", chain)
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const nexusAddress = getChainAddress("Nexus", chain)

        const constructorArguments = [
            nexusAddress,
            imusdAddress, // Savings
            mtaAddress,
            wmaticAddress, // Wrapped Matic
        ]

        // Deploy step 1 - Save Vault
        const saveVaultImpl = await deployContract<StakingRewardsWithPlatformTokenImusdPolygon2>(
            new StakingRewardsWithPlatformTokenImusdPolygon2__factory(signer),
            "StakingRewardsWithPlatformToken (v-imUSD)",
            constructorArguments,
        )

        await verifyEtherscan(hre, {
            address: saveVaultImpl.address,
            contract: "contracts/legacy-upgraded/imusd-vault-polygon-2.sol:StakingRewardsWithPlatformToken_imusd_polygon_2",
            constructorArguments,
        })

        // Deploy step 2 - Propose upgrade
        // Update the SaveVault proxy to point to the new implementation using the delayed proxy admin
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the  proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = []
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            imusdVaultAddress,
            saveVaultImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })

task("upgrade-imusd-mainnet", "Upgrade Mainnet imUSD save contract imUSD")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        if (chain !== Chain.mainnet) throw Error("Task can only run against mainnet or a mainnet fork")

        const imusdAddress = resolveAddress("mUSD", chain, "savings")
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const unwrapperAddress = getChainAddress("Unwrapper", chain)
        const constructorArguments = []

        // Deploy step 1 -  Save Contract
        const saveContractImpl = await deployContract<SavingsContractImusdMainnet21>(
            new SavingsContractImusdMainnet21__factory(signer),
            "mStable: mUSD Savings Contract (imUSD)",
            constructorArguments,
        )
        // Validate the unwrapper is set as constant on the save contract
        if ((await saveContractImpl.unwrapper()) !== unwrapperAddress || unwrapperAddress === DEAD_ADDRESS)
            throw Error("Unwrapper address not set on save contract")
        await verifyEtherscan(hre, {
            address: saveContractImpl.address,
            contract: "contracts/legacy-upgraded/imusd-mainnet-21.sol:SavingsContract_imusd_mainnet_21",
            constructorArguments,
        })

        // Deploy step 2 - Propose upgrade
        // Update the Save Contract proxy to point to the new implementation using the delayed proxy admin
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the  proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = []
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            imusdAddress,
            saveContractImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })

task("upgrade-vimusd-mainnet", "Upgrade Mainnet imUSD vault contract v-imUSD")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        if (chain !== Chain.mainnet) throw Error("Task can only run against mainnet or a mainnet fork")

        const imusdVaultAddress = resolveAddress("mUSD", chain, "vault")
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const constructorArguments = []

        // Deploy step 1 - Save Vault
        const saveVaultImpl = await deployContract<BoostedSavingsVaultImusdMainnet2>(
            new BoostedSavingsVaultImusdMainnet2__factory(signer),
            "BoostedSavingsVault (v-imUSD)",
            constructorArguments,
        )
        await verifyEtherscan(hre, {
            address: saveVaultImpl.address,
            contract: "contracts/legacy-upgraded/imusd-vault-mainnet-2.sol:BoostedSavingsVault_imusd_mainnet_2",
            constructorArguments,
        })
        // Deploy step 2 - Propose upgrade
        // Update the SaveVault proxy to point to the new implementation using the delayed proxy admin
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the  proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = []
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            imusdVaultAddress,
            saveVaultImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })

task("upgrade-imbtc-mainnet", "Upgrade Mainnet imBTC save contract imBTC")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        if (chain !== Chain.mainnet) throw Error("Task can only run against mainnet or a mainnet fork")

        const mbtcAddress = resolveAddress("mBTC", chain)
        const imbtcAddress = resolveAddress("mBTC", chain, "savings")
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const nexusAddress = getChainAddress("Nexus", chain)
        const unwrapperAddress = getChainAddress("Unwrapper", chain)

        const constructorArguments = [nexusAddress, mbtcAddress, unwrapperAddress]

        // Deploy step 1 -  Save Contract
        const saveContractImpl = await deployContract<SavingsContractImbtcMainnet21>(
            new SavingsContractImbtcMainnet21__factory(signer),
            "mStable: mBTC Savings Contract (imBTC)",
            constructorArguments,
        )
        await verifyEtherscan(hre, {
            address: saveContractImpl.address,
            contract: "contracts/legacy-upgraded/imbtc-mainnet-21.sol:SavingsContract_imbtc_mainnet_21",
            constructorArguments,
        })

        // Deploy step 2 - Propose upgrade
        // Update the Save Contract proxy to point to the new implementation using the delayed proxy admin
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the  proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = []
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            imbtcAddress,
            saveContractImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })

task("upgrade-vimbtc-mainnet", "Upgrade Mainnet imBTC vault contract v-imBTC")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        if (chain !== Chain.mainnet) throw Error("Task can only run against mainnet or a mainnet fork")
        const imbtcAddress = resolveAddress("mBTC", chain, "savings")
        const imbtcVaultAddress = resolveAddress("mBTC", chain, "vault")
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const nexusAddress = getChainAddress("Nexus", chain)
        const mtaAddress = resolveAddress("MTA", chain)
        const boostDirectorAddress = resolveAddress("BoostDirector", chain)

        // Gets current value of the mBTC vault
        const oldSaveVault = BoostedSavingsVaultImbtcMainnet2__factory.connect(imbtcVaultAddress, signer)
        const priceCoeff = await oldSaveVault.priceCoeff()
        const boostCoeff = await oldSaveVault.boostCoeff()

        const constructorArguments = [nexusAddress, imbtcAddress, boostDirectorAddress, priceCoeff, boostCoeff, mtaAddress]

        // Deploy step 1 - Save Vault
        const saveVaultImpl = await deployContract<BoostedSavingsVaultImbtcMainnet2>(
            new BoostedSavingsVaultImbtcMainnet2__factory(signer),
            "BoostedSavingsVault (v-imBTC)",
            constructorArguments,
        )
        await verifyEtherscan(hre, {
            address: saveVaultImpl.address,
            contract: "contracts/legacy-upgraded/imbtc-vault-mainnet-2.sol:BoostedSavingsVault_imbtc_mainnet_2",
            constructorArguments,
        })

        // Deploy step 2 - Propose upgrade
        // Update the SaveVault proxy to point to the new implementation using the delayed proxy admin
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the  proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = []
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            imbtcVaultAddress,
            saveVaultImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })
module.exports = {}
