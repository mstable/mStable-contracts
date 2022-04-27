import { Signer } from "ethers"
import { IUniswapV3Quoter, IUniswapV3Quoter__factory } from "types/generated"
import { BN, simpleToExactAmount } from "../math"

const uniswapEthToken = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const uniswapQuoterV3Address = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"

export interface EncodedPaths {
    encoded: string
    encodedReversed: string
}
export interface SwapQuote {
    outAmount: BN
    exchangeRate: BN
}
export interface Token {
    address: string
    decimals: number
}
export const encodeUniswapPath = (tokenAddresses: string[], fees: number[]): EncodedPaths => {
    const FEE_SIZE = 3

    if (tokenAddresses.length !== fees.length + 1) {
        throw new Error("tokenAddresses/fees lengths do not match")
    }

    let encoded = "0x"
    let encodedReversed = ""
    fees.forEach((fee, i) => {
        // 20 byte hex encoding of the address
        const encodedAddress = tokenAddresses[i].slice(2)
        encoded += encodedAddress
        encodedReversed = encodedAddress + encodedReversed

        // 3 byte hex encoding of the fee
        const encodedFee = fees[i].toString(16).padStart(2 * FEE_SIZE, "0")
        encoded += encodedFee
        encodedReversed = encodedFee + encodedReversed
    })
    // encode the final token
    const finalAddress = tokenAddresses[tokenAddresses.length - 1].slice(2)
    encoded += finalAddress
    encodedReversed = `0x${finalAddress}${encodedReversed}`

    return {
        encoded: encoded.toLowerCase(),
        encodedReversed: encodedReversed.toLowerCase(),
    }
}
export const getWETHPath = (fromPath: string, toPath: string): Array<string> => [fromPath, uniswapEthToken, toPath]
// It makes it easier to mock this function.
export const quoteExactInput = (
    quoter: IUniswapV3Quoter,
    encodedPath: string,
    amount: BN,
    blockNumber: number | string = "latest",
): Promise<BN> => quoter.callStatic.quoteExactInput(encodedPath, amount, { blockTag: blockNumber })

export const quoteSwap = async (
    signer: Signer,
    from: Token,
    to: Token,
    inAmount: BN,
    blockNumber: number | string,
    path?: string[],
    fees = [3000, 3000],
): Promise<SwapQuote> => {
    // Get quote value from UniswapV3
    const uniswapPath = path || getWETHPath(from.address, to.address)
    // console.log("ts: quoteSwap uniswapPath", uniswapPath)
    // Use Uniswap V3
    const encodedPath = encodeUniswapPath(uniswapPath, fees)
    const quoter = IUniswapV3Quoter__factory.connect(uniswapQuoterV3Address, signer)
    const outAmount = await quoteExactInput(quoter, encodedPath.encoded, inAmount, blockNumber)
    const exchangeRate = outAmount.div(simpleToExactAmount(1, to.decimals)).mul(simpleToExactAmount(1, from.decimals)).div(inAmount)
    // Exchange rate is not precise enough, better to relay on the output amount.
    return { outAmount, exchangeRate }
}
