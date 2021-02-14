/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import { btcBassets, capFactor, contracts, getBassetFromAddress, startingCap } from "@utils/btcConstants"
import { fullScale, ONE_DAY } from "@utils/constants"
import { applyDecimals, applyRatio, BN, simpleToExactAmount } from "@utils/math"
import { Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { task } from "hardhat/config"
import { InvariantValidator__factory, Masset, Masset__factory } from "types/generated"

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
    const values: BN[] = []
    let total = BN.from(0)
    btcBassets.forEach((bAsset, i) => {
        values.push(applyRatio(bAssets[1][i].vaultBalance, bAssets[1][i].ratio))
        total = total.add(values[i])
    })

    console.log("\nmBTC basket")
    btcBassets.forEach((bAsset, i) => {
        const percentage = values[i].mul(100).div(total)
        console.log(`${bAsset.symbol.padEnd(7)}  ${formatUnits(values[i]).padEnd(20)} ${percentage.toString().padStart(2)}%`)
    })
    const surplus = await mBtc.surplus()
    console.log(`Surplus  ${formatUnits(surplus)}`)
    const tvlCapPercentage = total.mul(100).div(tvlCap)
    console.log(`Total   ${formatUnits(total).padStart(21)}`)
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
                    const percent = scaledOutput.sub(scaledInput).mul(1000).div(scaledInput)
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

const getMints = async (mBTC: Masset, currentBlock: number): Promise<TxSummary> => {
    const filter = await mBTC.filters.Minted(null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, currentBlock - ONE_DAY.toNumber())

    console.log("\nMints in last 24 hours")
    console.log("Block#\t Minter\t\t\t\t\t    bAsset Masset Quantity")
    let total = BN.from(0)
    logs.forEach((log) => {
        const inputBasset = getBassetFromAddress(log.args.input)
        console.log(`${log.blockNumber} ${log.args.minter} ${inputBasset.symbol.padEnd(6)} ${formatUnits(log.args.mAssetQuantity)}`)
        total = total.add(log.args.mAssetQuantity)
    })
    console.log(`Total ${formatUnits(total)}`)
    return {
        total,
        fees: BN.from(0),
    }
}

const getRedemptions = async (mBTC: Masset, currentBlock: number): Promise<TxSummary> => {
    const filter = await mBTC.filters.Redeemed(null, null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, currentBlock - ONE_DAY.toNumber())

    console.log("\nRedemptions in last 24 hours")
    console.log("Block#\t Redeemer\t\t\t\t    bAsset Masset Quantity\tFee")
    let total = BN.from(0)
    let fees = BN.from(0)
    logs.forEach((log) => {
        const outputBasset = getBassetFromAddress(log.args.output)
        console.log(
            `${log.blockNumber} ${log.args.redeemer} ${outputBasset.symbol.padEnd(6)} ${formatUnits(log.args.mAssetQuantity)} ${formatUnits(
                log.args.scaledFee,
            )}`,
        )
        total = total.add(log.args.mAssetQuantity)
        fees = fees.add(log.args.scaledFee)
    })
    console.log(`Total ${formatUnits(total)}`)

    return {
        total,
        fees,
    }
}

const getSwaps = async (mBTC: Masset, currentBlock: number): Promise<TxSummary> => {
    const filter = await mBTC.filters.Swapped(null, null, null, null, null, null)
    const logs = await mBTC.queryFilter(filter, currentBlock - ONE_DAY.toNumber())

    console.log("\nSwaps in last 24 hours")
    console.log("Block#\t Swapper\t\t\t\t    Input  Output Output Quantity\tFee")
    // Scaled bAsset quantities
    let total = BN.from(0)
    let fees = BN.from(0)
    logs.forEach((log) => {
        const inputBasset = getBassetFromAddress(log.args.input)
        const outputBasset = getBassetFromAddress(log.args.output)
        console.log(
            `${log.blockNumber} ${log.args.swapper} ${inputBasset.symbol.padEnd(6)} ${outputBasset.symbol.padEnd(6)} ${formatUnits(
                log.args.outputAmount,
                outputBasset.decimals,
            ).padEnd(21)} ${formatUnits(log.args.scaledFee)}`,
        )
        total = total.add(applyDecimals(log.args.outputAmount, outputBasset.decimals))
        fees = fees.add(log.args.scaledFee)
    })
    console.log(`Total ${formatUnits(total)}`)

    return {
        total,
        fees,
    }
}

const outputFees = (redeems: TxSummary, swaps: TxSummary) => {
    const totalFees = redeems.fees.add(swaps.fees)
    const totalTotals = redeems.total.add(swaps.total)
    console.log("\nFees in the last 24 hours")
    console.log(
        `Redeem ${formatUnits(redeems.total).padEnd(22)} ${formatUnits(redeems.fees).padEnd(20)} ${redeems.fees.mul(100).div(totalFees)}%`,
    )
    console.log(
        `Swap   ${formatUnits(swaps.total).padEnd(22)} ${formatUnits(swaps.fees).padEnd(20)} ${swaps.fees.mul(100).div(totalFees)}%`,
    )
    console.log(`Total  ${formatUnits(totalTotals).padEnd(22)} ${formatUnits(totalFees).padEnd(20)}`)
}

task("mBTC-snap", "Get the latest data from the mBTC contracts").setAction(async (_, hre) => {
    const { ethers } = hre

    const [signer] = await ethers.getSigners()

    const linkedAddress = {
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: contracts.mainnet.Manager,
    }
    const mBtc = await new Masset__factory(linkedAddress, signer).attach(contracts.mainnet.mBTC)

    const currentBlock = await hre.ethers.provider.getBlockNumber()
    console.log(`Latest block ${currentBlock}, ${new Date().toUTCString()}`)

    await getBasket(mBtc, signer)
    await getBalances(mBtc)
    await getSwapRates(mBtc)

    await getMints(mBtc, currentBlock)
    const redeemSummary = await getRedemptions(mBtc, currentBlock)
    const swapSummary = await getSwaps(mBtc, currentBlock)
    outputFees(redeemSummary, swapSummary)
})

module.exports = {}
