import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"

import { SaveWrapper__factory } from "../types/generated"
import { getSigner } from "./utils/signerFactory"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress, resolveToken } from "./utils/networkAddressFactory"
import { verifyEtherscan } from "./utils/etherscan"

task("SaveWrapper.deploy", "Deploy a new SaveWrapper")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const nexusAddress = resolveAddress("Nexus", chain)

        const constructorArguments = [nexusAddress]
        const wrapper = await deployContract(new SaveWrapper__factory(signer), "SaveWrapper", constructorArguments)

        await verifyEtherscan(hre, {
            address: wrapper.address,
            contract: "contracts/savings/peripheral/SaveWrapper.sol:SaveWrapper",
            constructorArguments,
        })
    })

task("SaveWrapper.approveMasset", "Sets approvals for a new mAsset")
    .addParam("masset", "Token symbol of the mAsset. eg mUSD or mBTC", undefined, types.string, false)
    .addParam("bassets", "Comma separated symbols of the base assets. eg USDC,DAI,USDT,sUSD", undefined, types.string, false)
    .addParam("fassets", "Comma separated symbols of the Feeder Pool assets. eg GUSD,BUSD,alUSD,FEI,HBTC", undefined, types.string, false)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const wrapperAddress = resolveAddress("SaveWrapper", chain)
        const wrapper = SaveWrapper__factory.connect(wrapperAddress, signer)

        const mAssetToken = resolveToken(taskArgs.masset, chain)

        const bAssetSymbols = taskArgs.bassets.split(",")
        const bAssetAddresses = bAssetSymbols.map((symbol) => resolveAddress(symbol, chain))

        const fAssetSymbols = taskArgs.fassets.split(",")
        const fAssetAddresses = fAssetSymbols.map((symbol) => resolveAddress(symbol, chain, "address"))
        const feederPoolAddresses = fAssetSymbols.map((symbol) => resolveAddress(symbol, chain, "feederPool"))

        const tx = await wrapper["approve(address,address[],address[],address[],address,address)"](
            mAssetToken.address,
            bAssetAddresses,
            feederPoolAddresses,
            fAssetAddresses,
            mAssetToken.savings,
            mAssetToken.vault,
        )
        await logTxDetails(
            tx,
            `SaveWrapper approve mAsset ${taskArgs.masset}, bAssets ${taskArgs.bassets} and feeder pools ${taskArgs.fassets}`,
        )
    })

task("SaveWrapper.approveMulti", "Sets approvals for multiple tokens/a single spender")
    .addParam(
        "tokens",
        "Comma separated symbols of the tokens that is being approved. eg USDC,DAI,USDT,sUSD",
        undefined,
        types.string,
        false,
    )
    .addParam(
        "spender",
        "Token symbol of the mAsset or address type. eg mUSD, mBTC, feederPool, savings or vault",
        undefined,
        types.string,
        false,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const wrapperAddress = resolveAddress("SaveWrapper", chain)
        const wrapper = SaveWrapper__factory.connect(wrapperAddress, signer)

        const tokenSymbols = taskArgs.tokens.split(",")
        const tokenAddresses = tokenSymbols.map((symbol) => resolveAddress(symbol, chain))

        const spenderAddress = ["feederPool", "savings", "vault"].includes(taskArgs.spender)
            ? resolveAddress(taskArgs.token, chain, taskArgs.spender) // token is mUSD or mBTC
            : resolveAddress(taskArgs.spender, chain) // spender is mUSD or mBTC

        const tx = await wrapper["approve(address[],address)"](tokenAddresses, spenderAddress)
        await logTxDetails(tx, "Approve multiple tokens/single spender")
    })

task("SaveWrapper.approve", "Sets approvals for a single token/spender")
    .addParam("token", "Symbol of the token that is being approved. eg USDC, WBTC, FEI, HBTC, mUSD, imUSD", undefined, types.string, false)
    .addParam(
        "spender",
        "Token symbol of the mAsset or address type. eg mUSD, mBTC, feederPool, savings or vault",
        undefined,
        types.string,
        false,
    )
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        if (!taskArgs.spender) {
            throw Error(`spender must be a mAsset symbol, eg mUSD or mBTC, or an address type of a mAsset, eg feederPool, savings or vault`)
        }
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const wrapperAddress = resolveAddress("SaveWrapper", chain)
        const wrapper = SaveWrapper__factory.connect(wrapperAddress, signer)

        const tokenAddress = resolveAddress(taskArgs.token, chain)
        const spenderAddress = ["feederPool", "savings", "vault"].includes(taskArgs.spender)
            ? resolveAddress(taskArgs.token, chain, taskArgs.spender) // token is mUSD or mBTC
            : resolveAddress(taskArgs.spender, chain) // spender is mUSD or mBTC

        const tx = await wrapper["approve(address,address)"](tokenAddress, spenderAddress)
        await logTxDetails(tx, "Approve single token/spender")
    })

export {}
