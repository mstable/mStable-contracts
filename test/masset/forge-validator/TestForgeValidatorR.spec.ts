import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { createBasset, BassetStatus } from "@utils/mstable-objects";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import { ratioScale } from "@utils/constants";

const { expect } = envSetup.configure();

const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

interface BasketDeets {
    failed: boolean;
    totalSupply: number | string;
}
const setBasket = (failed: boolean, totalSupply: number | string): BasketDeets => {
    return {
        failed,
        totalSupply,
    };
};

interface BassetDeets {
    maxWeight: number | string;
    vaultUnits: number | string;
    decimals: number;
    status: BassetStatus;
}
const setBasset = (
    maxWeight: number | string,
    vaultUnits: number | string,
    decimals = 18,
    status: BassetStatus = BassetStatus.Normal,
): BassetDeets => {
    return {
        maxWeight,
        vaultUnits,
        decimals,
        status,
    };
};

interface Args {
    indexToRedeem: number;
    redeemAmountUnits: number | string;
}
const setArgs = (indexToRedeem: number, redeemAmountUnits: number | string): Args => {
    return {
        indexToRedeem,
        redeemAmountUnits,
    };
};

interface CalcResult {
    expectedValidity: boolean;
    expectedReason: string;
    expectedQs: Array<BN | string | number>;
    exact: boolean;
}
const setCalcResult = (
    expectedValidity: boolean,
    expectedReason = "",
    expectedQs: Array<BN | string | number> = [],
    exact = false,
): CalcResult => {
    return {
        expectedValidity,
        expectedReason,
        expectedQs,
        exact,
    };
};

interface Result {
    expectedValidity: boolean;
    expectedReason: string;
    expectFee: boolean;
}
const setResult = (
    expectedValidity: boolean,
    expectedReason = "",
    expectFee = expectedValidity,
): Result => {
    return {
        expectedValidity,
        expectedReason,
        expectFee,
    };
};

contract("ForgeValidator", async (accounts) => {
    let forgeValidator: t.ForgeValidatorInstance;

    before("Init contract", async () => {
        forgeValidator = await ForgeValidatorArtifact.new();
    });

    const assertRedeem = async (
        basket: BasketDeets,
        bAssets: BassetDeets[],
        args: Array<Args>,
        result: Result,
        sender: string = accounts[0],
    ): Promise<void> => {
        const [isValid, reason, applyFee] = await forgeValidator.validateRedemption(
            basket.failed,
            simpleToExactAmount(basket.totalSupply, 18),
            bAssets.map((b) =>
                createBasset(
                    b.maxWeight,
                    b.vaultUnits,
                    b.decimals,
                    b.status || BassetStatus.Normal,
                ),
            ),
            args.filter((a) => a.indexToRedeem !== undefined).map((a) => a.indexToRedeem),
            args.map((a) =>
                simpleToExactAmount(
                    a.redeemAmountUnits,
                    a.indexToRedeem === undefined || a.indexToRedeem >= bAssets.length
                        ? 18
                        : bAssets[a.indexToRedeem].decimals,
                ),
            ),
            { from: sender },
        );
        expect(result.expectedValidity).to.eq(isValid);
        expect(result.expectedReason).to.eq(reason);
        expect(result.expectFee).to.eq(applyFee);
    };

    context("validating a single redeem", async () => {
        // At target weight is defined when bAssetVaultUnits == (totalSupply * bAssetTarget)
        context("in a basket with no bAssets over max", async () => {
            it("returns valid for a simple validation", async () => {
                /**
                 * TotalSupply:     100e18
                 * MaxWeights:      [50, 50, 50, 50]
                 * BassetVaults:    [25, 25, 25, 25]
                 * RedeemIndex:     [  0]
                 * RedeemAmt:       [ 10]
                 */
                await assertRedeem(
                    setBasket(false, 100),
                    [setBasset(50, 25), setBasset(50, 25), setBasset(50, 25), setBasset(50, 25)],
                    [setArgs(0, 10)],
                    setResult(true),
                );
            });
            it("should work for any sender", async () => {
                /**
                 * TotalSupply:     100e18
                 * MaxWeights:      [50, 50, 50, 50]
                 * BassetVaults:    [25, 25, 25, 25]
                 * RedeemIndex:     [  0]
                 * RedeemAmt:       [ 10]
                 */
                await assertRedeem(
                    setBasket(false, 100),
                    [setBasset(50, 25), setBasset(50, 25), setBasset(50, 25), setBasset(50, 25)],
                    [setArgs(0, 10)],
                    setResult(true),
                    accounts[4],
                );
            });
            it("returns inValid if the bAsset does not exist", async () => {
                /**
                 * TotalSupply:     100e18
                 * MaxWeights:      [50, 50, 50, 50]
                 * BassetVaults:    [25, 25, 25, 25]
                 * RedeemIndex:     [  0]
                 * RedeemAmt:       [ 10]
                 */
                await assertRedeem(
                    setBasket(false, 100),
                    [setBasset(50, 25), setBasset(50, 25), setBasset(50, 25), setBasset(50, 25)],
                    [setArgs(4, 10)],
                    setResult(false, "Basset does not exist"),
                );
            });
            it("returns inValid if the bAsset vaultBalance is 0", async () => {
                /**
                 * TotalSupply:     100e18
                 * MaxWeights:      [50, 50]
                 * BassetVaults:    [ 0,  0]
                 * RedeemIndex:     [ 0]
                 * RedeemAmt:       [ 1]
                 */
                await assertRedeem(
                    setBasket(false, 100),
                    [setBasset(50, 0), setBasset(50, 0)],
                    [setArgs(0, 1)],
                    setResult(false, "Cannot redeem more bAssets than are in the vault"),
                );
            });
            describe("and the redemption causes other bAssets to go overweight", async () => {
                it("should fail", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [50, 50, 50, 50]
                     * BassetVaults:    [48, 30, 20,  2]
                     * RedeemIndex:     [ 1]
                     * RedeemAmt:       [ 15]
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(50, 48), setBasset(50, 30), setBasset(50, 20), setBasset(50, 2)],
                        [setArgs(1, 15)],
                        setResult(false, "bAssets must remain below max weight"),
                    );
                });
            });
            describe("using unexpected arguments", async () => {
                it("should return valid if there are no bAssets passed", async () => {
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(50, 25),
                            setBasset(50, 25),
                            setBasset(50, 25),
                            setBasset(50, 25),
                        ],
                        [],
                        setResult(true),
                    );
                });
                it("should fail if inputs are of unequal length", async () => {
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                        ],
                        [setArgs(undefined, 5), setArgs(1, 5)],
                        setResult(false, "Input arrays must have equal length"),
                    );
                });
            });
            describe("redeeming relatively largely amount of a bAsset", async () => {
                it("returns inValid if the bAsset quantity is greater than vault balance", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [50, 50, 50, 50]
                     * BassetVaults:    [40,  5, 15, 40]
                     * RedeemIndex:     1
                     * RedeemAmt:       6
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(50, 40), setBasset(50, 5), setBasset(50, 15), setBasset(50, 40)],
                        [setArgs(1, 6)],
                        setResult(false, "Cannot redeem more bAssets than are in the vault"),
                    );
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(50, 40), setBasset(50, 5), setBasset(50, 15), setBasset(50, 40)],
                        [setArgs(0, 10), setArgs(2, 21)],
                        setResult(false, "Cannot redeem more bAssets than are in the vault"),
                    );
                });
            });
            describe("using multiple bAssets as input", async () => {
                it("should succeed when using may inputs", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [10, 10, 10, 10...]
                     * BassetVaults:    [10, 10, 10, 10...]
                     * RedeemAmts:      [5, 6, 5, 5, 4,...]
                     * Redemption cause weights to deviate *within* the allowance
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(15, 10),
                            setBasset(15, 10),
                            setBasset(15, 10),
                            setBasset(15, 10),
                            setBasset(15, 10),
                            setBasset(15, 10),
                            setBasset(15, 10),
                            setBasset(15, 10),
                            setBasset(15, 10),
                            setBasset(15, 10),
                        ],
                        [
                            setArgs(0, 5),
                            setArgs(1, 6),
                            setArgs(2, 5),
                            setArgs(3, 4),
                            setArgs(4, 6),
                            setArgs(5, 5),
                            setArgs(6, 5),
                            setArgs(7, 5),
                            setArgs(8, 5),
                            setArgs(9, 5),
                        ],
                        setResult(true),
                    );
                });
                it("should fail if the inputs are of unequal length", async () => {
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                        ],
                        [setArgs(0, 1), setArgs(undefined, 6)],
                        setResult(false, "Input arrays must have equal length"),
                    );
                });
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [ 50,  50, 50]
                     * BassetVaults:    [ 48,  48,  4]
                     * RedeemIndex:     0
                     * RedeemAmt:       1
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(50, 48, 6), setBasset(50, 48, 12), setBasset(50, 4)],
                        [setArgs(0, 3)],
                        setResult(true),
                    );
                    // Pushes index 1 over it's implicit max
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(50, 48, 6), setBasset(50, 48, 12), setBasset(50, 4)],
                        [setArgs(0, 10)],
                        setResult(false, "bAssets must remain below max weight"),
                    );
                });
            });
            describe("and various redemption volumes", async () => {
                it("should be ok with 0 at all times", async () => {
                    /**
                     * TotalSupply:     114
                     * MaxWeights:      [50, 50, 50]
                     * BassetVaults:    [30, 44, 40]
                     * RedeemIndex:     0
                     * RedeemAmt:       0
                     * Doesn't change the basket composition at all
                     */
                    await assertRedeem(
                        setBasket(false, 114),
                        [setBasset(50, 30), setBasset(50, 44), setBasset(50, 40)],
                        [setArgs(0, 0)],
                        setResult(true),
                    );
                });
            });
        });
        context("in a basket with lots of bAssets (14)", async () => {
            it("should execute some basic validations", async () => {
                /**
                 * TotalSupply:     4000
                 * MaxWeights:      [40, 40, 20, 1....]
                 * BassetVaults:    [880, 800, 400, ...]
                 * RedeemIndex:     9
                 * RedeemAmt:       10
                 */
                await assertRedeem(
                    setBasket(false, 4000),
                    [
                        setBasset(40, 880),
                        setBasset(40, 800),
                        setBasset(20, 400),
                        setBasset(20, 400),
                        setBasset(20, 400),
                        setBasset(20, 400),
                        setBasset(10, 200),
                        setBasset(10, 200),
                        setBasset(5, 80),
                        setBasset(5, 80),
                        setBasset(5, 80),
                        setBasset(5, 80),
                    ],
                    [setArgs(9, 10)],
                    setResult(true),
                );
                await assertRedeem(
                    setBasket(false, 4000),
                    [
                        setBasset(40, 880),
                        setBasset(40, 800),
                        setBasset(20, 400),
                        setBasset(20, 400),
                        setBasset(20, 400),
                        setBasset(20, 400),
                        setBasset(10, 200),
                        setBasset(10, 200),
                        setBasset(5, 80),
                        setBasset(5, 80),
                        setBasset(5, 80),
                        setBasset(5, 80),
                    ],
                    [setArgs(0, 400)],
                    setResult(true),
                );
            });
        });
        context("in a basket with some bAssets overweight", async () => {
            describe("redeeming a non overweight bAsset", async () => {
                it("should always return invalid", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [20, 40, 40, 40]
                     * BassetVaults:    [37, 21, 21, 21]
                     * RedeemIndex:     0
                     * RedeemAmt:       10
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(20, 37),
                            setBasset(40, 21),
                            setBasset(40, 21),
                            setBasset(40, 21),
                        ],
                        [setArgs(1, 1)],
                        setResult(false, "Must redeem overweight bAssets"),
                    );
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(20, 37),
                            setBasset(40, 21),
                            setBasset(40, 21),
                            setBasset(40, 21),
                        ],
                        [setArgs(2, 1)],
                        setResult(false, "Must redeem overweight bAssets"),
                    );
                });
            });
            describe("redeeming some overweight bAssets", async () => {
                it("should fail if we don't redeem all overweight", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [40, 40, 40, 40]
                     * BassetVaults:    [48, 45, 5,  2]
                     * RedeemIndex:     [ 0]
                     * RedeemAmt:       [ 5]
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(40, 48), setBasset(40, 45), setBasset(40, 5), setBasset(40, 2)],
                        [setArgs(0, 5)],
                        setResult(false, "Redemption must contain all overweight bAssets"),
                    );
                });
                it("should fail if we redeem the same count but some aren't overweight", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [40, 40, 40, 40]
                     * BassetVaults:    [48, 45, 5,  2]
                     * RedeemIndex:     [ 0]
                     * RedeemAmt:       [ 5]
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(40, 48), setBasset(40, 45), setBasset(40, 5), setBasset(40, 2)],
                        [setArgs(0, 5), setArgs(2, 1)],
                        setResult(false, "Must redeem overweight bAssets"),
                    );
                });
            });
            describe("redeeming ALL overweight bAssets", async () => {
                it("should return valid, so long as others don't go overweight", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [40, 40, 40, 40]
                     * BassetVaults:    [48, 45, 5,  2]
                     * RedeemIndex:     [ 0, 1]
                     * RedeemAmt:       [ 2, 3]
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(40, 48), setBasset(40, 45), setBasset(40, 5), setBasset(40, 2)],
                        [setArgs(0, 2), setArgs(1, 3)],
                        setResult(true, "", false),
                    );
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(40, 48), setBasset(20, 21), setBasset(30, 29), setBasset(40, 2)],
                        [setArgs(0, 20), setArgs(1, 10)],
                        setResult(false, "bAssets must remain below max weight"),
                    );
                });
                it("should still allow the redemption if some other bAsset is breached", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [40, 20, 30, 40]
                     * BassetVaults:    [48, 21, 29,  2]
                     * RedeemIndex:     [    0,    1]
                     * RedeemAmt:       [ .001, .001]
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [setBasset(40, 48), setBasset(20, 21), setBasset(30, 29), setBasset(40, 2)],
                        [setArgs(0, "0.001"), setArgs(1, "0.001")],
                        setResult(true, "", false),
                    );
                });
            });
        });
        context("in a basket with bAssets nearing threshold (max weight breached)", async () => {
            it("allows redemption as long as nothing goes overweight", async () => {
                /**
                 * TotalSupply:     100e18
                 * MaxWeights:      [  40, 40,   40, 40]
                 * BassetVaults:    [39.5, 30, 10.5, 20]
                 * RedeemIndex:     [ 0]
                 * RedeemAmt:       [ 1]
                 * bAsset 0 is breached as it is within 1% of max
                 */
                await assertRedeem(
                    setBasket(false, 100),
                    [
                        setBasset(40, "39.5"),
                        setBasset(40, 30),
                        setBasset(40, "10.5"),
                        setBasset(40, 20),
                    ],
                    [setArgs(0, 10)],
                    setResult(true, "", true),
                );
                await assertRedeem(
                    setBasket(false, 100),
                    [
                        setBasset(40, "39.5"),
                        setBasset(40, 30),
                        setBasset(40, "10.5"),
                        setBasset(40, 20),
                    ],
                    [setArgs(1, 3)],
                    setResult(false, "bAssets must remain below max weight"),
                );
            });
            describe("and using multiple inputs", async () => {
                it("still fails", async () => {
                    /**
                     * TotalSupply:     100e18
                     * MaxWeights:      [  40, 40,   40, 40]
                     * BassetVaults:    [39.5, 30, 10.5, 20]
                     * RedeemIndex:     [ 0, 3]
                     * RedeemAmt:       [ 1, 3]
                     * bAsset 0 is breached as it is within 1% of max
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(40, "39.5"),
                            setBasset(40, 30),
                            setBasset(40, "10.5"),
                            setBasset(40, 20),
                        ],
                        [setArgs(0, 5), setArgs(3, 3)],
                        setResult(true, "", true),
                    );
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(40, "39.5"),
                            setBasset(40, 30),
                            setBasset(40, "10.5"),
                            setBasset(40, 20),
                        ],
                        [setArgs(0, 1), setArgs(1, 7)],
                        setResult(false, "bAssets must remain below max weight"),
                    );
                });
            });
        });
        context("in a basket with some affected bAssets", async () => {
            context("where some bAssets are liquidating, above or below peg", async () => {
                it("forces proportional using multiple bAssets", async () => {
                    /**
                     * TotalSupply:     100
                     * MaxWeights:      [ 40, 40, 40, 40]
                     * BassetVaults:    [ 30, 30, 20, 20]
                     * RedeemIndex:     [ 0]
                     * RedeemAmt:       [ 1]
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(40, 30),
                            setBasset(40, 30, 18, BassetStatus.Liquidating),
                            setBasset(40, 20),
                            setBasset(40, 20),
                        ],
                        [setArgs(0, 1)],
                        setResult(false, "Must redeem proportionately"),
                    );
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(40, 30, 12, BassetStatus.BrokenAbovePeg),
                            setBasset(40, 30, 6),
                            setBasset(40, 20),
                            setBasset(40, 20),
                        ],
                        [setArgs(0, 1)],
                        setResult(false, "Must redeem proportionately"),
                    );
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(40, 30),
                            setBasset(40, 30, 6),
                            setBasset(40, 20),
                            setBasset(40, 20, 12, BassetStatus.BrokenBelowPeg),
                        ],
                        [setArgs(0, 1)],
                        setResult(false, "Must redeem proportionately"),
                    );
                });
            });
            context("where some bAsset is blacklisted", async () => {
                it("fails if we try to redeem anything", async () => {
                    /**
                     * TotalSupply:     100
                     * MaxWeights:      [ 40, 40, 40, 40]
                     * BassetVaults:    [ 30, 30, 20, 20]
                     * RedeemIndex:     [ 0]
                     * RedeemAmt:       [ 1]
                     */
                    await assertRedeem(
                        setBasket(false, 100),
                        [
                            setBasset(40, 30),
                            setBasset(40, 30, 18, BassetStatus.Blacklisted),
                            setBasset(40, 20),
                            setBasset(40, 20),
                        ],
                        [setArgs(0, 1)],
                        setResult(false, "Basket contains blacklisted bAsset"),
                    );
                });
            });
        });
        context("in an affected basket", async () => {
            describe("when the basket has failed", async () => {
                it("always enforces proportional redemption", async () => {
                    /**
                     * TotalSupply:     100
                     * MaxWeights:      [ 40, 40, 40, 40]
                     * BassetVaults:    [ 30, 30, 20, 20]
                     * RedeemIndex:     [ 0]
                     * RedeemAmt:       [ 1]
                     */
                    await assertRedeem(
                        setBasket(true, 100),
                        [
                            setBasset(40, 30),
                            setBasset(40, 30),
                            setBasset(40, 20),
                            setBasset(40, 20),
                        ],
                        [setArgs(0, 1)],
                        setResult(false, "Must redeem proportionately"),
                    );
                });
            });
        });
    });

    context("calculating a multi redeem", async () => {
        const assertRedeemCalc = async (
            exactMassetQ: BN,
            bAssets: BassetDeets[],
            result: CalcResult,
            sender: string = accounts[0],
        ): Promise<void> => {
            // Calculate the exact expected amounts from a simple amount
            // If result is expected false, just stub the array with 0s
            const exactExpectedQs = !result.expectedValidity
                ? bAssets.map(() => new BN(0))
                : result.expectedQs.map((q, i) =>
                      result.exact ? new BN(q) : simpleToExactAmount(q, bAssets[i].decimals),
                  );
            const bAssetObj = bAssets.map((b) =>
                createBasset(
                    b.maxWeight,
                    b.vaultUnits,
                    b.decimals,
                    b.status || BassetStatus.Normal,
                ),
            );
            const [isValid, reason, bassetQs] = await forgeValidator.calculateRedemptionMulti(
                exactMassetQ,
                bAssetObj,
                {
                    from: sender,
                },
            );
            expect(result.expectedValidity).to.eq(isValid);
            expect(result.expectedReason).to.eq(reason);
            const expectedLen = exactExpectedQs.length;
            expect(expectedLen).to.eq(exactExpectedQs.length);
            if (expectedLen > 0) {
                exactExpectedQs.map((q, i) => expect(q).bignumber.eq(new BN(bassetQs[i])));
                const sumOfRatioedBassets = exactExpectedQs.reduce(
                    (p, c, i) => p.add(c.mul(new BN(bAssetObj[i].ratio)).div(ratioScale)),
                    new BN(0),
                );
                // Important - assert that the sum of the returned values is LT massetQ input
                expect(exactMassetQ).bignumber.gte(sumOfRatioedBassets as any);
            }
        };

        context("in a basket with normal collateral levels", async () => {
            it("returns proportional quantities", async () => {
                /**
                 * MassetQ:         10
                 * MaxWeights:      [50, 50, 50, 50]
                 * BassetVaults:    [25, 25, 25, 25]
                 * TotalSupply:     100
                 */
                await assertRedeemCalc(
                    simpleToExactAmount(10, 18),
                    [setBasset(50, 25), setBasset(50, 25), setBasset(50, 25), setBasset(50, 25)],
                    setCalcResult(true, "", [2.5, 2.5, 2.5, 2.5]),
                );
            });
            it("returns 100% if there is only 1 asset", async () => {
                /**
                 * MassetQ:         10
                 * MaxWeights:      [100]
                 * BassetVaults:    [100]
                 * TotalSupply:     100
                 */
                await assertRedeemCalc(
                    simpleToExactAmount(10, 18),
                    [setBasset(100, 100, 6)],
                    setCalcResult(true, "", [10]),
                );
            });
            it("should work for any sender", async () => {
                /**
                 * MassetQ:         10
                 * MaxWeights:      [50, 50, 50, 50]
                 * BassetVaults:    [25, 25, 25, 25]
                 * TotalSupply:     100
                 */
                await assertRedeemCalc(
                    simpleToExactAmount(10, 18),
                    [setBasset(50, 25), setBasset(50, 25), setBasset(50, 25), setBasset(50, 25)],
                    setCalcResult(true, "", [2.5, 2.5, 2.5, 2.5]),
                    accounts[4],
                );
            });
            describe("using unexpected arguments", async () => {
                it("should return 0 if 0 mAsset is passed", async () => {
                    /**
                     * MassetQ:         0
                     * MaxWeights:      [50, 50, 50, 50]
                     * BassetVaults:    [25, 25, 25, 25]
                     * TotalSupply:     100
                     */
                    await assertRedeemCalc(
                        new BN(0),
                        [
                            setBasset(50, 25),
                            setBasset(50, 25),
                            setBasset(50, 25),
                            setBasset(50, 25),
                        ],
                        setCalcResult(true, "", [0, 0, 0, 0]),
                    );
                });
                it("should fail if mAsset Q is greater than sum of bAssets", async () => {
                    /**
                     * MassetQ:         105
                     * MaxWeights:      [50, 50, 50, 50]
                     * BassetVaults:    [25, 25, 25, 25]
                     * TotalSupply:     100
                     */
                    await assertRedeemCalc(
                        simpleToExactAmount(105, 18),
                        [
                            setBasset(50, 25),
                            setBasset(50, 25),
                            setBasset(50, 25),
                            setBasset(50, 25),
                        ],
                        setCalcResult(false, "Not enough liquidity"),
                    );
                });
                it("should fail if no bAssets are passed", async () => {
                    /**
                     * MassetQ:         1
                     * MaxWeights:      []
                     * BassetVaults:    []
                     */
                    await assertRedeemCalc(
                        simpleToExactAmount(1, 18),
                        [],
                        setCalcResult(false, "Nothing in the basket to redeem"),
                    );
                });
            });
            describe("redeeming relatively largely amount of mAsset", async () => {
                it("returns proportional quantities", async () => {
                    /**
                     * MassetQ:         220
                     * MaxWeights:      [ 50,  50,  50,  50]
                     * BassetVaults:    [100, 150, 125, 125]
                     * TotalSupply:     500
                     */
                    await assertRedeemCalc(
                        simpleToExactAmount(220, 18),
                        [
                            setBasset(50, 100, 6),
                            setBasset(50, 150),
                            setBasset(50, 125, 12),
                            setBasset(50, 125),
                        ],
                        setCalcResult(true, "", [44, 66, 55, 55]),
                    );
                });
                it("returns inValid if the mAsset quantity is greater than vault balance", async () => {
                    /**
                     * MassetQ:         501
                     * MaxWeights:      [ 50,  50,  50,  50]
                     * BassetVaults:    [100, 150, 125, 125]
                     * TotalSupply:     500
                     */
                    await assertRedeemCalc(
                        simpleToExactAmount(501, 18),
                        [
                            setBasset(50, 100, 6),
                            setBasset(50, 150),
                            setBasset(50, 125, 12),
                            setBasset(50, 125),
                        ],
                        setCalcResult(false, "Not enough liquidity"),
                    );
                });
            });
            describe("and various decimals", async () => {
                it("should still calculate accurately", async () => {
                    /**
                     * MassetQ:         12345
                     * MaxWeights:      [ 50,  50,  50,  50]
                     * BassetVaults:    [300k, 400k, 50k, 650k]
                     * TotalSupply:     1400000
                     */
                    await assertRedeemCalc(
                        simpleToExactAmount(12345, 18),
                        [
                            setBasset(50, 300000),
                            setBasset(50, 400000, 6),
                            setBasset(50, 50000, 12),
                            setBasset(50, 650000),
                        ],
                        setCalcResult(
                            true,
                            "",
                            [
                                new BN("2645357142857142848325"),
                                new BN("3527142857"),
                                new BN("440892857142857"),
                                new BN("5731607142857142848325"),
                            ],
                            true,
                        ),
                    );
                });
                it("should round down everything if the return amounts are low", async () => {
                    /**
                     * MassetQ:         1
                     * MaxWeights:      [ 50,  50,  50,  50]
                     * BassetVaults:    [100, 100, 100, 100]
                     * TotalSupply:     400
                     */
                    await assertRedeemCalc(
                        new BN(1),
                        [
                            setBasset(50, 100, 6),
                            setBasset(50, 100),
                            setBasset(50, 100, 12),
                            setBasset(50, 100),
                        ],
                        setCalcResult(true, "", [0, 0, 0, 0]),
                    );
                });
                it("should round down if the return amount has a fraction", async () => {
                    /**
                     * MassetQ:         5
                     * MaxWeights:      [50, 50, 50, 50]
                     * BassetVaults:    [25, 25, 25, 25]
                     * TotalSupply:     100
                     */
                    await assertRedeemCalc(
                        new BN(5),
                        [
                            setBasset(50, 25, 6),
                            setBasset(50, 25),
                            setBasset(50, 25, 12),
                            setBasset(50, 25),
                        ],
                        setCalcResult(true, "", [0, 1, 0, 1], true),
                    );
                });
            });
        });
        context("in a fresh basket", async () => {
            it("returns inValid if the total bAsset vaultBalance is 0", async () => {
                /**
                 * MassetQ:         1
                 * MaxWeights:      [50, 50, 50, 50]
                 * BassetVaults:    [0, 0, 0, 0]
                 * TotalSupply:     100
                 */
                await assertRedeemCalc(
                    new BN(1),
                    [setBasset(50, 0), setBasset(50, 0), setBasset(50, 0), setBasset(50, 0)],
                    setCalcResult(false, "Nothing in the basket to redeem"),
                );
            });
        });
        context("in a basket with lots of bAssets (14)", async () => {
            it("should do normal calculations", async () => {
                /**
                 * MassetQ:         100e18
                 * MaxWeights:      [20, 20, ... (10)]
                 * BassetVaults:    [100, 100, ... (10)]
                 * TotalSupply:     1000
                 */
                await assertRedeemCalc(
                    simpleToExactAmount(100, 18),
                    [
                        setBasset(20, 100, 8),
                        setBasset(20, 100),
                        setBasset(20, 100, 16),
                        setBasset(20, 100),
                        setBasset(20, 100, 4),
                        setBasset(20, 100),
                        setBasset(20, 100),
                        setBasset(20, 100, 14),
                        setBasset(20, 100),
                        setBasset(20, 100),
                    ],
                    setCalcResult(true, "", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
                );
            });
            it("should do normal calculations", async () => {
                /**
                 * MassetQ:         140
                 * BassetVaults:    [200, 150, 150, 150, 75, 50, 25, 10]
                 * TotalSupply:     810
                 */
                await assertRedeemCalc(
                    simpleToExactAmount(140, 18),
                    [
                        setBasset(20, 200, 8),
                        setBasset(20, 150),
                        setBasset(20, 150, 16),
                        setBasset(20, 150),
                        setBasset(20, 75, 4),
                        setBasset(20, 50),
                        setBasset(20, 25),
                        setBasset(20, 10, 14),
                        setBasset(20, 0, 14),
                    ],
                    setCalcResult(
                        true,
                        "",
                        [
                            new BN("3456790123"),
                            new BN("25925925925925925900"),
                            new BN("259259259259259259"),
                            new BN("25925925925925925900"),
                            new BN("129629"),
                            new BN("8641975308641975300"),
                            new BN("4320987654320987580"),
                            new BN("172839506172839"),
                            new BN("0"),
                        ],
                        true,
                    ),
                );
            });
        });

        context("in a basket with high collateral levels", async () => {
            it("returns proportional quantities", async () => {
                /**
                 * MassetQ:         100k
                 * BassetVaults:    [2.5m, 2.5m, 4m, 1m]
                 * TotalSupply:     10m
                 */
                await assertRedeemCalc(
                    simpleToExactAmount(100000, 18),
                    [
                        setBasset(50, 2500000),
                        setBasset(50, 2500000),
                        setBasset(50, 4000000),
                        setBasset(50, 1000000),
                    ],
                    setCalcResult(true, "", [25000, 25000, 40000, 10000]),
                );
            });
            it("returns proportional quantities", async () => {
                /**
                 * MassetQ:         500k
                 * BassetVaults:    [6m, 4m, 5.5m, 7m, 2.5m, 0]
                 * TotalSupply:     25m
                 */
                await assertRedeemCalc(
                    simpleToExactAmount(500000, 18),
                    [
                        setBasset(50, 6000000),
                        setBasset(50, 4000000),
                        setBasset(50, 5500000),
                        setBasset(50, 7000000),
                        setBasset(50, 2500000),
                        setBasset(50, 0),
                    ],
                    setCalcResult(
                        true,
                        "",
                        [
                            simpleToExactAmount("1.2", 23),
                            simpleToExactAmount("0.8", 23),
                            simpleToExactAmount("1.1", 23),
                            simpleToExactAmount("1.4", 23),
                            simpleToExactAmount("5", 22),
                            0,
                        ],
                        true,
                    ),
                );
            });
        });
        context("in a basket with some affected bAssets", async () => {
            context("where some bAssets are liquidating", async () => {
                it("fails", async () => {
                    await assertRedeemCalc(
                        simpleToExactAmount(10, 18),
                        [
                            setBasset(50, 25, 6, BassetStatus.Liquidating),
                            setBasset(50, 25),
                            setBasset(50, 25),
                            setBasset(50, 25),
                        ],
                        setCalcResult(false, "Basket contains liquidating bAsset"),
                    );
                });
            });
            context("where some bAsset is blacklisted", async () => {
                it("fails", async () => {
                    await assertRedeemCalc(
                        simpleToExactAmount(10, 18),
                        [
                            setBasset(50, 25),
                            setBasset(50, 25),
                            setBasset(50, 25, 6, BassetStatus.Blacklisted),
                            setBasset(50, 25),
                        ],
                        setCalcResult(false, "Basket contains blacklisted bAsset"),
                    );
                });
            });
            context("where some bAsset has another status", async () => {
                it("returns proportional amounts", async () => {
                    await assertRedeemCalc(
                        simpleToExactAmount(10, 18),
                        [
                            setBasset(50, 25),
                            setBasset(50, 25),
                            setBasset(50, 25, 6, BassetStatus.BrokenAbovePeg),
                            setBasset(50, 25),
                        ],
                        setCalcResult(true, "", [2.5, 2.5, 2.5, 2.5]),
                    );
                    await assertRedeemCalc(
                        simpleToExactAmount(10, 18),
                        [
                            setBasset(50, 25),
                            setBasset(50, 25, 12, BassetStatus.BrokenAbovePeg),
                            setBasset(50, 25),
                            setBasset(50, 25),
                        ],
                        setCalcResult(true, "", [2.5, 2.5, 2.5, 2.5]),
                    );
                    await assertRedeemCalc(
                        simpleToExactAmount(10, 18),
                        [
                            setBasset(50, 25),
                            setBasset(50, 25, 12, BassetStatus.Liquidated),
                            setBasset(50, 25),
                            setBasset(50, 25),
                        ],
                        setCalcResult(true, "", [2.5, 2.5, 2.5, 2.5]),
                    );
                });
            });
        });
    });
});
