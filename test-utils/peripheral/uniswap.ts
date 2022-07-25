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
    fees: number[]
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
        const encodedFee = fee.toString(16).padStart(2 * FEE_SIZE, "0")
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
    const exchangeRate = inAmount.div(outAmount.div(simpleToExactAmount(1, to.decimals)))
    // Exchange rate is not precise enough, better to relay on the output amount.
    return { outAmount, exchangeRate, fees }
}
/**
 * For the same pair of tokens, it gives the best quote based on the router fees.
 * If only one fee pair is provided it returns only that fee route quote.
 *
 * @param {Signer} signer
 * @param {Token} from
 * @param {Token} to
 * @param {BN} inAmount
 * @param {(number | string)} blockNumber
 * @param {number[][]} fees
 * @param {string[]} [path]
 * @return {*}  {Promise<SwapQuote>}
 */
export const bestQuoteSwap = async (
    signer: Signer,
    from: Token,
    to: Token,
    inAmount: BN,
    blockNumber: number | string,
    fees: number[][],
    path?: string[],
): Promise<SwapQuote> => {
    // Get quote value from UniswapV3
    const uniswapPath = path || getWETHPath(from.address, to.address)
    const quoter = IUniswapV3Quoter__factory.connect(uniswapQuoterV3Address, signer)

    // Use Uniswap V3
    // Exchange rate is not precise enough, better to relay on the output amount.
    const quotes = await Promise.all(
        fees.map(async (feePair) => {
            const encodedPath = encodeUniswapPath(uniswapPath, feePair)
            const outAmount = await quoteExactInput(quoter, encodedPath.encoded, inAmount, blockNumber)
            const exchangeRate = inAmount.div(outAmount.div(simpleToExactAmount(1, to.decimals)))
            return { encodedPath, outAmount, exchangeRate, fees: feePair }
        }),
    )
    // Get the quote that gives more output amount
    return quotes.reduce((bestQuote, quote) => (bestQuote.outAmount > quote.outAmount ? bestQuote : quote))
}
