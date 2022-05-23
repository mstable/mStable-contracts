/* eslint-disable no-restricted-syntax */
import { subtask, task, types } from "hardhat/config"

import { IChildToken__factory, IRootChainManager__factory } from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { ethers } from "ethers"
import { logTxDetails } from "./utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

subtask("bridge-deposit", "Sends mainnet token to Polygon across Polygon's PoS Bridge")
    .addOptionalParam("token", "Symbol of mainnet token that is to be sent. eg MTA or mBTC", "MTA", types.string)
    .addOptionalParam("user", "Address of the account on Polygon that will receive the bridged tokens", undefined, types.string)
    .addParam("amount", "Amount of tokens to be sent without the token decimals.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const chainManagerAddress = resolveAddress("PolygonRootChainManager", chain)
        const chainManager = IRootChainManager__factory.connect(chainManagerAddress, signer)

        const tokenAddress = resolveAddress(taskArgs.token, chain)
        const userAddress = resolveAddress(taskArgs.user, chain)
        const amount = simpleToExactAmount(taskArgs.amount)

        const abiCoder = ethers.utils.defaultAbiCoder
        const amountData = abiCoder.encode(["uint256"], [amount])

        const tx = await chainManager.depositFor(userAddress, tokenAddress, amountData)
        await logTxDetails(tx, `deposit to Polygon PoS Bridge`)
    })
task("bridge-deposit").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("bridge-withdraw", "Sends Polygon tokens back to mainnet across Polygon's PoS Bridge")
    .addOptionalParam("token", "Symbol of mainnet token that is to be sent. eg MTA or mBTC", "MTA", types.string)
    .addParam("amount", "Amount of tokens to be sent without the token decimals.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const tokenAddress = resolveAddress(taskArgs.token, chain)
        const token = IChildToken__factory.connect(tokenAddress, signer)

        const amount = simpleToExactAmount(taskArgs.amount)

        const tx = await token.withdraw(amount)
        await logTxDetails(tx, `withdraw ${taskArgs.amount} ${taskArgs.token} to Mainnet over the PoS Bridge`)
    })
task("bridge-withdraw").setAction(async (_, __, runSuper) => {
    await runSuper()
})
