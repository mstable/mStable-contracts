import { BN } from "./tools";
import { ratioScale } from "./constants";

export const simpleToExactAmount = (
    amount: number | string | BN,
    decimals: number | BN = 18,
): BN => {
    // Code is largely lifted from the guts of web3 toWei here:
    // https://github.com/ethjs/ethjs-unit/blob/master/src/index.js
    let amountString = amount.toString();
    const decimalsBN = new BN(decimals);

    if (decimalsBN.gt(new BN(100))) {
        throw new Error(`Invalid decimals amount`);
    }

    const scale = new BN(10).pow(new BN(decimals));
    const scaleString = scale.toString();

    // Is it negative?
    const negative = amountString.substring(0, 1) === "-";
    if (negative) {
        amountString = amountString.substring(1);
    }

    if (amountString === ".") {
        throw new Error(`Error converting number ${amountString} to precise unit, invalid value`);
    }

    // Split it into a whole and fractional part
    // eslint-disable-next-line prefer-const
    let [whole, fraction, ...rest] = amountString.split(".");
    if (rest.length > 0) {
        throw new Error(
            `Error converting number ${amountString} to precise unit, too many decimal points`,
        );
    }

    if (!whole) {
        whole = "0";
    }
    if (!fraction) {
        fraction = "0";
    }

    if (fraction.length > scaleString.length - 1) {
        throw new Error(
            `Error converting number ${amountString} to precise unit, too many decimal places`,
        );
    }

    while (fraction.length < scaleString.length - 1) {
        fraction += "0";
    }

    const wholeBN = new BN(whole);
    const fractionBN = new BN(fraction);
    let result = wholeBN.mul(scale).add(fractionBN);

    if (negative) {
        result = result.mul(new BN("-1"));
    }

    return result;
};

export const percentToWeight = (percent: number | string | BN): BN => {
    return simpleToExactAmount(percent, 16);
};

// How many bAssets is this mAsset worth
export const applyRatioMassetToBasset = (input: BN, ratio: BN | string): BN => {
    return input.mul(ratioScale).div(new BN(ratio));
};

// How many mAssets is this bAsset worth
export const applyRatio = (bAssetQ: BN | string | number, ratio: BN | string): BN => {
    return new BN(bAssetQ).mul(new BN(ratio)).div(ratioScale);
};

// How many mAssets is this bAsset worth
export const applyRatioCeil = (bAssetQ: BN | string, ratio: BN | string): BN => {
    const scaled = new BN(bAssetQ).mul(new BN(ratio));
    const ceil = new BN(scaled).add(ratioScale.sub(new BN(1)));
    return ceil.div(ratioScale);
};

export const createMultiple = (decimals: number): BN => {
    const ratio = new BN(10).pow(new BN(18 - decimals));
    return new BN(ratio).mul(ratioScale);
};
