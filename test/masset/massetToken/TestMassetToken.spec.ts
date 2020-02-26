import envSetup from "@utils/env_setup";
import * as chai from "chai";

const { expect, assert } = envSetup.configure();
contract("MassetToken", async (accounts) => {
    describe("Minting", () => {
        it("Should not allow minting from external addr");
    });

    describe("Burning", () => {
        it("should only allow burning from those accounts with allowance or balance");
    });
});
