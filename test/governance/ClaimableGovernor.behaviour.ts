import { ClaimableGovernorInstance } from "../../types/generated";
import { StandardAccounts } from "@utils/machines";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
const { ZERO_ADDRESS } = constants;

const ClaimableGovernor = artifacts.require("ClaimableGovernor");

export function shouldBehaveLikeClaimable(
    ctx: { claimable: ClaimableGovernorInstance },
    sa: StandardAccounts,
) {
    it("should have a governor", async () => {
        const governor = await ctx.claimable.governor();
        assert.isTrue(governor !== ZERO_ADDRESS);
    });

    it("changes pendingGovernor after transfer", async () => {
        const newGovernor = sa.other;
        await ctx.claimable.requestGovernorChange(newGovernor, { from: sa.governor });
        const proposedGovernor = await ctx.claimable.proposedGovernor();

        assert.isTrue(proposedGovernor === newGovernor);
    });

    it("should prevent cancelGovernor from non-governor", async () => {
        // Request new Governor
        const newGovernor = sa.other;
        await ctx.claimable.requestGovernorChange(newGovernor, { from: sa.governor });
        const proposedGovernor = await ctx.claimable.proposedGovernor();
        assert.isTrue(proposedGovernor === newGovernor);

        // Try to Cancel governor
        await shouldFail.reverting.withMessage(
            ctx.claimable.cancelGovernorChange({ from: sa._ }),
            "GOV: caller is not the Governor",
        );
        const newProposedGovernor = await ctx.claimable.proposedGovernor();
        assert.isTrue(proposedGovernor === newProposedGovernor);
    });

    it("should prevent cancelGovernor from pending-governor", async () => {
        // Request new Governor
        const newGovernor = sa.other;
        await ctx.claimable.requestGovernorChange(newGovernor, { from: sa.governor });
        const proposedGovernor = await ctx.claimable.proposedGovernor();
        assert.isTrue(proposedGovernor === newGovernor);

        // Try to Cancel governor
        await shouldFail.reverting.withMessage(
            ctx.claimable.cancelGovernorChange({ from: sa.other }),
            "GOV: caller is not the Governor",
        );
        const newProposedGovernor = await ctx.claimable.proposedGovernor();
        assert.isTrue(proposedGovernor === newProposedGovernor);
    });

    it("should allow cancelGovernor from Governor", async () => {
        // Request new Governor
        const newGovernor = sa.other;
        const currentGovernor = await ctx.claimable.governor();
        await ctx.claimable.requestGovernorChange(newGovernor, { from: sa.governor });
        const proposedGovernor = await ctx.claimable.proposedGovernor();
        assert.isTrue(proposedGovernor === newGovernor);

        // Try to Cancel governor
        await ctx.claimable.cancelGovernorChange({ from: sa.governor });
        const newProposedGovernor = await ctx.claimable.proposedGovernor();
        const governor = await ctx.claimable.governor();

        assert.isTrue(proposedGovernor !== ZERO_ADDRESS);
        assert.isTrue(newProposedGovernor === ZERO_ADDRESS);
        assert.isTrue(governor === currentGovernor);
    });

    it("should prevent Others to call claimOwnership when there is no pendingGovernor", async () => {
        await shouldFail.reverting.withMessage(
            ctx.claimable.claimGovernorChange({ from: sa.other }),
            "Sender is not proposed governor",
        );
    });

    it("should prevent Governor to call claimOwnership when there is no pendingGovernor", async () => {
        await shouldFail.reverting.withMessage(
            ctx.claimable.claimGovernorChange({ from: sa.governor }),
            "Sender is not proposed governor",
        );
    });

    it("should prevent non-governors from transfering", async () => {
        const other = sa.other;
        const governor = await ctx.claimable.governor();

        assert.isTrue(governor !== other);
        await shouldFail.reverting.withMessage(
            ctx.claimable.requestGovernorChange(other, { from: other }),
            "GOV: caller is not the Governor",
        );
    });

    it("should prevent direct change governor", async () => {
        const other = sa.other;
        await shouldFail.reverting.withMessage(
            ctx.claimable.changeGovernor(other, { from: sa.governor }),
            "Direct change not allowed",
        );
    });

    it("requestGovernorChange(): should prevent zero address", async () => {
        await shouldFail.reverting.withMessage(
            ctx.claimable.requestGovernorChange(ZERO_ADDRESS, { from: sa.governor }),
            "Proposed governor is address(0)",
        );
    });

    it("should prevent when already proposed", async () => {
        const other = sa.other;
        await ctx.claimable.requestGovernorChange(other, { from: sa.governor });
        await shouldFail.reverting.withMessage(
            ctx.claimable.requestGovernorChange(other, { from: sa.governor }),
            "Proposed governor already set",
        );
    });

    it("cancelGovernorChange(): should prevent when not proposed", async () => {
        await shouldFail.reverting.withMessage(
            ctx.claimable.cancelGovernorChange({ from: sa.governor }),
            "Proposed Governor not set",
        );
    });
}
