import { shouldBehaveLikeGovernable } from "./Governable.behaviour";
import { shouldBehaveLikeClaimable } from "./ClaimableGovernor.behaviour";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { GovernableInstance } from "../../types/generated";

const DelayedClaimableGovernance = artifacts.require("DelayedClaimableGovernance");
envSetup.configure();

contract("DelayedClaimableGovernance", async (accounts) => {
    const ctx: { governable?: GovernableInstance } = {};
    const sa = new StandardAccounts(accounts);
    const GOVERNANCE_DELAY = 60 * 60 * 24 * 7; // 1 week

    beforeEach("Create Contract", async () => {
        ctx.governable = await DelayedClaimableGovernance.new(
            sa.governor,
            GOVERNANCE_DELAY,
            { from: sa.governor });
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

    //shouldBehaveLikeGovernable(ctx as Required<typeof ctx>, sa.governor, [sa.other]);
});
