import { MassetMachine, MassetDetails, Account } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { ethers } from "hardhat"
import { ERC20 } from "types/generated/ERC20"
import { IERC20BehaviourContext, shouldBehaveLikeERC20 } from "../../shared/ERC20.behaviour"

describe("Masset - ERC20", () => {
    const ctx: Partial<IERC20BehaviourContext> = {}

    const runSetup = async (seedBasket = false): Promise<void> => {
        ctx.details = await ctx.mAssetMachine.deployMasset()
        if (seedBasket) {
            await ctx.mAssetMachine.seedWithWeightings(ctx.details, [25, 25, 25, 25])
        }
    }
    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        ctx.mAssetMachine = await new MassetMachine().initAccounts(accounts)
        ctx.initialHolder = ctx.mAssetMachine.sa.default
        ctx.recipient = ctx.mAssetMachine.sa.dummy1
        ctx.anotherAccount = ctx.mAssetMachine.sa.dummy2
    })
    beforeEach("reset contracts", async () => {
        await runSetup(true)
        ctx.token = ctx.details.mAsset as ERC20
    })

    shouldBehaveLikeERC20(ctx as IERC20BehaviourContext, "ERC20", simpleToExactAmount(100, 18))
})
