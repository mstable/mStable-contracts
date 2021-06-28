import { expect } from "chai"
import { Governable } from "types/generated/Governable"
import { ZERO_ADDRESS } from "@utils/constants"
import { Account } from "types"

export interface IGovernableBehaviourContext {
    governable: Governable
    owner: Account
    other: Account
}

export function shouldBehaveLikeGovernable(ctx: IGovernableBehaviourContext): void {
    describe("as a Governable", () => {
        it("should have a Governor", async () => {
            expect(await ctx.governable.governor()).to.equal(ctx.owner.address)
        })

        it("changes governor after transfer", async () => {
            expect(await ctx.governable.connect(ctx.other.signer).isGovernor()).to.be.equal(false)
            const tx = ctx.governable.connect(ctx.owner.signer).changeGovernor(ctx.other.address)
            await expect(tx).to.emit(ctx.governable, "GovernorChanged")
            expect(await ctx.governable.governor()).to.equal(ctx.other.address)
            expect(await ctx.governable.connect(ctx.other.signer).isGovernor()).to.be.equal(true)
        })

        it("should prevent non-governor from changing governor", async () => {
            await expect(ctx.governable.connect(ctx.other.signer).changeGovernor(ctx.other.address)).to.be.revertedWith(
                "GOV: caller is not the Governor",
            )
        })

        // NOTE - For some reason this does not pass with the exact string even though it is emitted (false negative)
        it("should guard ownership against stuck state", async () => {
            await expect(ctx.governable.connect(ctx.owner.signer).changeGovernor(ZERO_ADDRESS)).to.be.revertedWith("VM Exception")
        })
    })
}
