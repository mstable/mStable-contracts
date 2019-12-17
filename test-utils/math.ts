import { BigNumber } from "./tools";
import { percentScale, ratioScale } from "./constants";

/**
 * @notice Common math functions
 * In theory, this can be built out and shipped in a separate mStable-js lib at some stage as
 * it likely share code with the front end
 */

const percentToWeight = (percent: number): BigNumber => {
  return new BigNumber(percent).times(percentScale);
};

const createMultiple = (ratio: number): BigNumber => {
  return new BigNumber(ratio).times(ratioScale);
};

const simpleToExactAmount = (amount: number, decimals: number): BigNumber => {
  return new BigNumber(amount).times(new BigNumber(10).pow(decimals));
};

/** @dev Converts a simple ratio (e.g. x1.1) to 1e6 format for OracleData */
const simpleToExactRelativePrice = (relativePrice: number): BigNumber => {
  return new BigNumber(relativePrice).times(new BigNumber(10).pow(6));
};

export {
  percentToWeight,
  createMultiple,
  simpleToExactAmount,
  simpleToExactRelativePrice,
};
