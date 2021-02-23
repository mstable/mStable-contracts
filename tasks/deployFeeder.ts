/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"

import { DEAD_ADDRESS, ZERO_ADDRESS } from "@utils/constants"
import { Signer } from "ethers"
import { task } from "hardhat/config"
import { formatEther } from "ethers/lib/utils"
import {
    FeederPool,
    FeederPool__factory,
    FeederValidator__factory,
    AssetProxy__factory,
    MockERC20,
    MockERC20__factory,
    MockInitializableToken__factory,
    BoostedSavingsVault__factory,
    ERC20,
} from "types/generated"
import { simpleToExactAmount, BN } from "@utils/math"

interface CommonAddresses {
    nexus: string
    proxyAdmin: string
    staking: string
    mta: string
    rewardsDistributor: string
}

interface DeployedFasset {
    integrator: string
    txFee: boolean
    contract: ERC20
    address: string
    symbol: string
}

interface FeederData {
    mAsset: DeployedFasset
    name: string
    symbol: string
    config: Config
}

interface Config {
    a: BN
    limits: {
        min: BN
        max: BN
    }
}

const deployFasset = async (sender: Signer, name: string, symbol: string, decimals = 18, initialMint = 500000): Promise<MockERC20> => {
    // Implementation
    const impl = await new MockInitializableToken__factory(sender).deploy()
    await impl.deployTransaction.wait()

    // Initialization Data
    const data = impl.interface.encodeFunctionData("initialize", [name, symbol, decimals, await sender.getAddress(), initialMint])
    // Proxy
    const proxy = await new AssetProxy__factory(sender).deploy(impl.address, DEAD_ADDRESS, data)
    const receipt = await proxy.deployTransaction.wait()

    console.log(`Deployed ${name} (${symbol}) to address ${proxy.address}. gas used ${receipt.gasUsed}`)

    return new MockERC20__factory(sender).attach(proxy.address)
}

const deployFeederPool = async (
    sender: Signer,
    addresses: CommonAddresses,
    ethers,
    feederData: FeederData,
    fAsset: DeployedFasset,
): Promise<FeederPool> => {
    // Invariant Validator
    console.log(`Deploying Feeder Validator`)
    const forgeVal = await new FeederValidator__factory(sender).deploy()
    const receiptForgeVal = await forgeVal.deployTransaction.wait()
    console.log(`Deployed Feeder Validator to ${forgeVal.address}. gas used ${receiptForgeVal.gasUsed}`)

    // External linked library
    const Manager = await ethers.getContractFactory("FeederManager")
    const managerLib = await Manager.deploy()
    const receiptManager = await managerLib.deployTransaction.wait()
    console.log(`Deployed FeederManager library to ${managerLib.address}. gas used ${receiptManager.gasUsed}`)

    const linkedAddress = {
        __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: managerLib.address,
        __$ba0f40aa073b093068e86d426c6136c22f$__: forgeVal.address,
    }
    // Implementation
    const feederPoolFactory = new FeederPool__factory(linkedAddress, sender)
    const size = feederPoolFactory.bytecode.length / 2 / 1000
    if (size > 24.576) {
        console.error(`FeederPool size is ${size} kb: ${size - 24.576} kb too big`)
    } else {
        console.log(`FeederPool = ${size} kb`)
    }
    console.log(`Deploying FeederPool impl with Nexus ${addresses.nexus} and mAsset ${feederData.mAsset.address}`)
    const impl = await feederPoolFactory.deploy(addresses.nexus, feederData.mAsset.address)
    const receiptImpl = await impl.deployTransaction.wait()
    console.log(`Deployed Masset to ${impl.address}. gas used ${receiptImpl.gasUsed}`)

    // Initialization Data
    const mpAssets = (await feederPoolFactory.attach(feederData.mAsset.address).getBassets())[0].map((p) => p[0])
    console.log(
        `Initializing Masset with: ${feederData.name}, ${feederData.symbol}, ${feederData.mAsset}, ${
            fAsset.contract.address
        }, ${feederData.config.a.toString()}, ${feederData.config.limits.min.toString()}, ${feederData.config.limits.max.toString()}`,
    )
    const data = impl.interface.encodeFunctionData("initialize", [
        feederData.name,
        feederData.symbol,
        {
            addr: feederData.mAsset.address,
            integrator: ZERO_ADDRESS,
            hasTxFee: false,
            status: 0,
        },
        {
            addr: fAsset.contract.address,
            integrator: ZERO_ADDRESS,
            hasTxFee: false,
            status: 0,
        },
        mpAssets,
        feederData.config,
    ])

    console.log(`Deploying FeederPool proxy with impl: ${impl.address} and admin ${addresses.proxyAdmin}`)
    const mBtcProxy = await new AssetProxy__factory(sender).deploy(impl.address, addresses.proxyAdmin, data)
    const receiptProxy = await mBtcProxy.deployTransaction.wait()

    console.log(`Deployed FeederPool proxy to address ${mBtcProxy.address}. gas used ${receiptProxy.gasUsed}`)

    // Create a Masset contract pointing to the deployed proxy contract
    return new FeederPool__factory(linkedAddress, sender).attach(mBtcProxy.address)
}

const mint = async (sender: Signer, bAssets: DeployedFasset[], feederPool: FeederPool) => {
    // Mint 3/5 of starting cap
    const scaledTestQty = simpleToExactAmount(100)

    // Approve spending
    // eslint-disable-next-line
    for (const bAsset of bAssets) {
        // eslint-disable-next-line
        const tx = await bAsset.contract.approve(feederPool.address, scaledTestQty)
        // eslint-disable-next-line
        const receiptApprove = await tx.wait()
        console.log(
            // eslint-disable-next-line
            `Approved FeederPool to transfer ${formatEther(scaledTestQty)} ${bAsset.symbol} from ${await sender.getAddress()}. gas used ${
                receiptApprove.gasUsed
            }`,
        )
    }

    // Mint
    const tx = await feederPool.mintMulti(
        bAssets.map((b) => b.contract.address),
        bAssets.map(() => scaledTestQty),
        1,
        await sender.getAddress(),
    )
    const receiptMint = await tx.wait()

    // Log minted amount
    const mAssetAmount = formatEther(await feederPool.totalSupply())
    console.log(`Minted ${mAssetAmount} fpToken from ${formatEther(scaledTestQty)} Units for each fAsset. gas used ${receiptMint.gasUsed}`)
}

const deployVault = async (sender: Signer, addresses: CommonAddresses, feederPool: FeederPool): Promise<void> => {
    const vImpl = await new BoostedSavingsVault__factory(sender).deploy(
        addresses.nexus,
        feederPool.address,
        addresses.staking,
        simpleToExactAmount(1, 18),
        addresses.mta,
    )
    const receiptVaultImpl = await vImpl.deployTransaction.wait()
    console.log(`Deployed Vault Impl to ${vImpl.address}. gas used ${receiptVaultImpl.gasUsed}`)

    // Data
    const vData = vImpl.interface.encodeFunctionData("initialize", [addresses.rewardsDistributor])
    // Proxy
    const vProxy = await new AssetProxy__factory(sender).deploy(vImpl.address, addresses.proxyAdmin, vData)
    const receiptVaultProxy = await vProxy.deployTransaction.wait()
    console.log(`Deployed Vault Proxy to ${vProxy.address}. gas used ${receiptVaultProxy.gasUsed}`)
}

task("fSize", "Gets the bytecode size of the FeederPool.sol contract").setAction(async (_, hre) => {
    const { ethers } = hre
    const [deployer] = await ethers.getSigners()
    const linkedAddress = {
        __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: DEAD_ADDRESS,
        __$ba0f40aa073b093068e86d426c6136c22f$__: DEAD_ADDRESS,
    }
    // Implementation
    const feederPoolFactory = new FeederPool__factory(linkedAddress, deployer)
    let size = feederPoolFactory.bytecode.length / 2 / 1000
    if (size > 24.576) {
        console.error(`FeederPool size is ${size} kb: ${size - 24.576} kb too big`)
    } else {
        console.log(`FeederPool = ${size} kb`)
    }

    const forgeVal = await new FeederValidator__factory(deployer)
    size = forgeVal.bytecode.length / 2 / 1000
    console.log(`FeederValidator = ${size} kb`)

    // External linked library
    const manager = await ethers.getContractFactory("FeederManager")
    size = manager.bytecode.length / 2 / 1000
    console.log(`FeederManager = ${size} kb`)
})

task("deployFeeder", "Deploys a feeder pool").setAction(async (_, hre) => {
    const { ethers, network } = hre
    const [deployer] = await ethers.getSigners()

    const addresses =
        network.name === "ropsten"
            ? {
                  mta: "0x273bc479E5C21CAA15aA8538DecBF310981d14C0",
                  staking: "0x77f9bf80e0947408f64faa07fd150920e6b52015",
                  nexus: "0xeD04Cd19f50F893792357eA53A549E23Baf3F6cB",
                  proxyAdmin: "0x2d369F83E9DC764a759a74e87a9Bc542a2BbfdF0",
                  rewardsDistributor: "0x99B62B75E3565bEAD786ddBE2642E9c40aA33465",
                  mAsset: "0x4A677A48A790f26eac4c97f495E537558Abf6A79", // mBTC
              }
            : {
                  mta: DEAD_ADDRESS,
                  staking: (await new MockERC20__factory(deployer).deploy("Stake", "ST8", 18, DEAD_ADDRESS, 1)).address,
                  nexus: DEAD_ADDRESS,
                  proxyAdmin: DEAD_ADDRESS,
                  rewardsDistributor: DEAD_ADDRESS,
                  // TODO - if wanting to do a successful deploy, will need to create a mock mAsset
                  mAsset: (await new MockERC20__factory(deployer).deploy("mAsset", "mXXX", 18, DEAD_ADDRESS, 1)).address,
              }

    const mAssetContract = await new MockERC20__factory(deployer).attach(addresses.mAsset)
    const deployedMasset: DeployedFasset = {
        integrator: ZERO_ADDRESS,
        txFee: false,
        contract: mAssetContract,
        address: addresses.mAsset,
        symbol: await mAssetContract.symbol(),
    }

    // 1. Deploy fAsset
    const fAsset: MockERC20 = await deployFasset(deployer, "Feeder pool Asset", "fAST", 18, 1000000)
    const deployedFasset: DeployedFasset = {
        integrator: ZERO_ADDRESS,
        txFee: false,
        contract: fAsset,
        address: fAsset.address,
        symbol: await fAsset.symbol(),
    }
    const feederData: FeederData = {
        mAsset: deployedMasset,
        name: `${deployedMasset.symbol}/${deployedFasset.symbol} FeederPool`,
        symbol: `fP ${deployedMasset.symbol}/${deployedFasset.symbol}`,
        config: {
            a: BN.from(100),
            limits: {
                min: simpleToExactAmount(3, 16),
                max: simpleToExactAmount(97, 16),
            },
        },
    }
    // 2. Deploy Feeder Pool
    const feederPool = await deployFeederPool(deployer, addresses, ethers, feederData, deployedFasset)

    // 3. Mint initial supply
    await mint(deployer, [deployedMasset, deployedFasset], feederPool)

    // 4. Rewards Contract
    await deployVault(deployer, addresses, feederPool)

    // TODO
    // - Fund vault
    // - deploy InterestValidator
    // - add InterestValidator as a module
})

module.exports = {}
