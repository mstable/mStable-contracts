import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { GovernableInstance } from "../../types/generated";

const { ZERO_ADDRESS } = constants;

export function shouldBehaveLikeGovernable(
    ctx: { governance: GovernableInstance },
    owner: string,
    [other]: string[],
) {
    describe("as a Governable", () => {
        it("should have a Governor", async () => {
            (await ctx.governance.governor()).should.equal(owner);
        });

        it("changes governor after transfer", async () => {
            (await ctx.governance.isGovernor({ from: other })).should.be.equal(false);
            const { logs } = await ctx.governance.changeGovernor(other, { from: owner });
            expectEvent.inLogs(logs, "GovernorChanged");

            (await ctx.governance.governor()).should.equal(other);
            (await ctx.governance.isGovernor({ from: other })).should.be.equal(true);
        });

        it("should prevent non-governor from changing governor", async () => {
            await shouldFail.reverting.withMessage(
                ctx.governance.changeGovernor(other, { from: other }),
                "Governable: caller is not the Governor",
            );
        });

        it("should guard ownership against stuck state", async () => {
            await shouldFail.reverting.withMessage(
                ctx.governance.changeGovernor(ZERO_ADDRESS, { from: owner }),
                "Governable: new Governor is the zero address",
            );
        });
    });
}
