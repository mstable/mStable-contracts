import envSetup from "@utils/env_setup";
import * as chai from "chai";

envSetup.configure();
const { expect, assert } = chai;

contract("MassetBasket", async (accounts) => {

  describe("Recollateralising the Basset", () => {
    it("should allow changes to x state from..");
    it("should send the basset over to the Recollateraliser");
    it("should not allow if currently in x state");
  });

});
