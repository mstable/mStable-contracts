import { ethers } from "hardhat"
import { expect } from "chai"

import { MassetMachine } from "@utils/machines"
import { ClaimableGovernor__factory } from "types/generated"
import { shouldBehaveLikeClaimable, IClaimableGovernableBehaviourContext } from "./ClaimableGovernor.behaviour"

describe("ClaimableGovernable", () => {
    const ctx: Partial<IClaimableGovernableBehaviourContext> = {}

    beforeEach("Create Contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        ctx.default = mAssetMachine.sa.default
        ctx.governor = mAssetMachine.sa.governor
        ctx.other = mAssetMachine.sa.other
        ctx.claimable = await new ClaimableGovernor__factory(mAssetMachine.sa.governor.signer).deploy(mAssetMachine.sa.governor.address)
    })

    shouldBehaveLikeClaimable(ctx as Required<typeof ctx>)

    describe("after initiating a transfer", () => {
        let newOwner

        beforeEach(async () => {
            const accounts = await ethers.getSigners()
            const mAssetMachine = await new MassetMachine().initAccounts(accounts)
            newOwner = mAssetMachine.sa.other
            await ctx.claimable.connect(mAssetMachine.sa.governor.signer).requestGovernorChange(newOwner.address)
        })

        it("changes allow pending owner to claim ownership", async () => {
            await ctx.claimable.connect(newOwner.signer).claimGovernorChange()
            const owner = await ctx.claimable.governor()

            expect(owner === newOwner.address).to.equal(true)
        })
    })
})
