/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import { Bassets, btcBassets, capFactor, contracts, getBassetFromAddress, startingCap } from "@utils/btcConstants"
import { ONE_YEAR } from "@utils/constants"
import { applyDecimals, BN, simpleToExactAmount } from "@utils/math"
import { Contract, Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { task, types } from "hardhat/config"
import { Masset, Masset__factory } from "types/generated"
import CurveRegistryExchangeABI from "../contracts/peripheral/Curve/CurveRegistryExchange.json"
import { getBasket, snapConfig, dumpTokenStorage, dumpBassetStorage, dumpConfigStorage } from "./utils/snap-utils"

interface TxSummary {
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

const formatBtc = (amount, decimals = 18, pad = 7, displayDecimals = 3): string => {
    const string2decimals = parseFloat(formatUnits(amount, decimals)).toFixed(displayDecimals)
    // Add thousands separator
    return string2decimals.replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(pad)
}

/**
                    Swap Rates
*/

interface SwapRate {
    inputToken: Token
    inputAmountRaw: BN
    outputToken: Token
    mOutputRaw: BN
    curveOutputRaw: BN
    curveInverseOutputRaw: BN
}
const outputSwapRate = (swap: SwapRate) => {
    const { inputToken, outputToken, mOutputRaw, curveOutputRaw } = swap
    const inputScaled = applyDecimals(swap.inputAmountRaw, inputToken.decimals)

    // Process mUSD swap output
    const mOutputScaled = applyDecimals(mOutputRaw, outputToken.decimals)
    const mBasicPoints = mOutputScaled.sub(inputScaled).mul(10000).div(inputScaled)

    // Process Curve's swap output
    const curveOutputScaled = applyDecimals(curveOutputRaw, outputToken.decimals)
    const curvePercent = curveOutputScaled.sub(inputScaled).mul(10000).div(inputScaled)

    // Calculate the difference between the mUSD and Curve outputs in basis points
    const diffOutputs = mOutputRaw.sub(curveOutputRaw).mul(10000).div(mOutputRaw)

    // Calculate if there's an arbitrage = inverse curve output - input
    const curveInverseOutputScaled = applyDecimals(swap.curveInverseOutputRaw, swap.inputToken.decimals)
    const arbProfit = curveInverseOutputScaled.sub(inputScaled)

    console.log(
        `${formatBtc(swap.inputAmountRaw, inputToken.decimals, 3, 0)} ${inputToken.symbol.padEnd(6)} -> ${outputToken.symbol.padEnd(
            6,
        )} ${formatBtc(mOutputRaw, outputToken.decimals)} ${mBasicPoints.toString().padStart(4)}bps Curve ${formatBtc(
            curveOutputRaw,
            outputToken.decimals,
        )} ${curvePercent.toString().padStart(4)}bps ${diffOutputs.toString().padStart(4)}bps ${formatBtc(arbProfit, 18)}`,
    )
}
const outputSwapRates = (swaps: SwapRate[], toBlock: number) => {
    console.log(`\nSwap rates for block ${toBlock}`)
    console.log("Qty  Input    Output Qty Out    Rate        Output    Rate    Diff    Arb$")
    swaps.forEach((swap) => {
        outputSwapRate(swap)
    })
}
const getSwapRates = async (mAsset: Masset, toBlock: number, inputAmount = BN.from("1000")): Promise<SwapRate[]> => {
    // Get Curve Exchange
    const curve = new Contract("0xD1602F68CC7C4c7B59D686243EA35a9C73B0c6a2", CurveRegistryExchangeABI, mAsset.signer)

    const pairs = []
    const mStableSwapPromises = []
    // Get mUSD swap rates
    for (const inputToken of btcBassets) {
        for (const outputToken of btcBassets) {
            if (inputToken.symbol !== outputToken.symbol) {
                const inputAddress = contracts.mainnet[inputToken.symbol]
                const outputAddress = contracts.mainnet[outputToken.symbol]
                pairs.push({
                    inputToken: {
                        ...inputToken,
                        address: inputAddress,
                    },
                    outputToken: {
                        ...outputToken,
                        address: outputAddress,
                    },
                })
                const inputAmountRaw = simpleToExactAmount(inputAmount, inputToken.decimals)
                mStableSwapPromises.push(
                    mAsset.getSwapOutput(inputAddress, outputAddress, inputAmountRaw, {
                        blockTag: toBlock,
                    }),
                )
            }
        }
    }
    // Resolve all the mUSD promises
    const mStableSwaps = await Promise.all(mStableSwapPromises)

    // Get Curve's best swap rate for each pair and the inverse swap
    const curveSwapsPromises = []
    pairs.forEach(({ inputToken, outputToken }, i) => {
        // Get the matching Curve swap rate
        const curveSwapPromise = curve.get_best_rate(
            inputToken.address,
            outputToken.address,
            simpleToExactAmount(inputAmount, inputToken.decimals),
            {
                blockTag: toBlock,
            },
        )
        // Get the Curve inverse swap rate using mUSD swap output as the input
        const curveInverseSwapPromise = curve.get_best_rate(outputToken.address, inputToken.address, mStableSwaps[i], {
            blockTag: toBlock,
        })
        curveSwapsPromises.push(curveSwapPromise, curveInverseSwapPromise)
    })
    // Resolve all the Curve promises
    const curveSwaps = await Promise.all(curveSwapsPromises)

    // Merge the mUSD and Curve swaps into one array
    const swaps: SwapRate[] = pairs.map(({ inputToken, outputToken }, i) => ({
        inputToken,
        inputAmountRaw: simpleToExactAmount(inputAmount, inputToken.decimals),
        outputToken,
        mOutputRaw: mStableSwaps[i],
        // This first param of the Curve result is the pool address, the second is the output amount
        curveOutputRaw: curveSwaps[i * 2][1],
        curveInverseOutputRaw: curveSwaps[i * 2 + 1][1],
    }))
    outputSwapRates(swaps, toBlock)

    return swaps
}

const getBalances = async (mAsset: Masset, toBlock: number): Promise<Balances> => {
    const mAssetBalance = await mAsset.totalSupply({
        blockTag: toBlock,
    })
    const savingBalance = await mAsset.balanceOf(contracts.mainnet.imBTC, {
        blockTag: toBlock,
    })
    const sushiPoolBalance = await mAsset.balanceOf(contracts.mainnet.sushiPool, {
        blockTag: toBlock,
    })
    const mStableFundManagerBalance = await mAsset.balanceOf(contracts.mainnet.fundManager, {
        blockTag: toBlock,
    })
    const otherBalances = mAssetBalance.sub(savingBalance).sub(sushiPoolBalance).sub(mStableFundManagerBalance)

    console.log("\nmBTC Holders")
    console.log(`imBTC                ${formatUnits(savingBalance).padEnd(20)} ${savingBalance.mul(100).div(mAssetBalance)}%`)
    console.log(`Sushi Pool           ${formatUnits(sushiPoolBalance).padEnd(20)} ${sushiPoolBalance.mul(100).div(mAssetBalance)}%`)
    console.log(
        `mStable Fund Manager ${formatUnits(mStableFundManagerBalance).padEnd(20)} ${mStableFundManagerBalance
            .mul(100)
            .div(mAssetBalance)}%`,
    )
    console.log(`Others               ${formatUnits(otherBalances).padEnd(20)} ${otherBalances.mul(100).div(mAssetBalance)}%`)

    return {
        total: mAssetBalance,
        save: savingBalance,
        earn: sushiPoolBalance,
    }
}

const getMints = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.Minted(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nMints since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset Masset Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = getBassetFromAddress(log.args.input)
        console.log(`${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(6)} ${formatUnits(log.args.mAssetQuantity)}`)
        total = total.add(log.args.mAssetQuantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)
    return {
        total,
        fees: BN.from(0),
    }
}

const getMultiMints = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.MintedMulti(null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nMulti Mints since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Masset Quantity")
    let total = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        // Ignore nMintMulti events from collectInterest and collectPlatformInterest
        if (!log.args.inputs.length) return
        const inputBassets: Bassets[] = log.args.inputs.map((input) => getBassetFromAddress(input))
        console.log(`${log.blockNumber} ${log.transactionHash} ${formatUnits(log.args.mAssetQuantity)}`)
        inputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(6)} ${formatUnits(log.args.inputQuantities[i], bAsset.decimals).padEnd(21)}`)
        })
        total = total.add(log.args.mAssetQuantity)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)
    return {
        total,
        fees: BN.from(0),
    }
}

const getRedemptions = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.Redeemed(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nRedemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset Masset Quantity\tFee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBasset = getBassetFromAddress(log.args.output)
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${outputBasset.symbol.padEnd(6)} ${formatUnits(
                log.args.mAssetQuantity,
            )} ${formatUnits(log.args.scaledFee)}`,
        )
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)

    return {
        total,
        fees,
    }
}

const getMultiRedemptions = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.RedeemedMulti(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nMulti Redemptions since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Masset Quantity\t Fee")
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const outputBassets: Bassets[] = log.args.outputs.map((output) => getBassetFromAddress(output))
        console.log(`${log.blockNumber} ${log.transactionHash} ${formatUnits(log.args.mAssetQuantity)} ${formatUnits(log.args.scaledFee)}`)
        outputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(6)} ${formatUnits(log.args.outputQuantity[i], bAsset.decimals).padEnd(21)}`)
        })
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)

    return {
        total,
        fees,
    }
}

const getSwaps = async (mAsset: Masset, fromBlock: number, startTime: Date, toBlock: number): Promise<TxSummary> => {
    const filter = await mAsset.filters.Swapped(null, null, null, null, null, null)
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock)

    console.log(`\nSwaps since block ${fromBlock} at ${startTime.toUTCString()}`)
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Input  Output Output Quantity\tFee")
    // Scaled bAsset quantities
    let total = BN.from(0)
    let fees = BN.from(0)
    let count = 0
    logs.forEach((log) => {
        const inputBasset = getBassetFromAddress(log.args.input)
        const outputBasset = getBassetFromAddress(log.args.output)
        console.log(
            `${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(6)} ${outputBasset.symbol.padEnd(6)} ${formatUnits(
                log.args.outputAmount,
                outputBasset.decimals,
            ).padEnd(21)} ${formatUnits(log.args.scaledFee)}`,
        )
        total = total.add(applyDecimals(log.args.outputAmount, outputBasset.decimals))
        fees = fees.add(log.args.scaledFee)
        count += 1
    })
    console.log(`Count ${count}, Total ${formatUnits(total)}`)

    return {
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
    console.log("              mBTC Volume\t     Fees\t\t  Fee %")
    console.log(
        `Mints         ${formatUnits(mints.total).padEnd(22)} ${formatUnits(mints.fees).padEnd(20)} ${mints.fees.mul(100).div(totalFees)}%`,
    )
    console.log(
        `Multi Mints   ${formatUnits(multiMints.total).padEnd(22)} ${formatUnits(multiMints.fees).padEnd(20)} ${multiMints.fees
            .mul(100)
            .div(totalFees)}%`,
    )
    console.log(
        `Redeems       ${formatUnits(redeems.total).padEnd(22)} ${formatUnits(redeems.fees).padEnd(20)} ${redeems.fees
            .mul(100)
            .div(totalFees)}%`,
    )
    console.log(
        `Multi Redeems ${formatUnits(multiRedeems.total).padEnd(22)} ${formatUnits(multiRedeems.fees).padEnd(20)} ${multiRedeems.fees
            .mul(100)
            .div(totalFees)}%`,
    )
    console.log(
        `Swaps         ${formatUnits(swaps.total).padEnd(22)} ${formatUnits(swaps.fees).padEnd(20)} ${swaps.fees.mul(100).div(totalFees)}%`,
    )
    const periodSeconds = BN.from(currentTime.valueOf() - startTime.valueOf()).div(1000)
    const liquidityUtilization = totalFeeTransactions.mul(100).div(balances.total)
    const totalApy = totalFees.mul(100).mul(ONE_YEAR).div(balances.save).div(periodSeconds)
    console.log(`Total Txs     ${formatUnits(totalTransactions).padEnd(22)}`)
    console.log(`Savings       ${formatUnits(balances.save).padEnd(22)} ${formatUnits(totalFees).padEnd(20)} APY ${totalApy}%`)
    console.log(
        `${liquidityUtilization}% liquidity utilization  (${formatUnits(totalFeeTransactions)} of ${formatUnits(balances.total)} mBTC)`,
    )
}

const getMasset = (signer: Signer, contractAddress = "0x945Facb997494CC2570096c74b5F66A3507330a1"): Masset => {
    const linkedAddress = {
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: contracts.mainnet.Manager,
    }
    const mMassetFactory = new Masset__factory(linkedAddress, signer)
    return mMassetFactory.attach(contractAddress)
}

task("mBTC-storage", "Dumps mBTC's storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre

        const toBlockNumber = taskArgs.to ? taskArgs.to : await ethers.provider.getBlockNumber()
        console.log(`Block number ${toBlockNumber}`)
        const [signer] = await ethers.getSigners()

        const mAsset = getMasset(signer)

        await dumpTokenStorage(mAsset, toBlockNumber)
        await dumpBassetStorage(mAsset, toBlockNumber)
        await dumpConfigStorage(mAsset, toBlockNumber)
    })

task("mBTC-snap", "Get the latest data from the mBTC contracts")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 11840520, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre

        const [signer] = await ethers.getSigners()

        const mAsset = getMasset(signer)

        const toBlockNumber = taskArgs.to ? taskArgs.to : await ethers.provider.getBlockNumber()
        const currentTime = new Date()
        const fromBlock = taskArgs.from
        console.log(`Latest block ${toBlockNumber}, ${currentTime.toUTCString()}`)
        const startBlock = await hre.ethers.provider.getBlock(fromBlock)
        const startTime = new Date(startBlock.timestamp * 1000)

        const tvlConfig = {
            startingCap,
            capFactor,
            invariantValidatorAddress: contracts.mainnet.InvariantValidator,
        }
        await getBasket(
            mAsset,
            btcBassets.map((b) => b.symbol),
            "mBTC",
            tvlConfig,
        )
        await snapConfig(mAsset, toBlockNumber)

        const balances = await getBalances(mAsset, toBlockNumber)

        const mintSummary = await getMints(mAsset, fromBlock, startTime, toBlockNumber)
        const mintMultiSummary = await getMultiMints(mAsset, fromBlock, startTime, toBlockNumber)
        const redeemSummary = await getRedemptions(mAsset, fromBlock, startTime, toBlockNumber)
        const redeemMultiSummary = await getMultiRedemptions(mAsset, fromBlock, startTime, toBlockNumber)
        const swapSummary = await getSwaps(mAsset, fromBlock, startTime, toBlockNumber)

        outputFees(mintSummary, mintMultiSummary, swapSummary, redeemSummary, redeemMultiSummary, balances, startTime, currentTime)
    })

task("mBTC-rates", "mBTC rate comparison to Curve")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .addOptionalParam("swapSize", "Swap size to compare rates with Curve", 10000, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre
        const [signer] = await ethers.getSigners()

        const mAsset = await getMasset(signer)

        const toBlockNumber = taskArgs.block ? taskArgs.block : await ethers.provider.getBlockNumber()
        const toBlock = await ethers.provider.getBlock(toBlockNumber)
        const endTime = new Date(toBlock.timestamp * 1000)
        console.log(`Block ${toBlockNumber}, ${endTime.toUTCString()}`)

        await getSwapRates(mAsset, toBlockNumber, BN.from(taskArgs.swapSize))
    })

module.exports = {}
