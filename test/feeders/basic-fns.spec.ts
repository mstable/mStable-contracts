import { ethers } from "hardhat"
import { expect } from "chai"

import { assertBNClosePercent } from "@utils/assertions"
import { simpleToExactAmount } from "@utils/math"
import { MassetDetails, MassetMachine, StandardAccounts, FeederMachine, FeederDetails } from "@utils/machines"

describe("Feeder Pools", () => {
    let sa: StandardAccounts
    let feederMachine: FeederMachine
    let details: MassetDetails
    let feeder: FeederDetails

    const runSetup = async (seedBasket = true): Promise<void> => {
        feeder = await feederMachine.deployFeeder(seedBasket)
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        feederMachine = await new FeederMachine(mAssetMachine)
        sa = mAssetMachine.sa

        await runSetup()
    })

    describe("testing some mints", () => {
        before(async () => {
            await runSetup(true)
        })
        it("should mint multi locally", async () => {
            const { bAssets, pool } = feeder
            const dataStart = await feederMachine.getBasketComposition(feeder)

            const approvals = await Promise.all(bAssets.map((b) => feederMachine.approveFeeder(b, pool.address, 100)))
            await pool.mintMulti(
                bAssets.map((b) => b.address),
                approvals,
                99,
                sa.default.address,
            )
            const dataEnd = await feederMachine.getBasketComposition(feeder)

            expect(dataEnd.totalSupply.sub(dataStart.totalSupply)).to.eq(simpleToExactAmount(200, 18))
        })
        it("should mint single locally", async () => {
            const { pool, mAsset, fAsset } = feeder

            // Mint with mAsset
            let approval = await feederMachine.approveFeeder(mAsset, pool.address, 100)
            await pool.mint(mAsset.address, approval, simpleToExactAmount(95), sa.default.address)

            // Mint with fAsset
            approval = await feederMachine.approveFeeder(fAsset, pool.address, 100)
            await pool.mint(fAsset.address, approval, simpleToExactAmount(95), sa.default.address)
        })
        it("should mint single via main pool", async () => {
            const { pool, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails
            // Mint with mpAsset[0]
            let approval = await feederMachine.approveFeeder(bAssets[0], pool.address, 100)
            await pool.mint(bAssets[0].address, approval, simpleToExactAmount(95), sa.default.address)
            // Mint with mpAsset[1]
            approval = await feederMachine.approveFeeder(bAssets[1], pool.address, 100)
            await pool.mint(bAssets[1].address, approval, simpleToExactAmount(95), sa.default.address)
        })
    })
    describe.only("testing some swaps", () => {
        before(async () => {
            await runSetup()
        })
        it("should swap locally", async () => {
            const { pool, mAsset, fAsset } = feeder
            // Swap mAsset -> fAsset
            const approval = await feederMachine.approveFeeder(mAsset, pool.address, 10)
            await pool.swap(mAsset.address, fAsset.address, approval, simpleToExactAmount("9.5"), sa.default.address)
        })
        it("should swap into mpAsset", async () => {
            const { pool, fAsset, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails
            // fAsset -> mpAsset
            const approval = await feederMachine.approveFeeder(fAsset, pool.address, 10)
            await pool.swap(fAsset.address, bAssets[0].address, approval, simpleToExactAmount("9.5"), sa.default.address)
        })
        it("should swap out of mpAsset", async () => {
            const { pool, fAsset, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails
            // mpAsset -> fAsset
            const approval = await feederMachine.approveFeeder(bAssets[0], pool.address, 10)
            await pool.swap(bAssets[0].address, fAsset.address, approval, simpleToExactAmount("9.5"), sa.default.address)
        })
    })
})
