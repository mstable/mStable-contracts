import { expect } from "chai"
import { ClaimableGovernor } from "types/generated/ClaimableGovernor"
import { ZERO_ADDRESS } from "@utils/constants"
import { Account } from "types"

export interface IClaimableGovernableBehaviourContext {
    claimable: ClaimableGovernor
    default: Account
    governor: Account
    other: Account
}

export function shouldBehaveLikeClaimable(ctx: IClaimableGovernableBehaviourContext): void {
    it("should have a governor", async () => {
        const governor = await ctx.claimable.governor()
        expect(governor !== ZERO_ADDRESS).to.equal(true)
    })

    it("changes pendingGovernor after transfer", async () => {
        const newGovernor = ctx.other
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(newGovernor.address)
        const proposedGovernor = await ctx.claimable.proposedGovernor()

        expect(proposedGovernor === newGovernor.address).to.equal(true)
    })

    it("should prevent cancelGovernor from non-governor", async () => {
        // Request new Governor
        const newGovernor = ctx.other
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(newGovernor.address)
        const proposedGovernor = await ctx.claimable.proposedGovernor()
        expect(proposedGovernor === newGovernor.address).to.equal(true)

        // Try to Cancel governor
        await expect(ctx.claimable.connect(ctx.default.signer).cancelGovernorChange()).to.be.revertedWith("GOV: caller is not the Governor")
        const newProposedGovernor = await ctx.claimable.proposedGovernor()
        expect(proposedGovernor === newProposedGovernor).to.equal(true)
    })

    it("should prevent cancelGovernor from pending-governor", async () => {
        // Request new Governor
        const newGovernor = ctx.other
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(newGovernor.address)
        const proposedGovernor = await ctx.claimable.proposedGovernor()
        expect(proposedGovernor === newGovernor.address).to.equal(true)

        // Try to Cancel governor
        await expect(ctx.claimable.connect(ctx.other.signer).cancelGovernorChange()).to.be.revertedWith("GOV: caller is not the Governor")
        const newProposedGovernor = await ctx.claimable.proposedGovernor()
        expect(proposedGovernor === newProposedGovernor).to.equal(true)
    })

    it("should allow cancelGovernor from Governor", async () => {
        // Request new Governor
        const newGovernor = ctx.other
        const currentGovernor = await ctx.claimable.governor()
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(newGovernor.address)
        const proposedGovernor = await ctx.claimable.proposedGovernor()
        expect(proposedGovernor === newGovernor.address).to.equal(true)

        // Try to Cancel governor
        await ctx.claimable.connect(ctx.governor.signer).cancelGovernorChange()
        const newProposedGovernor = await ctx.claimable.proposedGovernor()
        const governor = await ctx.claimable.governor()

        expect(proposedGovernor !== ZERO_ADDRESS).to.equal(true)
        expect(newProposedGovernor === ZERO_ADDRESS).to.equal(true)
        expect(governor === currentGovernor).to.equal(true)
    })

    it("should prevent Others to call claimOwnership when there is no pendingGovernor", async () => {
        await expect(ctx.claimable.connect(ctx.other.signer).claimGovernorChange()).to.be.revertedWith("Sender is not proposed governor")
    })

    it("should prevent Governor to call claimOwnership when there is no pendingGovernor", async () => {
        await expect(ctx.claimable.connect(ctx.governor.signer).claimGovernorChange()).to.be.revertedWith("Sender is not proposed governor")
    })

    it("should prevent non-governors from transfering", async () => {
        const governor = await ctx.claimable.governor()

        expect(governor !== ctx.other.address).to.equal(true)
        await expect(ctx.claimable.connect(ctx.other.signer).requestGovernorChange(ctx.other.address)).to.be.revertedWith(
            "GOV: caller is not the Governor",
        )
    })

    it("should prevent direct change governor", async () => {
        await expect(ctx.claimable.connect(ctx.governor.signer).changeGovernor(ctx.other.address)).to.be.revertedWith(
            "Direct change not allowed",
        )
    })

    it("requestGovernorChange(): should prevent zero address", async () => {
        // NOTE - false negative when passing specific error string
        await expect(ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(ZERO_ADDRESS)).to.be.reverted
    })

    it("should prevent when already proposed", async () => {
        await ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(ctx.other.address)
        await expect(ctx.claimable.connect(ctx.governor.signer).requestGovernorChange(ctx.other.address)).to.be.revertedWith(
            "Proposed governor already set",
        )
    })

    it("cancelGovernorChange(): should prevent when not proposed", async () => {
        await expect(ctx.claimable.connect(ctx.governor.signer).cancelGovernorChange()).to.be.revertedWith("Proposed Governor not set")
    })
}
