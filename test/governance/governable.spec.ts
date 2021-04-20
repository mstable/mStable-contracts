import { ethers } from "hardhat"
import { MassetMachine } from "@utils/machines"
import { MockGovernable__factory } from "types/generated"
import { shouldBehaveLikeGovernable, IGovernableBehaviourContext } from "./Governable.behaviour"

describe("Governable", () => {
    const ctx: Partial<IGovernableBehaviourContext> = {}

    beforeEach("Create Contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        ctx.governable = await new MockGovernable__factory(mAssetMachine.sa.governor.signer).deploy()
        ctx.owner = mAssetMachine.sa.governor
        ctx.other = mAssetMachine.sa.other
    })

    shouldBehaveLikeGovernable(ctx as Required<typeof ctx>)
})
