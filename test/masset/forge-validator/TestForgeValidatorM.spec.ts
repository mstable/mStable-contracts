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
            bAssetTarget: number,
            bAssetVaultUnits: number,
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
                createBasset(
                    new BN(bAssetTarget),
                    new BN(bAssetVaultUnits),
                    bAssetDecimals,
                    bAssetStatus,
                ),
                simpleToExactAmount(mintAmountUnits, bAssetDecimals),
                { from: sender },
            );
            expect(isValid).to.eq(expectedValidity);
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
                await assertSingleMint(100, 1, 25, 25, 18, 1, undefined, true, accounts[1]);
                await assertSingleMint(100, 1, 25, 25, 18, 1, undefined, true, accounts[2]);
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
            describe("with large basket supply", async () => {});
            describe("with a variable grace", async () => {});
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {
                    // 100 total supply
                    // bAsset 25 vaultBalance, 25 targetWeighting, 6 decimals
                    await assertSingleMint(100, 1, 25, 25, 6, 1, undefined, true);
                });
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                // should fail with lots
            });
        });
        // Underweight is defined when (totalSupply * bassetTarget) - deviationAllowance > bAssetVaultUnits
        context("with a basset underweight", async () => {
            it("returns valid for a simple validation", async () => {});
            it("returns inValid if mint pushes bAsset overweight", async () => {});
            describe("with large basket supply", async () => {});
            describe("with a variable grace", async () => {});
            describe("and various decimals", async () => {});
            describe("and various mint volumes", async () => {
                // should be ok with 0
                // should fail with lots
            });
        });
        // Overweight is defined when bAssetVaultUnits > (totalSupply * bAssetTarget) + deviationAllowance
        context("with a basset overweight", async () => {
            it("returns valid for a simple validation", async () => {});
            it("returns inValid if mint pushes bAsset overweight", async () => {});
            describe("with large basket supply", async () => {});
            describe("with a variable grace", async () => {});
            describe("and various decimals", async () => {});
            describe("and various mint volumes", async () => {
                // should be ok with 0
                // should fail with lots
            });
        });
        // Affected bAssets have been excluded from the basket temporarily or permanently due to circumstance
        context("with an affected bAsset", async () => {
            it("returns valid for a simple validation", async () => {});
            it("returns inValid if mint pushes bAsset overweight", async () => {});
            describe("with large basket supply", async () => {});
            describe("with a variable grace", async () => {});
            describe("and various decimals", async () => {});
            describe("and various mint volumes", async () => {
                // should be ok with 0
                // should fail with lots
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
