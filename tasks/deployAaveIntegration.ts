import "ts-node/register"
import "tsconfig-paths/register"

import { task } from "hardhat/config"
import {
    AaveV2Integration__factory,
    FeederPool__factory,
    MusdEth__factory,
    PAaveIntegration,
    PAaveIntegration__factory,
} from "types/generated"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { getDefenderSigner } from "./utils/defender-utils"

// mStable contracts
const nexusAddress = "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3"

// Aave contracts
const lendingPoolAddressProviderAddress = "0xb53c1a33016b2dc2ff3653530bff1848a515c8c5"
// Also called Incentives Controller
const aaveRewardControllerAddress = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5"
// Reward token
const stkAaveTokenAddress = "0x4da27a545c0c5b758a6ba100e3a049001de870f5"
interface CommonAddresses {
    nexus: string
    mAsset: string
    aave: string
    aaveToken: string
}

task("deployAaveIntegration", "Deploys an instance of AaveV2Integration contract").setAction(async (_, hre) => {
    const { ethers, network } = hre
    const [deployer] = await ethers.getSigners()

    if (network.name !== "mainnet") throw Error("Invalid network")

    const addresses: CommonAddresses = {
        mAsset: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
        nexus: "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3",
        aave: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
        aaveToken: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    }

    // Deploy
    const impl = await new AaveV2Integration__factory(deployer).deploy(
        addresses.nexus,
        addresses.mAsset,
        addresses.aave,
        addresses.aaveToken,
    )
    const reciept = await impl.deployTransaction.wait()
    console.log(`Deployed Integration to ${impl.address}. gas used ${reciept.gasUsed}`)

    // Complete setup
    //  - Set pToken addresses via governance
})

task("deployPAaveIntegration", "Deploys mUSD and mBTC instances of PAaveIntegration").setAction(async (_, hre) => {
    const { ethers, network } = hre
    const deployer = network.name === "mainnet" ? await getDefenderSigner() : (await ethers.getSigners())[0]

    // mAssets
    const mUsdAddress = "0xe2f2a5c287993345a840db3b0845fbc70f5935a5"
    const mBtcAddress = "0x945Facb997494CC2570096c74b5F66A3507330a1"

    // bAssets
    const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f"
    const usdtAddress = "0xdac17f958d2ee523a2206206994597c13d831ec7"
    const sUsdAddress = "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51"
    const wBtcAddress = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"
    // Aave aTokens
    const aDaiAddress = "0x028171bCA77440897B824Ca71D1c56caC55b68A3"
    const aUsdtAddress = "0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811"
    const asUsdAddress = "0x6C5024Cd4F8A59110119C56f8933403A539555EB"
    const aWBtcAddress = "0x9ff58f4fFB29fA2266Ab25e75e2A8b3503311656"

    // Deploy
    const mUsdPAaveIntegration = await deployContract<PAaveIntegration>(
        new PAaveIntegration__factory(deployer),
        "PAaveIntegration for mUSD",
        [nexusAddress, mUsdAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress],
    )
    let tx = await mUsdPAaveIntegration.initialize([daiAddress, usdtAddress, sUsdAddress], [aDaiAddress, aUsdtAddress, asUsdAddress])
    await logTxDetails(tx, "mUsdPAaveIntegration.initialize")

    const mBtcPAaveIntegration = await deployContract<PAaveIntegration>(
        new PAaveIntegration__factory(deployer),
        "PAaveIntegration for mBTC",
        [nexusAddress, mBtcAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress],
    )
    tx = await mBtcPAaveIntegration.initialize([wBtcAddress], [aWBtcAddress])
    await logTxDetails(tx, "mBtcPAaveIntegration.initialize")

    const approveRewardTokenData = mUsdPAaveIntegration.interface.encodeFunctionData("approveRewardToken")
    console.log(`\napproveRewardToken data: ${approveRewardTokenData}`)

    const mBtc = await MusdEth__factory.connect(mBtcAddress, deployer)
    const mUsd = await MusdEth__factory.connect(mUsdAddress, deployer)

    console.log(`\nGovernor tx data`)
    const mBtcMigrateWbtcData = mBtc.interface.encodeFunctionData("migrateBassets", [[wBtcAddress], mBtcPAaveIntegration.address])
    console.log(`mBTC migrateBassets WBTC data: ${mBtcMigrateWbtcData}`)

    const mUsdMigrateDaiData = mUsd.interface.encodeFunctionData("migrateBassets", [[daiAddress], mUsdPAaveIntegration.address])
    console.log(`mUSD migrateBassets DAI data: ${mUsdMigrateDaiData}`)

    const mUsdMigrateUsdtData = mUsd.interface.encodeFunctionData("migrateBassets", [[usdtAddress], mUsdPAaveIntegration.address])
    console.log(`mUSD migrateBassets USDT data: ${mUsdMigrateUsdtData}`)

    const mUsdMigrateSusdData = mUsd.interface.encodeFunctionData("migrateBassets", [[sUsdAddress], mUsdPAaveIntegration.address])
    console.log(`mUSD migrateBassets sUSD data: ${mUsdMigrateSusdData}`)
})

task("deployFPAaveIntegration", "Deploys mUSD feeder pool instances of PAaveIntegration").setAction(async (_, hre) => {
    const { ethers, network } = hre
    const deployer = network.name === "mainnet" ? await getDefenderSigner() : (await ethers.getSigners())[0]

    // fpAssets
    const bUsdFpAddress = "0xfE842e95f8911dcc21c943a1dAA4bd641a1381c6"
    const gUsdFpAddress = "0x945Facb997494CC2570096c74b5F66A3507330a1"

    // fAssets
    const bUsdAddress = "0x4Fabb145d64652a948d72533023f6E7A623C7C53"
    const gUsdAddress = "0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd"
    // Aave aTokens
    const abUsdAddress = "0xA361718326c15715591c299427c62086F69923D9"
    const agUsdAddress = "0xD37EE7e4f452C6638c96536e68090De8cBcdb583"

    // Deploy
    const bUsdPAaveIntegration = await deployContract<PAaveIntegration>(
        new PAaveIntegration__factory(deployer),
        "PAaveIntegration for BUSD Feeder Pool",
        [nexusAddress, bUsdFpAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress],
    )
    let tx = await bUsdPAaveIntegration.initialize([bUsdAddress], [abUsdAddress])
    await logTxDetails(tx, "bUsdPAaveIntegration.initialize")

    const gUsdPAaveIntegration = await deployContract<PAaveIntegration>(
        new PAaveIntegration__factory(deployer),
        "PAaveIntegration for GUSD Feeder Pool",
        [nexusAddress, gUsdFpAddress, lendingPoolAddressProviderAddress, stkAaveTokenAddress, aaveRewardControllerAddress],
    )
    tx = await gUsdPAaveIntegration.initialize([gUsdAddress], [agUsdAddress])
    await logTxDetails(tx, "gUsdPAaveIntegration.initialize")

    const approveRewardTokenData = bUsdPAaveIntegration.interface.encodeFunctionData("approveRewardToken")
    console.log(`\napproveRewardToken data: ${approveRewardTokenData}`)

    const bUsdFp = await FeederPool__factory.connect(bUsdFpAddress, deployer)
    const gUsdFp = await FeederPool__factory.connect(gUsdFpAddress, deployer)

    console.log(`\nGovernor tx data`)
    const bUsdMigrateWbtcData = bUsdFp.interface.encodeFunctionData("migrateBassets", [[bUsdAddress], bUsdPAaveIntegration.address])
    console.log(`Feeder Pool migrateBassets BUSD data: ${bUsdMigrateWbtcData}`)

    const gUsdMigrateDaiData = gUsdFp.interface.encodeFunctionData("migrateBassets", [[gUsdAddress], gUsdPAaveIntegration.address])
    console.log(`Feeder Pool migrateBassets GUSD data: ${gUsdMigrateDaiData}`)
})

module.exports = {}
