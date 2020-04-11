import * as t from "types/generated";

import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { createBasset, BassetStatus } from "@utils/mstable-objects";

import envSetup from "@utils/env_setup";

const { expect } = envSetup.configure();

const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

interface BasketDeets {
    totalSupply: number | string;
    deviationAllowanceUnits: number | string;
}
const setBasket = (
    totalSupply: number | string,
    deviationAllowanceUnits: number | string,
): BasketDeets => {
    return {
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
                simpleToExactAmount(basket.deviationAllowanceUnits, 18),
                createBasset(basset.target, basset.vaultUnits, basset.decimals, basset.status),
                simpleToExactAmount(quantity, basset.decimals),
                { from: sender },
            );
            expect(result.expectedValidity).to.eq(isValid);
            expect(result.expectedReason).to.eq(reason);
        };

        // At target weight is defined when bAssetVaultUnits == (totalSupply * bAssetTarget)
        context("with a basset at its target weight", async () => {
            it("returns valid for a simple validation that remains within the grace threshold", async () => {
                // 100 total supply
                // bAsset 25 vaultBalance, 25 targetWeighting
                // new weighting now 26/101, within grace boundary
                await assertSingleMint(setBasket(100, 1), setBasset(25, 25), 1, setResult(true));
            });
            it("should work for any sender", async () => {
                await assertSingleMint(
                    setBasket(100, 1),
                    setBasset(25, 25),
                    1,
                    setResult(true),
                    accounts[1],
                );
                await assertSingleMint(
                    setBasket(100, 1),
                    setBasset(25, 25),
                    1,
                    setResult(true),
                    accounts[2],
                );
            });
            it("returns inValid if mint pushes bAsset overweight", async () => {
                // 100 total supply
                // bAsset 25 vaultBalance, 25 targetWeighting
                // 1 deviation allowance but 2 mint units - pushing above threshold
                await assertSingleMint(
                    setBasket(100, 1),
                    setBasset(25, 25, 6),
                    2,
                    setResult(false, "Must be below implicit max weighting"),
                );
            });
            describe("with large basket supply", async () => {
                it("should succeed with sufficient grace", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 2.5% targetWeighting
                    // new weighting now 260k/1010k
                    // target weight = 250250, so 9750 grace is needed
                    const graceUnits = 9750;
                    await assertSingleMint(
                        setBasket(10000000, graceUnits),
                        setBasset("2.5", 250000, 12),
                        10000,
                        setResult(true),
                    );
                });
                it("should fail if we exceed the grace threshold", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 2.5% targetWeighting
                    // new weighting now 260k/1010k (roughly 2.51%)
                    // target weight = 250250, so 9750 grace is needed
                    const graceUnits = 9749;
                    await assertSingleMint(
                        setBasket(10000000, graceUnits),
                        setBasset("2.5", 250000, 12),
                        10000,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                });
            });
            describe("with a variable grace", async () => {
                it("should succeed with sufficient grace", async () => {
                    // 1000 total supply
                    //  150 vaultBalance, 15% targetWeighting
                    // new weighting now 250/1100
                    // target weight in units = 165, so 85 grace needed
                    let graceUnits = 100;
                    await assertSingleMint(
                        setBasket(1000, graceUnits),
                        setBasset(15, 150),
                        100,
                        setResult(true),
                    );
                    graceUnits = 85;
                    await assertSingleMint(
                        setBasket(1000, graceUnits),
                        setBasset(15, 150),
                        100,
                        setResult(true),
                    );
                    graceUnits = 70;
                    await assertSingleMint(
                        setBasket(1000, graceUnits),
                        setBasset(15, 150),
                        100,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                });
                it("should always fail with 0 grace", async () => {
                    let graceUnits = 0;
                    await assertSingleMint(
                        setBasket(100, graceUnits),
                        setBasset(25, 25),
                        1,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                    graceUnits = 1;
                    await assertSingleMint(
                        setBasket(100, graceUnits),
                        setBasset(25, 25),
                        1,
                        setResult(true),
                    );
                });
                it("should allow anything at a high grace", async () => {
                    // 1m
                    let graceUnits = 1000000;
                    await assertSingleMint(
                        setBasket(1000000, graceUnits),
                        setBasset(25, 250000),
                        1000000,
                        setResult(true),
                    );
                    await assertSingleMint(
                        setBasket(1000000, graceUnits),
                        setBasset(25, 250000),
                        1500000,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                    // 10m
                    graceUnits = 10000000;
                    await assertSingleMint(
                        setBasket(1000000, graceUnits),
                        setBasset(25, 250000),
                        1500000,
                        setResult(true),
                    );
                    await assertSingleMint(
                        setBasket(1000000, graceUnits),
                        setBasset(25, 250000),
                        12500000,
                        setResult(true),
                    );
                    await assertSingleMint(
                        setBasket(1000000, graceUnits),
                        setBasset(25, 250000),
                        14000001,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                });
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    // 100 total supply
                    // bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    await assertSingleMint(
                        setBasket(100, 1),
                        setBasset(25, 25, 6),
                        1,
                        setResult(true),
                    );
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                it("should be ok with 0 at all times", async () => {
                    // 100 total supply
                    // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(100, 10),
                        setBasset(25, 25, 6),
                        0,
                        setResult(true),
                    );
                    // 0 grace; bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    await assertSingleMint(
                        setBasket(100, 0),
                        setBasset(25, 25, 6),
                        0,
                        setResult(true),
                    );
                    // 0 grace; bAsset 25 vaultBalance, 25 targetWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(100, 0),
                        setBasset(25, 25, 18),
                        0,
                        setResult(true),
                    );
                });
                it("should fail once mint volume triggers grace", async () => {
                    // 100 total supply
                    // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    await assertSingleMint(
                        setBasket(100, 10),
                        setBasset(25, 25, 6),
                        13,
                        setResult(true),
                    );
                    // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    await assertSingleMint(
                        setBasket(100, 10),
                        setBasset(25, 25, 6),
                        14,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                });
            });
        });
        // Overweight is defined when bAssetVaultUnits > (totalSupply * bAssetTarget) + deviationAllowance
        context("with a basset overweight", async () => {
            it("returns inValid for a simple validation", async () => {
                // 100 total supply
                // bAsset 40 vaultBalance, 25 targetWeighting, 18 decimals
                await assertSingleMint(
                    setBasket(100, 1),
                    setBasset(25, 40),
                    1,
                    setResult(false, "Must be below implicit max weighting"),
                );
            });
            describe("with large basket supply", async () => {
                it("always returns invalid until grace is increased", async () => {
                    // 1,000,000 total supply
                    // bAsset 120,000 vaultBalance, 10% targetWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(1000000, 100),
                        setBasset(10, 120000),
                        1,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                    // 5,000,000 total supply
                    // bAsset 2,000,000 vaultBalance, 25% targetWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(5000000, 10000),
                        setBasset(25, 2000000),
                        100,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                    // 5,000,000 total supply
                    // bAsset 2,000,000 vaultBalance, 25% targetWeighting, 18 decimals
                    await assertSingleMint(
                        setBasket(5000000, 900000),
                        setBasset(25, 2000000),
                        100,
                        setResult(true),
                    );
                });
            });
            describe("with a variable grace", async () => {
                it("always returns invalid until grace is increased", async () => {
                    // 100 total supply
                    // bAsset 26.1 vaultBalance, 25% targetWeighting, 18 decimals
                    // making it 1.1 units gt target, with 1 grace
                    await assertSingleMint(
                        setBasket(100, 1),
                        setBasset(25, "26.1"),
                        1,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                    await assertSingleMint(
                        setBasket(100, 2),
                        setBasset(25, "26.1"),
                        1,
                        setResult(true),
                    );
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                // should fail with lots
                it("returns invalid with a 0 quantity input", async () => {
                    // 100 total supply
                    // bAsset 26.1 vaultBalance, 25% targetWeighting, 18 decimals
                    // making it 1.1 units gt target, with 1 grace
                    await assertSingleMint(
                        setBasket(100, 1),
                        setBasset(25, "26.1"),
                        0,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                });
                it("returns invalid with a all quantities", async () => {
                    // 100 total supply
                    // bAsset 26.1 vaultBalance, 25% targetWeighting, 18 decimals
                    // making it 1.1 units gt target, with 1 grace
                    await assertSingleMint(
                        setBasket(100, 1),
                        setBasset(25, "26.1"),
                        2,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                    await assertSingleMint(
                        setBasket(100, 1),
                        setBasset(25, "26.1"),
                        10,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                    await assertSingleMint(
                        setBasket(100, 1),
                        setBasset(25, "26.1"),
                        10000000,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                });
            });
        });
        // Underweight is defined when (totalSupply * bassetTarget) - deviationAllowance > bAssetVaultUnits
        context("with a basset underweight", async () => {
            it("returns valid for a simple validation", async () => {
                // 100 total supply
                // bAsset 10 vaultBalance, 25 targetWeighting
                // new weighting now 11/101, within grace boundary
                await assertSingleMint(setBasket(100, 1), setBasset(25, 10), 1, setResult(true));
            });
            it("returns inValid if mint pushes bAsset overweight", async () => {
                // 100 total supply
                // bAsset 10 vaultBalance, 25 targetWeighting
                // new weighting now 31/121, within grace boundary
                await assertSingleMint(
                    setBasket(100, 0),
                    setBasset(25, 10),
                    21,
                    setResult(false, "Must be below implicit max weighting"),
                );
            });
            describe("with large basket supply", async () => {
                it("should succeed with any grace, so long as we are still below target", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 10% targetWeighting
                    let graceUnits = 0;
                    await assertSingleMint(
                        setBasket(10000000, graceUnits),
                        setBasset(10, 250000, 12),
                        600000,
                        setResult(true),
                    );
                    graceUnits = 10000;
                    await assertSingleMint(
                        setBasket(10000000, graceUnits),
                        setBasset(10, 250000, 12),
                        600000,
                        setResult(true),
                    );
                });
                it("should fail if we exceed the grace threshold", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 10% targetWeighting
                    // fails since resulting is around 1.25m/11m, above boundary
                    let graceUnits = 0;
                    await assertSingleMint(
                        setBasket(10000000, graceUnits),
                        setBasset(10, 250000, 12),
                        1000000,
                        setResult(false, "Must be below implicit max weighting"),
                    );
                    graceUnits = 200000;
                    await assertSingleMint(
                        setBasket(10000000, graceUnits),
                        setBasset(10, 250000, 12),
                        1000000,
                        setResult(true),
                    );
                });
            });
        });
        // Affected bAssets have been excluded from the basket temporarily or permanently due to circumstance
        context("with an affected bAsset", async () => {
            it("returns inValid for a simple validation", async () => {
                // 100 total supply
                // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 18 decimals
                // Assert normal mint works
                await assertSingleMint(
                    setBasket(100, 10),
                    setBasset(25, 25, 18, BassetStatus.BrokenBelowPeg),
                    0,
                    setResult(false, "bAsset not allowed in mint"),
                );
                await assertSingleMint(
                    setBasket(100, 10),
                    setBasset(25, 25, 18, BassetStatus.Blacklisted),
                    0,
                    setResult(false, "bAsset not allowed in mint"),
                );
                await assertSingleMint(
                    setBasket(100, 10),
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
                simpleToExactAmount(basket.deviationAllowanceUnits, 18),
                bassets.map((b) => createBasset(b.target, b.vaultUnits, b.decimals, b.status)),
                quantities.map((q, i) =>
                    simpleToExactAmount(q, bassets[i] ? bassets[i].decimals : 18),
                ),
                { from: sender },
            );
            expect(result.expectedValidity).to.eq(isValid);
            expect(result.expectedReason).to.eq(reason);
        };

        // At target weight is defined when bAssetVaultUnits == (totalSupply * bAssetTarget)
        context("with a basset at its target weight", async () => {
            it("returns valid for a simple validation that remains within the grace threshold", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           1e18
                 * BassetTargets:   [25]
                 * BassetVaults:    [25]
                 * MintAmts:        [1]
                 * new weighting now 26/101, within grace boundary
                 */
                await assertMintMulti(setBasket(100, 1), [setBasset(25, 25)], [1], setResult(true));
            });
            it("should work for any sender", async () => {
                await assertMintMulti(
                    setBasket(100, 1),
                    [setBasset(25, 25), setBasset(25, 25)],
                    [1, 1],
                    setResult(true),
                    accounts[1],
                );
                await assertMintMulti(
                    setBasket(100, 1),
                    [setBasset(25, 25), setBasset(25, 25), setBasset(25, 25)],
                    [1, 1, 1],
                    setResult(true),
                    accounts[2],
                );
            });
            it("returns inValid if mint pushes bAsset overweight", async () => {
                /**
                 * TotalSupply:     100e18
                 * Grace:           1e18
                 * BassetTargets:   [25]
                 * BassetVaults:    [25]
                 * MintAmts:        [2]
                 * 1 deviation allowance but 2 mint units - pushing above threshold
                 */
                await assertMintMulti(
                    setBasket(100, 1),
                    [setBasset(25, 25, 6)],
                    [2],
                    setResult(false, "Must be below implicit max weighting"),
                );
            });
            describe("using unexpected arguments", async () => {
                it("should return valid if there are no bAssets passed", async () => {
                    await assertMintMulti(setBasket(100, 1), [], [], setResult(true));
                });
                it("should fail if inputs are of unequal length", async () => {
                    await assertMintMulti(
                        setBasket(100, 1),
                        [setBasset(25, 25), setBasset(25, 25)],
                        [5],
                        setResult(false, "Input length should be equal"),
                    );
                    await assertMintMulti(
                        setBasket(100, 1),
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
                     * BassetTargets:   [10, 10, 10, 10...]
                     * BassetVaults:    [10, 10, 10, 10...]
                     * MintAmts:        [5, 6, 5, 5, 4,...]
                     * Mints cause weights to deviate *within* the allowance
                     */
                    await assertMintMulti(
                        setBasket(100, 1),
                        [
                            setBasset(10, 10),
                            setBasset(10, 10),
                            setBasset(10, 10),
                            setBasset(10, 10),
                            setBasset(10, 10),
                            setBasset(10, 10),
                            setBasset(10, 10),
                            setBasset(10, 10),
                            setBasset(10, 10),
                            setBasset(10, 10),
                        ],
                        [5, 6, 5, 4, 6, 5, 5, 5, 6, 5],
                        setResult(true),
                    );
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
                    await assertMintMulti(
                        setBasket(100, 1),
                        [setBasset(25, 25), setBasset(25, 25), setBasset(25, 25)],
                        [4, 4, 4],
                        setResult(true),
                    );
                    /**
                     * TotalSupply:     100e18
                     * Grace:           10e18
                     * BassetTargets:   [25, 25, 25]
                     * BassetVaults:    [25, 25, 25]
                     * MintAmts:        []
                     * Mints cause total supply to go up, causing what would have been
                     * over weight exceptions to now be valid
                     */
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     [setBasset(25, 25), setBasset(25, 25), setBasset(25, 25)],
                    //     [20, 10, 10],
                    //     setResult(true),
                    // );
                });
                it("should fail if the inputs are of unequal length", async () => {});
                it("should fail if any bAsset goes above max weight", async () => {});
            });
            describe("with large basket supply", async () => {
                it("should succeed with sufficient grace", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 2.5% targetWeighting
                    // new weighting now 260k/1010k
                    // target weight = 250250, so 9750 grace is needed
                    // const graceUnits = 9750;
                    // await assertMintMulti(
                    //     setBasket(10000000, graceUnits),
                    //     setBasset("2.5", 250000, 12),
                    //     10000,
                    //     setResult(true),
                    // );
                });
                it("should fail if we exceed the grace threshold", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 2.5% targetWeighting
                    // new weighting now 260k/1010k (roughly 2.51%)
                    // target weight = 250250, so 9750 grace is needed
                    // const graceUnits = 9749;
                    // await assertMintMulti(
                    //     setBasket(10000000, graceUnits),
                    //     setBasset("2.5", 250000, 12),
                    //     10000,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                });
            });
            describe("with a variable grace", async () => {
                it("should succeed with sufficient grace", async () => {
                    // 1000 total supply
                    //  150 vaultBalance, 15% targetWeighting
                    // new weighting now 250/1100
                    // target weight in units = 165, so 85 grace needed
                    // let graceUnits = 100;
                    // await assertMintMulti(
                    //     setBasket(1000, graceUnits),
                    //     setBasset(15, 150),
                    //     100,
                    //     setResult(true),
                    // );
                    // graceUnits = 85;
                    // await assertMintMulti(
                    //     setBasket(1000, graceUnits),
                    //     setBasset(15, 150),
                    //     100,
                    //     setResult(true),
                    // );
                    // graceUnits = 70;
                    // await assertMintMulti(
                    //     setBasket(1000, graceUnits),
                    //     setBasset(15, 150),
                    //     100,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                });
                it("should always fail with 0 grace", async () => {
                    // let graceUnits = 0;
                    // await assertMintMulti(
                    //     setBasket(100, graceUnits),
                    //     setBasset(25, 25),
                    //     1,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                    // graceUnits = 1;
                    // await assertMintMulti(
                    //     setBasket(100, graceUnits),
                    //     setBasset(25, 25),
                    //     1,
                    //     setResult(true),
                    // );
                });
                it("should allow anything at a high grace", async () => {
                    // // 1m
                    // let graceUnits = 1000000;
                    // await assertMintMulti(
                    //     setBasket(1000000, graceUnits),
                    //     setBasset(25, 250000),
                    //     1000000,
                    //     setResult(true),
                    // );
                    // await assertMintMulti(
                    //     setBasket(1000000, graceUnits),
                    //     setBasset(25, 250000),
                    //     1500000,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                    // // 10m
                    // graceUnits = 10000000;
                    // await assertMintMulti(
                    //     setBasket(1000000, graceUnits),
                    //     setBasset(25, 250000),
                    //     1500000,
                    //     setResult(true),
                    // );
                    // await assertMintMulti(
                    //     setBasket(1000000, graceUnits),
                    //     setBasset(25, 250000),
                    //     12500000,
                    //     setResult(true),
                    // );
                    // await assertMintMulti(
                    //     setBasket(1000000, graceUnits),
                    //     setBasset(25, 250000),
                    //     14000001,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                });
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    // 100 total supply
                    // bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     setBasset(25, 25, 6),
                    //     1,
                    //     setResult(true),
                    // );
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                it("should be ok with 0 at all times", async () => {
                    // // 100 total supply
                    // // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 18 decimals
                    // await assertMintMulti(
                    //     setBasket(100, 10),
                    //     setBasset(25, 25, 6),
                    //     0,
                    //     setResult(true),
                    // );
                    // // 0 grace; bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    // await assertMintMulti(
                    //     setBasket(100, 0),
                    //     setBasset(25, 25, 6),
                    //     0,
                    //     setResult(true),
                    // );
                    // // 0 grace; bAsset 25 vaultBalance, 25 targetWeighting, 18 decimals
                    // await assertMintMulti(
                    //     setBasket(100, 0),
                    //     setBasset(25, 25, 18),
                    //     0,
                    //     setResult(true),
                    // );
                });
                it("should fail once mint volume triggers grace", async () => {
                    // // 100 total supply
                    // // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    // await assertMintMulti(
                    //     setBasket(100, 10),
                    //     setBasset(25, 25, 6),
                    //     13,
                    //     setResult(true),
                    // );
                    // // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    // await assertMintMulti(
                    //     setBasket(100, 10),
                    //     setBasset(25, 25, 6),
                    //     14,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                });
            });
        });
        // Overweight is defined when bAssetVaultUnits > (totalSupply * bAssetTarget) + deviationAllowance
        context("with a basset overweight", async () => {
            it("returns inValid for a simple validation", async () => {
                // // 100 total supply
                // // bAsset 40 vaultBalance, 25 targetWeighting, 18 decimals
                // await assertMintMulti(
                //     setBasket(100, 1),
                //     setBasset(25, 40),
                //     1,
                //     setResult(false, "Must be below implicit max weighting"),
                // );
            });
            describe("with large basket supply", async () => {
                it("always returns invalid until grace is increased", async () => {
                    // // 1,000,000 total supply
                    // // bAsset 120,000 vaultBalance, 10% targetWeighting, 18 decimals
                    // await assertMintMulti(
                    //     setBasket(1000000, 100),
                    //     setBasset(10, 120000),
                    //     1,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                    // // 5,000,000 total supply
                    // // bAsset 2,000,000 vaultBalance, 25% targetWeighting, 18 decimals
                    // await assertMintMulti(
                    //     setBasket(5000000, 10000),
                    //     setBasset(25, 2000000),
                    //     100,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                    // // 5,000,000 total supply
                    // // bAsset 2,000,000 vaultBalance, 25% targetWeighting, 18 decimals
                    // await assertMintMulti(
                    //     setBasket(5000000, 900000),
                    //     setBasset(25, 2000000),
                    //     100,
                    //     setResult(true),
                    // );
                });
            });
            describe("with a variable grace", async () => {
                it("always returns invalid until grace is increased", async () => {
                    // // 100 total supply
                    // // bAsset 26.1 vaultBalance, 25% targetWeighting, 18 decimals
                    // // making it 1.1 units gt target, with 1 grace
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     setBasset(25, "26.1"),
                    //     1,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                    // await assertMintMulti(
                    //     setBasket(100, 2),
                    //     setBasset(25, "26.1"),
                    //     1,
                    //     setResult(true),
                    // );
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                // should fail with lots
                it("returns invalid with a 0 quantity input", async () => {
                    // // 100 total supply
                    // // bAsset 26.1 vaultBalance, 25% targetWeighting, 18 decimals
                    // // making it 1.1 units gt target, with 1 grace
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     setBasset(25, "26.1"),
                    //     0,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                });
                it("returns invalid with a all quantities", async () => {
                    // // 100 total supply
                    // // bAsset 26.1 vaultBalance, 25% targetWeighting, 18 decimals
                    // // making it 1.1 units gt target, with 1 grace
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     setBasset(25, "26.1"),
                    //     2,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     setBasset(25, "26.1"),
                    //     10,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                    // await assertMintMulti(
                    //     setBasket(100, 1),
                    //     setBasset(25, "26.1"),
                    //     10000000,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                });
            });
        });
        // Underweight is defined when (totalSupply * bassetTarget) - deviationAllowance > bAssetVaultUnits
        context("with a basset underweight", async () => {
            it("returns valid for a simple validation", async () => {
                // 100 total supply
                // bAsset 10 vaultBalance, 25 targetWeighting
                // new weighting now 11/101, within grace boundary
                // await assertMintMulti(setBasket(100, 1), setBasset(25, 10), 1, setResult(true));
            });
            it("returns inValid if mint pushes bAsset overweight", async () => {
                // 100 total supply
                // bAsset 10 vaultBalance, 25 targetWeighting
                // new weighting now 31/121, within grace boundary
                // await assertMintMulti(
                //     setBasket(100, 0),
                //     setBasset(25, 10),
                //     21,
                //     setResult(false, "Must be below implicit max weighting"),
                // );
            });
            describe("with large basket supply", async () => {
                it("should succeed with any grace, so long as we are still below target", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 10% targetWeighting
                    // let graceUnits = 0;
                    // await assertMintMulti(
                    //     setBasket(10000000, graceUnits),
                    //     setBasset(10, 250000, 12),
                    //     600000,
                    //     setResult(true),
                    // );
                    // graceUnits = 10000;
                    // await assertMintMulti(
                    //     setBasket(10000000, graceUnits),
                    //     setBasset(10, 250000, 12),
                    //     600000,
                    //     setResult(true),
                    // );
                });
                it("should fail if we exceed the grace threshold", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 10% targetWeighting
                    // fails since resulting is around 1.25m/11m, above boundary
                    // let graceUnits = 0;
                    // await assertMintMulti(
                    //     setBasket(10000000, graceUnits),
                    //     setBasset(10, 250000, 12),
                    //     1000000,
                    //     setResult(false, "Must be below implicit max weighting"),
                    // );
                    // graceUnits = 200000;
                    // await assertMintMulti(
                    //     setBasket(10000000, graceUnits),
                    //     setBasset(10, 250000, 12),
                    //     1000000,
                    //     setResult(true),
                    // );
                });
            });
        });
        // Affected bAssets have been excluded from the basket temporarily or permanently due to circumstance
        context("with an affected bAsset", async () => {
            it("returns inValid for a simple validation", async () => {
                // 100 total supply
                // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 18 decimals
                // Assert normal mint works
                // await assertMintMulti(
                //     setBasket(100, 10),
                //     setBasset(25, 25, 18, BassetStatus.BrokenBelowPeg),
                //     0,
                //     setResult(false, "bAsset not allowed in mint"),
                // );
                // await assertMintMulti(
                //     setBasket(100, 10),
                //     setBasset(25, 25, 18, BassetStatus.Blacklisted),
                //     0,
                //     setResult(false, "bAsset not allowed in mint"),
                // );
                // await assertMintMulti(
                //     setBasket(100, 10),
                //     setBasset(25, 25, 18, BassetStatus.Liquidating),
                //     0,
                //     setResult(false, "bAsset not allowed in mint"),
                // );
            });
        });
    });
});
