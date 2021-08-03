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

    context("questing and multipliers", () => {
        it("should allow an admin to add a seasonal quest")
        it("should allow a user to complete a seasonal quest with verification")
        it("should increase a users voting power when they complete said quest")
        it("should allow an admin to end the quest season")
        // Important that each action (checkTimestamp, completeQuest, mint) applies this because
        // scaledBalance could actually decrease, even in these situations, since old seasonMultipliers are slashed
        it("should slash an old seasons reward on any action")
    })

    context("triggering the governance hook", () => {
        it("should allow governor to add a governanceHook")
        it("should trigger governanceHook each time voting weight changes")
        // WE should write a mock IGovernanceHook here.. and project how much it's going to cost.
        // If the flow is:
        //  - Look up preferences of the user
        //  - Update their personal balances in each gauge <- can we remove the SSTORES from this step and just use the gain/loss in voting power?
        //  - Update the total balance in each gauge & total overall balance
        // Then it could end up costing ~4 SLOADS and ~2 SSTORES per dial preference, which is >18k per dial (4 dials and we are up to 80k...)
        // This can be optimised as part of the dials release but worth thinking about now.
        it("should not cause a ridiculous amount of extra gas to trigger")
    })

    context("unstaking", () => {
        it("should not be possible before unstake window")
        it("should not be possible after the unstake window")
        it("should not reset the cooldown timer unless all is unstaked")
        it("should apply a redemption fee which is added to the pendingRewards from the rewards contract")
        it("should distribute these pendingAdditionalReward with the next notification")
    })

    context("updating lastAction timestamp", () => {
        it("should be triggered after every WRITE action on the contract")
    })
})
