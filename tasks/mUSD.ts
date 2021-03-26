/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Contract, ContractFactory, Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"

import { Masset } from "types/generated"
import { BN, simpleToExactAmount, applyDecimals } from "@utils/math"
import { BassetStatus } from "@utils/mstable-objects"
import { MassetLibraryAddresses, Masset__factory } from "types/generated/factories/Masset__factory"
import { ONE_YEAR } from "@utils/constants"
import * as MassetV2 from "../test-fork/mUSD/MassetV2.json"
import CurveRegistryExchangeABI from "../contracts/peripheral/Curve/CurveRegistryExchange.json"

// Mainnet contract addresses
const mUsdAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5"
const validatorAddress = "0xCa480D596e6717C95a62a4DC1bD4fbD7b7E7d705"

const config = {
    a: 135,
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(65, 16),
    },
}

interface TxSummary {
    count: number
    total: BN
    fees: BN
}
interface Token {
    symbol: string
    address: string
    integrator: string
    decimals: number
    vaultBalance: BN
    ratio: BN
}

interface Balances {
    total: BN
    save: BN
    earn: BN
}

const sUSD: Token = {
    symbol: "sUSD",
    address: "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51",
    integrator: "0xb9b0cfa90436c3fcbf8d8eb6ed8d0c2e3da47ca9",
    decimals: 18,
    vaultBalance: BN.from("10725219000000000000000000"),
    ratio: BN.from("100000000"),
}
const USDC: Token = {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735",
    decimals: 6,
    vaultBalance: BN.from("10725219000000"),
    ratio: BN.from("100000000000000000000"),
}
const USDT: Token = {
    symbol: "USDT",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39",
    decimals: 6,
    vaultBalance: BN.from("10725219000000"),
    ratio: BN.from("100000000000000000000"),
}
const DAI: Token = {
    symbol: "DAI",
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735",
    decimals: 18,
    vaultBalance: BN.from("10725219000000000000000000"),
    ratio: BN.from("100000000"),
}

const mUSDBassets: Token[] = [sUSD, USDC, DAI, USDT]

const formatUsd = (amount, decimals = 18, pad = 14, displayDecimals = 2): string => {
    const string2decimals = parseFloat(formatUnits(amount, decimals)).toFixed(displayDecimals)
    // Add thousands separator
    return string2decimals.replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(pad)
}

// Test mUSD token storage variables
const snapTokenStorage = async (token: Masset) => {
    console.log("Symbol: ", (await token.symbol()).toString(), "mUSD")
    console.log("Name: ", (await token.name()).toString(), "mStable USD")
    console.log("Decimals: ", (await token.decimals()).toString(), 18)
    console.log("UserBal: ", (await token.balanceOf("0x5C80E54f903458edD0723e268377f5768C7869d7")).toString(), "6971708003000000000000")
    console.log("Supply: ", (await token.totalSupply()).toString(), simpleToExactAmount(43000000).toString())
}

// Test the existing Masset V2 storage variables
const snapConfig = async (token: Masset) => {
    console.log("SwapFee: ", (await token.swapFee()).toString(), simpleToExactAmount(6, 14).toString())
    console.log("RedemptionFee: ", (await token.redemptionFee()).toString(), simpleToExactAmount(3, 14).toString())
    console.log("CacheSize: ", (await token.cacheSize()).toString(), simpleToExactAmount(3, 16).toString())
    console.log("Surplus: ", (await token.surplus()).toString())
}

// Test the new Masset V3 storage variables
const snapMasset = async (mUsd: Masset, validator: string) => {
    console.log("ForgeValidator: ", (await mUsd.forgeValidator()).toString(), validator)
    console.log("MaxBassets: ", (await mUsd.maxBassets()).toString(), 10)

    // bAsset personal data
    const bAssets = await mUsd.getBassets()
    mUSDBassets.forEach(async (token, i) => {
        console.log(`Addr${i}`, bAssets.personal[i].addr.toString(), token.address)
        console.log(`Integ${i}`, bAssets.personal[i].integrator.toString(), token.integrator)
        console.log(`TxFee${i}`, bAssets.personal[i].hasTxFee.toString(), "false")
        console.log(`Status${i}`, bAssets.personal[i].status.toString(), BassetStatus.Normal)
        console.log(`Ratio${i}`, bAssets.data[i].ratio.toString(), simpleToExactAmount(1, 8 + (18 - token.decimals)).toString())
        console.log(`Vault${i}`, bAssets.data[i].vaultBalance.toString(), token.vaultBalance.toString())
        console.log(await mUsd.bAssetIndexes(token.address), i)
        const bAsset = await mUsd.getBasset(token.address)
        console.log("Sanity check: ", bAsset[0][0], token.address)
    })

    // Get basket state
    const basketState = await mUsd.basket()
    console.log("UndergoingRecol: ", basketState.undergoingRecol, "true")
    console.log("Failed: ", basketState.failed, "false")

    const invariantConfig = await mUsd.getConfig()
    console.log("A: ", invariantConfig.a.toString(), config.a * 100)
    console.log("Min: ", invariantConfig.limits.min.toString(), config.limits.min.toString())
    console.log("Max: ", invariantConfig.limits.max.toString(), config.limits.max.toString())
}

const getSwapRates = async (masset: Masset, inputStr = "1000") => {
    console.log("\nSwap rates")

    // Get Curve Exchange
    const curve = new Contract("0xD1602F68CC7C4c7B59D686243EA35a9C73B0c6a2", CurveRegistryExchangeABI, masset.signer)

    for (const inputToken of mUSDBassets) {
        for (const outputToken of mUSDBassets) {
            if (inputToken.symbol !== outputToken.symbol) {
                const inputAddress = inputToken.address
                const outputAddress = outputToken.address
                try {
                    const input = simpleToExactAmount(inputStr, inputToken.decimals)

                    // Get mUSD swap rate
                    const output = await masset.getSwapOutput(inputAddress, outputAddress, input)
                    const scaledInput = applyDecimals(input, inputToken.decimals)
                    const scaledOutput = applyDecimals(output, outputToken.decimals)
                    const percent = scaledOutput.sub(scaledInput).mul(10000).div(scaledInput)

                    // Get Curve's best swap rate
                    const [, curveOutput] = await curve.get_best_rate(inputAddress, outputAddress, input)
                    const scaledCurveOutput = applyDecimals(curveOutput, outputToken.decimals)
                    const curvePercent = scaledCurveOutput.sub(scaledInput).mul(10000).div(scaledInput)

                    const diffOutputs = output.sub(curveOutput).mul(10000).div(output)

                    console.log(
                        `${inputStr} ${inputToken.symbol.padEnd(5)} -> ${outputToken.symbol.padEnd(5)} ${formatUsd(
                            output,
                            outputToken.decimals,
                            8,
                        )} ${percent.toString().padStart(4)}bps\tCurve ${formatUsd(
                            curveOutput,
                            outputToken.decimals,
                            8,
                        )} ${curvePercent.toString().padStart(4)}bps diff ${diffOutputs.toString().padStart(3)}bps`,
                    )
                } catch (err) {
                    console.error(`${inputToken.symbol} -> ${outputToken.symbol} ${err.message}`)
                }
            }
        }
    }
}

const getBalances = async (masset: Masset): Promise<Balances> => {
    const mUsdBalance = await masset.totalSupply()
    const savingBalance = await masset.balanceOf("0x30647a72dc82d7fbb1123ea74716ab8a317eac19")
    const curveMusdBalance = await masset.balanceOf("0x8474ddbe98f5aa3179b3b3f5942d724afcdec9f6")
    const mStableDAOBalance = await masset.balanceOf("0x3dd46846eed8D147841AE162C8425c08BD8E1b41")
    const balancerETHmUSD5050Balance = await masset.balanceOf("0xe036cce08cf4e23d33bc6b18e53caf532afa8513")
    const otherBalances = mUsdBalance.sub(savingBalance).sub(curveMusdBalance).sub(mStableDAOBalance).sub(balancerETHmUSD5050Balance)

    console.log("\nmUSD Holders")
    console.log(`imUSD                      ${formatUsd(savingBalance)} ${savingBalance.mul(100).div(mUsdBalance)}%`)
    console.log(`Curve mUSD                 ${formatUsd(curveMusdBalance)} ${curveMusdBalance.mul(100).div(mUsdBalance)}%`)
    console.log(`mStable DAO                ${formatUsd(mStableDAOBalance)} ${mStableDAOBalance.mul(100).div(mUsdBalance)}%`)
    console.log(
        `Balancer ETH/mUSD 50/50 #2 ${formatUsd(balancerETHmUSD5050Balance)} ${balancerETHmUSD5050Balance.mul(100).div(mUsdBalance)}%`,
    )
    console.log(`Others                     ${formatUsd(otherBalances)} ${otherBalances.mul(100).div(mUsdBalance)}%`)

    const surplus = await masset.surplus()
    console.log(`Surplus                    ${formatUsd(surplus)}`)
    console.log(`Total                      ${formatUsd(mUsdBalance)}`)

    return {
        total: mUsdBalance,
        save: savingBalance,
        earn: curveMusdBalance,
    }
}

// Deploys Migrator, pulls Manager address and deploys mUSD implementation
const getMusd = async (deployer: Signer): Promise<Masset> => {
    const linkedAddress: MassetLibraryAddresses = {
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: "0x1E91F826fa8aA4fa4D3F595898AF3A64dd188848", // Masset Manager
    }
    const mUsdV3Factory = new Masset__factory(linkedAddress, deployer)
    return mUsdV3Factory.attach(mUsdAddress)
}

const getMints = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.Minted(null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

    console.log(`\nMints since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = mUSDBassets.find((b) => b.address === log.args.input)
        console.log(`${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)} ${formatUsd(log.args.mAssetQuantity)}`)
        total = total.add(log.args.mAssetQuantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUsd(total)}`)
    return {
        count,
        total,
        fees: BN.from(0),
    }
}

const getMultiMints = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.MintedMulti(null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

    console.log(`\nMulti Mints since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        // Ignore nMintMulti events from collectInterest and collectPlatformInterest
        if (!log.args.inputs.length) return
        const inputBassets = log.args.inputs.map((input) => mUSDBassets.find((b) => b.address === input))
        console.log(`${log.blockNumber} ${log.transactionHash} ${formatUsd(log.args.mAssetQuantity)}`)
        inputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(4)} ${formatUsd(log.args.inputQuantities[i], bAsset.decimals)}`)
        })
        total = total.add(log.args.mAssetQuantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUsd(total)}`)
    return {
        count,
        total,
        fees: BN.from(0),
    }
}

const getSwaps = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.Swapped(null, null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

    console.log(`\nSwaps since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Input Output     Quantity      Fee")
    // Scaled bAsset quantities
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = mUSDBassets.find((b) => b.address === log.args.input)
        const outputBasset = mUSDBassets.find((b) => b.address === log.args.output)
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)}  ${outputBasset.symbol.padEnd(4)} ${formatUsd(
                log.args.outputAmount,
                outputBasset.decimals,
            )} ${formatUsd(log.args.scaledFee, 18, 8)}`,
        )
        total = total.add(applyDecimals(log.args.outputAmount, outputBasset.decimals))
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUsd(total)}`)

    return {
        count,
        total,
        fees,
    }
}

const getRedemptions = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.Redeemed(null, null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

    console.log(`\nRedemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity      Fee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBasset = mUSDBassets.find((b) => b.address === log.args.output)
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${outputBasset.symbol.padEnd(4)} ${formatUsd(log.args.mAssetQuantity)} ${formatUsd(
                log.args.scaledFee,
                18,
                8,
            )}`,
        )
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUsd(total)}`)

    return {
        count,
        total,
        fees,
    }
}

const getMultiRedemptions = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.RedeemedMulti(null, null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

    console.log(`\nMulti Redemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity      Fee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBassets = log.args.outputs.map((output) => mUSDBassets.find((b) => b.address === output))
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${formatUsd(log.args.mAssetQuantity)} ${formatUsd(log.args.scaledFee, 18, 8)}`,
        )
        outputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(4)} ${formatUsd(log.args.outputQuantity[i], bAsset.decimals)}`)
        })
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUsd(total)}`)

    return {
        count,
        total,
        fees,
    }
}

const outputFees = (
    mints: TxSummary,
    multiMints: TxSummary,
    swaps: TxSummary,
    redeems: TxSummary,
    multiRedeems: TxSummary,
    balances: Balances,
    startTime: Date,
    currentTime: Date,
) => {
    const totalFees = redeems.fees.add(multiRedeems.fees).add(swaps.fees)
    if (totalFees.eq(0)) {
        console.log(`\nNo fees since ${startTime.toUTCString()}`)
        return
    }
    const totalTransactions = mints.total.add(multiMints.total).add(redeems.total).add(multiRedeems.total).add(swaps.total)
    const totalFeeTransactions = redeems.total.add(multiRedeems.total).add(swaps.total)
    console.log(`\nFees since ${startTime.toUTCString()}`)
    console.log("              #     mUSD Volume      Fees    %")
    console.log(
        `Mints         ${mints.count.toString().padEnd(2)} ${formatUsd(mints.total)} ${formatUsd(mints.fees, 18, 9)} ${mints.fees
            .mul(100)
            .div(totalFees)
            .toString()
            .padStart(3)}%`,
    )
    console.log(
        `Multi Mints   ${multiMints.count.toString().padEnd(2)} ${formatUsd(multiMints.total)} ${formatUsd(
            multiMints.fees,
            18,
            9,
        )} ${multiMints.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Redeems       ${redeems.count.toString().padEnd(2)} ${formatUsd(redeems.total)} ${formatUsd(
            redeems.fees,
            18,
            9,
        )} ${redeems.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Multi Redeems ${multiRedeems.count.toString().padEnd(2)} ${formatUsd(multiRedeems.total)} ${formatUsd(
            multiRedeems.fees,
            18,
            9,
        )} ${multiRedeems.fees.mul(100).div(totalFees).toString().padStart(3)}%`,
    )
    console.log(
        `Swaps         ${swaps.count.toString().padEnd(2)} ${formatUsd(swaps.total)} ${formatUsd(swaps.fees, 18, 9)} ${swaps.fees
            .mul(100)
            .div(totalFees)
            .toString()
            .padStart(3)}%`,
    )
    const periodSeconds = BN.from(currentTime.valueOf() - startTime.valueOf()).div(1000)
    const liquidityUtilization = totalFeeTransactions.mul(100).div(balances.total)
    const totalApy = totalFees.mul(100).mul(ONE_YEAR).div(balances.save).div(periodSeconds)
    console.log(`Total Txs        ${formatUsd(totalTransactions)}`)
    console.log(`Savings          ${formatUsd(balances.save)} ${formatUsd(totalFees, 18, 9)} APY ${totalApy}%`)
    console.log(`${liquidityUtilization}% liquidity utilization  (${formatUsd(totalFeeTransactions)} of ${formatUsd(balances.total)} mUSD)`)
}

task("mUSD-snapv2", "Snaps mUSD's V2 storage").setAction(async (_, hre) => {
    const { ethers } = hre
    console.log(`Current block number ${await ethers.provider.getBlockNumber()}`)
    const [signer] = await ethers.getSigners()

    const mUsdV2Factory = new ContractFactory(MassetV2.abi, MassetV2.bytecode, signer)
    const mUSD = mUsdV2Factory.attach(mUsdAddress) as Masset

    await snapTokenStorage(mUSD)
    await snapConfig(mUSD)
    await getBalances(mUSD)
})

task("mUSD-snapv3", "Snaps mUSD's V3 storage").setAction(async (_, hre) => {
    const { ethers } = hre
    console.log(`Current block number ${await ethers.provider.getBlockNumber()}`)
    const [signer] = await ethers.getSigners()

    const mUSD = await getMusd(signer)

    await snapTokenStorage(mUSD)
    await snapConfig(mUSD)
    await getBalances(mUSD)
    await snapMasset(mUSD, validatorAddress)
})

task("mUSD-snap", "Snaps mUSD")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12094461, types.int)
    .addOptionalParam("swapSize", "Swap size to compare rates with Curve", 1000, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre
        const [signer] = await ethers.getSigners()

        const mUSD = await getMusd(signer)

        const currentBlock = await hre.ethers.provider.getBlockNumber()
        const currentTime = new Date()
        const fromBlock = taskArgs.from
        console.log(`Latest block ${currentBlock}, ${currentTime.toUTCString()}`)
        const startBlock = await hre.ethers.provider.getBlock(fromBlock)
        const startTime = new Date(startBlock.timestamp * 1000)

        const balances = await getBalances(mUSD)

        await getSwapRates(mUSD, taskArgs.swapSize)

        const mintSummary = await getMints(mUSD, fromBlock, startTime)
        const mintMultiSummary = await getMultiMints(mUSD, fromBlock, startTime)
        const swapSummary = await getSwaps(mUSD, fromBlock, startTime)
        const redeemSummary = await getRedemptions(mUSD, fromBlock, startTime)
        const redeemMultiSummary = await getMultiRedemptions(mUSD, fromBlock, startTime)

        outputFees(mintSummary, mintMultiSummary, swapSummary, redeemSummary, redeemMultiSummary, balances, startTime, currentTime)
    })

module.exports = {}
