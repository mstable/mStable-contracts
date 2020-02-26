import envSetup from "@utils/env_setup";

const { expect, assert } = envSetup.configure();

/**
 * @notice Todo
 */
contract("MassetBasket", async (accounts) => {
    describe("Handling peg loss", () => {
        it("should set the status on the Basset in given conditions");
    });

    describe("Negating peg loss", () => {
        it("should set the status on the Basset in given conditions");
    });
    describe("Initiating recollateralisation", () => {
        it("should throw if the Basset or Basket is in an invalid state");
        it("should transfer the tokens to recollateraliser");
    });

    describe("Completing recollateralisation", () => {
        it("should throw if the Basset or Basket is in an invalid state");
        it(
            "should fail the basket and set a collateralisation ratio if we are undercollateralised",
        );
    });
});
