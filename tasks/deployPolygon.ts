/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"
import { task } from "hardhat/config"
import {
    AssetProxy,
    AssetProxy__factory,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    MassetManager,
    MassetManager__factory,
    Masset,
    Masset__factory,
    MockERC20,
    MockERC20__factory,
    MockInitializableToken,
    MockInitializableToken__factory,
    Nexus,
    Nexus__factory,
    PAaveIntegration,
    PAaveIntegration__factory,
    SaveWrapper,
    SaveWrapper__factory,
    SavingsContract,
    SavingsContract__factory,
    MassetLogic,
    MassetLogic__factory,
    PLiquidator,
    PLiquidator__factory,
} from "types/generated"
import { Contract, ContractFactory } from "@ethersproject/contracts"
import { Bassets, DeployedBasset } from "@utils/btcConstants"
import { DEAD_ADDRESS, KEY_PROXY_ADMIN, KEY_SAVINGS_MANAGER, ONE_DAY, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"
import { MassetLibraryAddresses } from "types/generated/factories/Masset__factory"
import { SavingsManager } from "types/generated/SavingsManager"
import { SavingsManager__factory } from "types/generated/factories/SavingsManager__factory"
import { formatUnits } from "@ethersproject/units"

// FIXME: this import does not work for some reason
// import { sleep } from "@utils/time"
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const sleepTime = 2000 // milliseconds

export const mUsdBassets: Bassets[] = [
    {
        name: "(PoS) USD Coin",
        symbol: "PoS-USDC",
        decimals: 6,
        integrator: ZERO_ADDRESS,
        txFee: false,
        initialMint: 10000,
    },
    {
        name: "(PoS) Dai Stablecoin",
        symbol: "PoS-DAI",
        decimals: 18,
        integrator: ZERO_ADDRESS,
        txFee: false,
        initialMint: 10000,
    },
    {
        name: "(PoS) Tether USD",
        symbol: "PoS-USDT",
        decimals: 6,
        integrator: ZERO_ADDRESS,
        txFee: false,
        initialMint: 10000,
    },
]

const deployContract = async <T extends Contract>(
    contractFactory: ContractFactory,
    contractName = "Contract",
    contractorArgs: Array<unknown> = [],
): Promise<T> => {
    console.log(`Deploying ${contractName}`)
    const contract = (await contractFactory.deploy(...contractorArgs)) as T
    const contractReceipt = await contract.deployTransaction.wait()
    const ethUsed = contractReceipt.gasUsed.mul(contract.deployTransaction.gasPrice)
    const abiEncodedConstructorArgs = contract.interface.encodeDeploy(contractorArgs)
    console.log(`Deployed ${contractName} to ${contract.address}, gas used ${contractReceipt.gasUsed}, eth ${formatUnits(ethUsed)}`)
    console.log(`ABI encoded args: ${abiEncodedConstructorArgs}`)
    return contract
}

const deployBasset = async (
    deployer: SignerWithAddress,
    name: string,
    symbol: string,
    decimals = 18,
    initialMint = 500000,
): Promise<MockERC20> => {
    // Deploy Implementation
    const impl = await deployContract<MockInitializableToken>(new MockInitializableToken__factory(deployer), `${symbol} impl`)
    // Initialization Implementation
    const data = impl.interface.encodeFunctionData("initialize", [name, symbol, decimals, await deployer.getAddress(), initialMint])
    // Deploy Proxy
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(deployer), `${symbol} proxy`, [impl.address, DEAD_ADDRESS, data])

    return new MockERC20__factory(deployer).attach(proxy.address)
}

const deployBassets = async (deployer: SignerWithAddress, bAssetsProps: Bassets[]): Promise<DeployedBasset[]> => {
    const bAssets: DeployedBasset[] = []
    // eslint-disable-next-line
    for (const basset of bAssetsProps) {
        // eslint-disable-next-line
        const contract = await deployBasset(deployer, basset.name, basset.symbol, basset.decimals, basset.initialMint)
        bAssets.push({
            contract,
            integrator: basset.integrator,
            txFee: basset.txFee,
            symbol: basset.symbol,
        })
    }
    return bAssets
}

const attachBassets = (deployer: SignerWithAddress, bAssetsProps: Bassets[], bAssetAddresses: string[]): DeployedBasset[] => {
    const bAssets: DeployedBasset[] = []
    bAssetsProps.forEach((basset, i) => {
        const contract = new MockERC20__factory(deployer).attach(bAssetAddresses[i])
        bAssets.push({
            contract,
            integrator: basset.integrator,
            txFee: basset.txFee,
            symbol: basset.symbol,
        })
    })
    return bAssets
}

const deployMasset = async (
    deployer: SignerWithAddress,
    linkedAddress: MassetLibraryAddresses,
    nexus: Nexus,
    delayedProxyAdmin: DelayedProxyAdmin,
    recolFee = 5e13,
): Promise<Masset> => {
    const mAssetFactory = new Masset__factory(linkedAddress, deployer)
    const impl = await deployContract<Masset>(mAssetFactory, "Masset Impl", [nexus.address, recolFee])
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(deployer), "Masset Proxy", [
        impl.address,
        delayedProxyAdmin.address,
        "0x", // Passing zero bytes as we'll initialize the proxy contract later
    ])
    return mAssetFactory.attach(proxy.address)
}

const deployInterestBearingMasset = async (
    deployer: SignerWithAddress,
    nexus: Nexus,
    mUsd: Masset,
    delayedProxyAdmin: DelayedProxyAdmin,
    poker: string,
    symbol: string,
    name: string,
): Promise<SavingsContract> => {
    const impl = await deployContract<SavingsContract>(new SavingsContract__factory(deployer), "SavingsContract Impl", [
        nexus.address,
        mUsd.address,
    ])
    const initializeData = impl.interface.encodeFunctionData("initialize", [poker, name, symbol])
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(deployer), "SavingsContract Proxy", [
        impl.address,
        delayedProxyAdmin.address,
        initializeData,
    ])

    return new SavingsContract__factory(deployer).attach(proxy.address)
}

const deployAaveIntegration = async (
    deployer: SignerWithAddress,
    nexus: Nexus,
    mAsset: Masset,
    networkName: string,
): Promise<PAaveIntegration> => {
    let platformAddress = DEAD_ADDRESS
    let rewardTokenAddress = DEAD_ADDRESS
    let rewardControllerAddress = DEAD_ADDRESS
    let quickSwapRouter = DEAD_ADDRESS

    if (networkName === "polygon_mainnet") {
        platformAddress = "0xd05e3E715d945B59290df0ae8eF85c1BdB684744" // Aave lendingPoolAddressProvider
        rewardTokenAddress = "0x8dF3aad3a84da6b69A4DA8aeC3eA40d9091B2Ac4" // wMatic
        rewardControllerAddress = "0x357D51124f59836DeD84c8a1730D72B749d8BC23" // Aave AaveIncentivesController
        quickSwapRouter = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff"
    }

    const aaveIntegration = await deployContract<PAaveIntegration>(new PAaveIntegration__factory(deployer), "PAaveIntegration", [
        nexus.address,
        mAsset.address,
        platformAddress,
        rewardTokenAddress,
        rewardControllerAddress,
    ])

    // Deploy Liquidator
    await deployContract<PLiquidator>(new PLiquidator__factory(deployer), "PLiquidator", [nexus.address, quickSwapRouter, mAsset.address])

    return aaveIntegration
}

const mint = async (sender: SignerWithAddress, bAssets: DeployedBasset[], mAsset: Masset, scaledMintQty: BN) => {
    // Approve spending
    const approvals: BN[] = []
    // eslint-disable-next-line
    for (const bAsset of bAssets) {
        // eslint-disable-next-line
        const dec = await bAsset.contract.decimals()
        const approval = dec === 18 ? scaledMintQty : scaledMintQty.div(simpleToExactAmount(1, BN.from(18).sub(dec)))
        approvals.push(approval)
        // eslint-disable-next-line
        const tx = await bAsset.contract.approve(mAsset.address, approval)
        // eslint-disable-next-line
        const receiptApprove = await tx.wait()
        console.log(
            `Approved mAsset to transfer ${formatUnits(scaledMintQty)} ${bAsset.symbol} from ${sender.address}. gas used ${
                receiptApprove.gasUsed
            }`,
        )
        console.log(
            // eslint-disable-next-line
            `Balance ${(await bAsset.contract.balanceOf(await sender.getAddress())).toString()}`,
        )
    }

    // Mint
    const tx = await mAsset.mintMulti(
        bAssets.map((b) => b.contract.address),
        approvals,
        1,
        await sender.getAddress(),
    )
    const receiptMint = await tx.wait()

    // Log minted amount
    const mAssetAmount = formatUnits(await mAsset.totalSupply())
    console.log(`Minted ${mAssetAmount} mAssets from ${formatUnits(scaledMintQty)} units for each bAsset. gas used ${receiptMint.gasUsed}`)
}

const save = async (sender: SignerWithAddress, mAsset: Masset, imAsset: SavingsContract, scaledSaveQty: BN) => {
    console.log(`About to save ${formatUnits(scaledSaveQty)} mAssets`)
    await mAsset.approve(imAsset.address, scaledSaveQty)
    await imAsset["depositSavings(uint256)"](scaledSaveQty)
    console.log(`Saved ${formatUnits(scaledSaveQty)} mAssets to interest bearing mAssets`)
}

task("deploy-polly", "Deploys mUSD, mBTC and Feeder pools to a Polygon network").setAction(async (_, hre) => {
    const { network } = hre
    const [deployer] = await hre.ethers.getSigners()

    // Deploy Nexus
    const nexus = await deployContract<Nexus>(new Nexus__factory(deployer), "Nexus", [deployer.address])

    // Deploy DelayedProxyAdmin
    const delayedProxyAdmin = await deployContract<DelayedProxyAdmin>(new DelayedProxyAdmin__factory(deployer), "DelayedProxyAdmin", [
        nexus.address,
    ])

    await sleep(sleepTime)

    let deployedUsdBassets: DeployedBasset[]
    let multiSigAddress: string
    if (network.name === "hardhat") {
        multiSigAddress = deployer.address
        // Deploy mocked base USD assets
        deployedUsdBassets = await deployBassets(deployer, mUsdBassets)
    } else if (network.name === "polygon_testnet") {
        multiSigAddress = "0xE1304aA964C5119C98E8AE554F031Bf3B21eC836"
        // Attach to already deployed mocked bAssets
        deployedUsdBassets = attachBassets(deployer, mUsdBassets, [
            "0x4fa81E591dC5dAf1CDA8f21e811BAEc584831673",
            "0xD84574BFE3294b472C74D7a7e3d3bB2E92894B48",
            "0x872093ee2BCb9951b1034a4AAC7f489215EDa7C2",
        ])
    } else if (network.name === "polygon_mainnet") {
        multiSigAddress = "0xEdE10699339ceC9b6799319C585066FfBCA938b8"
        // Attach to 3rd party bAssets
        deployedUsdBassets = attachBassets(deployer, mUsdBassets, [
            "0x1a13F4Ca1d028320A707D99520AbFefca3998b7F",
            "0x27F8D03b3a2196956ED754baDc28D73be8830A6e",
            "0x60D55F02A771d515e077c9C2403a1ef324885CeC",
        ])
    }

    await sleep(sleepTime)

    // Deploy mAsset dependencies
    const massetLogic = await deployContract<MassetLogic>(new MassetLogic__factory(deployer), "MassetLogic")
    const managerLib = await deployContract<MassetManager>(new MassetManager__factory(deployer), "MassetManager")
    const linkedAddress = {
        __$6a4be19f34d71a078def5cee18ccebcd10$__: massetLogic.address,
        __$3b19b776afde68cd758db0cae1b8e49f94$__: managerLib.address,
    }

    // Deploy mUSD Masset
    const mUsd = await deployMasset(deployer, linkedAddress, nexus, delayedProxyAdmin)

    const aaveIntegration = await deployAaveIntegration(deployer, nexus, mUsd, network.name)

    const config = {
        a: 120,
        limits: {
            min: simpleToExactAmount(5, 16),
            max: simpleToExactAmount(75, 16),
        },
    }
    await mUsd.initialize(
        "POS-mUSD",
        "(PoS) mStable USD",
        deployedUsdBassets.map((b) => ({
            addr: b.contract.address,
            integrator: network.name === "polygon_mainnet" ? aaveIntegration.address : ZERO_ADDRESS,
            hasTxFee: b.txFee,
            status: 0,
        })),
        config,
    )

    await sleep(sleepTime)

    // Deploy Interest Bearing mUSD
    const imUsd = await deployInterestBearingMasset(
        deployer,
        nexus,
        mUsd,
        delayedProxyAdmin,
        DEAD_ADDRESS,
        "POS-imUSD",
        "(PoS) interest bearing mStable USD",
    )

    await sleep(sleepTime)

    // Deploy Save Wrapper
    const saveWrapper = await deployContract<SaveWrapper>(new SaveWrapper__factory(deployer), "SaveWrapper")

    // Deploy Savings Manager
    const savingsManager = await deployContract<SavingsManager>(new SavingsManager__factory(deployer), "SavingsManager", [
        nexus.address,
        mUsd.address,
        imUsd.address,
        simpleToExactAmount(9, 17), // 90% = 9e17
        ONE_DAY,
    ])

    await sleep(sleepTime)

    // SaveWrapper contract approves the savings contract (imUSD) to spend its USD mAsset tokens (mUSD)
    await saveWrapper["approve(address,address)"](mUsd.address, imUsd.address)
    // SaveWrapper approves the bAsset contracts to spend its USD mAsset tokens (mUSD)
    const bAssetAddresses = deployedUsdBassets.map((b) => b.contract.address)
    await saveWrapper["approve(address[],address)"](bAssetAddresses, mUsd.address)
    console.log("Successful token approvals from the SaveWrapper")

    await sleep(sleepTime)

    // Initialize Nexus Modules
    const moduleKeys = [KEY_SAVINGS_MANAGER, KEY_PROXY_ADMIN]
    const moduleAddresses = [savingsManager.address, delayedProxyAdmin.address]
    const moduleIsLocked = [false, true]
    await nexus.connect(deployer).initialize(moduleKeys, moduleAddresses, moduleIsLocked, multiSigAddress)

    await sleep(sleepTime)

    if (hre.network.name !== "polygon_mainnet") {
        await mint(deployer, deployedUsdBassets, mUsd, simpleToExactAmount(20))
        await save(deployer, mUsd, imUsd, simpleToExactAmount(15))
    }
})

module.exports = {}
