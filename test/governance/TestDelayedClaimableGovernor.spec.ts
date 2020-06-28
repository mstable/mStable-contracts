import { StandardAccounts } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { expectRevert } from "@openzeppelin/test-helpers";
import * as t from "types/generated";
import shouldBehaveLikeClaimable from "./ClaimableGovernor.behaviour";
import shouldBehaveLikeDelayedClaimable from "./DelayedClaimableGovernor.behaviour";

const DelayedClaimableGovernor = artifacts.require("DelayedClaimableGovernor");

contract("DelayedClaimableGovernance", async (accounts) => {
    const ctx: { claimable?: t.DelayedClaimableGovernorInstance } = {};
    const sa = new StandardAccounts(accounts);
    const GOVERNANCE_DELAY = 60 * 60 * 24 * 7; // 1 week

    describe("Should behave like Claimable", () => {
        beforeEach("Create Contract", async () => {
            ctx.claimable = await DelayedClaimableGovernor.new(sa.governor, GOVERNANCE_DELAY, {
                from: sa.governor,
            });
        });

        shouldBehaveLikeClaimable(ctx as Required<typeof ctx>, sa);
    });

    describe("Should behave like DelayedClaimable", () => {
        beforeEach("Initiate change Governor", async () => {
            ctx.claimable = await DelayedClaimableGovernor.new(sa.governor, GOVERNANCE_DELAY, {
                from: sa.governor,
            });
            const { other } = sa;
            await ctx.claimable.requestGovernorChange(other, { from: sa.governor });
        });

        shouldBehaveLikeDelayedClaimable(ctx as Required<typeof ctx>, sa);

        it("should not allow zero delay", async () => {
            await expectRevert(
                DelayedClaimableGovernor.new(sa.governor, 0, { from: sa.governor }),
                "Delay must be greater than zero",
            );
        });
    });
});
