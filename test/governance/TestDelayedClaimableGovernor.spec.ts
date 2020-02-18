import { shouldBehaveLikeClaimable } from "./ClaimableGovernor.behaviour";
import { shouldBehaveLikeDelayedClaimable } from "./DelayedClaimableGovernor.behaviour";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { DelayedClaimableGovernorInstance } from "../../types/generated";

const DelayedClaimableGovernor = artifacts.require("DelayedClaimableGovernor");
envSetup.configure();

contract("DelayedClaimableGovernance", async (accounts) => {
    const ctx: { claimable?: DelayedClaimableGovernorInstance } = {};
    const sa = new StandardAccounts(accounts);
    const GOVERNANCE_DELAY = 60 * 60 * 24 * 7; // 1 week

    describe("Should behave like Claimable", () => {
        beforeEach("Create Contract", async () => {
            ctx.claimable = await DelayedClaimableGovernor.new(
                sa.governor,
                GOVERNANCE_DELAY,
                { from: sa.governor });
        });

        shouldBehaveLikeClaimable(ctx as Required<typeof ctx>, sa);
    });

    describe("Should behave like DelayedClaimable", () => {
        beforeEach("Initiate change Governor", async () => {
            ctx.claimable = await DelayedClaimableGovernor.new(
                sa.governor,
                GOVERNANCE_DELAY,
                { from: sa.governor });
            const other = sa.other;
            ctx.claimable.requestGovernorChange(other, { from: sa.governor });
        });

        shouldBehaveLikeDelayedClaimable(ctx as Required<typeof ctx>, sa);
    });

});
