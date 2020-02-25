import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { GovernableInstance } from "types/generated";

const { ZERO_ADDRESS } = constants;

export default function shouldBehaveLikeGovernable(
    ctx: { governable: GovernableInstance },
    owner: string,
    [other]: string[],
) {
    describe("as a Governable", () => {
        it("should have a Governor", async () => {
            (await ctx.governable.governor()).should.equal(owner);
        });

        it("changes governor after transfer", async () => {
            (await ctx.governable.isGovernor({ from: other })).should.be.equal(false);
            const { logs } = await ctx.governable.changeGovernor(other, { from: owner });
            expectEvent.inLogs(logs, "GovernorChanged");

            (await ctx.governable.governor()).should.equal(other);
            (await ctx.governable.isGovernor({ from: other })).should.be.equal(true);
        });

        it("should prevent non-governor from changing governor", async () => {
            await shouldFail.reverting.withMessage(
                ctx.governable.changeGovernor(other, { from: other }),
                "GOV: caller is not the Governor",
            );
        });

        it("should guard ownership against stuck state", async () => {
            await shouldFail.reverting.withMessage(
                ctx.governable.changeGovernor(ZERO_ADDRESS, { from: owner }),
                "GOV: new Governor is address(0)",
            );
        });
    });
}
