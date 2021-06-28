"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertBasketIsHealthy = exports.assertBNSlightlyGTPercent = exports.assertBNSlightlyGT = exports.assertBnGte = exports.assertBNClosePercent = exports.assertBNClose = void 0;
const chai_1 = require("chai");
const math_1 = require("./math");
const constants_1 = require("./constants");
/**
 *  Convenience method to assert that two BN.js instances are within 100 units of each other.
 *  @param actual The BN.js instance you received
 *  @param expected The BN.js amount you expected to receive, allowing a varience of +/- 10 units
 */
const assertBNClose = (actual, expected, variance = math_1.BN.from(10), reason = null) => {
    const actualBN = math_1.BN.from(actual);
    const actualDelta = actualBN.gt(expected) ? actualBN.sub(expected) : expected.sub(actualBN);
    const str = reason ? `\n\tReason: ${reason}\n\t${actualBN.toString()} vs ${expected.toString()}` : "";
    chai_1.assert.ok(actualBN.gte(expected.sub(variance)), `Number is too small to be close (Delta between actual and expected is ${actualDelta.toString()}, but variance was only ${variance.toString()}${str}`);
    chai_1.assert.ok(actualBN.lte(expected.add(variance)), `Number is too large to be close (Delta between actual and expected is ${actualDelta.toString()}, but variance was only ${variance.toString()})${str}`);
};
exports.assertBNClose = assertBNClose;
/**
 *  Convenience method to assert that two BN.js instances are within 100 units of each other.
 *  @param actual The BN.js instance you received
 *  @param expected The BN.js amount you expected to receive, allowing a varience of +/- 10 units
 */
const assertBNClosePercent = (a, b, variance = "0.02", reason = null) => {
    if (a.eq(b))
        return;
    const varianceBN = math_1.simpleToExactAmount(variance.toString().substr(0, 6), 16);
    const diff = a
        .sub(b)
        .abs()
        .mul(2)
        .mul(constants_1.fullScale)
        .div(a.add(b));
    const str = reason ? `\n\tReason: ${reason}\n\t${a.toString()} vs ${b.toString()}` : "";
    chai_1.assert.ok(diff.lte(varianceBN), `Numbers exceed ${variance}% diff (Delta between a and b is ${diff.toString()}%, but variance was only ${varianceBN.toString()})${str}`);
};
exports.assertBNClosePercent = assertBNClosePercent;
/**
 *  Convenience method to assert that one BN.js instance is GTE the other
 *  @param actual The BN.js instance you received
 *  @param expected The operant to compare against
 */
const assertBnGte = (actual, comparison) => {
    chai_1.assert.ok(actual.gte(comparison), `Number must be GTE comparitor, got: ${actual.toString()}; comparitor: ${comparison.toString()}`);
};
exports.assertBnGte = assertBnGte;
/**
 *  Convenience method to assert that one BN.js number is eq to, or greater than an expected value by some small amount
 *  @param actual The BN.js instance you received
 *  @param equator The BN.js to equate to
 *  @param maxActualShouldExceedExpected Upper limit for the growth
 *  @param mustBeGreater Fail if the operands are equal
 */
const assertBNSlightlyGT = (actual, equator, maxActualShouldExceedExpected = math_1.BN.from(100), mustBeGreater = false, reason = null) => {
    const actualDelta = actual.gt(equator) ? actual.sub(equator) : equator.sub(actual);
    const str = reason ? `\n\t${reason}\n\t${actual.toString()} vs ${equator.toString()}` : "";
    chai_1.assert.ok(mustBeGreater ? actual.gt(equator) : actual.gte(equator), `Actual value should be greater than the expected value ${str}`);
    chai_1.assert.ok(actual.lte(equator.add(maxActualShouldExceedExpected)), `Actual value should not exceed ${maxActualShouldExceedExpected.toString()} units greater than expected. Variance was ${actualDelta.toString()} ${str}`);
};
exports.assertBNSlightlyGT = assertBNSlightlyGT;
/**
 *  Convenience method to assert that one BN.js number is eq to, or greater than an expected value by some small amount
 *  @param actual The BN.js instance you received
 *  @param equator The BN.js to equate to
 *  @param maxActualShouldExceedExpected Percentage amount of increase, as a string (1% = 1)
 *  @param mustBeGreater Fail if the operands are equal
 */
const assertBNSlightlyGTPercent = (actual, equator, maxPercentIncrease = "0.1", mustBeGreater = false) => {
    const maxIncreaseBN = math_1.simpleToExactAmount(maxPercentIncrease, 16);
    const maxIncreaseUnits = equator.mul(maxIncreaseBN).div(constants_1.fullScale);
    // const actualDelta = actual.gt(equator) ? actual.sub(equator) : equator.sub(actual);
    chai_1.assert.ok(mustBeGreater ? actual.gt(equator) : actual.gte(equator), `Actual value should be greater than the expected value`);
    chai_1.assert.ok(actual.lte(equator.add(maxIncreaseUnits)), `Actual value should not exceed ${maxPercentIncrease}% greater than expected`);
};
exports.assertBNSlightlyGTPercent = assertBNSlightlyGTPercent;
const assertBasketIsHealthy = async (machine, md) => {
    // Read full basket composition
    const composition = await machine.getBasketComposition(md);
    // Assert sum of bAssets in vault storage is gte to total supply of mAsset
    exports.assertBnGte(composition.sumOfBassets, composition.totalSupply.add(composition.surplus));
    // No basket weight should be above max
    // composition.bAssets.forEach((b, i) => {
    //     expect(b.overweight).to.eq(false)
    // })
    // Actual tokens held should always gte vaultBalance
    composition.bAssets.forEach((b, i) => {
        chai_1.expect(b.actualBalance, `assertBasketIsHealthy: Actual balance of ${i} < vaultBalance`).gte(b.vaultBalance);
    });
    // Should be not undergoing recol
    chai_1.expect(composition.undergoingRecol, "not undergoing recol").to.eq(false);
    // not failed
    chai_1.expect(composition.failed, "mAsset not failed").to.eq(false);
    // prepareForgeBasset works
    // Potentially wrap in mock and check event
    await md.mAsset["getBasset(address)"](md.bAssets[0].address);
};
exports.assertBasketIsHealthy = assertBasketIsHealthy;
//# sourceMappingURL=assertions.js.map