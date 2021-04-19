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
} from "types/generated"
import { Contract, ContractFactory } from "@ethersproject/contracts"
import { Bassets, DeployedBasset } from "@utils/btcConstants"
import { DEAD_ADDRESS, ZERO_ADDRESS } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"

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
    console.log(`Deployed ${contractName} to ${contract.address}. gas used ${contractReceipt.gasUsed}`)
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

const deployMasset = async (
    deployer: SignerWithAddress,
    linkedAddress,
    nexus: Nexus,
    invariantValidator: InvariantValidator,
): Promise<Masset> => {
    // Deploy mUSD bAssets
    const bAssets: DeployedBasset[] = []
    // eslint-disable-next-line
    for (const basset of mUsdBassets) {
        // eslint-disable-next-line
        const contract = await deployBasset(deployer, basset.name, basset.symbol, basset.decimals, basset.initialMint)
        bAssets.push({
            contract,
            integrator: basset.integrator,
            txFee: basset.txFee,
            symbol: basset.symbol,
        })
    }
    const mUsdMasset = await deployContract<Masset>(new Masset__factory(linkedAddress, deployer), "Masset", [nexus.address])
    const config = {
        a: 120,
        limits: {
            min: simpleToExactAmount(5, 16),
            max: simpleToExactAmount(75, 16),
        },
    }
    const mUsdInitializeData = mUsdMasset.interface.encodeFunctionData("initialize", [
        "(PoS) mStable USD",
        "PoS-mUSD",
        invariantValidator.address,
        bAssets.map((b) => ({
            addr: b.contract.address,
            integrator: b.integrator,
            hasTxFee: b.txFee,
            status: 0,
        })),
        config,
    ])
    const mUsdProxy = await new AssetProxy__factory(deployer).deploy(mUsdMasset.address, delayedProxyAdmin.address, mUsdInitializeData)

    return new Masset__factory(linkedAddress, deployer).attach(mUsdProxy.address)
}

task("deploy-polly", "Deploys mUSD, mBTC and Feeder pools to a Polygon network").setAction(async (_, hre) => {
    const { ethers, network } = hre
    // if (network.name !== "mamumbai-testnet") throw Error("Must be Polygon testnet mumbai-testnet")

    const [deployer, governor] = await ethers.getSigners()

    const nexus = await deployContract<Nexus>(new Nexus__factory(deployer), "Nexus", [governor.address])
    const delayedProxyAdmin = await deployContract<DelayedProxyAdmin>(new DelayedProxyAdmin__factory(deployer), "DelayedProxyAdmin", [
        nexus.address,
    ])

    const invariantValidator = await deployContract<InvariantValidator>(new InvariantValidator__factory(deployer), "InvariantValidator")
    const managerLib = await deployContract<Manager>(new Manager__factory(deployer), "Manager")
    const linkedAddress = {
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: managerLib.address,
    }

    // TODO move into a deployMasset function
    // Deploy mUSD bAssets
    const bAssets: DeployedBasset[] = []
    // eslint-disable-next-line
    for (const basset of mUsdBassets) {
        // eslint-disable-next-line
        const contract = await deployBasset(deployer, basset.name, basset.symbol, basset.decimals, basset.initialMint)
        bAssets.push({
            contract,
            integrator: basset.integrator,
            txFee: basset.txFee,
            symbol: basset.symbol,
        })
    }
    const mUsdMasset = await deployContract<Masset>(new Masset__factory(linkedAddress, deployer), "Masset", [nexus.address])
    const config = {
        a: 120,
        limits: {
            min: simpleToExactAmount(5, 16),
            max: simpleToExactAmount(75, 16),
        },
    }
    const mUsdInitializeData = mUsdMasset.interface.encodeFunctionData("initialize", [
        "(PoS) mStable USD",
        "PoS-mUSD",
        invariantValidator.address,
        bAssets.map((b) => ({
            addr: b.contract.address,
            integrator: b.integrator,
            hasTxFee: b.txFee,
            status: 0,
        })),
        config,
    ])
    const mUsdProxy = await new AssetProxy__factory(deployer).deploy(mUsdMasset.address, delayedProxyAdmin.address, mUsdInitializeData)

    const mUsd = new Masset__factory(linkedAddress, deployer).attach(mUsdProxy.address)
})

module.exports = {}
