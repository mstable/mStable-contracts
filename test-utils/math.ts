import { BN } from "./tools";
import { percentScale, ratioScale } from "./constants";

/**
 * @notice Common math functions
 * In theory, this can be built out and shipped in a separate mStable-js lib at some stage as
 * it likely share code with the front end
 */

const percentToWeight = (percent: number): BN => {
    return new BN(percent).mul(percentScale);
};

const createMultiple = (ratio: number): BN => {
    return new BN(ratio).mul(ratioScale);
};

const simpleToExactAmount = (amount: number, decimals: number): BN => {
    return new BN(amount).mul(new BN(10).pow(new BN(decimals.toString())));
};

/** @dev Converts a simple ratio (e.g. x1.1) to 1e6 format for OracleData */
const simpleToExactRelativePrice = (relativePrice: number): BN => {
    return new BN(relativePrice).mul(new BN(10).pow(6));
};

export { percentToWeight, createMultiple, simpleToExactAmount, simpleToExactRelativePrice };
