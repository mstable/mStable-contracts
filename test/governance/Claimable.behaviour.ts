import { ClaimableGovernorInstance } from "../../types/generated";

// FIXME these don't exist yet
const { ZEPPELIN_LOCATION } = require("../helper.js");
const { assertRevert } = require(ZEPPELIN_LOCATION +
    "openzeppelin-solidity/test/helpers/assertRevert");

const ClaimableGovernor = artifacts.require("ClaimableGovernor");

export function shouldBehaveLikeClaimable(
    ctx: { claimable: ClaimableGovernorInstance },
    accounts: string[],
) {
    it("should have an owner", async () => {
        const owner = await ctx.claimable.owner();
        assert.isTrue(owner !== 0);
    });

    it("changes pendingOwner after transfer", async () => {
        const newOwner = accounts[1];
        await ctx.claimable.transferOwnership(newOwner);
        const pendingOwner = await ctx.claimable.pendingOwner();

        assert.isTrue(pendingOwner === newOwner);
    });

    it("should prevent to claimOwnership from no pendingOwner", async () => {
        await assertRevert(ctx.claimable.claimOwnership({ from: accounts[2] }));
    });

    it("should prevent non-owners from transfering", async () => {
        const other = accounts[2];
        const owner = await ctx.claimable.owner.call();

        assert.isTrue(owner !== other);
        await assertRevert(ctx.claimable.transferOwnership(other, { from: other }));
    });

    describe("after initiating a transfer", () => {
        let newOwner;

        beforeEach(async () => {
            newOwner = accounts[1];
            await ctx.claimable.transferOwnership(newOwner);
        });

        it("changes allow pending owner to claim ownership", async () => {
            await ctx.claimable.claimOwnership({ from: newOwner });
            const owner = await ctx.claimable.owner();

            assert.isTrue(owner === newOwner);
        });
    });
}
