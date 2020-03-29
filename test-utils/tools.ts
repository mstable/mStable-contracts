import * as chai from "chai";
import { asciiToHex as aToH, padRight } from "web3-utils";
import BN from "bn.js";

/**
 *  Convenience method to assert that two BN.js instances are within 100 units of each other.
 *  @param actual The BN.js instance you received
 *  @param expected The BN.js amount you expected to receive, allowing a varience of +/- 10 units
 */
const assertBNClose = (actual: BN, expected: BN, variance = new BN(10)) => {
    const actualDelta = actual.gt(expected) ? actual.sub(expected) : expected.sub(actual);

    assert.ok(
        actual.gte(expected.sub(variance)),
        `Number is too small to be close (Delta between actual and expected is ${actualDelta.toString()}, but variance was only ${variance.toString()}`,
    );
    assert.ok(
        actual.lte(expected.add(variance)),
        `Number is too large to be close (Delta between actual and expected is ${actualDelta.toString()}, but variance was only ${variance.toString()})`,
    );
};

/**
 *  Convenience method to assert that one BN.js number is eq to, or greater than an expected value by some small amount
 *  @param actual The BN.js instance you received
 *  @param equator The BN.js to equate to
 *  @param maxActualShouldExceedExpected Upper limit for the growth
 *  @param mustBeGreater Fail if the operands are equal
 */
const assertBNSlightlyGT = (
    actual: BN,
    equator: BN,
    maxActualShouldExceedExpected = new BN(100),
    mustBeGreater = false,
) => {
    const actualDelta = actual.gt(equator) ? actual.sub(equator) : equator.sub(actual);

    assert.ok(
        mustBeGreater ? actual.gt(equator) : actual.gte(equator),
        `Actual value should be greater than the expected value`,
    );
    assert.ok(
        actual.lte(equator.add(maxActualShouldExceedExpected)),
        `Actual value should not exceed ${maxActualShouldExceedExpected.toString()} units greater than expected. Variance was ${actualDelta.toString()}`,
    );
};

export { assertBNSlightlyGT, assertBNClose, aToH, BN, chai, padRight };
