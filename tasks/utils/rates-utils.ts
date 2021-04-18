import { Contract } from "ethers"
import { applyDecimals, BN, simpleToExactAmount } from "@utils/math"
import { FeederPool, Masset } from "types/generated"
import CurveRegistryExchangeABI from "../../contracts/peripheral/Curve/CurveRegistryExchange.json"
import { QuantityFormatter } from "./quantity-formatters"
import { Token } from "./tokens"

export interface Balances {
    total: BN
    save: BN
    earn: BN
}

export interface BlockInfo {
    fromBlockNumber: number
    toBlockNumber: number
    startTime: Date
    endTime: Date
}
export interface SwapRate {
    inputToken: Token
    inputAmountRaw: BN
    inputDisplay: string
    outputToken: Token
    mOutputRaw: BN
    curveOutputRaw: BN
    curveInverseOutputRaw: BN
}

export const outputSwapRate = (swap: SwapRate, quantityFormatter: QuantityFormatter): void => {
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

    if (curveOutputRaw.gt(0)) {
        console.log(
            `${swap.inputDisplay.padStart(9)} ${inputToken.symbol.padEnd(6)} -> ${outputToken.symbol.padEnd(6)} ${quantityFormatter(
                mOutputRaw,
                outputToken.decimals,
                12,
            )} ${mBasicPoints.toString().padStart(4)}bps Curve ${quantityFormatter(
                curveOutputRaw,
                outputToken.decimals,
                12,
            )} ${curvePercent.toString().padStart(4)}bps ${diffOutputs.toString().padStart(3)}bps ${quantityFormatter(arbProfit, 18, 8)}`,
        )
    } else {
        console.log(
            `${swap.inputDisplay.padStart(9)} ${inputToken.symbol.padEnd(6)} -> ${outputToken.symbol.padEnd(6)} ${quantityFormatter(
                mOutputRaw,
                outputToken.decimals,
                12,
            )} ${mBasicPoints.toString().padStart(4)}bps`,
        )
    }
}

export const getSwapRates = async (
    inputTokens: Token[],
    outputTokens: Token[],
    mAsset: Masset | FeederPool,
    toBlock: number,
    quantityFormatter: QuantityFormatter,
    inputAmount: BN | number | string = BN.from("1000"),
): Promise<SwapRate[]> => {
    // Get Curve Exchange
    const curve = new Contract("0xD1602F68CC7C4c7B59D686243EA35a9C73B0c6a2", CurveRegistryExchangeABI, mAsset.signer)

    const callOverride = {
        blockTag: toBlock,
    }
    const pairs = []
    const mAssetSwapPromises = []
    // Get mUSD swap rates
    for (const inputToken of inputTokens) {
        for (const outputToken of outputTokens) {
            if (inputToken.symbol !== outputToken.symbol) {
                pairs.push({
                    inputToken,
                    outputToken,
                })
                const inputAmountRaw = simpleToExactAmount(inputAmount, inputToken.decimals)
                mAssetSwapPromises.push(mAsset.getSwapOutput(inputToken.address, outputToken.address, inputAmountRaw, callOverride))
            }
        }
    }
    // Resolve all the mUSD promises
    const mAssetSwaps: BN[] = await Promise.all(mAssetSwapPromises)

    // Get Curve's best swap rate for each pair and the inverse swap
    const curveSwapsPromises = []
    pairs.forEach(({ inputToken, outputToken }, i) => {
        // Get the matching Curve swap rate
        const curveSwapPromise = curve.get_best_rate(
            inputToken.address,
            outputToken.address,
            simpleToExactAmount(inputAmount, inputToken.decimals),
            callOverride,
        )
        // Get the Curve inverse swap rate using mUSD swap output as the input
        const curveInverseSwapPromise = curve.get_best_rate(outputToken.address, inputToken.address, mAssetSwaps[i], callOverride)
        curveSwapsPromises.push(curveSwapPromise, curveInverseSwapPromise)
    })
    // Resolve all the Curve promises
    const curveSwaps = await Promise.all(curveSwapsPromises)

    // Merge the mUSD and Curve swaps into one array
    const swaps: SwapRate[] = pairs.map(({ inputToken, outputToken }, i) => ({
        inputToken,
        inputAmountRaw: simpleToExactAmount(inputAmount, inputToken.decimals),
        inputDisplay: inputAmount.toString(),
        outputToken,
        mOutputRaw: mAssetSwaps[i],
        // This first param of the Curve result is the pool address, the second is the output amount
        curveOutputRaw: curveSwaps[i * 2][1],
        curveInverseOutputRaw: curveSwaps[i * 2 + 1][1],
    }))
    swaps.forEach((swap) => {
        outputSwapRate(swap, quantityFormatter)
    })

    return swaps
}
