import { MassetDetails, MassetMachine } from "@utils/machines";
import { BN } from "./tools";
import { simpleToExactAmount } from "./math";
import { fullScale } from "./constants";
import envSetup from "./env_setup";

const { expect, assert } = envSetup.configure();

/**
 *  Convenience method to assert that two BN.js instances are within 100 units of each other.
 *  @param actual The BN.js instance you received
 *  @param expected The BN.js amount you expected to receive, allowing a varience of +/- 10 units
 */
export const assertBNClose = (
    actual: BN,
    expected: BN,
    variance: BN | number = new BN(10),
): void => {
    const actualDelta = actual.gt(expected) ? actual.sub(expected) : expected.sub(actual);

    assert.ok(
        actual.gte(expected.sub(new BN(variance))),
        `Number is too small to be close (Delta between actual and expected is ${actualDelta.toString()}, but variance was only ${variance.toString()}`,
    );
    assert.ok(
        actual.lte(expected.add(new BN(variance))),
        `Number is too large to be close (Delta between actual and expected is ${actualDelta.toString()}, but variance was only ${variance.toString()})`,
    );
};

/**
 *  Convenience method to assert that two BN.js instances are within 100 units of each other.
 *  @param actual The BN.js instance you received
 *  @param expected The BN.js amount you expected to receive, allowing a varience of +/- 10 units
 */
export const assertBNClosePercent = (a: BN, b: BN, variance = "0.02"): void => {
    if (a.eq(b)) return;
    const varianceBN = simpleToExactAmount(variance.substr(0, 6), 16);
    const diff = a
        .sub(b)
        .abs()
        .muln(2)
        .mul(fullScale)
        .div(a.add(b));

    assert.ok(
        diff.lte(varianceBN),
        `Numbers exceed ${variance}% diff (Delta between a and b is ${diff.toString()}%, but variance was only ${varianceBN.toString()})`,
    );
};

/**
 *  Convenience method to assert that one BN.js instance is GTE the other
 *  @param actual The BN.js instance you received
 *  @param expected The operant to compare against
 */
export const assertBnGte = (actual: BN, comparison: BN): void => {
    assert.ok(
        actual.gte(comparison),
        `Number must be GTE comparitor, got: ${actual.toString()}; comparitor: ${comparison.toString()}`,
    );
};

/**
 *  Convenience method to assert that one BN.js number is eq to, or greater than an expected value by some small amount
 *  @param actual The BN.js instance you received
 *  @param equator The BN.js to equate to
 *  @param maxActualShouldExceedExpected Upper limit for the growth
 *  @param mustBeGreater Fail if the operands are equal
 */
export const assertBNSlightlyGT = (
    actual: BN,
    equator: BN,
    maxActualShouldExceedExpected: number | BN = new BN(100),
    mustBeGreater = false,
): void => {
    const actualDelta = actual.gt(equator) ? actual.sub(equator) : equator.sub(actual);

    assert.ok(
        mustBeGreater ? actual.gt(equator) : actual.gte(equator),
        `Actual value should be greater than the expected value`,
    );
    assert.ok(
        actual.lte(equator.add(new BN(maxActualShouldExceedExpected))),
        `Actual value should not exceed ${maxActualShouldExceedExpected.toString()} units greater than expected. Variance was ${actualDelta.toString()}`,
    );
};

/**
 *  Convenience method to assert that one BN.js number is eq to, or greater than an expected value by some small amount
 *  @param actual The BN.js instance you received
 *  @param equator The BN.js to equate to
 *  @param maxActualShouldExceedExpected Percentage amount of increase, as a string (1% = 1)
 *  @param mustBeGreater Fail if the operands are equal
 */
export const assertBNSlightlyGTPercent = (
    actual: BN,
    equator: BN,
    maxPercentIncrease = "0.1",
    mustBeGreater = false,
): void => {
    const maxIncreaseBN = simpleToExactAmount(maxPercentIncrease, 16);
    const maxIncreaseUnits = equator.mul(maxIncreaseBN).div(fullScale);
    // const actualDelta = actual.gt(equator) ? actual.sub(equator) : equator.sub(actual);

    assert.ok(
        mustBeGreater ? actual.gt(equator) : actual.gte(equator),
        `Actual value should be greater than the expected value`,
    );
    assert.ok(
        actual.lte(equator.add(maxIncreaseUnits)),
        `Actual value should not exceed ${maxPercentIncrease}% greater than expected`,
    );
};

export const assertBasketIsHealthy = async (
    machine: MassetMachine,
    md: MassetDetails,
): Promise<void> => {
    // Read full basket composition
    const composition = await machine.getBasketComposition(md);
    // Assert sum of bAssets in vault storage is gte to total supply of mAsset
    assertBnGte(composition.sumOfBassets, composition.totalSupply.add(composition.surplus));
    // No basket weight should be above max
    composition.bAssets.forEach((b, i) => {
        expect(b.overweight).to.eq(false);
    });
    // Actual tokens held should always gte vaultBalance
    composition.bAssets.forEach((b) => {
        expect(b.actualBalance).bignumber.gte(b.vaultBalance as any);
    });
    // Should be unpaused
    expect(await md.basketManager.paused()).to.eq(false);
    // not failed
    expect(composition.failed).to.eq(false);
    expect(composition.colRatio).bignumber.eq(fullScale);
    // prepareForgeBasset works
    // Potentially wrap in mock and check event
    await md.basketManager.prepareForgeBasset(md.bAssets[0].address, "1", false);
};
