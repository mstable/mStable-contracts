import envSetup from "@utils/env_setup";
import { StandardAccounts, SystemMachine } from "@utils/machines";

envSetup.configure();

/**
 * @notice Todo
 */
contract("Recollateraliser", async (accounts) => {

  const sa = new StandardAccounts(accounts);
  let systemMachine: SystemMachine;

  before("Init contracts", async () => {
    /** Get fresh SystemMachine */
    systemMachine = new SystemMachine(accounts, sa.other);

    /** Create a basic mock representation of the deployed system */
    await systemMachine.initialiseMocks();
  });

  describe("Initialising a new recollateralisation", () => {
    it("should revert if it gets passed bad arguments");
    it("should revert if a recollateralisation already exists");
    it("should initialise the auction struct correctly");
    it("should initialise the basset price ratios correctly");
    it("should initialise the meta price ratios correctly");
  });

  describe("Committing to any auction", () => {
    it("should throw if the auction hasn't started, or invalid params");
    it("should throw if the auction isn't in the right stage");
    it("should reject the bid if we are passed the time limit");
    describe("Committing Masset during the Basset phase", () => {
      it("should clamp the bid if we commit lots of masset");
      it("should clamp the bid if time pushes ratio up");
      it("should transfer the Massets to the contract");
      it("should transfer the Masset and add to commitments mapping");
      it("should allow commitments that do xxx");
    });
    describe("Committing Masset during the Meta phase", () => {
      it("should clamp the bid if we commit too many masset");
      it("should clamp the bid if time pushes ratio up");
      it("should transfer the Masset and add to commitments mapping");
      it("should allow commitments that do xxx");
    });
  });

  describe("Resolving the BassetPhase", () => {
    it("should only move from Basset to Masset phase when time elapsed on raised enough funds");
    it("should still progress even if we raised 0 Massets");
    it("should set up the final Basset ratio based on the time elapsed (in terms of Masset Units)");
  });

  describe("Resolving the MetaPhase", () => {
    it("should only move from Meta to Complete when...");
    it("should revert if we don't raised enough massets");
    it("should mint the right amount of Systok based on time and ratio");
  });

  describe("Settling a commitment", () => {
    it("Should only settle a commitment when in the correct stage");
    it("Should only settle a commitment if users commitment is valid and unclaimed");
    it("Should not allow a trader to redeem the same commitment twice");
    it("Should pay out and xfer basset amounts based on the final price and bassetRatio");
    it("Should pay out and xfer systok amount based on the final price");
    it("Should just return capital if Meta auction failed");
  });
});
