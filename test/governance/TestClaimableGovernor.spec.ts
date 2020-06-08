import { StandardAccounts } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { ClaimableGovernorInstance } from "../../types/generated";
import shouldBehaveLikeClaimable from "./ClaimableGovernor.behaviour";

const ClaimableGovernor = artifacts.require("ClaimableGovernor");
const { assert } = envSetup.configure();

contract("ClaimableGovernable", async (accounts) => {
    const ctx: { claimable?: ClaimableGovernorInstance } = {};
    const sa = new StandardAccounts(accounts);

    beforeEach("Create Contract", async () => {
        ctx.claimable = await ClaimableGovernor.new(sa.governor);
    });

    shouldBehaveLikeClaimable(ctx as Required<typeof ctx>, sa);

    describe("after initiating a transfer", () => {
        let newOwner;

        beforeEach(async () => {
            newOwner = sa.other;
            await ctx.claimable.requestGovernorChange(newOwner, { from: sa.governor });
        });

        it("changes allow pending owner to claim ownership", async () => {
            await ctx.claimable.claimGovernorChange({ from: newOwner });
            const owner = await ctx.claimable.governor();

            assert.isTrue(owner === newOwner);
        });
    });
});
