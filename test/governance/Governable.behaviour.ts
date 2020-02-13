import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { GovernableInstance } from "../../types/generated";
import { SuiteWithContext } from "../../types/mocha";

const { ZERO_ADDRESS } = constants;

export function shouldBehaveLikeGovernable(
    this: SuiteWithContext<{ governance: GovernableInstance }>,
    owner: string,
    [other]: string[],
) {
    describe("as an Governable", () => {
        it("should have a Governor", async () => {
            (await this.governance.governor()).should.equal(owner);
        });

        it("changes governor after transfer", async () => {
            (await this.governance.isGovernor({ from: other })).should.be.equal(false);
            const { logs } = await this.governance.changeGovernor(other, { from: owner });
            expectEvent.inLogs(logs, "GovernorChanged");

            (await this.governance.governor()).should.equal(other);
            (await this.governance.isGovernor({ from: other })).should.be.equal(true);
        });

        it("should prevent non-governor from changing governor", async () => {
            await shouldFail.reverting.withMessage(
                this.governance.changeGovernor(other, { from: other }),
                "Governable: caller is not the Governor",
            );
        });

        it("should guard ownership against stuck state", async () => {
            await shouldFail.reverting.withMessage(
                this.governance.changeGovernor(ZERO_ADDRESS, { from: owner }),
                "Governable: new Governor is the zero address",
            );
        });
    });
}
