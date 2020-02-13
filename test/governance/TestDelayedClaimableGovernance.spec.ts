import { shouldBehaveLikeGovernble } from "./Governable.behaviour.js";
import { shouldBehaveLikeClaimable } from "./Claimable.behaviour.js";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import envSetup from "@utils/env_setup";

const DelayedClaimableGovernance = artifacts.require("DelayedClaimableGovernance");
envSetup.configure();

contract("DelayedClaimableGovernance", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const GOVERNANCE_DELAY = 60 * 60 * 24 * 7; // 1 week
    let governance;

    beforeEach("Create Contract", async () => {
        console.log("IIIII");
        governance = await DelayedClaimableGovernance.new(GOVERNANCE_DELAY);
    });

    describe("Test1", () => {
    });

    describe("Test2", () => {

    });
    describe("Test3", async () => {
        it("testtt", async () => {
            const gov = await governance.governor();
            console.log("GOVV : " + governance);
        });

    });

    shouldBehaveLikeGovernble(governance, sa.governor, [sa.default]);
});
