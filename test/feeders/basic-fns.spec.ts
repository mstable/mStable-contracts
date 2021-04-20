import { ethers } from "hardhat"
import { expect } from "chai"

import { assertBNClosePercent } from "@utils/assertions"
import { BN, simpleToExactAmount } from "@utils/math"
import { MassetMachine, StandardAccounts, FeederMachine, FeederDetails } from "@utils/machines"

describe("Feeder Pools", () => {
    let sa: StandardAccounts
    let feederMachine: FeederMachine
    let feeder: FeederDetails

    const runSetup = async (
        useLendingMarkets = false,
        useInterestValidator = false,
        feederWeights?: Array<BN | number>,
        mAssetWeights?: Array<BN | number>,
    ): Promise<void> => {
        feeder = await feederMachine.deployFeeder(feederWeights, mAssetWeights, useLendingMarkets, useInterestValidator)
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
            await runSetup()
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
        it("should fail to mintMulti with mpAsset", async () => {
            const { pool, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails

            // fpToken -> mpAsset
            await expect(
                pool.mintMulti([bAssets[0].address], [simpleToExactAmount(10)], simpleToExactAmount(9), sa.default.address),
            ).to.be.revertedWith("Invalid asset")
        })
        it("should mint single locally", async () => {
            const { pool, mAsset, fAsset } = feeder

            const dataStart = await feederMachine.getBasketComposition(feeder)

            // Mint with mAsset
            let approval = await feederMachine.approveFeeder(mAsset, pool.address, 10)
            await pool.mint(mAsset.address, approval, simpleToExactAmount("9.5"), sa.default.address)

            // Mid checks
            const dataMid = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            assertBNClosePercent(dataMid.totalSupply, dataStart.totalSupply.add(approval), "0.1")
            // Token movements
            expect(dataMid.bAssets[0].actualBalance, "mAsset should be transferred").eq(dataStart.bAssets[0].actualBalance.add(approval))
            // Vault balances
            expect(dataMid.bAssets[0].vaultBalance, "mAsset vault balance should increase").eq(
                dataStart.bAssets[0].vaultBalance.add(approval),
            )

            // Mint with fAsset
            approval = await feederMachine.approveFeeder(fAsset, pool.address, 10)
            await pool.mint(fAsset.address, approval, simpleToExactAmount("9.5"), sa.default.address)

            // Mid checks
            const dataEnd = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            assertBNClosePercent(dataEnd.totalSupply, dataMid.totalSupply.add(approval), "0.1")
            // Token movements
            expect(dataEnd.bAssets[1].actualBalance, "fAsset should be transferred").eq(dataMid.bAssets[1].actualBalance.add(approval))
            // Vault balances
            expect(dataEnd.bAssets[1].vaultBalance, "fAsset vault balance should increase").eq(
                dataMid.bAssets[1].vaultBalance.add(approval),
            )
        })
        it("should mint single via main pool", async () => {
            const { pool, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails

            const dataStart = await feederMachine.getBasketComposition(feeder)

            // Mint with mpAsset[0]
            let approval = await feederMachine.approveFeeder(bAssets[0], pool.address, 10)
            await pool.mint(bAssets[0].address, approval, simpleToExactAmount("9.5"), sa.default.address)

            // Mid checks
            const dataMid = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            assertBNClosePercent(dataMid.totalSupply.sub(dataStart.totalSupply), approval, "0.1", "Total supply should increase")
            // Token movements
            assertBNClosePercent(
                dataMid.bAssets[0].actualBalance,
                dataStart.bAssets[0].actualBalance.add(simpleToExactAmount(10)),
                "0.1",
                "mAsset should deposit",
            )
            // Vault balances
            assertBNClosePercent(
                dataMid.bAssets[0].vaultBalance,
                dataStart.bAssets[0].vaultBalance.add(simpleToExactAmount(10)),
                "0.1",
                "mAsset vaultBalance should increase",
            )

            // Mint with mpAsset[1]
            approval = await feederMachine.approveFeeder(bAssets[1], pool.address, 10)
            await pool.mint(bAssets[1].address, approval, simpleToExactAmount("9.5"), sa.default.address)

            // End checks
            const dataEnd = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            assertBNClosePercent(
                dataEnd.totalSupply.sub(dataMid.totalSupply),
                simpleToExactAmount(10),
                "0.1",
                "Total supply should increase",
            )
            // Token movements
            assertBNClosePercent(
                dataEnd.bAssets[0].actualBalance,
                dataMid.bAssets[0].actualBalance.add(simpleToExactAmount(10)),
                "0.1",
                "mAsset should deposit",
            )
            // Vault balances
            assertBNClosePercent(
                dataEnd.bAssets[0].vaultBalance,
                dataMid.bAssets[0].vaultBalance.add(simpleToExactAmount(10)),
                "0.1",
                "mAsset vaultBalance should increase",
            )
        })
    })
    describe("testing some swaps", () => {
        before(async () => {
            await runSetup()
        })
        it("should swap locally", async () => {
            const { pool, mAsset, fAsset } = feeder

            const dataStart = await feederMachine.getBasketComposition(feeder)

            // Swap mAsset -> fAsset
            let approval = await feederMachine.approveFeeder(mAsset, pool.address, 10)
            await pool.swap(mAsset.address, fAsset.address, approval, simpleToExactAmount("9.5"), sa.default.address)

            // Mid checks
            const dataMid = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            expect(dataMid.totalSupply).eq(dataStart.totalSupply)
            // Token movements
            expect(dataMid.bAssets[0].actualBalance.sub(dataStart.bAssets[0].actualBalance), "mAsset should be transferred").eq(approval)
            assertBNClosePercent(
                dataStart.bAssets[1].actualBalance.sub(dataMid.bAssets[1].actualBalance),
                approval,
                "0.3",
                "fAsset should be transferred",
            )
            // Vault balances
            expect(dataMid.bAssets[0].vaultBalance, "mAsset vault balance should increase").eq(
                dataStart.bAssets[0].vaultBalance.add(approval),
            )
            assertBNClosePercent(
                dataMid.bAssets[1].vaultBalance,
                dataStart.bAssets[1].vaultBalance.sub(approval),
                "0.3",
                "fAsset vaultBalance should decrease",
            )

            // Swap fAsset -> mAsset
            approval = await feederMachine.approveFeeder(fAsset, pool.address, 10)
            await pool.swap(fAsset.address, mAsset.address, approval, simpleToExactAmount("9.5"), sa.default.address)
        })
        it("should swap into mpAsset", async () => {
            const { pool, fAsset, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails

            const dataStart = await feederMachine.getBasketComposition(feeder)

            // fAsset -> mpAsset
            const approval = await feederMachine.approveFeeder(fAsset, pool.address, 10)
            await pool.swap(fAsset.address, bAssets[0].address, approval, simpleToExactAmount("9.5"), sa.default.address)

            // Mid checks
            const dataMid = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            expect(dataMid.totalSupply).eq(dataStart.totalSupply)
            // Token movements
            expect(dataMid.bAssets[1].actualBalance.sub(dataStart.bAssets[1].actualBalance), "fAsset should be transferred in").eq(approval)
            assertBNClosePercent(
                dataStart.bAssets[0].actualBalance.sub(dataMid.bAssets[0].actualBalance),
                approval,
                "0.3",
                "mAsset should be transferred out",
            )
            // Vault balances
            expect(dataMid.bAssets[1].vaultBalance.sub(dataStart.bAssets[1].vaultBalance), "fAsset vaultBalance should increase").eq(
                approval,
            )
            assertBNClosePercent(
                dataStart.bAssets[0].vaultBalance.sub(dataMid.bAssets[0].vaultBalance),
                approval,
                "0.3",
                "mAsset vault balance should decrease",
            )
        })
        it("should swap out of mpAsset", async () => {
            const { pool, fAsset, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails

            const dataStart = await feederMachine.getBasketComposition(feeder)

            // mpAsset -> fAsset
            const approval = await feederMachine.approveFeeder(bAssets[0], pool.address, 10)
            await pool.swap(bAssets[0].address, fAsset.address, approval, simpleToExactAmount("9.5"), sa.default.address)

            // Mid checks
            const dataMid = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            expect(dataMid.totalSupply).eq(dataStart.totalSupply)
            // Token movements
            assertBNClosePercent(
                dataMid.bAssets[0].actualBalance.sub(dataStart.bAssets[0].actualBalance),
                approval,
                "0.3",
                "mAsset should be transferred in",
            )
            assertBNClosePercent(
                dataStart.bAssets[1].actualBalance.sub(dataMid.bAssets[1].actualBalance),
                approval,
                "0.3",
                "fAsset should be transferred out",
            )
            // Vault balances
            assertBNClosePercent(
                dataMid.bAssets[0].vaultBalance.sub(dataStart.bAssets[0].vaultBalance),
                approval,
                "0.3",
                "mAsset vault balance should increase",
            )
            assertBNClosePercent(
                dataStart.bAssets[1].vaultBalance.sub(dataMid.bAssets[1].vaultBalance),
                approval,
                "0.3",
                "fAsset vault balance should decrease",
            )
        })
        it("should fail to swap mpAsset <> mAsset", async () => {
            const { pool, mAsset, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails
            // mpAsset -> mAsset
            await expect(
                pool.swap(bAssets[0].address, mAsset.address, simpleToExactAmount(1), simpleToExactAmount(1), sa.default.address),
            ).to.be.revertedWith("Invalid pair")
            // mAsset -> mpAsset
            await expect(
                pool.swap(mAsset.address, bAssets[0].address, simpleToExactAmount(1), simpleToExactAmount(1), sa.default.address),
            ).to.be.revertedWith("Invalid pair")
        })
        it("should fail to swap mpAsset <> mpAsset", async () => {
            const { pool, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails
            // mpAsset -> mpAsset
            await expect(
                pool.swap(bAssets[1].address, bAssets[0].address, simpleToExactAmount(1), simpleToExactAmount(1), sa.default.address),
            ).to.be.revertedWith("Invalid pair")
        })
    })

    describe("testing some single redemptions", () => {
        before(async () => {
            await runSetup()
        })
        it("should redeem locally", async () => {
            const { pool, mAsset, fAsset } = feeder

            const dataStart = await feederMachine.getBasketComposition(feeder)

            // Redeem fpToken -> mAsset
            await pool.redeem(mAsset.address, simpleToExactAmount(10), simpleToExactAmount("9.5"), sa.default.address)

            // Mid checks - should decrease mAsset vb
            const dataMid = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            expect(dataMid.totalSupply).eq(dataStart.totalSupply.sub(simpleToExactAmount(10)))
            // Token movements
            assertBNClosePercent(
                dataStart.bAssets[0].actualBalance.sub(dataMid.bAssets[0].actualBalance),
                simpleToExactAmount(10),
                "0.3",
                "mAsset should be transferred out",
            )
            // Vault balances
            assertBNClosePercent(
                dataStart.bAssets[0].vaultBalance.sub(dataMid.bAssets[0].vaultBalance),
                simpleToExactAmount(10),
                "0.3",
                "mAsset vault balance should decrease",
            )

            // Redeem fpToken -> fAsset
            await pool.redeem(fAsset.address, simpleToExactAmount(10), simpleToExactAmount("9.5"), sa.default.address)
        })
        it("should redeem into mpAsset", async () => {
            const { pool, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails

            const dataStart = await feederMachine.getBasketComposition(feeder)

            // fpToken -> mpAsset
            await pool.redeem(bAssets[0].address, simpleToExactAmount(10), simpleToExactAmount("9.5"), sa.default.address)

            // Mid checks - should decrease mAsset vb
            const dataMid = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            expect(dataMid.totalSupply).eq(dataStart.totalSupply.sub(simpleToExactAmount(10)))
            // Token movements
            // assertBNClosePercent(
            //     dataStart.bAssets[0].actualBalance.sub(dataMid.bAssets[0].actualBalance),
            //     simpleToExactAmount(10),
            //     "0.3",
            //     "mAsset should be transferred out",
            // )
            // Vault balances
            assertBNClosePercent(
                dataStart.bAssets[0].vaultBalance.sub(dataMid.bAssets[0].vaultBalance),
                simpleToExactAmount(10),
                "0.3",
                "mAsset vault balance should decrease",
            )
        })
    })

    describe("testing some exact redemptions", () => {
        before(async () => {
            await runSetup()
        })
        it("should redeem locally", async () => {
            const { pool, mAsset, fAsset } = feeder

            const dataStart = await feederMachine.getBasketComposition(feeder)

            // Redeem fpToken -> mAsset
            await pool.redeemExactBassets([mAsset.address], [simpleToExactAmount(10)], simpleToExactAmount(11), sa.default.address)

            // Mid checks - should decrease mAsset vb
            const dataMid = await feederMachine.getBasketComposition(feeder)
            // Total Supply
            assertBNClosePercent(dataMid.totalSupply, dataStart.totalSupply.sub(simpleToExactAmount(10)))
            // Token movements
            expect(dataStart.bAssets[0].actualBalance.sub(dataMid.bAssets[0].actualBalance), "mAsset should be transferred out").eq(
                simpleToExactAmount(10),
            )
            // Vault balances
            expect(dataStart.bAssets[0].vaultBalance.sub(dataMid.bAssets[0].vaultBalance), "mAsset vb should decrease").eq(
                simpleToExactAmount(10),
            )

            // Redeem fpToken -> fAsset
            await pool.redeemExactBassets([fAsset.address], [simpleToExactAmount(10)], simpleToExactAmount(11), sa.default.address)
            // Redeem fpToken -> [mAsset,fAsset]
            await pool.redeemExactBassets(
                [mAsset.address, fAsset.address],
                [simpleToExactAmount(1), simpleToExactAmount(1)],
                simpleToExactAmount("2.5"),
                sa.default.address,
            )
        })
        it("should fail to redeem into mpAsset", async () => {
            const { pool, mAssetDetails } = feeder
            const { bAssets } = mAssetDetails
            // fpToken -> mpAsset
            await expect(
                pool.redeemExactBassets([bAssets[0].address], [simpleToExactAmount(10)], simpleToExactAmount(11), sa.default.address),
            ).to.be.revertedWith("Invalid asset")
        })
    })
})
