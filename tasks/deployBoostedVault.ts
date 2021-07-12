import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { DEAD_ADDRESS } from "@utils/constants"

import { params } from "./taskUtils"
import { AssetProxy__factory, BoostedVault__factory, BoostedDualVault__factory } from "../types/generated"

task("getBytecode-BoostedDualVault").setAction(async () => {
    const size = BoostedDualVault__factory.bytecode.length / 2 / 1000
    if (size > 24.576) {
        console.error(`BoostedDualVault size is ${size} kb: ${size - 24.576} kb too big`)
    } else {
        console.log(`BoostedDualVault = ${size} kb`)
    }
})

task("BoostedVault.deploy", "Deploys a BoostedVault")
    .addParam("nexus", "Nexus address", undefined, params.address, false)
    .addParam("proxyAdmin", "ProxyAdmin address", undefined, params.address, false)
    .addParam("rewardsDistributor", "RewardsDistributor address", undefined, params.address, false)
    .addParam("stakingToken", "Staking token address", undefined, params.address, false)
    .addParam("rewardsToken", "Rewards token address", undefined, params.address, false)
    .addParam("vaultName", "Vault name", undefined, types.string, false)
    .addParam("vaultSymbol", "Vault symbol", undefined, types.string, false)
    .addParam("boostCoefficient", "Boost coefficient", undefined, types.string, false)
    .addParam("priceCoefficient", "Price coefficient", undefined, types.string, false)
    .setAction(
        async (
            {
                boostCoefficient,
                nexus,
                priceCoefficient,
                proxyAdmin,
                rewardsDistributor,
                rewardsToken,
                vaultName,
                vaultSymbol,
                stakingToken,
            }: {
                boostCoefficient: string
                nexus: string
                priceCoefficient: string
                proxyAdmin: string
                rewardsDistributor: string
                rewardsToken: string
                vaultName: string
                vaultSymbol: string
                stakingToken: string
            },
            { ethers },
        ) => {
            const [deployer] = await ethers.getSigners()

            const implementation = await new BoostedVault__factory(deployer).deploy(
                nexus,
                stakingToken,
                DEAD_ADDRESS,
                priceCoefficient,
                boostCoefficient,
                rewardsToken,
            )
            const receipt = await implementation.deployTransaction.wait()
            console.log(`Deployed Vault Implementation to ${implementation.address}. gas used ${receipt.gasUsed}`)

            const data = implementation.interface.encodeFunctionData("initialize", [rewardsDistributor, vaultName, vaultSymbol])

            const assetProxy = await new AssetProxy__factory(deployer).deploy(implementation.address, proxyAdmin, data)
            const assetProxyDeployReceipt = await assetProxy.deployTransaction.wait()

            await new BoostedVault__factory(deployer).attach(assetProxy.address)

            console.log(`Deployed Vault Proxy to ${assetProxy.address}. gas used ${assetProxyDeployReceipt.gasUsed}`)
        },
    )

export {}
