import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ZERO_ADDRESS } from "@utils/constants"
import { INexus__factory, ImmutableModule } from "types/generated"

export interface IModuleBehaviourContext {
    module: ImmutableModule
    sa: StandardAccounts
}

export function shouldBehaveLikeModule(ctx: IModuleBehaviourContext): void {
    it("should have Nexus", async () => {
        const nexusAddr = await ctx.module.nexus()
        expect(nexusAddr).to.not.equal(ZERO_ADDRESS)
    })

    it("should have Governor address", async () => {
        const nexusAddr = await ctx.module.nexus()
        const nexus = await INexus__factory.connect(nexusAddr, ctx.sa.default.signer)

        const nexusGovernor = await nexus.governor()
        expect(nexusGovernor).to.equal(ctx.sa.governor.address)
    })
}

export default shouldBehaveLikeModule
