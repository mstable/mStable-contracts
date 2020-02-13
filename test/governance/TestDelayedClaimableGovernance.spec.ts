import { shouldBehaveLikeGovernable } from "./Governable.behaviour";
import { shouldBehaveLikeClaimable } from "./Claimable.behaviour";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { SuiteWithContext } from "../../types/mocha";
import { GovernableInstance } from "../../types/generated";

const DelayedClaimableGovernance = artifacts.require("DelayedClaimableGovernance");
envSetup.configure();

contract("DelayedClaimableGovernance", async function(
    this: SuiteWithContext<{
        governance: GovernableInstance;
    }>,
    accounts,
) {
    const sa = new StandardAccounts(accounts);
    const GOVERNANCE_DELAY = 60 * 60 * 24 * 7; // 1 week

    beforeEach("Create Contract", async () => {
        this.governance = await DelayedClaimableGovernance.new(GOVERNANCE_DELAY);
    });

    // describe("Test1", () => {});
    //
    // describe("Test2", () => {});
    // describe("Test3", async () => {
    //     it("testtt", async () => {
    //         const gov = await governance.governor();
    //         console.log("GOVV : " + governance);
    //     });
    // });

    shouldBehaveLikeGovernable.bind(this, sa.governor, accounts);
});
