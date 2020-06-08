import { StandardAccounts } from "@utils/machines";
import { BN } from "@utils/tools";
import envSetup from "@utils/env_setup";
import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import * as t from "types/generated";

const { expect } = envSetup.configure();

export default function shouldBehaveLikeDelayedClaimable(
    ctx: { claimable: t.DelayedClaimableGovernorInstance },
    sa: StandardAccounts,
): void {
    it("should have delay set", async () => {
        const delay = await ctx.claimable.delay();
        expect(delay, "wrong delay").bignumber.gt(new BN(0) as any);
    });

    it("should have request time set", async () => {
        const timestamp = await time.latest();
        const requestTime = await ctx.claimable.requestTime();
        expect(requestTime, "requestTime is 0").bignumber.gt(new BN(0) as any);
        expect(timestamp, "wrong timestamp").bignumber.eq(requestTime);
    });

    it("prevent newGovernor to claim ownership before delay over", async () => {
        const newOwner = sa.other;
        await expectRevert(ctx.claimable.claimGovernorChange({ from: newOwner }), "Delay not over");
        const owner = await ctx.claimable.governor();

        expect(owner, "wrong owner").to.not.equal(newOwner);
    });

    it("prevent newOwner to claim ownership before 10 second of delay over time", async () => {
        const timestamp = await time.latest();
        const delay = await ctx.claimable.delay();
        await time.increase(delay.sub(new BN(10)));

        const newOwner = sa.other;
        await expectRevert(ctx.claimable.claimGovernorChange({ from: newOwner }), "Delay not over");
        const owner = await ctx.claimable.governor();
        const requestTime = await ctx.claimable.requestTime();

        expect(owner, "wrong owner").to.not.equal(newOwner);
        expect(requestTime, "wrong requestTime").bignumber.eq(timestamp);
    });

    it("allow pending owner to claim ownership after delay over", async () => {
        const timestamp = await time.latest();
        const delay = await ctx.claimable.delay();
        await time.increase(delay);
        const previousGov = await ctx.claimable.governor();
        const newGovernor = sa.other;
        const tx = await ctx.claimable.claimGovernorChange({ from: newGovernor });
        expectEvent(tx.receipt, "GovernorChangeClaimed", { proposedGovernor: newGovernor });
        expectEvent(tx.receipt, "GovernorChanged", {
            previousGovernor: previousGov,
            newGovernor,
        });

        const owner = await ctx.claimable.governor();
        const requestTime = await ctx.claimable.requestTime();
        expect(owner, "owner not equal").to.equal(newGovernor);
        expect(requestTime, "wrong requestTime").bignumber.eq(new BN(0));
    });

    it("should allow cancel change request", async () => {
        const requestTime = await ctx.claimable.requestTime();
        expect(requestTime, "wrong requestTime").bignumber.gt(new BN(0) as any);

        const tx = await ctx.claimable.cancelGovernorChange({ from: sa.governor });

        const newRequestTime = await ctx.claimable.requestTime();
        expect(newRequestTime).bignumber.eq(new BN(0));
    });
}
