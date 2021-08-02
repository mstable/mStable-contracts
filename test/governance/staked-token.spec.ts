import { ethers } from "hardhat"
import { MassetMachine } from "@utils/machines"
import { shouldBehaveLikeModule, IModuleBehaviourContext } from "../shared/Module.behaviour"

describe("Staked Token", () => {
    const ctx: Partial<IModuleBehaviourContext> = {}

    beforeEach("Create Contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        ctx.sa = mAssetMachine.sa
    })

    // shouldBehaveLikeModule(ctx as Required<typeof ctx>)

    context("staking and delegating", () => {
        it("should delegate to self by default")
        it("should allow immediate delegating to a user")
        it("should not allow token transfers")
        it("should extend the cooldown timer proportionately")
    })

    context("boosting", () => {
        it("should apply a multiplier if the user stakes within the migration window")
        it("should apply the multiplier to voting power but not raw balance")
        it("should update total votingPower, totalSupply, etc, retroactively")
    })

    context("unstaking", () => {
        it("should not be possible before unstake window")
        it("should not be possible after the unstake window")
        it("should not reset the cooldown timer unless all is unstaked")
    })
})
