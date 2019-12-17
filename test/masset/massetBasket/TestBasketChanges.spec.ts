import envSetup from "@utils/env_setup";
import * as chai from "chai";

envSetup.configure();
const { expect, assert } = chai;

contract("MassetBasket", async (accounts) => {

  describe("Initialising the basket", () => {
    it("should throw if the weightings dont add up to..");
  });

  describe("Adding a basset the basket", () => {
    it("should calculate the ratio correctly");
    it("should allow for various measurementmultiples (under certain limit)");
    it("should not allow the basset if...");
  });

  describe("Setting weights on the basket", () => {
    it("should update the weights if..");
    it("should throw if some bassets are in an recollateralising state");
  });
});
