/* eslint-disable import/no-extraneous-dependencies */
import { BigNumber as BN } from "ethers"
import { ratioScale } from "./constants"

export { BN }

// Converts an unscaled number to scaled number with the specified number of decimals
// eg convert 3 to 3000000000000000000 with 18 decimals
export const simpleToExactAmount = (amount: number | string | BN, decimals: number | BN = 18): BN => {
    // Code is largely lifted from the guts of web3 toWei here:
    // https://github.com/ethjs/ethjs-unit/blob/master/src/index.js
    let amountString = amount.toString()
    const decimalsBN = BN.from(decimals)

    if (decimalsBN.gt(100)) {
        throw new Error(`Invalid decimals amount`)
    }

    const scale = BN.from(10).pow(decimals)
    const scaleString = scale.toString()

    // Is it negative?
    const negative = amountString.substring(0, 1) === "-"
    if (negative) {
        amountString = amountString.substring(1)
    }

    if (amountString === ".") {
        throw new Error(`Error converting number ${amountString} to precise unit, invalid value`)
    }

    // Split it into a whole and fractional part
    // eslint-disable-next-line prefer-const
    let [whole, fraction, ...rest] = amountString.split(".")
    if (rest.length > 0) {
        throw new Error(`Error converting number ${amountString} to precise unit, too many decimal points`)
    }

    if (!whole) {
        whole = "0"
    }
    if (!fraction) {
        fraction = "0"
    }

    if (fraction.length > scaleString.length - 1) {
        throw new Error(`Error converting number ${amountString} to precise unit, too many decimal places`)
    }

    while (fraction.length < scaleString.length - 1) {
        fraction += "0"
    }

    const wholeBN = BN.from(whole)
    const fractionBN = BN.from(fraction)
    let result = wholeBN.mul(scale).add(fractionBN)

    if (negative) {
        result = result.mul("-1")
    }

    return result
}

// How many mAssets is this bAsset worth using bAsset decimal length
// eg convert 3679485 with 6 decimals (3.679485) to 3679485000000000000 with 18 decimals
export const applyDecimals = (inputQuantity: number | string | BN, decimals = 18): BN =>
    BN.from(10)
        .pow(18 - decimals)
        .mul(inputQuantity)

export const percentToWeight = (percent: number | string | BN): BN => simpleToExactAmount(percent, 16)

// How many bAssets is this mAsset worth
export const applyRatioMassetToBasset = (input: BN, ratio: BN | string): BN => input.mul(ratioScale).div(ratio)

// How many mAssets is this bAsset worth
export const applyRatio = (bAssetQ: BN | string | number, ratio: BN | string): BN => BN.from(bAssetQ).mul(ratio).div(ratioScale)

// How many mAssets is this bAsset worth
export const applyRatioCeil = (bAssetQ: BN | string, ratio: BN | string): BN => {
    const scaled = BN.from(bAssetQ).mul(ratio)
    const ceil = BN.from(scaled).add(ratioScale.sub(1))
    return ceil.div(ratioScale)
}

export const createMultiple = (decimals: number): BN => {
    const ratio = BN.from(10).pow(18 - decimals)
    return BN.from(ratio).mul(ratioScale)
}

// Returns the smaller number
export const minimum = (a: BN, b: BN): BN => (a.lte(b) ? a : b)
