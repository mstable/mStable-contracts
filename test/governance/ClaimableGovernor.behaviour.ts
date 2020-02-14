import { ClaimableGovernorInstance } from "../../types/generated";

import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
const { ZERO_ADDRESS } = constants;

const ClaimableGovernor = artifacts.require("ClaimableGovernor");

export function shouldBehaveLikeClaimable(
    ctx: { claimable: ClaimableGovernorInstance },
    accounts: string[],
) {
    it("should have a governor", async () => {
        const governor = await ctx.claimable.governor();
        assert.isTrue(governor !== ZERO_ADDRESS);
    });

    it("changes pendingGovernor after transfer", async () => {
        const newGovernor = accounts[1];
        await ctx.claimable.requestGovernorChange(newGovernor);
        const proposedGovernor = await ctx.claimable.proposedGovernor();

        assert.isTrue(proposedGovernor === newGovernor);
    });

    it("should prevent cancelGovernor from non-governor", async () => {
        // Request new Governor
        const newGovernor = accounts[1];
        await ctx.claimable.requestGovernorChange(newGovernor);
        const proposedGovernor = await ctx.claimable.proposedGovernor();
        assert.isTrue(proposedGovernor === newGovernor);

        // Try to Cancel governor
        await shouldFail.reverting.withMessage(
            ctx.claimable.cancelGovernorChange({ from: accounts[2] }),
            "Governable: caller is not the Governor");
        const newProposedGovernor = await ctx.claimable.proposedGovernor();
        assert.isTrue(proposedGovernor === newProposedGovernor);
    });

    it("should allow cancelGovernor from Governor", async () => {
        // Request new Governor
        const newGovernor = accounts[1];
        const currentGovernor = await ctx.claimable.governor();
        await ctx.claimable.requestGovernorChange(newGovernor);
        const proposedGovernor = await ctx.claimable.proposedGovernor();
        assert.isTrue(proposedGovernor === newGovernor);

        // Try to Cancel governor
        await ctx.claimable.cancelGovernorChange();
        const newProposedGovernor = await ctx.claimable.proposedGovernor();
        const governor = await ctx.claimable.governor();

        assert.isTrue(proposedGovernor !== ZERO_ADDRESS);
        assert.isTrue(newProposedGovernor === ZERO_ADDRESS);
        assert.isTrue(governor === currentGovernor);
    });

    it("should prevent to claimOwnership from no pendingGovernor", async () => {
        await shouldFail.reverting.withMessage(
            ctx.claimable.claimGovernorChange({ from: accounts[2] }),
            "Sender is not a proposed governor");
    });

    it("should prevent non-governors from transfering", async () => {
        const other = accounts[2];
        const governor = await ctx.claimable.governor();

        assert.isTrue(governor !== other);
        await shouldFail.reverting.withMessage(
            ctx.claimable.requestGovernorChange(other, { from: other }),
            "Governable: caller is not the Governor");
    });

    describe("after initiating a transfer", () => {
        let newOwner;

        beforeEach(async () => {
            newOwner = accounts[1];
            await ctx.claimable.requestGovernorChange(newOwner);
        });

        it("changes allow pending owner to claim ownership", async () => {
            await ctx.claimable.claimGovernorChange({ from: newOwner });
            const owner = await ctx.claimable.governor();

            assert.isTrue(owner === newOwner);
        });
    });
}
