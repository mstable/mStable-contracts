
import { shouldFail } from "openzeppelin-test-helpers";
import { ADDRESS_1, MASSET_FACTORY_BYTES } from "@utils/constants";
import {
  ERC20MockContract,
  GovernancePortalMockContract,
  ManagerMockContract,
  MassetContract,
  OracleHubMockContract,
} from "@utils/contracts";
import envSetup from "@utils/env_setup";
import { BassetMachine, MassetMachine, SystemMachine } from "@utils/machines";
import { percentToWeight, simpleToExactRelativePrice } from "@utils/math";
import { aToH, chai, BigNumber } from "@utils/tools";
import { Basset, BassetStatus } from "@utils/mstable-objects";
import { expectEvent, expectNoEvent } from "@utils/helpers";

envSetup.configure();
const { expect, assert } = chai;

/**
 * @notice Unit and integration tests to detect consequences of Basset deviating from peg
 * Masset created, prices injected into OracleHub and then peg detection initiated. If a
 * basset deviates beyond threshold, it is isolated and a governance proposal generated
 */
contract("Recollateraliser", async (accounts) => {
  const [_, governor, fundManager, other, other2, oraclePriceProvider] = accounts;

  let systemMachine: SystemMachine;

  let governancePortal: GovernancePortalMockContract;

  before("Init contracts", async () => {
    /** Get fresh SystemMachine */
    systemMachine = new SystemMachine(accounts, other);

    /** Create a basic mock representation of the deployed system */
    await systemMachine.initialiseMocks();

    governancePortal = systemMachine.governancePortal;
  });

  describe("Creating a proposal for a failed Basset", () => {
    it("should revert if proposal for that Basset is currently active");
    it("should only allow the Manager to propose the vote");
    it("should create proposal and add to mappings, with all relevant data in struct");
    it("should return voteID which will allow people to vote on the Proposal");
  });

  describe("Voting on a proposal", () => {
    it("should only allow votes from whitelisted governors");
    it("should only allow votes that contain price data within a certain range");
    it("should allow voters to change their vote");
    it("should automatically execute relevant action if the quorum has been reached");
    it("should create a new vote if there is no clear victor after elapsed time");
    it("should allow counting of the votes after the voting period has elapsed");
    it("should revert if the vote has expired or does not exist");
    it("is only valid if the supplied pricing data is correct");
  });
});
