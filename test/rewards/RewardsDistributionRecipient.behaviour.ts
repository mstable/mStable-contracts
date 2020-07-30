import * as t from "types/generated";
import { StandardAccounts } from "@utils/machines";
import { constants, expectRevert } from "@openzeppelin/test-helpers";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const { ZERO_ADDRESS } = constants;

function behaveLikeAModule(
    ctx: {
        module: t.ModuleInstance;
    },
    sa: StandardAccounts,
): void {
    return shouldBehaveLikeModule(ctx, sa);
}

export default function shouldBehaveLikeDistributionRecipient(
    ctx: {
        recipient: t.RewardsDistributionRecipientInstance;
    },
    moduleCtx: {
        module: t.ModuleInstance;
    },
    sa: StandardAccounts,
): void {
    behaveLikeAModule(moduleCtx, sa);

    it("should have a distributor", async () => {
        const distributor = await ctx.recipient.rewardsDistributor();
        assert.isTrue(distributor !== ZERO_ADDRESS);
    });

    it("should allow governor to change the distributor", async () => {
        const newDistributor = sa.other;
        await ctx.recipient.setRewardsDistribution(newDistributor, { from: sa.governor });
        assert.isTrue((await ctx.recipient.rewardsDistributor()) === newDistributor);
    });

    it("should prevent change from non-governor", async () => {
        const newDistributor = sa.other;
        const oldDistributor = await ctx.recipient.rewardsDistributor();
        await expectRevert(
            ctx.recipient.setRewardsDistribution(newDistributor, { from: sa.default }),
            "Only governor can execute",
        );
        assert.isTrue((await ctx.recipient.rewardsDistributor()) === oldDistributor);
    });
}
