import { ethers } from "hardhat"
import { MassetDetails, MassetMachine, StandardAccounts } from "@utils/machines"
import { MockERC677WithdrawExploitor__factory } from "types/generated/factories/MockERC677WithdrawExploitor__factory"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"

describe("Masset - Reentrancy", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let details: MassetDetails

    const runSetup = async (
        seedBasket = true,
        useTransferFees = false,
        useLendingMarkets = false,
        weights: number[] = [25, 25, 25, 25],
    ): Promise<void> => {
        details = await mAssetMachine.deployMasset(useLendingMarkets, useTransferFees, undefined, true)
        if (seedBasket) {
            await mAssetMachine.seedWithWeightings(details, weights)
        }
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        await runSetup()
    })

    describe("redeeming with a single bAsset", () => {
        it("should fail if re-entracncy attack", async () => {
            const { bAssets, mAsset } = details

            const factory = new MockERC677WithdrawExploitor__factory(sa.default.signer)

            const withdrawExploitor = await factory.deploy(mAsset.address, bAssets[0].address, bAssets[3].address)
            
            await bAssets[0].connect(sa.default.signer).transfer(withdrawExploitor.address, simpleToExactAmount(1))
            
            await withdrawExploitor.depositFunds()

            const tx = withdrawExploitor.withdrawFunds()

            await expect(tx).to.reverted
        })
    })

    describe("redeeming with multiple bAssets", async () => {
        it("should fail if re-entracny attack", async () => {
            const { bAssets, mAsset } = details

            const factory = new MockERC677WithdrawExploitor__factory(sa.default.signer)

            const withdrawExploitor = await factory.deploy(mAsset.address, bAssets[0].address, bAssets[3].address)
            
            await bAssets[0].connect(sa.default.signer).transfer(withdrawExploitor.address, simpleToExactAmount(1))
            
            await withdrawExploitor.depositFunds()

            const tx = withdrawExploitor.withdrawFundsMulti()

            await expect(tx).to.reverted
        })
    })

    it("swapping should fail if re-entrancy attack", async () => {
            const { bAssets, mAsset } = details

            const factory = new MockERC677SwapExploitor__factory(sa.default.signer)

            const swapExploitor = await factory.deploy(mAsset.address, bAssets[0].address)
            
            await bAssets[0].connect(sa.default.signer).transfer(swapExploitor.address, simpleToExactAmount(1))
            
            const tx = await swapExploitor.swapFunds()

            await expect(tx).to.reverted
    })
})
