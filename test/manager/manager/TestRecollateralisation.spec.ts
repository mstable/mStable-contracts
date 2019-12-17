import envSetup from "@utils/env_setup";

envSetup.configure();

/**
 * @notice Todo
 */
contract("Manager", async (accounts) => {

  describe("Initiating recollateralisation", () => {
    it("should reject if the Basset has no balance");
    it("should set the status on the Basset");
    it("should begin a new auction in the recollateraliser");
  });

  describe("Completing recollateralisation", () => {
    it("should only be called by the auction");
    it("should tell the Masset that the auction has finished");
  });
});
