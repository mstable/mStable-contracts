/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
import { btcBassets, capFactor, contracts, startingCap } from "@utils/btcConstants"
import { fullScale } from "@utils/constants"
import { applyRatio, BN, simpleToExactAmount } from "@utils/math"
import { Signer } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { task } from "hardhat/config"
import { InvariantValidator__factory, Masset, Masset__factory } from "types/generated"

const getTvlCap = async (signer: Signer): Promise<BN> => {
    const validator = await new InvariantValidator__factory(signer).attach(contracts.mainnet.InvariantValidator)
    const tvlStartTime = await validator.startTime()
    const weeksSinceLaunch = BN.from(Date.now()).div(1000).sub(tvlStartTime).mul(fullScale).div(604800)
    // // e.g. 1e19 + (15e18 * 2.04e36) = 1e19 + 3.06e55
    // // startingCap + (capFactor * weeksSinceLaunch**2 / 1e36);
    return startingCap.add(capFactor.mul(weeksSinceLaunch.pow(2)).div(fullScale.pow(2)))
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
                    const scaledInput = BN.from(10)
                        .pow(18 - inputToken.decimals)
                        .mul(input)
                    const scaledOutput = BN.from(10)
                        .pow(18 - outputToken.decimals)
                        .mul(output)
                    const percent = scaledOutput.sub(scaledInput).mul(1000).div(scaledInput)
                    console.log(
                        `${inputStr} ${inputToken.symbol} -> ${formatUnits(output, outputToken.decimals)}\t${
                            outputToken.symbol
                        }\t${percent}bps`,
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
    console.log(`imBTC ${formatUnits(savingBalance)} ${savingBalance.mul(100).div(mBtcBalance)}%`)
    console.log(`Sushi Pool ${formatUnits(sushiPoolBalance)} ${sushiPoolBalance.mul(100).div(mBtcBalance)}%`)
    console.log(`mStable Fund Manager ${formatUnits(mStableFundManagerBalance)} ${mStableFundManagerBalance.mul(100).div(mBtcBalance)}%`)
    console.log(`Others ${formatUnits(otherBalances)} ${otherBalances.mul(100).div(mBtcBalance)}%`)
}

task("mBTC-snap", "Get the latest data from the mBTC contracts").setAction(async (_, hre) => {
    const { ethers } = hre

    const [signer] = await ethers.getSigners()

    const linkedAddress = {
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: contracts.mainnet.Manager,
    }
    const mBtc = await new Masset__factory(linkedAddress, signer).attach(contracts.mainnet.mBTC)

    const tvlCap = await getTvlCap(signer)

    const block = await hre.ethers.provider.getBlockNumber()
    console.log(`Latest block ${block}, ${new Date()}`)

    const bAssets = await mBtc.getBassets()
    const values: BN[] = []
    let total = BN.from(0)
    btcBassets.forEach((bAsset, i) => {
        values.push(applyRatio(bAssets[1][i].vaultBalance, bAssets[1][i].ratio))
        total = total.add(values[i])
    })
    btcBassets.forEach((bAsset, i) => {
        const percentage = values[i].mul(100).div(total)
        console.log(`${bAsset.symbol}\t${formatUnits(values[i])}\t\t${percentage}%`)
    })
    const surplus = await mBtc.surplus()
    console.log(`Surplus ${formatUnits(surplus)}`)
    const tvlCapPercentage = total.mul(100).div(tvlCap)
    console.log(`Total ${formatUnits(total)}, tvl cap ${formatUnits(tvlCap)} ${tvlCapPercentage}%`)

    await getBalances(mBtc)
    await getSwapRates(mBtc)
})

module.exports = {}
