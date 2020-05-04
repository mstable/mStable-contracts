import { constants, expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import * as t from "types/generated";

const { ZERO_ADDRESS } = constants;

export default function shouldBehaveLikeGovernable(
    ctx: { governable: t.GovernableInstance },
    owner: string,
    [other]: string[],
): void {
    describe("as a Governable", () => {
        it("should have a Governor", async () => {
            (await ctx.governable.governor()).should.equal(owner);
        });

        it("changes governor after transfer", async () => {
            (await ctx.governable.isGovernor({ from: other })).should.be.equal(false);
            const { receipt } = await ctx.governable.changeGovernor(other, { from: owner });
            expectEvent(receipt, "GovernorChanged");

            (await ctx.governable.governor()).should.equal(other);
            (await ctx.governable.isGovernor({ from: other })).should.be.equal(true);
        });

        it("should prevent non-governor from changing governor", async () => {
            await expectRevert(
                ctx.governable.changeGovernor(other, { from: other }),
                "GOV: caller is not the Governor",
            );
        });

        it("should guard ownership against stuck state", async () => {
            await expectRevert(
                ctx.governable.changeGovernor(ZERO_ADDRESS, { from: owner }),
                "GOV: new Governor is address(0)",
            );
        });
    });
}
