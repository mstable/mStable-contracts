import { BN } from "./tools";
import { percentScale, ratioScale } from "./constants";

/**
 * @notice Common math functions
 * In theory, this can be built out and shipped in a separate mStable-js lib at some stage as
 * it likely share code with the front end
 */

// TODO - new BN does not handle fractions.. ensure only passing integers
export const percentToWeight = (percent: number): BN => {
    return new BN(percent).mul(percentScale);
};

// TODO - new BN does not handle fractions.. ensure only passing integers
export const createMultiple = (ratio: number): BN => {
    return new BN(ratio).mul(ratioScale);
};

// TODO - new BN does not handle fractions.. ensure only passing integers
export const simpleToExactAmount = (amount: number, decimals: number): BN => {
    return new BN(amount).mul(new BN(10).pow(new BN(decimals)));
};

// TODO - new BN does not handle fractions.. ensure only passing integers
export const exactAmountToSimple = (value, decimals): BN => {
    return new BN(value).div(new BN(10).pow(new BN(decimals)));
};

export const applyRatioMassetToBasset = (input: BN, ratio: BN): string => {
    return input
        .mul(ratioScale)
        .div(ratio)
        .toString();
};

/** @dev Converts a simple ratio (e.g. x1.1) to 1e6 format for OracleData */
export const simpleToExactRelativePrice = (relativePrice: string): BN => {
    const tenx = new BN(10).pow(new BN(6));
    console.log("t", tenx.toString());
    const input = new BN(relativePrice);
    console.log("i", input.toString());
    const price = input.mul(tenx);
    console.log("p", price.toString());
    return price;
};
