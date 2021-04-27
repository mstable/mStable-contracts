import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ZERO_ADDRESS } from "@utils/constants"
import { INexus__factory, PausableModule } from "types/generated"

export interface IPausableModuleBehaviourContext {
    module: PausableModule
    sa: StandardAccounts
}

export function shouldBehaveLikePausableModule(ctx: IPausableModuleBehaviourContext): void {
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

    it("should not be paused", async () => {
        const paused = await ctx.module.paused()
        expect(paused).to.eq(false)
    })
    it("should allow pausing and unpausing by governor", async () => {
        // Pause
        let tx = ctx.module.connect(ctx.sa.governor.signer).pause()
        await expect(tx).to.emit(ctx.module, "Paused").withArgs(ctx.sa.governor.address)
        // Fail if already paused
        await expect(ctx.module.connect(ctx.sa.governor.signer).pause()).to.be.revertedWith("Pausable: paused")

        // Unpause
        tx = ctx.module.connect(ctx.sa.governor.signer).unpause()
        await expect(tx).to.emit(ctx.module, "Unpaused").withArgs(ctx.sa.governor.address)

        // Fail to unpause twice
        await expect(ctx.module.connect(ctx.sa.governor.signer).unpause()).to.be.revertedWith("Pausable: not paused")
    })
    it("should fail to pause if non-governor", async () => {
        await expect(ctx.module.connect(ctx.sa.other.signer).pause()).to.be.revertedWith("Only governor can execute")
    })
}

export default shouldBehaveLikePausableModule
