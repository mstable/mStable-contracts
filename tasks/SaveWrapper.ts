import "ts-node/register"
import "tsconfig-paths/register"
import { task } from "hardhat/config"

import { params, deployTx, sendTx } from "./taskUtils"
import { SaveWrapper__factory } from "../types/generated"
import { getSigner } from "./utils/defender-utils"

task("SaveWrapper.deploy", "Deploy a new SaveWrapper").setAction(async (taskArgs, { ethers }) => {
    const [deployer] = await ethers.getSigners()
    await deployTx(deployer, SaveWrapper__factory, "SaveWrapper")
})

task("SaveWrapper.approveMasset", "Sets approvals for a new mAsset")
    .addParam("saveWrapper", "SaveWrapper address", undefined, params.address, false)
    .addParam("masset", "mAsset address", undefined, params.address, false)
    .addParam("bassets", "bAsset addresses", undefined, params.addressArray, false)
    .addParam("fPools", "Feeder Pool addresses", undefined, params.addressArray, false)
    .addParam("fAssets", "fAsset addresses (corresponding to fPools)", undefined, params.addressArray, false)
    .addParam("save", "Save contract address (i.e. imAsset)", undefined, params.address, false)
    .addParam("vault", "BoostedSavingsVault contract address", undefined, params.address, false)
    .setAction(
        async (
            {
                saveWrapper,
                masset,
                vault,
                bassets,
                fassets,
                fPools,
                save,
            }: { saveWrapper: string; masset: string; bassets: string[]; save: string; vault: string; fassets: string[]; fPools: string[] },
            { ethers, network },
        ) => {
            const deployer = await getSigner(ethers)
            await sendTx(
                SaveWrapper__factory.connect(saveWrapper, deployer),
                "approve(address,address[],address[],address[],address,address)",
                "Approve mAsset and other assets",
                masset,
                bassets,
                fPools,
                fassets,
                save,
                vault,
            )
        },
    )

task("SaveWrapper.approveMulti", "Sets approvals for multiple tokens/a single spender")
    .addParam("saveWrapper", "SaveWrapper address", undefined, params.address, false)
    .addParam("tokens", "Token addresses", undefined, params.address, false)
    .addParam("spender", "Spender address", undefined, params.address, false)
    .setAction(async ({ saveWrapper, tokens, spender }: { saveWrapper: string; tokens: string[]; spender: string }, hre) => {
        const deployer = await getSigner(hre.ethers)
        await sendTx(
            SaveWrapper__factory.connect(saveWrapper, deployer),
            "approve(address[],address)",
            "Approve muliple tokens/single spender",
            tokens,
            spender,
        )
    })

task("SaveWrapper.approve", "Sets approvals for a single token/spender")
    .addParam("saveWrapper", "SaveWrapper address", undefined, params.address, false)
    .addParam("token", "Token address", undefined, params.address, false)
    .addParam("spender", "Spender address", undefined, params.address, false)
    .setAction(async ({ saveWrapper, token, spender }: { saveWrapper: string; token: string; spender: string }, { ethers }) => {
        const [deployer] = await ethers.getSigners()
        await sendTx(
            SaveWrapper__factory.connect(saveWrapper, deployer),
            "approve(address,address)",
            "Approve single token/spender",
            token,
            spender,
        )
    })

export {}
