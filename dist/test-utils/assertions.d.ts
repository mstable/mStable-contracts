import { MassetMachine, MassetDetails } from "@utils/machines";
import { BN } from "./math";
/**
 *  Convenience method to assert that two BN.js instances are within 100 units of each other.
 *  @param actual The BN.js instance you received
 *  @param expected The BN.js amount you expected to receive, allowing a varience of +/- 10 units
 */
export declare const assertBNClose: (actual: BN | string, expected: BN, variance?: BN | number, reason?: string) => void;
/**
 *  Convenience method to assert that two BN.js instances are within 100 units of each other.
 *  @param actual The BN.js instance you received
 *  @param expected The BN.js amount you expected to receive, allowing a varience of +/- 10 units
 */
export declare const assertBNClosePercent: (a: BN, b: BN, variance?: string | number, reason?: string) => void;
/**
 *  Convenience method to assert that one BN.js instance is GTE the other
 *  @param actual The BN.js instance you received
 *  @param expected The operant to compare against
 */
export declare const assertBnGte: (actual: BN, comparison: BN) => void;
/**
 *  Convenience method to assert that one BN.js number is eq to, or greater than an expected value by some small amount
 *  @param actual The BN.js instance you received
 *  @param equator The BN.js to equate to
 *  @param maxActualShouldExceedExpected Upper limit for the growth
 *  @param mustBeGreater Fail if the operands are equal
 */
export declare const assertBNSlightlyGT: (actual: BN, equator: BN, maxActualShouldExceedExpected?: BN, mustBeGreater?: boolean, reason?: string) => void;
/**
 *  Convenience method to assert that one BN.js number is eq to, or greater than an expected value by some small amount
 *  @param actual The BN.js instance you received
 *  @param equator The BN.js to equate to
 *  @param maxActualShouldExceedExpected Percentage amount of increase, as a string (1% = 1)
 *  @param mustBeGreater Fail if the operands are equal
 */
export declare const assertBNSlightlyGTPercent: (actual: BN, equator: BN, maxPercentIncrease?: string, mustBeGreater?: boolean) => void;
export declare const assertBasketIsHealthy: (machine: MassetMachine, md: MassetDetails) => Promise<void>;
