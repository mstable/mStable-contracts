import { GovernableInstance, MassetRewardsInstance } from "../../types/generated";
import { shouldBehaveLikeGovernable } from "../governance/Governable.behaviour";
import { StandardAccounts } from "@utils/machines";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
const { ZERO_ADDRESS } = constants;

export function shouldBehaveLikeMassetRewards(
    ctx: { massetRewards: MassetRewardsInstance; governable: GovernableInstance },
    sa: StandardAccounts,
) {
    describe("Should behave like Governed", () => {
        shouldBehaveLikeGovernable(ctx as Required<typeof ctx>, sa.governor, [sa.other]);
    });

    // describe("Contract deployed", async () => {
    //     it("Should have valid parameters", async () => {
    //         assert((await ctx.massetRewards.mUSD()) === masset.address);
    //         assert((await ctx.massetRewards.MTA()) === systemMachine.systok.address);
    //         assert((await ctx.massetRewards.governor()) === sa.governor);
    //     });
    // });
}
