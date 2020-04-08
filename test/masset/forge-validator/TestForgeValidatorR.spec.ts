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
        // At target weight is defined when bAssetVaultUnits == (totalSupply * bAssetTarget)
        context("with a basset at its target weight", async () => {
            it("returns valid for a simple validation that remains within the grace threshold", async () => {
                const [isValid, reason] = await forgeValidator.validateRedemption(
                    false,
                    simpleToExactAmount(100, 18),
                    [createBasset(new BN(100), new BN(100), 18)],
                    simpleToExactAmount(1, 18),
                    "0",
                    simpleToExactAmount(1, 18),
                    { from: accounts[0] },
                );
                expect(true).to.eq(isValid);
                expect("").to.eq(reason);
            });
            it("should work for any sender", async () => {});
            it("returns inValid if mint pushes bAsset overweight", async () => {});
            describe("with large basket supply", async () => {
                it("should succeed with sufficient grace", async () => {});
                it("should fail if we exceed the grace threshold", async () => {});
            });
            describe("with a variable grace", async () => {
                it("should succeed with sufficient grace", async () => {});
                it("should always fail with 0 grace", async () => {});
                it("should allow anything at a high grace", async () => {});
            });
            describe("and various decimals", async () => {
                it("returns valid with custom ratio", async () => {});
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                it("should be ok with 0 at all times", async () => {});
                it("should fail once mint volume triggers grace", async () => {});
            });
        });
        // Overweight is defined when bAssetVaultUnits > (totalSupply * bAssetTarget) + deviationAllowance
        context("with a basset overweight", async () => {
            it("returns inValid for a simple validation", async () => {});
            describe("with large basket supply", async () => {
                it("always returns invalid until grace is increased", async () => {});
            });
            describe("with a variable grace", async () => {
                it("always returns invalid until grace is increased", async () => {});
            });
            describe("and various mint volumes", async () => {
                // should be ok with 0
                // should fail with lots
                it("returns invalid with a 0 quantity input", async () => {});
                it("returns invalid with a all quantities", async () => {});
            });
        });
        // Underweight is defined when (totalSupply * bassetTarget) - deviationAllowance > bAssetVaultUnits
        context("with a basset underweight", async () => {
            it("returns valid for a simple validation", async () => {});
            it("returns inValid if mint pushes bAsset overweight", async () => {});
            describe("with large basket supply", async () => {
                it("should succeed with any grace, so long as we are still below target", async () => {});
                it("should fail if we exceed the grace threshold", async () => {});
            });
        });
        // Affected bAssets have been excluded from the basket temporarily or permanently due to circumstance
        context("with an affected bAsset", async () => {
            it("returns inValid for a simple validation", async () => {});
        });
    });
});
