import * as t from "types/generated";

import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { createBasset, BassetStatus } from "@utils/mstable-objects";

import envSetup from "@utils/env_setup";
const { expect } = envSetup.configure();

const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

contract("ForgeValidator", async (accounts) => {
    let forgeValidator: t.ForgeValidatorInstance;

    before("Init contract", async () => {
        forgeValidator = await ForgeValidatorArtifact.new();
    });

    context("validating a single mint", async () => {
        const assertSingleMint = async (
            totalSupply: number | string,
            deviationAllowanceUnits: number | string,
            bAssetTarget: number | string,
            bAssetVaultUnits: number | string,
            bAssetDecimals: number,
            mintAmountUnits: number | string,
            bAssetStatus: BassetStatus = BassetStatus.Normal,
            expectedValidity: boolean,
            expectedReason: string = "",
            sender: string = accounts[0],
        ) => {
            let [isValid, reason] = await forgeValidator.validateMint(
                simpleToExactAmount(totalSupply, 18),
                simpleToExactAmount(deviationAllowanceUnits, 18),
                createBasset(bAssetTarget, bAssetVaultUnits, bAssetDecimals, bAssetStatus),
                simpleToExactAmount(mintAmountUnits, bAssetDecimals),
                { from: sender },
            );
            expect(expectedValidity).to.eq(isValid);
            expect(expectedReason).to.eq(reason);
        };

        // At target weight is defined when bAssetVaultUnits == (totalSupply * bAssetTarget)
        context("with a basset at its target weight", async () => {
            it("returns valid for a simple validation that remains within the grace threshold", async () => {
                // 100 total supply
                // bAsset 25 vaultBalance, 25 targetWeighting
                // new weighting now 26/101, within grace boundary
                await assertSingleMint(100, 1, 25, 25, 18, 1, undefined, true);
            });
            it("should work for any sender", async () => {
                await assertSingleMint(100, 1, 25, 25, 18, 1, undefined, true, "", accounts[1]);
                await assertSingleMint(100, 1, 25, 25, 18, 1, undefined, true, "", accounts[2]);
            });
            it("returns inValid if mint pushes bAsset overweight", async () => {
                // 100 total supply
                // bAsset 25 vaultBalance, 25 targetWeighting
                // 1 deviation allowance but 2 mint units - pushing above threshold
                await assertSingleMint(
                    100,
                    1,
                    25,
                    25,
                    6,
                    2,
                    undefined,
                    false,
                    "Must be below implicit max weighting",
                );
            });
            describe("with large basket supply", async () => {
                it("should succeed with sufficient grace", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 2.5% targetWeighting
                    // new weighting now 260k/1010k
                    // target weight = 250250, so 9750 grace is needed
                    let graceUnits = 9750;
                    await assertSingleMint(
                        10000000,
                        graceUnits,
                        "2.5",
                        250000,
                        12,
                        10000,
                        undefined,
                        true,
                    );
                });
                it("should fail if we exceed the grace threshold", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 2.5% targetWeighting
                    // new weighting now 260k/1010k (roughly 2.51%)
                    // target weight = 250250, so 9750 grace is needed
                    let graceUnits = 9749;
                    await assertSingleMint(
                        10000000,
                        graceUnits,
                        "2.5",
                        250000,
                        12,
                        10000,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
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
                    await assertSingleMint(1000, graceUnits, 15, 150, 18, 100, undefined, true);
                    graceUnits = 85;
                    await assertSingleMint(1000, graceUnits, 15, 150, 18, 100, undefined, true);
                    graceUnits = 70;
                    await assertSingleMint(
                        1000,
                        graceUnits,
                        15,
                        150,
                        18,
                        100,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                });
                it("should always fail with 0 grace", async () => {
                    let graceUnits = 0;
                    await assertSingleMint(
                        100,
                        graceUnits,
                        25,
                        25,
                        18,
                        1,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                    graceUnits = 1;
                    await assertSingleMint(100, graceUnits, 25, 25, 18, 1, undefined, true);
                });
                it("should allow anything at a high grace", async () => {
                    // 1m
                    let graceUnits = 1000000;
                    await assertSingleMint(
                        1000000,
                        graceUnits,
                        25,
                        250000,
                        18,
                        1000000,
                        undefined,
                        true,
                    );
                    await assertSingleMint(
                        1000000,
                        graceUnits,
                        25,
                        250000,
                        18,
                        1500000,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                    // 10m
                    graceUnits = 10000000;
                    await assertSingleMint(
                        1000000,
                        graceUnits,
                        25,
                        250000,
                        18,
                        1500000,
                        undefined,
                        true,
                    );
                    await assertSingleMint(
                        1000000,
                        graceUnits,
                        25,
                        250000,
                        18,
                        12500000,
                        undefined,
                        true,
                    );
                    await assertSingleMint(
                        1000000,
                        graceUnits,
                        25,
                        250000,
                        18,
                        14000001,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                });
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    // 100 total supply
                    // bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    await assertSingleMint(100, 1, 25, 25, 6, 1, undefined, true);
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                it("should be ok with 0 at all times", async () => {
                    // 100 total supply
                    // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 18 decimals
                    await assertSingleMint(100, 10, 25, 25, 18, 0, undefined, true);
                    // 0 grace; bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    await assertSingleMint(100, 0, 25, 25, 6, 0, undefined, true);
                    // 0 grace; bAsset 25 vaultBalance, 25 targetWeighting, 18 decimals
                    await assertSingleMint(100, 0, 25, 25, 18, 0, undefined, true);
                });
                it("should fail once mint volume triggers grace", async () => {
                    // 100 total supply
                    // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    await assertSingleMint(100, 10, 25, 25, 6, 13, undefined, true);
                    // 10 grace; bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    await assertSingleMint(
                        100,
                        10,
                        25,
                        25,
                        6,
                        14,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
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
                    100,
                    1,
                    25,
                    40,
                    18,
                    1,
                    undefined,
                    false,
                    "Must be below implicit max weighting",
                );
            });
            describe("with large basket supply", async () => {
                it("always returns invalid until grace is increased", async () => {
                    // 1,000,000 total supply
                    // bAsset 120,000 vaultBalance, 10% targetWeighting, 18 decimals
                    await assertSingleMint(
                        1000000,
                        100,
                        10,
                        120000,
                        18,
                        1,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                    // 5,000,000 total supply
                    // bAsset 2,000,000 vaultBalance, 25% targetWeighting, 18 decimals
                    await assertSingleMint(
                        5000000,
                        10000,
                        25,
                        2000000,
                        18,
                        100,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                    // 5,000,000 total supply
                    // bAsset 2,000,000 vaultBalance, 25% targetWeighting, 18 decimals
                    await assertSingleMint(5000000, 900000, 25, 2000000, 18, 100, undefined, true);
                });
            });
            describe("with a variable grace", async () => {
                it("always returns invalid until grace is increased", async () => {
                    // 100 total supply
                    // bAsset 26.1 vaultBalance, 25% targetWeighting, 18 decimals
                    // making it 1.1 units gt target, with 1 grace
                    await assertSingleMint(
                        100,
                        1,
                        25,
                        "26.1",
                        18,
                        1,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                    await assertSingleMint(100, 2, 25, "26.1", 18, 1, undefined, true);
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
                        100,
                        1,
                        25,
                        "26.1",
                        18,
                        0,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                });
                it("returns invalid with a all quantities", async () => {
                    // 100 total supply
                    // bAsset 26.1 vaultBalance, 25% targetWeighting, 18 decimals
                    // making it 1.1 units gt target, with 1 grace
                    await assertSingleMint(
                        100,
                        1,
                        25,
                        "26.1",
                        18,
                        2,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                    await assertSingleMint(
                        100,
                        1,
                        25,
                        "26.1",
                        18,
                        10,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                    await assertSingleMint(
                        100,
                        1,
                        25,
                        "26.1",
                        18,
                        10000000,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
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
                await assertSingleMint(100, 1, 25, 10, 18, 1, undefined, true);
            });
            it("returns inValid if mint pushes bAsset overweight", async () => {
                // 100 total supply
                // bAsset 10 vaultBalance, 25 targetWeighting
                // new weighting now 31/121, within grace boundary
                await assertSingleMint(
                    100,
                    0,
                    25,
                    10,
                    18,
                    21,
                    undefined,
                    false,
                    "Must be below implicit max weighting",
                );
            });
            describe("with large basket supply", async () => {
                it("should succeed with any grace, so long as we are still below target", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 10% targetWeighting
                    let graceUnits = 0;
                    await assertSingleMint(
                        10000000,
                        graceUnits,
                        10,
                        250000,
                        12,
                        600000,
                        undefined,
                        true,
                    );
                    graceUnits = 10000;
                    await assertSingleMint(
                        10000000,
                        graceUnits,
                        10,
                        250000,
                        12,
                        600000,
                        undefined,
                        true,
                    );
                });
                it("should fail if we exceed the grace threshold", async () => {
                    // 10,000,000 total supply
                    //    250,000 vaultBalance, 10% targetWeighting
                    // fails since resulting is around 1.25m/11m, above boundary
                    let graceUnits = 0;
                    await assertSingleMint(
                        10000000,
                        graceUnits,
                        10,
                        250000,
                        12,
                        1000000,
                        undefined,
                        false,
                        "Must be below implicit max weighting",
                    );
                    graceUnits = 200000;
                    await assertSingleMint(
                        10000000,
                        graceUnits,
                        10,
                        250000,
                        12,
                        1000000,
                        undefined,
                        true,
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
                await assertSingleMint(100, 10, 25, 25, 18, 0, BassetStatus.Normal, true);
                await assertSingleMint(
                    100,
                    10,
                    25,
                    25,
                    18,
                    0,
                    BassetStatus.BrokenAbovePeg,
                    false,
                    "bAsset not allowed in mint",
                );
                await assertSingleMint(
                    100,
                    10,
                    25,
                    25,
                    18,
                    0,
                    BassetStatus.Blacklisted,
                    false,
                    "bAsset not allowed in mint",
                );
                await assertSingleMint(
                    100,
                    10,
                    25,
                    25,
                    18,
                    0,
                    BassetStatus.Liquidating,
                    false,
                    "bAsset not allowed in mint",
                );
            });
        });
    });

    // describe("With empty basket", async () => {
    //     it("should not allow a mint that is not on the target weights", async () => {
    //         await expectRevert(
    //             forgeValidator.validateMint(emptyBasket, [
    //                 simpleToExactAmount(10000, 18),
    //                 simpleToExactAmount(200, 18),
    //             ]),
    //             "Basket should not deviate from the optimal weightings",
    //         );
    //     });

    //     it("should allow a mint that is on the target weights", async () => {
    //         const isValidMint = await forgeValidator.validateMint(emptyBasket, [
    //             simpleToExactAmount(500, 18),
    //             simpleToExactAmount(500, 18),
    //         ]);
    //         assert(isValidMint, "Should be a valid mint!");
    //     });

    //     it("should allow completely empty minting to pass", async () => {
    //         const isValidMint = await forgeValidator.validateMint(emptyBasket, [
    //             simpleToExactAmount(0, 18),
    //             simpleToExactAmount(0, 18),
    //         ]);
    //         expect(isValidMint).to.be.true;
    //     });
    // });

    // describe("With static basket", () => {
    //     it("should allow a mint exactly on the target weights", async () => {
    //         const isValidMint = await forgeValidator.validateMint(standardBasket, [
    //             simpleToExactAmount(1000, 18),
    //             simpleToExactAmount(1000, 14),
    //             simpleToExactAmount(500, 6),
    //         ]);
    //         expect(isValidMint).to.be.true;
    //     });

    //     it("should not allow a mint that is not on the target weights", async () => {
    //         await expectRevert(
    //             forgeValidator.validateMint(standardBasket, [
    //                 simpleToExactAmount(1000, 18),
    //                 simpleToExactAmount(1000, 14),
    //                 simpleToExactAmount(501, 6),
    //             ]),
    //             "Basket should not deviate from the optimal weightings",
    //         );
    //     });

    //     it("should not allow a mint that is not on the target weights (even with grace)", async () => {
    //         standardBasket.grace = percentToWeight(50).toString();

    //         await expectRevert(
    //             forgeValidator.validateMint(standardBasket, [
    //                 simpleToExactAmount(1000, 18),
    //                 simpleToExactAmount(1000, 14),
    //                 simpleToExactAmount(501, 6),
    //             ]),
    //             "Basket should not deviate from the optimal weightings",
    //         );
    //     });
    // });

    // describe("With adjusting basket", () => {
    //     it("should allow a mint exactly on the target weights", async () => {
    //         const isValidMint = await forgeValidator.validateMint(adjustingBasket, [
    //             simpleToExactAmount(2000, 18),
    //             simpleToExactAmount(2000, 14),
    //             simpleToExactAmount(1000, 6),
    //         ]);
    //         expect(isValidMint).to.be.true;
    //     });

    //     it("should allow a mint that pushes us closer to the target", async () => {
    //         const isValidMint = await forgeValidator.validateMint(adjustingBasket, [
    //             simpleToExactAmount(500, 18),
    //             simpleToExactAmount(0, 14),
    //             simpleToExactAmount(0, 6),
    //         ]);
    //         expect(isValidMint).to.be.true;
    //     });

    //     it("should allow a mint that pushes some bassets over target, so long as we move closer overall", async () => {
    //         const isValidMint = await forgeValidator.validateMint(adjustingBasket, [
    //             simpleToExactAmount(3000, 18),
    //             simpleToExactAmount(1500, 14),
    //             simpleToExactAmount(0, 6),
    //         ]);
    //         expect(isValidMint).to.be.true;
    //     });

    //     it("should throw if a mint pushes us further away", async () => {
    //         await expectRevert(
    //             forgeValidator.validateMint(adjustingBasket, [
    //                 simpleToExactAmount(32, 18),
    //                 simpleToExactAmount(36, 14),
    //                 simpleToExactAmount(33, 6),
    //             ]),
    //             "Forge must move Basket weightings towards the target",
    //         );
    //     });

    //     it("should throw if we go way over the target", async () => {
    //         await expectRevert(
    //             forgeValidator.validateMint(adjustingBasket, [
    //                 simpleToExactAmount(5000, 18),
    //                 simpleToExactAmount(0, 14),
    //                 simpleToExactAmount(0, 6),
    //             ]),
    //             "Forge must move Basket weightings towards the target",
    //         );
    //     });
    // });

    // describe("With adjusting basket (w/ Grace)", () => {
    //     it("should allow a mint with negative difference, within the grace range", async () => {
    //         const isValidMint = await forgeValidator.validateMint(adjustingBasketWithGrace, [
    //             simpleToExactAmount(410, 18),
    //             simpleToExactAmount(400, 14),
    //             simpleToExactAmount(190, 6),
    //         ]);
    //         expect(isValidMint).to.be.true;
    //     });

    //     it("should throw if the mint pushes us outside the grace range", async () => {
    //         await expectRevert(
    //             forgeValidator.validateMint(adjustingBasketWithGrace, [
    //                 simpleToExactAmount(480, 18),
    //                 simpleToExactAmount(400, 14),
    //                 simpleToExactAmount(200, 6),
    //             ]),
    //             "Forge must move Basket weightings towards the target",
    //         );
    //     });
    // });

    // describe("With Basket undergoing re-collateralisation", () => {
    //     // TODO

    //     it("Should calculate relative weightings assuming the basset has disappeared");
    //     it("Should throw if a user tries to forge with a basset under-peg");
    //     it("Should allow minting with a basset that is over-peg");
    //     it("Should act like a normal mint, excluding the basset");
    // });

    // describe("With all Bassets isolated in some way", () => {
    //     it("Should not allow minting if all bassets have deviated under-peg");
    // });
});
