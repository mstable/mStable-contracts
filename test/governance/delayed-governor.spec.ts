import { MassetMachine } from "@utils/machines"
import { expect } from "chai"
import { ethers } from "hardhat"
import { DelayedClaimableGovernor__factory } from "types/generated"

import { shouldBehaveLikeClaimable } from "./ClaimableGovernor.behaviour"
import { shouldBehaveLikeDelayedClaimable } from "./DelayedClaimableGovernor.behaviour"

import type { IGovernableBehaviourContext } from "./DelayedClaimableGovernor.behaviour"

describe("DelayedClaimableGovernor", () => {
    const ctx: Partial<IGovernableBehaviourContext> = {}
    const GOVERNANCE_DELAY = 60 * 60 * 24 * 7 // 1 week

    describe("Should behave like Claimable", () => {
        beforeEach("Create Contract", async () => {
            const accounts = await ethers.getSigners()
            const mAssetMachine = await new MassetMachine().initAccounts(accounts)
            ctx.default = mAssetMachine.sa.default
            ctx.governor = mAssetMachine.sa.governor
            ctx.other = mAssetMachine.sa.other
            ctx.claimable = await new DelayedClaimableGovernor__factory(ctx.governor.signer).deploy(ctx.governor.address, GOVERNANCE_DELAY)
        })

        shouldBehaveLikeClaimable(ctx as Required<typeof ctx>)
    })

    describe("Should behave like DelayedClaimable", () => {
        beforeEach("Initiate change Governor", async () => {
            const accounts = await ethers.getSigners()
            const mAssetMachine = await new MassetMachine().initAccounts(accounts)
            ctx.default = mAssetMachine.sa.default
            ctx.governor = mAssetMachine.sa.governor
            ctx.other = mAssetMachine.sa.other
            ctx.claimable = await new DelayedClaimableGovernor__factory(ctx.governor.signer).deploy(ctx.governor.address, GOVERNANCE_DELAY)

            await ctx.claimable.requestGovernorChange(ctx.other.address)
        })

        shouldBehaveLikeDelayedClaimable(ctx as Required<typeof ctx>)

        it("should not allow zero delay", async () => {
            await expect(new DelayedClaimableGovernor__factory(ctx.governor.signer).deploy(ctx.governor.address, 0)).to.be.revertedWith(
                "Delay must be greater than zero",
            )
        })
    })
})
