import { simpleToExactAmount } from "@utils/math";
import { createBasset, BassetStatus } from "@utils/mstable-objects";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";

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

    context("validating a single mint", async () => {
        const assertSingleMint = async (
            basket: BasketDeets,
            basset: BassetDeets,
            quantity: number | string,
            result: Result,
            sender: string = accounts[0],
        ): Promise<void> => {
            const [isValid, reason] = await forgeValidator.validateMint(
                simpleToExactAmount(basket.totalSupply, 18),
                createBasset(basset.maxWeight, basset.vaultUnits, basset.decimals, basset.status),
                simpleToExactAmount(quantity, basset.decimals),
                { from: sender },
            );
            expect(result.expectedValidity).to.eq(isValid);
            expect(result.expectedReason).to.eq(reason);
        };

        // At target weight is defined when bAssetVaultUnits == (totalSupply * bAssetTarget)
        context("with a basset at its target weight", async () => {
            it("returns valid for a simple validation that remains within the max weight", async () => {
                // 100 total supply
                // bAsset 24 vaultBalance, 25 maxWeighting
                // new weighting now 25/100
                await assertSingleMint(setBasket(100), setBasset(25, 24), 1, setResult(true));
            });
            it("should work for any sender", async () => {
                await assertSingleMint(
                    setBasket(100),
                    setBasset(25, 24),
                    1,
                    setResult(true),
                    accounts[1],
                );
                await assertSingleMint(
                    setBasket(100),
                    setBasset(25, 24),
                    1,
                    setResult(true),
                    accounts[2],
                );
            });
            it("returns inValid if mint pushes bAsset overweight", async () => {
                // 100 total supply
                // bAsset 24 vaultBalance, 25 maxWeighting
                // 1 deviation allowance but 2 mint units - pushing above threshold
                await assertSingleMint(
                    setBasket(100),
                    setBasset(25, 24, 6),
                    2,
                    setResult(false, "bAssets used in mint cannot exceed their max weight"),
                );
            });
            describe("with large basket supply", async () => {
                it("should succeed with sufficient max weight", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 2.65% maxWeighting
                    // new weighting now 260k/1010k
                    // max weight = 265k
                    await assertSingleMint(
                        setBasket(10000000),
                        setBasset("2.65", 250000, 12),
                        10000,
                        setResult(true),
                    );
                });
                it("should fail if we exceed the max weight", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 2.55% maxWeighting
                    // new weighting now 260k/1010k
                    // max weight = 255k
                    await assertSingleMint(
                        setBasket(10000000),
                        setBasset("2.55", 250000, 12),
                        10000,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
            });
            describe("with a variable max weight", async () => {
                it("should succeed with sufficient allowance", async () => {
                    // 1000 total supply
                    //  150 vaultBalance, 15% maxWeighting
                    // new weighting now 250/1100
                    // max weight in units = 165
                    await assertSingleMint(
                        setBasket(1000),
                        setBasset(25, 150),
                        100,
                        setResult(true),
                    );
                    await assertSingleMint(
                        setBasket(1000),
                        setBasset(23, 150),
                        100,
                        setResult(true),
                    );
                    await assertSingleMint(
                        setBasket(1000),
                        setBasset(20, 150),
                        100,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
                it("should always fail with 0 max weight", async () => {
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(0, 0),
                        1,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
                it("should allow anything at a high max weight", async () => {
                    // 70%
                    let maxWeight = 70;
                    await assertSingleMint(
                        setBasket(1000000),
                        setBasset(maxWeight, 250000),
                        1000000,
                        setResult(true),
                    );
                    await assertSingleMint(
                        setBasket(1000000),
                        setBasset(maxWeight, 250000),
                        1500001,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    // 95%
                    maxWeight = 95;
                    await assertSingleMint(
                        setBasket(1000000),
                        setBasset(maxWeight, 250000),
                        1500000,
                        setResult(true),
                    );
                    await assertSingleMint(
                        setBasket(1000000),
                        setBasset(maxWeight, 250000),
                        12500000,
                        setResult(true),
                    );
                    await assertSingleMint(
                        setBasket(1000000),
                        setBasset(maxWeight, 250000),
                        14000001,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    // 100 total supply
                    // bAsset 25 vaultBalance, 30 maxWeighting, 6 decimals
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(30, 25, 6),
                        1,
                        setResult(true),
                    );
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                it("should be ok with 0 at all times", async () => {
                    // 100 total supply
                    // bAsset 25 vaultBalance, 30 maxWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(30, 25, 6),
                        0,
                        setResult(true),
                    );
                    // bAsset 25 vaultBalance, 30 maxWeighting, 6 decimals
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(30, 25, 6),
                        0,
                        setResult(true),
                    );
                    // bAsset 25 vaultBalance, 30 maxWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(30, 25, 18),
                        0,
                        setResult(true),
                    );
                });
                it("should fail once mint volume triggers max weight", async () => {
                    // 100 total supply
                    // bAsset 25 vaultBalance, 30 maxWeighting, 6 decimals
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(35, 25, 6),
                        13,
                        setResult(true),
                    );
                    // bAsset 25 vaultBalance, 30 maxWeighting, 6 decimals
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(30, 25, 6),
                        14,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
            });
        });
        // Overweight is defined when bAssetVaultUnits > (totalSupply * bAssetMax)
        context("with a basset overweight", async () => {
            it("returns inValid for a simple validation", async () => {
                // 100 total supply
                // bAsset 40 vaultBalance, 25 maxWeighting, 18 decimals
                await assertSingleMint(
                    setBasket(100),
                    setBasset(25, 40),
                    1,
                    setResult(false, "bAssets used in mint cannot exceed their max weight"),
                );
            });
            describe("with large basket supply", async () => {
                it("always returns invalid until weight is increased", async () => {
                    // 1,000,000 total supply
                    // bAsset 120,000 vaultBalance, 10% maxWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(1000000),
                        setBasset(10, 120000),
                        1,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    // 5,000,000 total supply
                    // bAsset 2,000,000 vaultBalance, 25% maxWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(5000000),
                        setBasset(35, 2000000),
                        100,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    // 5,000,000 total supply
                    // bAsset 2,000,000 vaultBalance, 40% maxWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(5000000),
                        setBasset(41, 2000000),
                        100,
                        setResult(true),
                    );
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                // should fail with lots
                it("returns invalid with a 0 quantity input", async () => {
                    // 100 total supply
                    // bAsset 26.1 vaultBalance, 25% maxWeighting, 18 decimals
                    // making it 1.1 units gt target
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(25, "26.1"),
                        0,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
                it("returns invalid with a all quantities", async () => {
                    // 100 total supply
                    // bAsset 26.1 vaultBalance, 25% maxWeighting, 18 decimals
                    // making it 1.1 units gt target
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(25, "26.1"),
                        2,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(25, "26.1"),
                        10,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    await assertSingleMint(
                        setBasket(100),
                        setBasset(25, "26.1"),
                        10000000,
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
            });
        });
        // Affected bAssets have been excluded from the basket temporarily or permanently due to circumstance
        context("with an affected bAsset", async () => {
            it("returns inValid for a simple validation", async () => {
                // 100 total supply
                // bAsset 25 vaultBalance, 25 maxWeighting, 18 decimals
                // Assert normal mint works
                await assertSingleMint(
                    setBasket(100),
                    setBasset(25, 25, 18, BassetStatus.BrokenBelowPeg),
                    0,
                    setResult(false, "bAsset not allowed in mint"),
                );
                await assertSingleMint(
                    setBasket(100),
                    setBasset(25, 25, 18, BassetStatus.Blacklisted),
                    0,
                    setResult(false, "bAsset not allowed in mint"),
                );
                await assertSingleMint(
                    setBasket(100),
                    setBasset(25, 25, 18, BassetStatus.Liquidating),
                    0,
                    setResult(false, "bAsset not allowed in mint"),
                );
            });
        });
    });
    context("validating a mint with multiple bAssets", async () => {
        const assertMintMulti = async (
            basket: BasketDeets,
            bassets: Array<BassetDeets>,
            quantities: Array<number | string>,
            result: Result,
            sender: string = accounts[0],
        ): Promise<void> => {
            const [isValid, reason] = await forgeValidator.validateMintMulti(
                simpleToExactAmount(basket.totalSupply, 18),
                bassets.map((b) => createBasset(b.maxWeight, b.vaultUnits, b.decimals, b.status)),
                quantities.map((q, i) =>
                    simpleToExactAmount(q, bassets[i] ? bassets[i].decimals : 18),
                ),
                { from: sender },
            );
            expect(result.expectedValidity).to.eq(isValid);
            expect(result.expectedReason).to.eq(reason);
        };

        // At target weight is defined when bAssetVaultUnits <= (totalSupply * bAssetTarget)
        context("with a basset under its max weight", async () => {
            it("returns valid for a simple validation that remains within the max weight", async () => {
                /**
                 * TotalSupply:     100e18
                 * BassetMax:       [25]
                 * BassetVaults:    [24]
                 * MintAmts:        [1]
                 * new weighting now 25/100, on the threshold
                 */
                await assertMintMulti(setBasket(100), [setBasset(25, 24)], [1], setResult(true));
            });
            it("should work for any sender", async () => {
                await assertMintMulti(
                    setBasket(100),
                    [setBasset(25, 24), setBasset(25, 24)],
                    [1, 1],
                    setResult(true),
                    accounts[1],
                );
                await assertMintMulti(
                    setBasket(100),
                    [setBasset(25, 24), setBasset(25, 24), setBasset(25, 24)],
                    [1, 1, 1],
                    setResult(true),
                    accounts[2],
                );
            });
            it("returns inValid if mint pushes bAsset overweight", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           1e18
                 * BassetMax:       [25]
                 * BassetVaults:    [24]
                 * MintAmts:        [2]
                 * 1 deviation allowance but 2 mint units - pushing above threshold
                 */
                await assertMintMulti(
                    setBasket(100),
                    [setBasset(25, 24, 6)],
                    [2],
                    setResult(false, "bAssets used in mint cannot exceed their max weight"),
                );
            });
            describe("using unexpected arguments", async () => {
                it("should return valid if there are no bAssets passed", async () => {
                    await assertMintMulti(setBasket(100), [], [], setResult(true));
                });
                it("should fail if inputs are of unequal length", async () => {
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 25), setBasset(25, 25)],
                        [5],
                        setResult(false, "Input length should be equal"),
                    );
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 25)],
                        [5, 5],
                        setResult(false, "Input length should be equal"),
                    );
                });
            });
            describe("using multiple bAssets as input", async () => {
                it("should succeed when using may inputs", async () => {
                    /**
                     * TotalSupply:     100e18
                     * Grace:           1e18
                     * BassetMax:       [15, 15, 15, 15...]
                     * BassetVaults:    [10, 10, 10, 10...]
                     * MintAmts:        [5, 6, 5, 5, 4,...]
                     * Mints cause weights to deviate *within* the allowance
                     */
                    await assertMintMulti(
                        setBasket(100),
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
                        [5, 6, 5, 4, 6, 5, 5, 5, 6, 5],
                        setResult(true),
                    );
                });
                it("should calculate the new total supply correctly and apply conditions", async () => {
                    /**
                     * TotalSupply:     100e18
                     * BassetMax:       [25, 25, 25]
                     * BassetVaults:    [23, 23, 23]
                     * MintAmts:        [ 4,  4,  4]
                     * Mints cause total supply to go up, causing what would have been
                     * over weight exceptions to now be valid
                     */
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 23), setBasset(25, 23), setBasset(25, 23)],
                        [4, 4, 4],
                        setResult(true),
                    );
                });
                it("should fail if the inputs are of unequal length", async () => {
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 25), setBasset(25, 25), setBasset(25, 25)],
                        [4, 4],
                        setResult(false, "Input length should be equal"),
                    );
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 25), setBasset(25, 25)],
                        [4, 4, 4],
                        setResult(false, "Input length should be equal"),
                    );
                });
                it("should fail if any bAsset goes above max weight", async () => {
                    /**
                     * TotalSupply:     100e18
                     * BassetMax:       [25, 25, 25]
                     * BassetVaults:    [24, 24, 24]
                     * MintAmts:        [ 2,  6,  2]
                     * Mints cause total supply to go up, causing B to go overweight
                     */
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 24), setBasset(25, 24), setBasset(25, 24)],
                        [2, 6, 2],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
            });
            describe("with large basket supply", async () => {
                it("should succeed with sufficient max weight", async () => {
                    /**
                     * TotalSupply:     1e25
                     * BassetMax:       [2.65]
                     * BassetVaults:    [250k]
                     * MintAmts:        [ 10k]
                     */
                    await assertMintMulti(
                        setBasket(10000000),
                        [setBasset("2.65", 250000, 12)],
                        [10000],
                        setResult(true),
                    );
                });
                it("should fail if we exceed the max weight", async () => {
                    /**
                     * TotalSupply:     1e25
                     * BassetMax:       [2.55]
                     * BassetVaults:    [250k]
                     * MintAmts:        [ 10k]
                     */
                    await assertMintMulti(
                        setBasket(10000000),
                        [setBasset("2.55", 250000, 12)],
                        [10000],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
            });
            describe("with a variable max weight", async () => {
                it("should succeed with sufficient allowance", async () => {
                    /**
                     * TotalSupply:     1000e18
                     * BassetMax:       [15]
                     * BassetVaults:    [150]
                     * MintAmts:        [100]
                     * New weighting now 250/1100, or 22.7%
                     * target weight in units = 165, so 85 grace needed
                     */
                    let maxWeight = 30;
                    await assertMintMulti(
                        setBasket(1000),
                        [setBasset(maxWeight, 150)],
                        [100],
                        setResult(true),
                    );
                    maxWeight = 23;
                    await assertMintMulti(
                        setBasket(1000),
                        [setBasset(maxWeight, 150)],
                        [100],
                        setResult(true),
                    );
                    maxWeight = 22;
                    await assertMintMulti(
                        setBasket(1000),
                        [setBasset(maxWeight, 150)],
                        [100],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
                it("should always fail with 0 max weight", async () => {
                    /**
                     * BassetMax:       [0]
                     * BassetVaults:    [150]
                     * MintAmts:        [100]
                     */
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(0, 25)],
                        [1],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
                it("should allow anything at a high weight", async () => {
                    /**
                     * BassetMax:       [65]
                     * BassetVaults:    [250k]
                     * MintAmts:        [1m]
                     */
                    let maxWeight = 65;
                    await assertMintMulti(
                        setBasket(1000000),
                        [setBasset(maxWeight, 250000)],
                        [1000000],
                        setResult(true),
                    );
                    await assertMintMulti(
                        setBasket(1000000),
                        [setBasset(maxWeight, 250000)],
                        [1500000],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    maxWeight = 95;
                    await assertMintMulti(
                        setBasket(1000000),
                        [setBasset(maxWeight, 250000)],
                        [1500000],
                        setResult(true),
                    );
                    await assertMintMulti(
                        setBasket(1000000),
                        [setBasset(maxWeight, 250000)],
                        [12500000],
                        setResult(true),
                    );
                    await assertMintMulti(
                        setBasket(1000000),
                        [setBasset(maxWeight, 250000)],
                        [14000001],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    /**
                     * TotalSupply:     100e18
                     * BassetMax:       [30]
                     * BassetVaults:    [25]
                     * MintAmts:        [1]
                     */
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(30, 25, 6)],
                        [1],
                        setResult(true),
                    );
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                it("should be ok with 0 at all times", async () => {
                    /**
                     * TotalSupply:     100e18
                     * BassetMax:       [25]
                     * BassetVaults:    [25]
                     * MintAmts:        [0]
                     */
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 25, 6)],
                        [0],
                        setResult(true),
                    );
                    // bAsset 25 vaultBalance, 30 maxWeighting, 6 decimals
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(30, 25, 6)],
                        [0],
                        setResult(true),
                    );
                    // bAsset 45 vaultBalance, 45 maxWeighting, 18 decimals
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(45, 45, 18)],
                        [0],
                        setResult(true),
                    );
                });
                it("should fail once mint volume triggers threshold", async () => {
                    /**
                     * TotalSupply:     100e18
                     * BassetMax:       [35]
                     * BassetVaults:    [25]
                     * MintAmts:        [0]
                     */
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(35, 25, 6)],
                        [13],
                        setResult(true),
                    );
                    // bAsset 25 vaultBalance, 35 maxWeighting, 6 decimals
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(35, 25, 6)],
                        [16],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
            });
        });
        // Overweight is defined when bAssetVaultUnits > (totalSupply * bAssetTarget)
        context("with a basset overweight", async () => {
            it("returns inValid for a simple validation", async () => {
                /**
                 * TotalSupply:     100e18
                 * BassetMax:       [25]
                 * BassetVaults:    [40]
                 * MintAmts:        [1]
                 */
                await assertMintMulti(
                    setBasket(100),
                    [setBasset(25, 40)],
                    [1],
                    setResult(false, "bAssets used in mint cannot exceed their max weight"),
                );
            });
            describe("with large basket supply", async () => {
                it("always returns invalid until max weight is increased", async () => {
                    /**
                     * TotalSupply:     1e24
                     * BassetMax:       [10]
                     * BassetVaults:    [120k]
                     * MintAmts:        [1]
                     * Basset is already 20k units overweight
                     */
                    await assertMintMulti(
                        setBasket(1000000),
                        [setBasset(10, 120000)],
                        [1],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    // 5,000,000 total supply
                    // bAsset 2,000,000 vaultBalance, 40% maxWeighting, 18 decimals
                    await assertMintMulti(
                        setBasket(5000000),
                        [setBasset(40, 2000000)],
                        [100],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    // 5,000,000 total supply
                    // bAsset 2,000,000 vaultBalance, 41% maxWeighting, 18 decimals
                    // passed now due to 41 max
                    await assertMintMulti(
                        setBasket(5000000),
                        [setBasset(41, 2000000)],
                        [100],
                        setResult(true),
                    );
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                // should fail with lots
                it("returns invalid with a 0 quantity input", async () => {
                    /**
                     * TotalSupply:     100e18
                     * BassetMax:       [25]
                     * BassetVaults:    [26]
                     * MintAmts:        [0]
                     * Basset is already overweight
                     */
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 26)],
                        [0],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
                it("returns invalid with a all quantities", async () => {
                    /**
                     * TotalSupply:     100e18
                     * BassetMax:       [25]
                     * BassetVaults:    [25]
                     * MintAmts:        [0]
                     * Basset is already overweight
                     */
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 25)],
                        [2],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(25, 25)],
                        [10],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                    await assertMintMulti(
                        setBasket(100),
                        [setBasset(40, 25)],
                        [10000000],
                        setResult(false, "bAssets used in mint cannot exceed their max weight"),
                    );
                });
            });
        });
        // Affected bAssets have been excluded from the basket temporarily or permanently due to circumstance
        context("with an affected bAsset", async () => {
            it("returns inValid for a simple validation", async () => {
                /**
                 * TotalSupply:     100e18
                 * BassetMax:       [25]
                 * BassetVaults:    [25]
                 * MintAmts:        [0]
                 * Fails since bAssets used are invalid
                 */
                await assertMintMulti(
                    setBasket(100),
                    [setBasset(25, 25, 18, BassetStatus.BrokenBelowPeg)],
                    [0],
                    setResult(false, "bAsset not allowed in mint"),
                );
                await assertMintMulti(
                    setBasket(100),
                    [setBasset(25, 25, 18, BassetStatus.Blacklisted)],
                    [0],
                    setResult(false, "bAsset not allowed in mint"),
                );
                await assertMintMulti(
                    setBasket(100),
                    [setBasset(25, 25, 18, BassetStatus.Liquidating)],
                    [0],
                    setResult(false, "bAsset not allowed in mint"),
                );
            });
        });
    });
});
