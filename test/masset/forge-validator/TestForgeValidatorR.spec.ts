import * as t from "types/generated";

import { simpleToExactAmount } from "@utils/math";
import { createBasset, BassetStatus } from "@utils/mstable-objects";

import envSetup from "@utils/env_setup";

const { expect } = envSetup.configure();

const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

interface BasketDeets {
    failed: boolean;
    totalSupply: number | string;
    deviationAllowanceUnits: number | string;
}
const setBasket = (
    failed: boolean,
    totalSupply: number | string,
    deviationAllowanceUnits: number | string,
): BasketDeets => {
    return {
        failed,
        totalSupply,
        deviationAllowanceUnits,
    };
};
interface BassetDeets {
    target: number | string;
    vaultUnits: number | string;
    decimals: number;
    status: BassetStatus;
}
const setBasset = (
    target: number | string,
    vaultUnits: number | string,
    decimals = 18,
    status: BassetStatus = BassetStatus.Normal,
): BassetDeets => {
    return {
        target,
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
}
const setResult = (expectedValidity: boolean, expectedReason = ""): Result => {
    return {
        expectedValidity,
        expectedReason,
    };
};

contract("ForgeValidator", async (accounts) => {
    let forgeValidator: t.ForgeValidatorInstance;

    before("Init contract", async () => {
        forgeValidator = await ForgeValidatorArtifact.new();
    });

    const assertSingleRedeem = async (
        basket: BasketDeets,
        bAssets: BassetDeets[],
        args: Args,
        result: Result,
        sender: string = accounts[0],
    ): Promise<void> => {
        const invalidIndex = args.indexToRedeem >= bAssets.length;
        const [isValid, reason] = await forgeValidator.validateRedemption(
            basket.failed,
            simpleToExactAmount(basket.totalSupply, 18),
            bAssets.map((b) =>
                createBasset(b.target, b.vaultUnits, b.decimals, b.status || BassetStatus.Normal),
            ),
            simpleToExactAmount(basket.deviationAllowanceUnits, 18),
            args.indexToRedeem,
            simpleToExactAmount(
                args.redeemAmountUnits,
                invalidIndex ? 18 : bAssets[args.indexToRedeem].decimals,
            ),
            { from: sender },
        );
        expect(result.expectedValidity).to.eq(isValid);
        expect(result.expectedReason).to.eq(reason);
    };

    context("validating a single redeem", async () => {
        // At target weight is defined when bAssetVaultUnits == (totalSupply * bAssetTarget)
        context("in a basket with bAssets conforming to targets", async () => {
            it("returns valid for a simple validation that remains within the grace threshold", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           1e18
                 * BassetTargets:   [100]
                 * BassetVaults:    [100]
                 * RedeemIndex:     0
                 * RedeemAmt:       10e18
                 */
                await assertSingleRedeem(
                    setBasket(false, 100, 1),
                    [setBasset(100, 100)],
                    setArgs(0, 10),
                    setResult(true),
                );
            });
            it("should work for any sender", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           1e18
                 * BassetTargets:   [100]
                 * BassetVaults:    [100]
                 * RedeemIndex:     0
                 * RedeemAmt:       10e18
                 */
                await assertSingleRedeem(
                    setBasket(false, 100, 1),
                    [setBasset(100, 100)],
                    setArgs(0, 10),
                    setResult(true),
                    accounts[4],
                );
            });
            it("returns inValid if the bAsset does not exist", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           1e18
                 * BassetTargets:   [100]
                 * BassetVaults:    [100]
                 * RedeemIndex:     0
                 * RedeemAmt:       10e18
                 */
                await assertSingleRedeem(
                    setBasket(false, 100, 1),
                    [setBasset(100, 100)],
                    setArgs(1, 10),
                    setResult(false, "Basset does not exist"),
                );
            });
            it("returns inValid if the bAsset vaultBalance is 0", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           10e18
                 * BassetTargets:   [50, 50]
                 * BassetVaults:    [0, 0]
                 * RedeemIndex:     0
                 * RedeemAmt:       1
                 */
                await assertSingleRedeem(
                    setBasket(false, 100, 10),
                    [setBasset(50, 0), setBasset(50, 0)],
                    setArgs(0, 1),
                    setResult(false, "Cannot redeem more bAssets than are in the vault"),
                );
            });

            describe("redeeming relatively largely amount of a bAsset", async () => {
                it("returns inValid if redemption pushes bAsset underweight", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           1e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * RedeemIndex:     0
                     * RedeemAmt:       2
                     * Failed: Because resulting weighting is 23/98, where target is 24.5
                     * and grace = 1, so implicit min = 23.5
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 1),
                        [
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                        ],
                        setArgs(0, 2),
                        setResult(false, "bAssets must remain above implicit min weight"),
                    );
                });
                it("returns inValid if the bAsset quantity is greater than vault balance", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           10e18
                     * BassetTargets:   [95, 5]
                     * BassetVaults:    [95, 5]
                     * RedeemIndex:     1
                     * RedeemAmt:       6
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 10),
                        [setBasset(95, 95), setBasset(5, 5)],
                        setArgs(1, 6),
                        setResult(false, "Cannot redeem more bAssets than are in the vault"),
                    );
                });
            });

            describe("with a variable grace", async () => {
                it("should succeed with sufficient grace", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           4e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * RedeemIndex:     0
                     * RedeemAmt:       7
                     * ResultingWeight: 17/93, where new target is 23.25
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 4),
                        [
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                            setBasset(25, 25),
                        ],
                        setArgs(0, 7),
                        setResult(false, "bAssets must remain above implicit min weight"),
                    );
                    // Change grace to 5
                    await assertSingleRedeem(
                        setBasket(false, 100, 5),
                        [setBasset(50, 50), setBasset(50, 50)],
                        setArgs(0, 10),
                        setResult(true),
                    );
                });
                it("should always fail with 0 grace", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           0
                     * BassetTargets:   [50, 50]
                     * BassetVaults:    [50, 50]
                     * RedeemIndex:     0
                     * RedeemAmt:       1
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 0),
                        [setBasset(50, 50), setBasset(50, 50)],
                        setArgs(0, 1),
                        setResult(false, "bAssets must remain above implicit min weight"),
                    );
                });
                it("should allow anything at a high grace", async () => {
                    /**
                     * TotalSupply:     1000e18
                     * Grace:           1000e18
                     * BassetTargets:   [ 50,  50]
                     * BassetVaults:    [500, 500]
                     * RedeemIndex:     0
                     * RedeemAmt:       500
                     */
                    await assertSingleRedeem(
                        setBasket(false, 1000, 5000),
                        [setBasset(50, 500), setBasset(50, 500)],
                        setArgs(0, 500),
                        setResult(true),
                    );
                });
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           1e18
                     * BassetTargets:   [ 50,  50]
                     * BassetVaults:    [ 50,  50]
                     * RedeemIndex:     0
                     * RedeemAmt:       1
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 1),
                        [setBasset(50, 50, 6), setBasset(50, 50, 12)],
                        setArgs(0, 2),
                        setResult(true),
                    );
                    // Pushes index 1 over it's implicit max
                    await assertSingleRedeem(
                        setBasket(false, 100, 1),
                        [setBasset(50, 50, 6), setBasset(50, 50, 12)],
                        setArgs(0, 3),
                        setResult(false, "bAssets must remain above implicit min weight"),
                    );
                });
            });
            describe("and various redemption volumes", async () => {
                it("should be ok with 0 at all times", async () => {
                    /**
                     * TotalSupply:     138e18
                     * Grace:           0
                     * BassetTargets:   [50, 50]
                     * BassetVaults:    [69, 69]
                     * RedeemIndex:     0
                     * RedeemAmt:       0
                     * Doesn't change the basket composition at all
                     */
                    await assertSingleRedeem(
                        setBasket(false, 138, 0),
                        [setBasset(50, 69), setBasset(50, 69)],
                        setArgs(0, 0),
                        setResult(true),
                    );
                });
                it("should fail once redemption volume triggers grace", async () => {
                    /**
                     * TotalSupply:     138e18
                     * Grace:           1e18
                     * BassetTargets:   [50, 50]
                     * BassetVaults:    [69, 69]
                     * RedeemIndex:     0
                     * RedeemAmt:       0
                     */
                    await assertSingleRedeem(
                        setBasket(false, 138, 1),
                        [setBasset(50, 69), setBasset(50, 69)],
                        setArgs(0, 1),
                        setResult(true),
                    );
                    await assertSingleRedeem(
                        setBasket(false, 138, 1),
                        [setBasset(50, 69), setBasset(50, 69)],
                        setArgs(0, 3),
                        setResult(false, "bAssets must remain above implicit min weight"),
                    );
                });
            });
        });
        context("in a basket with lots of bAssets (14)", async () => {
            it("should execute some basic validations", async () => {
                /**
                 * TotalSupply:     4000e18
                 * Grace:           10e18
                 * BassetTargets:   [20, 20, 10, 10, 10, 10, 5, 5, 2, 2, 2, 2, 1, 1]
                 * BassetVaults:    [800, 800, 400, ...]
                 * RedeemIndex:     9
                 * RedeemAmt:       10
                 */
                await assertSingleRedeem(
                    setBasket(false, 4000, 10),
                    [
                        setBasset(20, 800),
                        setBasset(20, 800),
                        setBasset(10, 400),
                        setBasset(10, 400),
                        setBasset(10, 400),
                        setBasset(10, 400),
                        setBasset(5, 200),
                        setBasset(5, 200),
                        setBasset(2, 80),
                        setBasset(2, 80),
                        setBasset(2, 80),
                        setBasset(2, 80),
                        setBasset(1, 40),
                        setBasset(1, 40),
                    ],
                    setArgs(9, 10),
                    setResult(true),
                );
                await assertSingleRedeem(
                    setBasket(false, 4000, 10),
                    [
                        setBasset(20, 800),
                        setBasset(20, 800),
                        setBasset(10, 400),
                        setBasset(10, 400),
                        setBasset(10, 400),
                        setBasset(10, 400),
                        setBasset(5, 200),
                        setBasset(5, 200),
                        setBasset(2, 80),
                        setBasset(2, 80),
                        setBasset(2, 80),
                        setBasset(2, 80),
                        setBasset(1, 40),
                        setBasset(1, 40),
                    ],
                    setArgs(9, 15),
                    setResult(false, "bAssets must remain above implicit min weight"),
                );
            });
        });
        context("in a basket with some bAssets underweight", async () => {
            describe("and redeeming underweight bAsset", async () => {
                it("always returns invalid", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           3e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [19, 27, 27, 27]
                     * RedeemIndex:     0
                     * RedeemAmt:       0
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 3),
                        [
                            setBasset(25, 19),
                            setBasset(25, 27),
                            setBasset(25, 27),
                            setBasset(25, 27),
                        ],
                        setArgs(0, 1),
                        setResult(false, "bAssets must remain above implicit min weight"),
                    );
                });
                it("returns invalid with a 0 quantity input", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           3e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [19, 27, 27, 27]
                     * RedeemIndex:     0
                     * RedeemAmt:       0
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 3),
                        [
                            setBasset(25, 19),
                            setBasset(25, 27),
                            setBasset(25, 27),
                            setBasset(25, 27),
                        ],
                        setArgs(0, 0),
                        setResult(false, "bAssets must remain above implicit min weight"),
                    );
                });
            });
            describe("and redeeming a non-underweight bAsset", async () => {
                it("always is valid, so long as bAsset does not go beyond min", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           10e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [13, 25, 31, 31]
                     * RedeemIndex:     1
                     * RedeemAmt:       1
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 10),
                        [
                            setBasset(25, 13),
                            setBasset(25, 25),
                            setBasset(25, 31),
                            setBasset(25, 31),
                        ],
                        setArgs(1, 1),
                        setResult(true),
                    );
                    // Redeeming 14 puts target to 21.5 units, and vaultBalance to 21
                    await assertSingleRedeem(
                        setBasket(false, 100, 10),
                        [
                            setBasset(25, 13),
                            setBasset(25, 25),
                            setBasset(25, 31),
                            setBasset(25, 31),
                        ],
                        setArgs(1, 14),
                        setResult(false, "bAssets must remain above implicit min weight"),
                    );
                });
            });
        });
        context("in a basket with some bAssets overweight", async () => {
            describe("redeeming a non overweight bAsset", async () => {
                it("should always return invalid", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           10e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [37, 21, 21, 21]
                     * RedeemIndex:     0
                     * RedeemAmt:       10
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 10),
                        [
                            setBasset(25, 37),
                            setBasset(25, 21),
                            setBasset(25, 21),
                            setBasset(25, 21),
                        ],
                        setArgs(1, 1),
                        setResult(false, "Must redeem overweight bAssets"),
                    );
                    await assertSingleRedeem(
                        setBasket(false, 100, 10),
                        [
                            setBasset(25, 37),
                            setBasset(25, 21),
                            setBasset(25, 21),
                            setBasset(25, 21),
                        ],
                        setArgs(2, 1),
                        setResult(false, "Must redeem overweight bAssets"),
                    );
                });
            });
            describe("redeeming an overweight bAsset", async () => {
                it("should return valid, so long as we don't go underweight", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           10e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [37, 21, 21, 21]
                     * RedeemIndex:     0
                     * RedeemAmt:       10
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 10),
                        [
                            setBasset(25, 37),
                            setBasset(25, 21),
                            setBasset(25, 21),
                            setBasset(25, 21),
                        ],
                        setArgs(0, 29),
                        setResult(true),
                    );
                    // Redeeming more should push us under
                    await assertSingleRedeem(
                        setBasket(false, 100, 10),
                        [
                            setBasset(25, 37),
                            setBasset(25, 21),
                            setBasset(25, 21),
                            setBasset(25, 21),
                        ],
                        setArgs(0, 30),
                        setResult(false, "bAssets must remain above implicit min weight"),
                    );
                });
            });
        });
        context("in a basket with bAssets nearing threshold", async () => {
            it("returns valid if redemption pushes some other bAsset overweight", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           5e18
                 * BassetTargets:   [25, 25, 25, 25]
                 * BassetVaults:    [25, 21, 29, 25]
                 * RedeemIndex:     3
                 * RedeemAmt:       5
                 * Index 2 will go over weight
                 */
                await assertSingleRedeem(
                    setBasket(false, 100, 5),
                    [setBasset(25, 25), setBasset(25, 21), setBasset(25, 29), setBasset(25, 25)],
                    setArgs(3, 5),
                    setResult(true),
                );
            });
            it("always returns invalid until grace is increased", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           5e18
                 * BassetTargets:   [25, 25, 25, 25]
                 * BassetVaults:    [25, 21, 29, 25]
                 * RedeemIndex:     3
                 * RedeemAmt:       5
                 * Index 2 will go over weight
                 */
                await assertSingleRedeem(
                    setBasket(false, 100, 5),
                    [setBasset(25, 25), setBasset(25, 21), setBasset(25, 29), setBasset(25, 25)],
                    setArgs(3, 5),
                    setResult(true),
                );
            });
        });
        context("in a basket with some affected bAssets", async () => {
            context("with some bAssets liquidating or below peg", async () => {
                it("always returns invalid", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           5e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * Statuses:        [N, L, N, N]
                     * RedeemIndex:     0
                     * RedeemAmt:       1
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 5),
                        [
                            setBasset(25, 25),
                            setBasset(25, 25, 18, BassetStatus.Liquidating),
                            setBasset(25, 25),
                            setBasset(25, 25),
                        ],
                        setArgs(0, 1),
                        setResult(false, "bAssets undergoing liquidation"),
                    );
                    await assertSingleRedeem(
                        setBasket(false, 100, 5),
                        [
                            setBasset(25, 25),
                            setBasset(25, 25, 18, BassetStatus.BrokenBelowPeg),
                            setBasset(25, 25),
                            setBasset(25, 25),
                        ],
                        setArgs(0, 1),
                        setResult(false, "bAssets undergoing liquidation"),
                    );
                });
            });
            context("with some bAssets broken above peg", async () => {
                it("is ok to redeem with a bAsset with Normal status", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           5e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * Statuses:        [N, A, N, N]
                     * RedeemIndex:     0
                     * RedeemAmt:       1
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 5),
                        [
                            setBasset(25, 25),
                            setBasset(25, 25, 18, BassetStatus.BrokenAbovePeg),
                            setBasset(25, 25),
                            setBasset(25, 25),
                        ],
                        setArgs(0, 1),
                        setResult(true),
                    );
                });
                it("fails if we try to redeem it", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           5e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * Statuses:        [N, A, N, N]
                     * RedeemIndex:     1
                     * RedeemAmt:       1
                     */
                    await assertSingleRedeem(
                        setBasket(false, 100, 5),
                        [
                            setBasset(25, 25),
                            setBasset(25, 25, 18, BassetStatus.BrokenAbovePeg),
                            setBasset(25, 25),
                            setBasset(25, 25),
                        ],
                        setArgs(1, 1),
                        setResult(false, "Cannot redeem depegged bAsset"),
                    );
                });
                it("succeeds with redemption if the basket has failed", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           5e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * Statuses:        [N, A, N, N]
                     * RedeemIndex:     1
                     * RedeemAmt:       1
                     */
                    await assertSingleRedeem(
                        setBasket(true, 100, 5),
                        [
                            setBasset(25, 25),
                            setBasset(25, 25, 18, BassetStatus.BrokenAbovePeg),
                            setBasset(25, 25),
                            setBasset(25, 25),
                        ],
                        setArgs(1, 1),
                        setResult(true),
                    );
                });
            });
        });
    });

    context("redeeming with multiple bAssets", async () => {
        const assertRedeemMulti = async (
            basket: BasketDeets,
            bAssets: BassetDeets[],
            args: Array<Args>,
            result: Result,
            sender: string = accounts[0],
        ): Promise<void> => {
            const [isValid, reason] = await forgeValidator.validateRedemptionMulti(
                basket.failed,
                simpleToExactAmount(basket.totalSupply, 18),
                simpleToExactAmount(basket.deviationAllowanceUnits, 18),
                args.map((a) => a.indexToRedeem),
                args.map((a) =>
                    simpleToExactAmount(
                        a.redeemAmountUnits,
                        a.indexToRedeem >= bAssets.length ? 18 : bAssets[a.indexToRedeem].decimals,
                    ),
                ),
                bAssets.map((b) =>
                    createBasset(
                        b.target,
                        b.vaultUnits,
                        b.decimals,
                        b.status || BassetStatus.Normal,
                    ),
                ),
                { from: sender },
            );
            expect(result.expectedValidity).to.eq(isValid);
            expect(result.expectedReason).to.eq(reason);
        };
        // At target weight is defined when bAssetVaultUnits == (totalSupply * bAssetTarget)
        context("in a basket with bAssets conforming to targets", async () => {
            it("returns valid for a simple validation that remains within the grace threshold", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           1e18
                 * BassetTargets:   [100]
                 * BassetVaults:    [100]
                 * RedeemIndex:     0
                 * RedeemAmt:       10e18
                 */
                await assertRedeemMulti(
                    setBasket(false, 100, 1),
                    [setBasset(100, 100)],
                    [setArgs(0, 10)],
                    setResult(true),
                );
            });
            it("should work for any sender", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           1e18
                 * BassetTargets:   [100]
                 * BassetVaults:    [100]
                 * RedeemIndex:     0
                 * RedeemAmt:       10e18
                 */
                // await assertSingleRedeem(
                //     setBasket(false, 100, 1),
                //     [setBasset(100, 100)],
                //     setArgs(0, 10),
                //     setResult(true),
                //     accounts[4],
                // );
            });
            it("returns inValid if the bAsset does not exist", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           1e18
                 * BassetTargets:   [100]
                 * BassetVaults:    [100]
                 * RedeemIndex:     0
                 * RedeemAmt:       10e18
                 */
                // await assertSingleRedeem(
                //     setBasket(false, 100, 1),
                //     [setBasset(100, 100)],
                //     setArgs(1, 10),
                //     setResult(false, "Basset does not exist"),
                // );
            });
            it("returns inValid if the bAsset vaultBalance is 0", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           10e18
                 * BassetTargets:   [50, 50]
                 * BassetVaults:    [0, 0]
                 * RedeemIndex:     0
                 * RedeemAmt:       1
                 */
                // await assertSingleRedeem(
                //     setBasket(false, 100, 10),
                //     [setBasset(50, 0), setBasset(50, 0)],
                //     setArgs(0, 1),
                //     setResult(false, "Cannot redeem more bAssets than are in the vault"),
                // );
            });

            describe("redeeming relatively largely amount of a bAsset", async () => {
                it("returns inValid if redemption pushes bAsset underweight", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           1e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * RedeemIndex:     0
                     * RedeemAmt:       2
                     * Failed: Because resulting weighting is 23/98, where target is 24.5
                     * and grace = 1, so implicit min = 23.5
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 1),
                    //     [
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //     ],
                    //     setArgs(0, 2),
                    //     setResult(false, "bAssets must remain above implicit min weight"),
                    // );
                });
                it("returns inValid if the bAsset quantity is greater than vault balance", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           10e18
                     * BassetTargets:   [95, 5]
                     * BassetVaults:    [95, 5]
                     * RedeemIndex:     1
                     * RedeemAmt:       6
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 10),
                    //     [setBasset(95, 95), setBasset(5, 5)],
                    //     setArgs(1, 6),
                    //     setResult(false, "Cannot redeem more bAssets than are in the vault"),
                    // );
                });
            });

            describe("using unexpected arguments", async () => {
                it("should return valid if there are no bAssets passed", async () => {
                    // await assertMintMulti(setBasket(100, 1), [], [], setResult(true));
                });
                it("should fail if inputs are of unequal length", async () => {
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     [setBasset(25, 25), setBasset(25, 25)],
                    //     [5],
                    //     setResult(false, "Input length should be equal"),
                    // );
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     [setBasset(25, 25)],
                    //     [5, 5],
                    //     setResult(false, "Input length should be equal"),
                    // );
                });
            });

            describe("using multiple bAssets as input", async () => {
                it("should succeed when using may inputs", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           1e18
                     * BassetTargets:   [10, 10, 10, 10...]
                     * BassetVaults:    [10, 10, 10, 10...]
                     * MintAmts:        [5, 6, 5, 5, 4,...]
                     * Mints cause weights to deviate *within* the allowance
                     */
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     [
                    //         setBasset(10, 10),
                    //         setBasset(10, 10),
                    //         setBasset(10, 10),
                    //         setBasset(10, 10),
                    //         setBasset(10, 10),
                    //         setBasset(10, 10),
                    //         setBasset(10, 10),
                    //         setBasset(10, 10),
                    //         setBasset(10, 10),
                    //         setBasset(10, 10),
                    //     ],
                    //     [5, 6, 5, 4, 6, 5, 5, 5, 6, 5],
                    //     setResult(true),
                    // );
                });
                it("should calculate the new total supply correctly and apply conditions", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           1e18
                     * BassetTargets:   [25, 25, 25]
                     * BassetVaults:    [25, 25, 25]
                     * MintAmts:        []
                     * Mints cause total supply to go up, causing what would have been
                     * over weight exceptions to now be valid
                     */
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     [setBasset(25, 25), setBasset(25, 25), setBasset(25, 25)],
                    //     [4, 4, 4],
                    //     setResult(true),
                    // );
                });
                it("should fail if the inputs are of unequal length", async () => {});
                it("should fail if any bAsset goes above max weight", async () => {});
            });

            describe("with a variable grace", async () => {
                it("should succeed with sufficient grace", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           4e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * RedeemIndex:     0
                     * RedeemAmt:       7
                     * ResultingWeight: 17/93, where new target is 23.25
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 4),
                    //     [
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //     ],
                    //     setArgs(0, 7),
                    //     setResult(false, "bAssets must remain above implicit min weight"),
                    // );
                    // Change grace to 5
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 5),
                    //     [setBasset(50, 50), setBasset(50, 50)],
                    //     setArgs(0, 10),
                    //     setResult(true),
                    // );
                });
                it("should always fail with 0 grace", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           0
                     * BassetTargets:   [50, 50]
                     * BassetVaults:    [50, 50]
                     * RedeemIndex:     0
                     * RedeemAmt:       1
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 0),
                    //     [setBasset(50, 50), setBasset(50, 50)],
                    //     setArgs(0, 1),
                    //     setResult(false, "bAssets must remain under max weight"),
                    // );
                });
                it("should allow anything at a high grace", async () => {
                    /**
                     * TotalSupply:     1000e18
                     * Grace:           1000e18
                     * BassetTargets:   [ 50,  50]
                     * BassetVaults:    [500, 500]
                     * RedeemIndex:     0
                     * RedeemAmt:       500
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 1000, 5000),
                    //     [setBasset(50, 500), setBasset(50, 500)],
                    //     setArgs(0, 500),
                    //     setResult(true),
                    // );
                });
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           1e18
                     * BassetTargets:   [ 50,  50]
                     * BassetVaults:    [ 50,  50]
                     * RedeemIndex:     0
                     * RedeemAmt:       1
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 1),
                    //     [setBasset(50, 50, 6), setBasset(50, 50, 12)],
                    //     setArgs(0, 2),
                    //     setResult(true),
                    // );
                    // // Pushes index 1 over it's implicit max
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 1),
                    //     [setBasset(50, 50, 6), setBasset(50, 50, 12)],
                    //     setArgs(0, 3),
                    //     setResult(false, "bAssets must remain under max weight"),
                    // );
                });
            });
            describe("and various redemption volumes", async () => {
                it("should be ok with 0 at all times", async () => {
                    /**
                     * TotalSupply:     138e18
                     * Grace:           0
                     * BassetTargets:   [50, 50]
                     * BassetVaults:    [69, 69]
                     * RedeemIndex:     0
                     * RedeemAmt:       0
                     * Doesn't change the basket composition at all
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 138, 0),
                    //     [setBasset(50, 69), setBasset(50, 69)],
                    //     setArgs(0, 0),
                    //     setResult(true),
                    // );
                });
                it("should fail once redemption volume triggers grace", async () => {
                    /**
                     * TotalSupply:     138e18
                     * Grace:           1e18
                     * BassetTargets:   [50, 50]
                     * BassetVaults:    [69, 69]
                     * RedeemIndex:     0
                     * RedeemAmt:       0
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 138, 1),
                    //     [setBasset(50, 69), setBasset(50, 69)],
                    //     setArgs(0, 1),
                    //     setResult(true),
                    // );
                    // await assertSingleRedeem(
                    //     setBasket(false, 138, 1),
                    //     [setBasset(50, 69), setBasset(50, 69)],
                    //     setArgs(0, 3),
                    //     setResult(false, "bAssets must remain under max weight"),
                    // );
                });
            });
        });
        context("in a basket with lots of bAssets (14)", async () => {
            it("should execute some basic validations", async () => {
                /**
                 * TotalSupply:     4000e18
                 * Grace:           10e18
                 * BassetTargets:   [20, 20, 10, 10, 10, 10, 5, 5, 2, 2, 2, 2, 1, 1]
                 * BassetVaults:    [800, 800, 400, ...]
                 * RedeemIndex:     9
                 * RedeemAmt:       10
                 */
                // await assertSingleRedeem(
                //     setBasket(false, 4000, 10),
                //     [
                //         setBasset(20, 800),
                //         setBasset(20, 800),
                //         setBasset(10, 400),
                //         setBasset(10, 400),
                //         setBasset(10, 400),
                //         setBasset(10, 400),
                //         setBasset(5, 200),
                //         setBasset(5, 200),
                //         setBasset(2, 80),
                //         setBasset(2, 80),
                //         setBasset(2, 80),
                //         setBasset(2, 80),
                //         setBasset(1, 40),
                //         setBasset(1, 40),
                //     ],
                //     setArgs(9, 10),
                //     setResult(true),
                // );
                // await assertSingleRedeem(
                //     setBasket(false, 4000, 10),
                //     [
                //         setBasset(20, 800),
                //         setBasset(20, 800),
                //         setBasset(10, 400),
                //         setBasset(10, 400),
                //         setBasset(10, 400),
                //         setBasset(10, 400),
                //         setBasset(5, 200),
                //         setBasset(5, 200),
                //         setBasset(2, 80),
                //         setBasset(2, 80),
                //         setBasset(2, 80),
                //         setBasset(2, 80),
                //         setBasset(1, 40),
                //         setBasset(1, 40),
                //     ],
                //     setArgs(9, 15),
                //     setResult(false, "bAssets must remain above implicit min weight"),
                // );
            });
        });
        context("in a basket with some bAssets underweight", async () => {
            describe("and redeeming underweight bAsset", async () => {
                it("always returns invalid", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           3e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [19, 27, 27, 27]
                     * RedeemIndex:     0
                     * RedeemAmt:       0
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 3),
                    //     [
                    //         setBasset(25, 19),
                    //         setBasset(25, 27),
                    //         setBasset(25, 27),
                    //         setBasset(25, 27),
                    //     ],
                    //     setArgs(0, 1),
                    //     setResult(false, "bAssets must remain above implicit min weight"),
                    // );
                });
                it("returns invalid with a 0 quantity input", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           3e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [19, 27, 27, 27]
                     * RedeemIndex:     0
                     * RedeemAmt:       0
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 3),
                    //     [
                    //         setBasset(25, 19),
                    //         setBasset(25, 27),
                    //         setBasset(25, 27),
                    //         setBasset(25, 27),
                    //     ],
                    //     setArgs(0, 0),
                    //     setResult(false, "bAssets must remain above implicit min weight"),
                    // );
                });
            });
            describe("and redeeming a non-underweight bAsset", async () => {
                it("always is valid, so long as bAsset does not go beyond min", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           10e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [13, 25, 31, 31]
                     * RedeemIndex:     1
                     * RedeemAmt:       1
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 10),
                    //     [
                    //         setBasset(25, 13),
                    //         setBasset(25, 25),
                    //         setBasset(25, 31),
                    //         setBasset(25, 31),
                    //     ],
                    //     setArgs(1, 1),
                    //     setResult(true),
                    // );
                    // // Redeeming 14 puts target to 21.5 units, and vaultBalance to 21
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 10),
                    //     [
                    //         setBasset(25, 13),
                    //         setBasset(25, 25),
                    //         setBasset(25, 31),
                    //         setBasset(25, 31),
                    //     ],
                    //     setArgs(1, 14),
                    //     setResult(false, "bAssets must remain above implicit min weight"),
                    // );
                });
            });
        });
        context("in a basket with some bAssets overweight", async () => {
            describe("redeeming a non overweight bAsset", async () => {
                it("should always return invalid", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           10e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [37, 21, 21, 21]
                     * RedeemIndex:     0
                     * RedeemAmt:       10
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 10),
                    //     [
                    //         setBasset(25, 37),
                    //         setBasset(25, 21),
                    //         setBasset(25, 21),
                    //         setBasset(25, 21),
                    //     ],
                    //     setArgs(1, 1),
                    //     setResult(false, "Must redeem overweight bAssets"),
                    // );
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 10),
                    //     [
                    //         setBasset(25, 37),
                    //         setBasset(25, 21),
                    //         setBasset(25, 21),
                    //         setBasset(25, 21),
                    //     ],
                    //     setArgs(2, 1),
                    //     setResult(false, "Must redeem overweight bAssets"),
                    // );
                });
            });
            describe("redeeming an overweight bAsset", async () => {
                it("should return valid, so long as we don't go underweight", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           10e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [37, 21, 21, 21]
                     * RedeemIndex:     0
                     * RedeemAmt:       10
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 10),
                    //     [
                    //         setBasset(25, 37),
                    //         setBasset(25, 21),
                    //         setBasset(25, 21),
                    //         setBasset(25, 21),
                    //     ],
                    //     setArgs(0, 29),
                    //     setResult(true),
                    // );
                    // // Redeeming more should push us under
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 10),
                    //     [
                    //         setBasset(25, 37),
                    //         setBasset(25, 21),
                    //         setBasset(25, 21),
                    //         setBasset(25, 21),
                    //     ],
                    //     setArgs(0, 30),
                    //     setResult(false, "bAssets must remain above implicit min weight"),
                    // );
                });
            });
        });
        context("in a basket with bAssets nearing threshold", async () => {
            it("returns inValid if redemption pushes some other bAsset overweight", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           5e18
                 * BassetTargets:   [25, 25, 25, 25]
                 * BassetVaults:    [25, 21, 29, 25]
                 * RedeemIndex:     3
                 * RedeemAmt:       5
                 * Index 2 will go over weight
                 */
                // await assertSingleRedeem(
                //     setBasket(false, 100, 5),
                //     [setBasset(25, 25), setBasset(25, 21), setBasset(25, 29), setBasset(25, 25)],
                //     setArgs(3, 5),
                //     setResult(false, "bAssets must remain under max weight"),
                // );
                // // Changing q to 3 allows the redemption to pass
                // await assertSingleRedeem(
                //     setBasket(false, 100, 5),
                //     [setBasset(25, 25), setBasset(25, 21), setBasset(25, 29), setBasset(25, 25)],
                //     setArgs(3, 3),
                //     setResult(true),
                // );
            });
            it("always returns invalid until grace is increased", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           5e18
                 * BassetTargets:   [25, 25, 25, 25]
                 * BassetVaults:    [25, 21, 29, 25]
                 * RedeemIndex:     3
                 * RedeemAmt:       5
                 * Index 2 will go over weight
                 */
                // await assertSingleRedeem(
                //     setBasket(false, 100, 5),
                //     [setBasset(25, 25), setBasset(25, 21), setBasset(25, 29), setBasset(25, 25)],
                //     setArgs(3, 5),
                //     setResult(false, "bAssets must remain under max weight"),
                // );
                // // Changing grace to 7 allows passage
                // await assertSingleRedeem(
                //     setBasket(false, 100, 7),
                //     [setBasset(25, 25), setBasset(25, 21), setBasset(25, 29), setBasset(25, 25)],
                //     setArgs(3, 5),
                //     setResult(true),
                // );
            });
        });
        context("in a basket with some affected bAssets", async () => {
            context("with some bAssets liquidating or below peg", async () => {
                it("always returns invalid", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           5e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * Statuses:        [N, L, N, N]
                     * RedeemIndex:     0
                     * RedeemAmt:       1
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 5),
                    //     [
                    //         setBasset(25, 25),
                    //         setBasset(25, 25, 18, BassetStatus.Liquidating),
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //     ],
                    //     setArgs(0, 1),
                    //     setResult(false, "bAssets undergoing liquidation"),
                    // );
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 5),
                    //     [
                    //         setBasset(25, 25),
                    //         setBasset(25, 25, 18, BassetStatus.BrokenBelowPeg),
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //     ],
                    //     setArgs(0, 1),
                    //     setResult(false, "bAssets undergoing liquidation"),
                    // );
                });
            });
            context("with some bAssets broken above peg", async () => {
                it("is ok to redeem with a bAsset with Normal status", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           5e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * Statuses:        [N, A, N, N]
                     * RedeemIndex:     0
                     * RedeemAmt:       1
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 5),
                    //     [
                    //         setBasset(25, 25),
                    //         setBasset(25, 25, 18, BassetStatus.BrokenAbovePeg),
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //     ],
                    //     setArgs(0, 1),
                    //     setResult(true),
                    // );
                });
                it("fails if we try to redeem it", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           5e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * Statuses:        [N, A, N, N]
                     * RedeemIndex:     1
                     * RedeemAmt:       1
                     */
                    // await assertSingleRedeem(
                    //     setBasket(false, 100, 5),
                    //     [
                    //         setBasset(25, 25),
                    //         setBasset(25, 25, 18, BassetStatus.BrokenAbovePeg),
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //     ],
                    //     setArgs(1, 1),
                    //     setResult(false, "Cannot redeem depegged bAsset"),
                    // );
                });
                it("succeeds with redemption if the basket has failed", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           5e18
                     * BassetTargets:   [25, 25, 25, 25]
                     * BassetVaults:    [25, 25, 25, 25]
                     * Statuses:        [N, A, N, N]
                     * RedeemIndex:     1
                     * RedeemAmt:       1
                     */
                    // await assertSingleRedeem(
                    //     setBasket(true, 100, 5),
                    //     [
                    //         setBasset(25, 25),
                    //         setBasset(25, 25, 18, BassetStatus.BrokenAbovePeg),
                    //         setBasset(25, 25),
                    //         setBasset(25, 25),
                    //     ],
                    //     setArgs(1, 1),
                    //     setResult(true),
                    // );
                });
            });
        });
    });
});
