import { simpleToExactAmount } from "@utils/math";
import { createBasset, BassetStatus } from "@utils/mstable-objects";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import { ratioScale } from "@utils/constants";
import { BN } from "@utils/tools";

const { expect } = envSetup.configure();

const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

interface BasketDeets {
    totalSupply: number | string;
}
const setBasket = (totalSupply: number | string): BasketDeets => {
    return {
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
interface Result {
    expectedValidity: boolean;
    expectedReason: string;
    applySwapFee: boolean;
}
const setResult = (
    expectedValidity: boolean,
    expectedReason = "",
    applySwapFee = expectedValidity,
): Result => {
    return {
        expectedValidity,
        expectedReason,
        applySwapFee,
    };
};

contract("ForgeValidator", async (accounts) => {
    let forgeValidator: t.ForgeValidatorInstance;

    before("Init contract", async () => {
        forgeValidator = await ForgeValidatorArtifact.new();
    });

    context("validating a swap", async () => {
        const assertSwap = async (
            basket: BasketDeets,
            input: BassetDeets,
            output: BassetDeets,
            quantity: number | string,
            result: Result,
            sender: string = accounts[0],
        ): Promise<void> => {
            const inputBasset = createBasset(
                input.maxWeight,
                input.vaultUnits,
                input.decimals,
                input.status,
            );
            const outputBasset = createBasset(
                output.maxWeight,
                output.vaultUnits,
                output.decimals,
                output.status,
            );
            const scaledQuantity = simpleToExactAmount(quantity, input.decimals);
            const [
                isValid,
                reason,
                swapOutput,
                applyFee,
            ] = await forgeValidator.validateSwap(
                simpleToExactAmount(basket.totalSupply, 18),
                inputBasset,
                outputBasset,
                scaledQuantity,
                { from: sender },
            );
            expect(result.expectedValidity).to.eq(isValid);
            expect(result.expectedReason).to.eq(reason);
            expect(result.applySwapFee).to.eq(applyFee);
            if (result.expectedValidity === true && new BN(quantity).gt(new BN(0))) {
                const scaledBasset = scaledQuantity.mul(new BN(inputBasset.ratio)).div(ratioScale);
                const outputExact = scaledBasset.mul(ratioScale).div(new BN(outputBasset.ratio));
                expect(outputExact).bignumber.eq(swapOutput);
            } else {
                expect(new BN(0)).bignumber.eq(swapOutput);
            }
        };

        context("with an input basset under its max weight", async () => {
            it("returns valid for a simple validation that remains within the max weight", async () => {
                /**
                 * TotalSupply:     100e18
                 * Input:           [m: 25, v: 24]
                 * Output:          [m: 25, v: 25]
                 * Quantity:        [1]
                 * New weighting now 25/101
                 */
                await assertSwap(
                    setBasket(100),
                    setBasset(25, 24),
                    setBasset(25, 25),
                    1,
                    setResult(true),
                );
            });
            it("should work for any sender", async () => {
                await assertSwap(
                    setBasket(100),
                    setBasset(25, 24),
                    setBasset(25, 25),
                    1,
                    setResult(true),
                    accounts[1],
                );
                await assertSwap(
                    setBasket(100),
                    setBasset(25, 24),
                    setBasset(25, 25),
                    1,
                    setResult(true),
                    accounts[2],
                );
            });
            it("returns inValid if mint pushes bAsset overweight", async () => {
                /**
                 * TotalSupply:     100e18
                 * Input:           [m: 25, v: 24]
                 * Output:          [m: 25, v: 25]
                 * Quantity:        [1]
                 * New weighting now 26/102
                 */
                await assertSwap(
                    setBasket(100),
                    setBasset(25, 24),
                    setBasset(25, 25),
                    2,
                    setResult(false, "Input must remain below max weighting"),
                );
            });
            describe("with large basket supply", async () => {
                it("should succeed with sufficient max weight", async () => {
                    /**
                     * TotalSupply:     1e25
                     * Input:           [m: 2.65, v: 250k]
                     * Output:          [m: 10,   v:   1m]
                     * Quantity:        [10000]
                     * New weighting now 260k/10,010k
                     */
                    await assertSwap(
                        setBasket(10000000),
                        setBasset("2.65", 250000, 12),
                        setBasset(10, 1000000, 16),
                        10000,
                        setResult(true),
                    );
                });
                it("should fail if we exceed the max weight", async () => {
                    /**
                     * TotalSupply:     1e25
                     * Input:           [m: 2.55, v: 250k]
                     * Output:          [m: 10,   v:   1m]
                     * Quantity:        [10000]
                     * New weighting now 260k/10,010k
                     */
                    await assertSwap(
                        setBasket(10000000),
                        setBasset("2.55", 250000, 12),
                        setBasset(10, 1000000, 16),
                        10000,
                        setResult(false, "Input must remain below max weighting"),
                    );
                });
            });
            describe("with a variable max weight", async () => {
                it("should succeed with sufficient allowance", async () => {
                    /**
                     * TotalSupply:     1000e18
                     * Input:           [m:   X, v: 150]
                     * Output:          [m:  25, v: 200]
                     * Quantity:        [100]
                     */
                    let x = 25;
                    await assertSwap(
                        setBasket(1000),
                        setBasset(x, 150),
                        setBasset(25, 200),
                        100,
                        setResult(true),
                    );
                    x = 23;
                    await assertSwap(
                        setBasket(1000),
                        setBasset(x, 150),
                        setBasset(25, 200),
                        100,
                        setResult(false, "Input must remain below max weighting"),
                    );
                });
                it("should always fail with 0 max weight", async () => {
                    /**
                     * TotalSupply:     100
                     * Input:           [m:   0, v:   X]
                     * Output:          [m:  25, v: 200]
                     * Quantity:        [1]
                     */
                    let x = 0;
                    await assertSwap(
                        setBasket(100),
                        setBasset(0, x),
                        setBasset(25, 200),
                        1,
                        setResult(false, "Input must remain below max weighting"),
                    );
                    x = 5;
                    await assertSwap(
                        setBasket(100),
                        setBasset(0, x),
                        setBasset(25, 200),
                        1,
                        setResult(false, "Input must remain below max weighting"),
                    );
                });
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    /**
                     * TotalSupply:     100
                     * Input:           [m: 30, v: 25, d: 6]
                     * Output:          [m: 25, v: 20]
                     * Quantity:        [1]
                     */
                    await assertSwap(
                        setBasket(100),
                        setBasset(30, 25, 6),
                        setBasset(25, 20, 14),
                        1,
                        setResult(true),
                    );
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                it("should be ok with 0 at all times", async () => {
                    /**
                     * TotalSupply:     100
                     * Input:           [m: 30, v: 25, d: 6]
                     * Output:          [m: 25, v: 20]
                     * Quantity:        [0]
                     */
                    await assertSwap(
                        setBasket(100),
                        setBasset(30, 25, 6),
                        setBasset(30, 25),
                        0,
                        setResult(true),
                    );
                    await assertSwap(
                        setBasket(100),
                        setBasset(10, 9, 6),
                        setBasset(40, 4),
                        0,
                        setResult(true),
                    );
                    await assertSwap(
                        setBasket(100),
                        setBasset(30, 25),
                        setBasset(20, 20),
                        0,
                        setResult(true),
                    );
                });
                it("should fail once mint volume triggers max weight", async () => {
                    /**
                     * TotalSupply:     100
                     * Input:           [m: 30, v: 25]
                     * Output:          [m: 25, v: 20]
                     * Quantity:        [13]
                     */
                    await assertSwap(
                        setBasket(100),
                        setBasset(30, 25),
                        setBasset(25, 20),
                        5,
                        setResult(true),
                    );
                    await assertSwap(
                        setBasket(100),
                        setBasset(30, 25),
                        setBasset(25, 20),
                        6,
                        setResult(false, "Input must remain below max weighting"),
                    );
                });
            });
        });
        context("with a basket with low liquidity", async () => {
            describe("swapping out more than is in the basket", async () => {
                it("should throw if there is nothing to redeem", async () => {
                    /**
                     * TotalSupply:     100
                     * Input:           [m: 30, v: 25]
                     * Output:          [m: 25, v: 0]
                     * Quantity:        [1]
                     */
                    await assertSwap(
                        setBasket(100),
                        setBasset(30, 25),
                        setBasset(25, 0),
                        1,
                        setResult(false, "Not enough liquidity"),
                    );
                });
                it("should throw if there is not enough to redeem", async () => {
                    /**
                     * TotalSupply:     100
                     * Input:           [m: 30, v: 25]
                     * Output:          [m: 25, v: 9]
                     * Quantity:        [10]
                     */
                    await assertSwap(
                        setBasket(100),
                        setBasset(30, 25),
                        setBasset(25, 9),
                        10,
                        setResult(false, "Not enough liquidity"),
                    );
                });
            });
        });
        context("in a basket with overweight bAssets", async () => {
            describe("with an input basset overweight", async () => {
                it("should always fail", async () => {
                    /**
                     * TotalSupply:     100
                     * Input:           [m: 50, v: 51]
                     * Output:          [m: 50, v: 30]
                     * Quantity:        [1]
                     */
                    await assertSwap(
                        setBasket(100),
                        setBasset(50, 51),
                        setBasset(50, 30),
                        1,
                        setResult(false, "Input must remain below max weighting"),
                    );
                });
                it("returns invalid with a 0 quantity input", async () => {
                    /**
                     * TotalSupply:     100
                     * Input:           [m: 50, v: 51]
                     * Output:          [m: 50, v: 30]
                     * Quantity:        [1]
                     */
                    await assertSwap(
                        setBasket(100),
                        setBasset(50, 51),
                        setBasset(50, 30),
                        0,
                        setResult(false, "Input must remain below max weighting"),
                    );
                });
                it("always returns invalid until weight is increased", async () => {
                    /**
                     * TotalSupply:     1m
                     * Input:           [m:  X, v: 120k]
                     * Output:          [m: 40, v: 300k]
                     * Quantity:        [1]
                     */
                    let x = 10;
                    await assertSwap(
                        setBasket(1000000),
                        setBasset(x, 120000),
                        setBasset(40, 300000),
                        1,
                        setResult(false, "Input must remain below max weighting"),
                    );
                    x = 12;
                    await assertSwap(
                        setBasket(1000000),
                        setBasset(x, 120000),
                        setBasset(40, 300000),
                        1,
                        setResult(false, "Input must remain below max weighting"),
                    );
                    x = 13;
                    await assertSwap(
                        setBasket(1000000),
                        setBasset(x, 120000),
                        setBasset(40, 300000),
                        1,
                        setResult(true),
                    );
                });
            });
            describe("with an output basset overweight", async () => {
                it("should not charge a swap fee", async () => {
                    /**
                     * TotalSupply:     100
                     * Input:           [m: 30, v: 10]
                     * Output:          [m: 50, v: 51]
                     * Quantity:        [X]
                     */
                    let x = 1;
                    await assertSwap(
                        setBasket(100),
                        setBasset(30, 10, 6),
                        setBasset(50, 51, 18),
                        x,
                        setResult(true, "", false),
                    );
                    x = 10;
                    await assertSwap(
                        setBasket(100),
                        setBasset(30, 10, 6),
                        setBasset(50, 51, 18),
                        x,
                        setResult(true, "", false),
                    );
                });
                it("should allow redemption to 0", async () => {
                    /**
                     * TotalSupply:     200k
                     * Input:           [m: 75, v: 50k]
                     * Output:          [m: 10, v: 100k]
                     * Quantity:        [X]
                     */
                    let x = 50000;
                    await assertSwap(
                        setBasket(200000),
                        setBasset(75, 50000, 6),
                        setBasset(10, 100000, 18),
                        x,
                        setResult(true, "", false),
                    );
                    x = 100000;
                    await assertSwap(
                        setBasket(200000),
                        setBasset(75, 50000, 6),
                        setBasset(10, 100000, 18),
                        x,
                        setResult(true, "", false),
                    );
                    x = 100001;
                    await assertSwap(
                        setBasket(200000),
                        setBasset(75, 50000, 6),
                        setBasset(10, 100000, 18),
                        x,
                        setResult(false, "Not enough liquidity"),
                    );
                });
                it("should throw if input bAsset ends up overweight", async () => {
                    /**
                     * TotalSupply:     200k
                     * Input:           [m: 30, v: 50k]
                     * Output:          [m: 10, v: 100k]
                     * Quantity:        [x]
                     */
                    let x = 10000;
                    await assertSwap(
                        setBasket(200000),
                        setBasset(30, 50000),
                        setBasset(10, 100000, 12),
                        x,
                        setResult(true, "", false),
                    );
                    x = 10001;
                    await assertSwap(
                        setBasket(200000),
                        setBasset(30, 50000),
                        setBasset(10, 100000, 12),
                        x,
                        setResult(false, "Input must remain below max weighting"),
                    );
                });
            });
        });
        // Affected bAssets have been excluded from the basket temporarily or permanently due to circumstance
        context("with an affected bAsset", async () => {
            it("returns inValid for a simple validation", async () => {
                /**
                 * TotalSupply:     100
                 * Input:           [m: 25, v: 20]
                 * Output:          [m: 40, v: 30]
                 * Quantity:        [5]
                 */
                await assertSwap(
                    setBasket(100),
                    setBasset(25, 20, 18, BassetStatus.BrokenBelowPeg),
                    setBasset(40, 30, 18, BassetStatus.Normal),
                    5,
                    setResult(false, "bAsset not allowed in swap"),
                );
                await assertSwap(
                    setBasket(100),
                    setBasset(25, 20, 18, BassetStatus.Normal),
                    setBasset(40, 30, 18, BassetStatus.Blacklisted),
                    5,
                    setResult(false, "bAsset not allowed in swap"),
                );
                await assertSwap(
                    setBasket(100),
                    setBasset(25, 20, 18, BassetStatus.Normal),
                    setBasset(40, 30, 18, BassetStatus.Default),
                    5,
                    setResult(false, "bAsset not allowed in swap"),
                );
                await assertSwap(
                    setBasket(100),
                    setBasset(25, 20, 18, BassetStatus.Liquidated),
                    setBasset(40, 30, 18, BassetStatus.Normal),
                    5,
                    setResult(false, "bAsset not allowed in swap"),
                );
                await assertSwap(
                    setBasket(100),
                    setBasset(25, 20, 18, BassetStatus.Normal),
                    setBasset(40, 30, 18, BassetStatus.Normal),
                    5,
                    setResult(true),
                );
            });
        });
    });
});
