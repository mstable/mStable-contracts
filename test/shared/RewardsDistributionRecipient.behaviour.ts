import { expect } from "chai"
import { ZERO_ADDRESS } from "@utils/constants"
import { InitializableRewardsDistributionRecipient } from "types/generated"
import { IModuleBehaviourContext, shouldBehaveLikeModule } from "./Module.behaviour"

function behaveLikeAModule(ctx: IModuleBehaviourContext): void {
    return shouldBehaveLikeModule(ctx)
}

export interface IRewardsDistributionRecipientContext extends IModuleBehaviourContext {
    recipient: InitializableRewardsDistributionRecipient
}

export function shouldBehaveLikeDistributionRecipient(ctx: IRewardsDistributionRecipientContext): void {
    behaveLikeAModule(ctx as IModuleBehaviourContext)

    it("should have a distributor", async () => {
        const distributor = await ctx.recipient.rewardsDistributor()
        expect(distributor).not.eq(ZERO_ADDRESS)
    })

    it("should allow governor to change the distributor", async () => {
        const newDistributor = ctx.sa.other
        await ctx.recipient.connect(ctx.sa.governor.signer).setRewardsDistribution(newDistributor.address)
        expect(await ctx.recipient.rewardsDistributor()).eq(newDistributor.address)
    })

    it("should prevent change from non-governor", async () => {
        const newDistributor = ctx.sa.other
        const oldDistributor = await ctx.recipient.rewardsDistributor()
        await expect(ctx.recipient.connect(ctx.sa.default.signer).setRewardsDistribution(newDistributor.address)).to.be.revertedWith(
            "Only governor can execute",
        )
        expect(await ctx.recipient.rewardsDistributor()).eq(oldDistributor)
    })
}

export default shouldBehaveLikeDistributionRecipient
