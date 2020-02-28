import { StandardAccounts } from "@utils/machines";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { GovernableInstance, MassetRewardsInstance } from "types/generated";
import shouldBehaveLikeGovernable from "../governance/Governable.behaviour";

const { ZERO_ADDRESS } = constants;

export default function shouldBehaveLikeMassetRewards(
    ctx: { massetRewards: MassetRewardsInstance; governable: GovernableInstance },
    sa: StandardAccounts,
) {
    describe("Should behave like Governed", () => {
        shouldBehaveLikeGovernable(ctx as Required<typeof ctx>, sa.governor, [sa.other]);
    });

    // describe("Contract deployed", async () => {
    //     it("Should have valid parameters", async () => {
    //         assert((await ctx.massetRewards.mUSD()) === masset.address);
    //         assert((await ctx.massetRewards.MTA()) === systemMachine.metaToken.address);
    //         assert((await ctx.massetRewards.governor()) === sa.governor);
    //     });
    // });
}
