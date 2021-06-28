import "ts-node/register"
import "tsconfig-paths/register"
import { task } from "hardhat/config"

import { params, deployTx, sendTx } from "./taskUtils"
import { FeederWrapper__factory } from "../types/generated"
import { getSigner } from "./utils/defender-utils"

task("FeederWrapper.deploy", "Deploy a new FeederWrapper").setAction(async (taskArgs, hre) => {
    const deployer = await getSigner(hre.network.name, hre.ethers)
    await deployTx(deployer, FeederWrapper__factory, "FeederWrapper")
})

task("FeederWrapper.approveAll", "Sets approvals for a Feeder Pool")
    .addParam("feederWrapper", "FeederWrapper address", undefined, params.address, false)
    .addParam("feeder", "Feeder Pool address", undefined, params.address, false)
    .addParam("vault", "BoostedVault contract address", undefined, params.address, false)
    .addParam("assets", "Asset addresses", undefined, params.addressArray, false)
    .setAction(
        async (
            { feederWrapper, feeder, vault, assets }: { feederWrapper: string; feeder: string; assets: string[]; vault: string },
            { ethers, network },
        ) => {
            const deployer = await getSigner(network.name, ethers)
            await sendTx(
                FeederWrapper__factory.connect(feederWrapper, deployer),
                "approve(address,address,address[])",
                "Approve Feeder/Vault and other assets",
                feeder,
                vault,
                assets,
            )
        },
    )

task("FeederWrapper.approveMulti", "Sets approvals for multiple tokens/a single spender")
    .addParam("feederWrapper", "FeederWrapper address", undefined, params.address, false)
    .addParam("tokens", "Token addresses", undefined, params.address, false)
    .addParam("spender", "Spender address", undefined, params.address, false)
    .setAction(async ({ feederWrapper, tokens, spender }: { feederWrapper: string; tokens: string[]; spender: string }, hre) => {
        const deployer = await getSigner(hre.network.name, hre.ethers)
        await sendTx(
            FeederWrapper__factory.connect(feederWrapper, deployer),
            "approve(address[],address)",
            "Approve muliple tokens/single spender",
            tokens,
            spender,
        )
    })

task("FeederWrapper.approve", "Sets approvals for a single token/spender")
    .addParam("feederWrapper", "FeederWrapper address", undefined, params.address, false)
    .addParam("token", "Token address", undefined, params.address, false)
    .addParam("spender", "Spender address", undefined, params.address, false)
    .setAction(async ({ feederWrapper, token, spender }: { feederWrapper: string; token: string; spender: string }, { ethers }) => {
        const [deployer] = await ethers.getSigners()
        await sendTx(
            FeederWrapper__factory.connect(feederWrapper, deployer),
            "approve(address,address)",
            "Approve single token/spender",
            token,
            spender,
        )
    })

export {}
