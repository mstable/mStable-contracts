import { SuiteWithContext } from "../../types/mocha";
import { ClaimableGovernorInstance } from "../../types/generated";

// FIXME these don't exist yet
const { ZEPPELIN_LOCATION } = require("../helper.js");
const { assertRevert } = require(ZEPPELIN_LOCATION +
    "openzeppelin-solidity/test/helpers/assertRevert");

const ClaimableGovernor = artifacts.require("ClaimableGovernor");

export function shouldBehaveLikeClaimable(
    this: SuiteWithContext<{ claimable: ClaimableGovernorInstance }>,
    accounts: string[],
) {
    it("should have an owner", async () => {
        const owner = await this.claimable.owner();
        assert.isTrue(owner !== 0);
    });

    it("changes pendingOwner after transfer", async () => {
        const newOwner = accounts[1];
        await this.claimable.transferOwnership(newOwner);
        const pendingOwner = await this.claimable.pendingOwner();

        assert.isTrue(pendingOwner === newOwner);
    });

    it("should prevent to claimOwnership from no pendingOwner", async () => {
        await assertRevert(this.claimable.claimOwnership({ from: accounts[2] }));
    });

    it("should prevent non-owners from transfering", async () => {
        const other = accounts[2];
        const owner = await this.claimable.owner.call();

        assert.isTrue(owner !== other);
        await assertRevert(this.claimable.transferOwnership(other, { from: other }));
    });

    describe("after initiating a transfer", () => {
        let newOwner;

        beforeEach(async () => {
            newOwner = accounts[1];
            await this.claimable.transferOwnership(newOwner);
        });

        it("changes allow pending owner to claim ownership", async () => {
            await this.claimable.claimOwnership({ from: newOwner });
            const owner = await this.claimable.owner();

            assert.isTrue(owner === newOwner);
        });
    });
}
