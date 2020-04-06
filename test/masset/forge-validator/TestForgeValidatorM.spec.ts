import * as t from "types/generated";

import { percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasset, createBasket, Basket } from "@utils/mstable-objects";
import { StandardAccounts } from "@utils/machines/standardAccounts";

import envSetup from "@utils/env_setup";
import BN = require("bn.js");
const { expect, assert } = envSetup.configure();

const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

contract("ForgeValidator", async (accounts) => {
    const sa = new StandardAccounts(accounts);

    let forgeValidator: t.ForgeValidatorInstance;

    before("Init contract", async () => {
        forgeValidator = await ForgeValidatorArtifact.new();
    });

    context("validating a single mint", async () => {
        context("with a basset under its max weight", async () => {
            describe("minting with standard", async () => {
                it("works", async () => {
                    let [isValid, reason] = await forgeValidator.validateMint(
                        simpleToExactAmount(new BN(100), 18),
                        simpleToExactAmount(new BN(1), 18),
                        createBasset(new BN(25), new BN(25)),
                        simpleToExactAmount(new BN(1), 18),
                    );
                    expect(isValid).to.eq(true);
                });
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
