/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"
import { task } from "hardhat/config"
import {
    AssetProxy,
    AssetProxy__factory,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    InvariantValidator,
    InvariantValidator__factory,
    Manager,
    Manager__factory,
    Masset,
    Masset__factory,
    MockERC20,
    MockERC20__factory,
    MockInitializableToken,
    MockInitializableToken__factory,
    Nexus,
    Nexus__factory,
    SaveWrapper,
    SaveWrapper__factory,
    SavingsContract,
    SavingsContract__factory,
} from "types/generated"
import { Contract, ContractFactory } from "@ethersproject/contracts"
import { Bassets, DeployedBasset } from "@utils/btcConstants"
import { DEAD_ADDRESS, KEY_PROXY_ADMIN, KEY_SAVINGS_MANAGER, ZERO_ADDRESS } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"
import { MassetLibraryAddresses } from "types/generated/factories/Masset__factory"
import { SavingsManager } from "types/generated/SavingsManager"
import { SavingsManager__factory } from "types/generated/factories/SavingsManager__factory"
import { formatUnits } from "@ethersproject/units"

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
    console.log(`Deployed ${contractName} to ${contract.address}, gas used ${contractReceipt.gasUsed}, eth ${formatUnits(ethUsed)}`)
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

const deployMasset = async (
    deployer: SignerWithAddress,
    linkedAddress: MassetLibraryAddresses,
    nexus: Nexus,
    invariantValidator: InvariantValidator,
    delayedProxyAdmin: DelayedProxyAdmin,
    mAssetSymbol: string,
    mAssetName: string,
    bAssets: DeployedBasset[],
): Promise<Masset> => {
    const mAssetImpl = await deployContract<Masset>(new Masset__factory(linkedAddress, deployer), "Masset", [nexus.address])
    const config = {
        a: 120,
        limits: {
            min: simpleToExactAmount(5, 16),
            max: simpleToExactAmount(75, 16),
        },
    }
    const mUsdInitializeData = mAssetImpl.interface.encodeFunctionData("initialize", [
        mAssetName,
        mAssetSymbol,
        invariantValidator.address,
        bAssets.map((b) => ({
            addr: b.contract.address,
            integrator: b.integrator,
            hasTxFee: b.txFee,
            status: 0,
        })),
        config,
    ])
    const mAssetProxy = await new AssetProxy__factory(deployer).deploy(mAssetImpl.address, delayedProxyAdmin.address, mUsdInitializeData)

    return new Masset__factory(linkedAddress, deployer).attach(mAssetProxy.address)
}

task("deploy-polly", "Deploys mUSD, mBTC and Feeder pools to a Polygon network").setAction(async (_, hre) => {
    const { ethers, network } = hre
    // if (network.name !== "mamumbai-testnet") throw Error("Must be Polygon testnet mumbai-testnet")

    const [deployer, governor] = await ethers.getSigners()

    const nexus = await deployContract<Nexus>(new Nexus__factory(deployer), "Nexus", [governor.address])
    const delayedProxyAdmin = await deployContract<DelayedProxyAdmin>(new DelayedProxyAdmin__factory(deployer), "DelayedProxyAdmin", [
        nexus.address,
    ])

    // Deploy mAsset dependencies
    const invariantValidator = await deployContract<InvariantValidator>(new InvariantValidator__factory(deployer), "InvariantValidator")
    const managerLib = await deployContract<Manager>(new Manager__factory(deployer), "Manager")
    const linkedAddress = {
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: managerLib.address,
    }

    const deployedUsdBassets = await deployBassets(deployer, mUsdBassets)

    // Deploy mUSD Masset
    const mUsd = await deployMasset(
        deployer,
        linkedAddress,
        nexus,
        invariantValidator,
        delayedProxyAdmin,
        "POS-mUSD",
        "(PoS) mStable USD",
        deployedUsdBassets,
    )

    // Deploy Interest Bearing mUSD
    const imUsd = await deployContract<SavingsContract>(new SavingsContract__factory(deployer), "SavingsContract", [
        nexus.address,
        mUsd.address,
    ])

    // Deploy Save Wrapper
    const saveWrapper = await deployContract<SaveWrapper>(new SaveWrapper__factory(deployer), "SaveWrapper")

    // Deploy Savings Manager
    const savingsManager = await deployContract<SavingsManager>(new SavingsManager__factory(deployer), "SavingsManager", [
        nexus.address,
        mUsd.address,
        imUsd.address,
    ])

    // SaveWrapper contract approves the savings contract (imUSD) to spend its USD mAsset tokens (mUSD)
    await saveWrapper["approve(address,address)"](mUsd.address, imUsd.address)
    // SaveWrapper approves the bAsset contracts to spend its USD mAsset tokens (mUSD)
    const bAssetAddresses = deployedUsdBassets.map((b) => b.contract.address)
    await saveWrapper["approve(address[],address)"](bAssetAddresses, mUsd.address)

    // Initialize Nexus Modules
    const moduleKeys = [KEY_SAVINGS_MANAGER, KEY_PROXY_ADMIN]
    const moduleAddresses = [savingsManager.address, delayedProxyAdmin.address]
    const moduleIsLocked = [false, true]
    // if (network.name === "mamumbai-testnet") {
    //     const safe = new Contract("0xE1304aA964C5119C98E8AE554F031Bf3B21eC836", GnosisSafe, deployer)
    //     await safe.
    // } else {
    await nexus.connect(governor).initialize(moduleKeys, moduleAddresses, moduleIsLocked, governor.address)
    // }
})

module.exports = {}
