/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import { Bassets, btcBassets, capFactor, contracts, getBassetFromAddress, startingCap } from "@utils/btcConstants"
import { fullScale, ONE_YEAR } from "@utils/constants"
import { applyDecimals, applyRatio, BN, simpleToExactAmount } from "@utils/math"
import { Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { task, types } from "hardhat/config"
import { InvariantValidator__factory, Masset, Masset__factory } from "types/generated"

// This is a rough approximation
const ONE_DAY_BLOCKS = 6500
interface TxSummary {
    total: BN
    fees: BN
}

const getTvlCap = async (signer: Signer): Promise<BN> => {
    const validator = await new InvariantValidator__factory(signer).attach(contracts.mainnet.InvariantValidator)
    const tvlStartTime = await validator.startTime()
    const weeksSinceLaunch = BN.from(Date.now()).div(1000).sub(tvlStartTime).mul(fullScale).div(604800)
    // // e.g. 1e19 + (15e18 * 2.04e36) = 1e19 + 3.06e55
    // // startingCap + (capFactor * weeksSinceLaunch**2 / 1e36);
    return startingCap.add(capFactor.mul(weeksSinceLaunch.pow(2)).div(fullScale.pow(2)))
}

const getBasket = async (mBtc: Masset, signer: Signer) => {
    const tvlCap = await getTvlCap(signer)

    const bAssets = await mBtc.getBassets()
    const bAssetTotals: BN[] = []
    let totalBassets = BN.from(0)
    btcBassets.forEach((_, i) => {
        const scaledBassetQuantity = applyRatio(bAssets[1][i].vaultBalance, bAssets[1][i].ratio)
        bAssetTotals.push(scaledBassetQuantity)
        totalBassets = totalBassets.add(scaledBassetQuantity)
    })

    console.log("\nmBTC basket")
    btcBassets.forEach((bAsset, i) => {
        const percentage = bAssetTotals[i].mul(100).div(totalBassets)
        console.log(`${bAsset.symbol.padEnd(7)}  ${formatUnits(bAssetTotals[i]).padEnd(20)} ${percentage.toString().padStart(2)}%`)
    })
    const surplus = await mBtc.surplus()
    console.log(`Surplus  ${formatUnits(surplus)}`)
    const tvlCapPercentage = totalBassets.mul(100).div(tvlCap)
    console.log(`Total   ${formatUnits(totalBassets).padStart(21)}`)
    console.log(`TVL cap ${formatUnits(tvlCap).padStart(21)} ${tvlCapPercentage}%`)
}

const getSwapRates = async (mBTC: Masset) => {
    console.log("\nSwap rates")
    for (const inputToken of btcBassets) {
        for (const outputToken of btcBassets) {
            if (inputToken.symbol !== outputToken.symbol) {
                const inputAddress = contracts.mainnet[inputToken.symbol]
                const outputAddress = contracts.mainnet[outputToken.symbol]
                try {
                    const inputStr = "0.1"
                    const input = simpleToExactAmount(inputStr, inputToken.decimals)
                    const output = await mBTC.getSwapOutput(inputAddress, outputAddress, input)
                    const scaledInput = applyDecimals(input, inputToken.decimals)
                    const scaledOutput = applyDecimals(output, outputToken.decimals)
                    const percent = scaledOutput.sub(scaledInput).mul(10000).div(scaledInput)
                    console.log(
                        `${inputStr} ${inputToken.symbol.padEnd(6)} -> ${outputToken.symbol.padEnd(6)} ${formatUnits(
                            output,
                            outputToken.decimals,
                        ).padEnd(21)} ${percent.toString().padStart(4)}bps`,
                    )
                } catch (err) {
                    console.error(`${inputToken.symbol} -> ${outputToken.symbol} ${err.message}`)
                }
            }
        }
    }
}

const getBalances = async (mBTC: Masset) => {
    const mBtcBalance = await mBTC.totalSupply()
    const savingBalance = await mBTC.balanceOf(contracts.mainnet.imBTC)
    const sushiPoolBalance = await mBTC.balanceOf(contracts.mainnet.sushiPool)
    const mStableFundManagerBalance = await mBTC.balanceOf(contracts.mainnet.fundManager)
    const otherBalances = mBtcBalance.sub(savingBalance).sub(sushiPoolBalance).sub(mStableFundManagerBalance)

    console.log("\nmBTC Holders")
    console.log(`imBTC                ${formatUnits(savingBalance).padEnd(20)} ${savingBalance.mul(100).div(mBtcBalance)}%`)
    console.log(`Sushi Pool           ${formatUnits(sushiPoolBalance).padEnd(20)} ${sushiPoolBalance.mul(100).div(mBtcBalance)}%`)
    console.log(
        `mStable Fund Manager ${formatUnits(mStableFundManagerBalance).padEnd(20)} ${mStableFundManagerBalance.mul(100).div(mBtcBalance)}%`,
    )
    console.log(`Others               ${formatUnits(otherBalances).padEnd(20)} ${otherBalances.mul(100).div(mBtcBalance)}%`)
}

const getMints = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.Minted(null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

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

const getMultiMints = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.MintedMulti(null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

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

const getRedemptions = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.Redeemed(null, null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

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

const getMultiRedemptions = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.RedeemedMulti(null, null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

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

const getSwaps = async (mBTC: Masset, fromBlock: number, startTime: Date): Promise<TxSummary> => {
    const filter = await mBTC.filters.Swapped(null, null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, fromBlock)

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
    totalSupply: BN,
    startTime: Date,
    currentTime: Date,
) => {
    const totalFees = redeems.fees.add(multiRedeems.fees).add(swaps.fees)
    const totalTotals = mints.total.add(multiMints.total).add(redeems.total).add(multiRedeems.total).add(swaps.total)
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
    const totalApy = totalFees.mul(100).mul(ONE_YEAR).div(totalSupply).div(periodSeconds)
    console.log(`Total         ${formatUnits(totalTotals).padEnd(22)} ${formatUnits(totalFees).padEnd(20)} APY ${totalApy}%`)
}

task("mBTC-snap", "Get the latest data from the mBTC contracts")
    .addOptionalParam("fromBlock", "Block to query transaction events from. (default: deployment block)", 11840520, types.int)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre

        const [signer] = await ethers.getSigners()

        const linkedAddress = {
            __$1a38b0db2bd175b310a9a3f8697d44eb75$__: contracts.mainnet.Manager,
        }
        const mBtc = await new Masset__factory(linkedAddress, signer).attach(contracts.mainnet.mBTC)

        const currentBlock = await hre.ethers.provider.getBlockNumber()
        const currentTime = new Date()
        const { fromBlock } = taskArgs
        console.log(`Latest block ${currentBlock}, ${currentTime.toUTCString()}`)
        const startBlock = await hre.ethers.provider.getBlock(fromBlock)
        const startTime = new Date(startBlock.timestamp * 1000)

        await getBasket(mBtc, signer)
        await getBalances(mBtc)
        await getSwapRates(mBtc)

        const mintSummary = await getMints(mBtc, fromBlock, startTime)
        const mintMultiSummary = await getMultiMints(mBtc, fromBlock, startTime)
        const redeemSummary = await getRedemptions(mBtc, fromBlock, startTime)
        const redeemMultiSummary = await getMultiRedemptions(mBtc, fromBlock, startTime)
        const swapSummary = await getSwaps(mBtc, fromBlock, startTime)

        const totalSupply = await mBtc.totalSupply()
        outputFees(mintSummary, mintMultiSummary, swapSummary, redeemSummary, redeemMultiSummary, totalSupply, startTime, currentTime)
    })

module.exports = {}
