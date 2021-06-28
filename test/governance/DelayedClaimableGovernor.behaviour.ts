import { expect } from "chai"
import { Account } from "types"
import { BN } from "@utils/math"
import { getTimestamp, increaseTime } from "@utils/time"
import { DelayedClaimableGovernor } from "types/generated"

export interface IGovernableBehaviourContext {
    claimable: DelayedClaimableGovernor
    default: Account
    governor: Account
    other: Account
}

export function shouldBehaveLikeDelayedClaimable(ctx: IGovernableBehaviourContext): void {
    it("should have delay set", async () => {
        const delay = await ctx.claimable.delay()
        expect(delay, "wrong delay").gt(BN.from(0))
    })

    it("should have request time set", async () => {
        const timestamp = await getTimestamp()
        const requestTime = await ctx.claimable.requestTime()
        expect(requestTime, "requestTime is 0").gt(BN.from(0))
        expect(timestamp, "wrong timestamp").eq(requestTime)
    })

    it("prevent newGovernor to claim ownership before delay over", async () => {
        const newOwner = ctx.other
        await expect(ctx.claimable.connect(newOwner.signer).claimGovernorChange()).to.be.revertedWith("Delay not over")
        const owner = await ctx.claimable.governor()

        expect(owner, "wrong owner").to.not.equal(newOwner)
    })

    it("prevent newOwner to claim ownership before 10 second of delay over time", async () => {
        const timestamp = await getTimestamp()
        const delay = await ctx.claimable.delay()
        await increaseTime(delay.sub(BN.from(10)))

        const newOwner = ctx.other
        await expect(ctx.claimable.connect(newOwner.signer).claimGovernorChange()).to.be.revertedWith("Delay not over")
        const owner = await ctx.claimable.governor()
        const requestTime = await ctx.claimable.requestTime()

        expect(owner, "wrong owner").to.not.equal(newOwner)
        expect(requestTime, "wrong requestTime").eq(timestamp)
    })

    it("allow pending owner to claim ownership after delay over", async () => {
        const delay = await ctx.claimable.delay()
        await increaseTime(delay)
        const previousGov = await ctx.claimable.governor()
        const newGovernor = ctx.other
        const tx = ctx.claimable.connect(newGovernor.signer).claimGovernorChange()
        await expect(tx).to.emit(ctx.claimable, "GovernorChangeClaimed").withArgs(newGovernor.address)
        await expect(tx).to.emit(ctx.claimable, "GovernorChanged").withArgs(previousGov, newGovernor.address)

        const owner = await ctx.claimable.governor()
        const requestTime = await ctx.claimable.requestTime()
        expect(owner, "owner not equal").to.equal(newGovernor.address)
        expect(requestTime, "wrong requestTime").eq(BN.from(0))
    })

    it("should allow cancel change request", async () => {
        const requestTime = await ctx.claimable.requestTime()
        expect(requestTime, "wrong requestTime").gt(BN.from(0))

        await ctx.claimable.connect(ctx.governor.signer).cancelGovernorChange()

        const newRequestTime = await ctx.claimable.requestTime()
        expect(newRequestTime).eq(BN.from(0))
    })
}
