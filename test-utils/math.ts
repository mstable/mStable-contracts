import { BN } from "./tools";
import { percentScale, ratioScale } from "./constants";

export const percentToWeight = (percent: number): BN => {
    return new BN(percent).mul(percentScale);
};

// TODO - new BN does not handle fractions.. ensure only passing integers
export const createMultiple = (ratio: number): BN => {
    return new BN(ratio).mul(ratioScale);
};

export const simpleToExactAmount = (amount: number | string, decimals: number | BN): BN => {
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
    var negative = amountString.substring(0, 1) === "-";
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

export const exactToSimpleAmount = (amount: BN, decimals: number | BN): BN => {
    // Code is largely lifted from the guts of web3 fromWei here:
    // https://github.com/ethjs/ethjs-unit/blob/master/src/index.js
    const scale = new BN(10).pow(new BN(decimals));
    const scaleString = scale.toString();
    const negative = amount.lt(new BN("0"));

    if (negative) {
        amount = amount.mul(new BN("-1"));
    }

    let fraction = amount.mod(scale).toString();

    while (fraction.length < scaleString.length - 1) {
        fraction = `0${fraction}`;
    }

    // Chop zeros off the end if there are extras.
    fraction = fraction.replace(/0+$/, "");

    const whole = amount.div(scale).toString();
    let value = whole.concat(fraction === "" ? "" : `.${fraction}`);

    if (negative) {
        value = `-${value}`;
    }

    return new BN(value);
};

export const applyRatioMassetToBasset = (input: BN, ratio: BN): BN => {
    return input.mul(ratioScale).div(ratio);
};
