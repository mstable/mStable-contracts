import { simpleToExactAmount } from "@utils/math";
import { createBasset, BassetStatus } from "@utils/mstable-objects";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";

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

    it("forces proportional using multiple bAssets", async () => {});

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
                it("should fail");
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
                        setResult(false, "Input arrays should be equal"),
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
                        setResult(false, "Input arrays should be equal"),
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
                it("should fail if we don't redeem all overweight");
                it("should fail if we don't redeem the same count");
                it("should fail if we redeem the same count but some aren't overweight");
            });
            describe("redeeming ALL overweight bAssets", async () => {
                it("should return valid, so long as others don't go overweight");
                describe("and some bAssets have their max weight breached", async () => {
                    it("should still allow the redemption if all overweights are redeemed");
                });
            });
        });
        context("in a basket with bAssets nearing threshold (max weight breached)", async () => {
            // NONE overweight!
            it("enforces proportional redemption");
            describe("and using multiple inputs", async () => {
                it("still fails");
            });
            // it("returns valid if redemption pushes some other bAsset overweight", async () => {
            //     /**
            //      * TotalSupply:     100e18
            //      * MaxWeights:      [25, 25, 25, 25]
            //      * BassetVaults:    [25, 21, 29, 25]
            //      * RedeemIndex:     3
            //      * RedeemAmt:       5
            //      * Index 2 will go over weight
            //      */
            //     await assertRedeem(
            //         setBasket(false, 100),
            //         [setBasset(25, 25), setBasset(25, 21), setBasset(25, 29), setBasset(25, 25)],
            //         [setArgs(3, 5)],
            //         setResult(true),
            //     );
            // });
        });
        context("in a basket with some affected bAssets", async () => {
            context("where some bAssets are liquidating, above or below peg", async () => {
                it("forces proportional using multiple bAssets");
                it("always forces proportional redemption", async () => {
                    //     /**
                    //      * TotalSupply:     100e18
                    //      * MaxWeights:      [25, 25, 25, 25]
                    //      * BassetVaults:    [25, 25, 25, 25]
                    //      * Statuses:        [N, L, N, N]
                    //      * RedeemIndex:     0
                    //      * RedeemAmt:       1
                    //      */
                    //     await assertRedeem(
                    //         setBasket(false, 100),
                    //         [
                    //             setBasset(25, 25),
                    //             setBasset(25, 25, 18, BassetStatus.Liquidating),
                    //             setBasset(25, 25),
                    //             setBasset(25, 25),
                    //         ],
                    //         [setArgs(0, 1)],
                    //         setResult(false, "bAssets undergoing liquidation"),
                    //     );
                    //     await assertRedeem(
                    //         setBasket(false, 100),
                    //         [
                    //             setBasset(25, 25),
                    //             setBasset(25, 25, 18, BassetStatus.BrokenBelowPeg),
                    //             setBasset(25, 25),
                    //             setBasset(25, 25),
                    //         ],
                    //         [setArgs(0, 1)],
                    //         setResult(false, "bAssets undergoing liquidation"),
                    //     );
                });
            });
            context("where some bAsset is blacklisted", async () => {
                it("fails if we try to redeem anything");
            });
        });
        context("in an affected basket", async () => {
            describe("when the basket has failed", async () => {
                it("always enforces proportional redemption");
            });
        });
    });
});
