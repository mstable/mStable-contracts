import { ethers } from "hardhat"
import { expect } from "chai"

import { assertBNClosePercent } from "@utils/assertions"
import { simpleToExactAmount } from "@utils/math"
import { MassetDetails, MassetMachine, StandardAccounts } from "@utils/machines"

import { DEAD_ADDRESS, ZERO_ADDRESS } from "@utils/constants"
import { Masset__factory, InvariantValidator__factory, AssetProxy__factory, ExposedMasset__factory } from "types/generated"
import { BasketComposition } from "types"

describe("Masset", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let details: MassetDetails

    const runSetup = async (): Promise<void> => {
        const renBtc = await mAssetMachine.loadBassetProxy("Ren BTC", "renBTC", 18)
        const sbtc = await mAssetMachine.loadBassetProxy("Synthetix BTC", "sBTC", 18)
        const wbtc = await mAssetMachine.loadBassetProxy("Wrapped BTC", "wBTC", 12)
        const bAssets = [renBtc, sbtc, wbtc]
        const forgeVal = await new InvariantValidator__factory(sa.default.signer).deploy()
        const Manager = await ethers.getContractFactory("Manager")
        const managerLib = await Manager.deploy()
        const linkedAddress = {
            __$1a38b0db2bd175b310a9a3f8697d44eb75$__: managerLib.address,
        }
        const impl = await new Masset__factory(linkedAddress, sa.default.signer).deploy(DEAD_ADDRESS)
        const data = impl.interface.encodeFunctionData("initialize", [
            "mStable BTC",
            "mBTC",
            forgeVal.address,
            bAssets.map((b) => ({
                addr: b.address,
                integrator: ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            })),
            {
                a: simpleToExactAmount(1, 2),
                limits: {
                    min: simpleToExactAmount(5, 16),
                    max: simpleToExactAmount(55, 16),
                },
            },
        ])
        const mAsset = await new AssetProxy__factory(sa.default.signer).deploy(impl.address, DEAD_ADDRESS, data)
        details = {
            mAsset: await new ExposedMasset__factory(linkedAddress, sa.default.signer).attach(mAsset.address),
            bAssets,
        }
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        await runSetup()
    })

    describe("testing some mints", () => {
        before("reset", async () => {
            await runSetup()
        })
        it("should mint some bAssets", async () => {
            const { bAssets, mAsset } = details
            const approvals = await Promise.all(details.bAssets.map((b) => mAssetMachine.approveMasset(b, mAsset, 100)))
            await mAsset.mintMulti(
                bAssets.map((b) => b.address),
                approvals,
                99,
                sa.default.address,
            )
            const dataEnd = await mAssetMachine.getBasketComposition(details)

            expect(dataEnd.totalSupply).to.eq(simpleToExactAmount(300, 18))
        })
        it("should mint less when going into penalty zone", async () => {
            // soft max is 50%, currently all are at 33% with 300 tvl
            // adding 50 units pushes tvl to 350 and weight to 42.8%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 50)
            await expect(mAsset.mint(bAssets[0].address, approval, simpleToExactAmount(51), sa.default.address)).to.be.revertedWith(
                "Mint quantity < min qty",
            )
            await mAsset.mint(bAssets[0].address, approval, simpleToExactAmount(49), sa.default.address)

            const dataEnd = await mAssetMachine.getBasketComposition(details)
            const minted = dataEnd.totalSupply.sub(dataBefore.totalSupply)

            expect(minted).to.lt(simpleToExactAmount(50, 18))
            expect(minted).to.gt(simpleToExactAmount("49.7", 18))
        })
        it("should apply close to 5% penalty near hard max", async () => {
            // hard max is 55%, currently at 42.86% with 350 tvl
            // adding 80 units pushes tvl to 430 and weight to 53.4%
            // other weights then are 23.3%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 80)
            await expect(mAsset.mint(bAssets[0].address, approval, simpleToExactAmount("79.9"), sa.default.address)).to.be.revertedWith(
                "Mint quantity < min qty",
            )
            await mAsset.mint(bAssets[0].address, approval, simpleToExactAmount(76), sa.default.address)

            const dataEnd = await mAssetMachine.getBasketComposition(details)
            const minted = dataEnd.totalSupply.sub(dataBefore.totalSupply)

            expect(minted).to.lt(simpleToExactAmount(80, 18))
            expect(minted).to.gt(simpleToExactAmount(77, 18))
        })
        it("should fail if we go over max", async () => {
            const { bAssets, mAsset } = details
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 80)
            await expect(mAsset.mint(bAssets[0].address, approval, simpleToExactAmount(87), sa.default.address)).to.be.revertedWith(
                "Exceeds weight limits",
            )
        })
        it("should allow lots of minting", async () => {
            const { bAssets, mAsset } = details
            const approval = await mAssetMachine.approveMasset(bAssets[1], mAsset, 80)
            await mAsset.mint(bAssets[1].address, approval.div(80), 0, sa.default.address)
            await mAsset.mint(bAssets[1].address, approval.div(80), 0, sa.default.address)
            await mAsset.mint(bAssets[1].address, approval.div(80), 0, sa.default.address)
            await bAssets[2].transfer(sa.dummy2.address, simpleToExactAmount(50, await bAssets[2].decimals()))
            const approval2 = await mAssetMachine.approveMasset(bAssets[2], mAsset, 50, sa.dummy2.signer)
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address)
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address)
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address)
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address)
            await mAsset.connect(sa.dummy2.signer).mint(bAssets[2].address, approval2.div(5), 0, sa.default.address)
        })
    })
    describe("testing some swaps", () => {
        let dataStart: BasketComposition
        before("set up basket", async () => {
            await runSetup()
            const { bAssets, mAsset } = details
            const approvals = await Promise.all(details.bAssets.map((b) => mAssetMachine.approveMasset(b, mAsset, 100)))
            await mAsset.mintMulti(
                bAssets.map((b) => b.address),
                approvals,
                simpleToExactAmount(99),
                sa.default.address,
            )
            dataStart = await mAssetMachine.getBasketComposition(details)

            expect(dataStart.totalSupply).to.eq(simpleToExactAmount(300, 18))
        })
        it("should swap 1:1(-fee) within normal range", async () => {
            // soft max is 41%, currently all are at 33% with 300 tvl
            // adding 10 units should result in 9.9994 output and 36.66%
            const { bAssets, mAsset } = details

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 10)
            await expect(
                mAsset.swap(
                    bAssets[0].address, // renBTC
                    bAssets[1].address, // sBTC
                    approval,
                    simpleToExactAmount(11),
                    sa.default.address,
                ),
            ).to.be.revertedWith("Output qty < minimum qty")
            await mAsset.swap(
                bAssets[0].address, // renBTC
                bAssets[1].address, // sBTC
                approval,
                simpleToExactAmount("9.9"),
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const swappedOut = dataStart.bAssets[1].mAssetUnits.sub(dataAfter.bAssets[1].mAssetUnits)
            assertBNClosePercent(swappedOut, simpleToExactAmount("9.994", 18), "0.1")

            expect(dataAfter.bAssets[0].mAssetUnits.sub(dataStart.bAssets[0].mAssetUnits)).to.eq(simpleToExactAmount(10, 18))

            expect(dataAfter.totalSupply).to.eq(dataStart.totalSupply)
        })
        it("should apply minute fee when 2% over soft max ", async () => {
            // soft max is 41%, currently at 36.66% with 110/300 tvl
            // adding 20 units pushes to 130/300 and weight to 43.2%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 20)
            await mAsset.swap(
                bAssets[0].address, // renBTC
                bAssets[2].address, // wBTC
                approval,
                simpleToExactAmount(19, 12),
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const swappedOut = dataBefore.bAssets[2].mAssetUnits.sub(dataAfter.bAssets[2].mAssetUnits)
            // sum of fee is 0.5% (incl 0.06% swap fee)
            expect(swappedOut).to.gt(simpleToExactAmount("19.9", 18))
            expect(swappedOut).to.lt(simpleToExactAmount(20, 18))
        })
        it("should apply close to 5% penalty near hard max", async () => {
            // hard max is 56%, currently at 43.2% with 130/300 tvl
            // adding 35 units pushes to 165/300 and weight to 55%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 35)
            await expect(
                mAsset.swap(
                    bAssets[0].address, // renBTC
                    bAssets[1].address, // sBTC
                    approval,
                    simpleToExactAmount("34.9"),
                    sa.default.address,
                ),
            ).to.be.revertedWith("Output qty < minimum qty")
            await mAsset.swap(
                bAssets[0].address, // renBTC
                bAssets[1].address, // sBTC
                approval,
                simpleToExactAmount(31),
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const swappedOut = dataBefore.bAssets[1].mAssetUnits.sub(dataAfter.bAssets[1].mAssetUnits)
            // sum of fee is 0.5% (incl 0.06% swap fee)
            expect(swappedOut).to.gt(simpleToExactAmount(33, 18))
            expect(swappedOut).to.lt(simpleToExactAmount("34.7", 18))
        })
        it("should fail if we go over max", async () => {
            const { bAssets, mAsset } = details
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 10)
            await expect(
                mAsset.swap(
                    bAssets[0].address, // renBTC
                    bAssets[2].address, // wBTC
                    approval,
                    simpleToExactAmount(9, 12),
                    sa.default.address,
                ),
            ).to.be.revertedWith("Exceeds weight limits")
        })
    })

    describe("testing redeem exact mAsset", () => {
        let dataStart: BasketComposition
        before("set up basket", async () => {
            await runSetup()
            const { bAssets, mAsset } = details
            const approvals = await Promise.all(details.bAssets.map((b) => mAssetMachine.approveMasset(b, mAsset, 100)))
            await mAsset.mintMulti(
                bAssets.map((b) => b.address),
                approvals,
                99,
                sa.default.address,
            )
            dataStart = await mAssetMachine.getBasketComposition(details)

            expect(dataStart.totalSupply).to.eq(simpleToExactAmount(300, 18))
        })
        it("should redeem 1:1(-fee) within normal range", async () => {
            // soft min is 25%, currently all are at 33% with 300 tvl
            // redeeming 10 units should result in 9.9994 output and 31%
            const { bAssets, mAsset } = details

            const mAssetRedeemAmount = simpleToExactAmount(10, 18)
            const minBassetAmount = simpleToExactAmount(9, 18)
            await expect(
                mAsset.redeem(
                    bAssets[0].address, // renBTC,
                    mAssetRedeemAmount,
                    mAssetRedeemAmount,
                    sa.default.address,
                ),
            ).to.be.revertedWith("bAsset qty < min qty")
            await mAsset.redeem(
                bAssets[0].address, // renBTC,
                mAssetRedeemAmount,
                minBassetAmount,
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const redeemed = dataStart.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits)
            assertBNClosePercent(redeemed, simpleToExactAmount("9.994", 18), "0.1")

            expect(dataAfter.totalSupply).to.eq(dataStart.totalSupply.sub(mAssetRedeemAmount))
        })
        it("should apply minute fee when 2% under soft min ", async () => {
            // soft min is 25%, currently at 31% with 90/290 tvl
            // withdrawing 30 units pushes to 60/260 and weight to 23.07%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const mAssetRedeemAmount = simpleToExactAmount(30, 18)
            const minBassetAmount = simpleToExactAmount(29, 18)
            await mAsset.redeem(
                bAssets[0].address, // renBTC
                mAssetRedeemAmount,
                minBassetAmount,
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const redeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits)
            // sum of slippage is max 0.33% (incl 0.06% swap fee)
            expect(redeemed).to.gt(simpleToExactAmount("29.9", 18))
            expect(redeemed).to.lt(simpleToExactAmount(30, 18))

            expect(dataAfter.totalSupply).to.eq(dataBefore.totalSupply.sub(mAssetRedeemAmount))
            expect(dataAfter.surplus.sub(dataBefore.surplus)).to.eq(simpleToExactAmount(18, 15))
        })
        it("should apply close to 5% penalty near hard min", async () => {
            // hard min is 10%, currently at 23.07% with 60/260 tvl
            // adding 37 units pushes to 23/223 and weight to 10.3%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const mAssetRedeemAmount = simpleToExactAmount(37, 18)
            const minBassetAmount = simpleToExactAmount(30, 18)
            await mAsset.redeem(
                bAssets[0].address, // renBTC
                mAssetRedeemAmount,
                minBassetAmount,
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const bAssetRedeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits)
            // max slippage around 9%
            expect(bAssetRedeemed).to.gt(simpleToExactAmount("34", 18))
            expect(bAssetRedeemed).to.lt(simpleToExactAmount("36.5", 18))

            expect(dataAfter.totalSupply).to.eq(dataBefore.totalSupply.sub(mAssetRedeemAmount))
        })
    })

    describe("testing redeem exact bAsset(s)", () => {
        let dataStart: BasketComposition
        before("set up basket", async () => {
            await runSetup()
            const { bAssets, mAsset } = details
            const approvals = await Promise.all(details.bAssets.map((b) => mAssetMachine.approveMasset(b, mAsset, 100)))
            await mAsset.mintMulti(
                bAssets.map((b) => b.address),
                approvals,
                99,
                sa.default.address,
            )
            dataStart = await mAssetMachine.getBasketComposition(details)

            expect(dataStart.totalSupply).to.eq(simpleToExactAmount(300, 18))
        })
        it("should redeem 1:1(-fee) within normal range", async () => {
            // soft min is 25%, currently all are at 33% with 300 tvl
            // redeeming 10 units should result in 10.006 burned and 31%
            const { bAssets, mAsset } = details

            const bAssetAmount = simpleToExactAmount(10, 18)
            const maxMasset = simpleToExactAmount("10.01", 18)
            await mAsset.redeemExactBassets([bAssets[0].address], [bAssetAmount], maxMasset, sa.default.address)

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const mAssetBurned = dataStart.totalSupply.sub(dataAfter.totalSupply)
            assertBNClosePercent(mAssetBurned, simpleToExactAmount("10.006003602161296778", 18), "0.1")

            expect(dataAfter.bAssets[0].vaultBalance).to.eq(dataStart.bAssets[0].vaultBalance.sub(simpleToExactAmount(10, 18)))
        })
        it("should apply minute fee when 2% under soft min ", async () => {
            // soft min is 25%, currently at 31% with 90/290 tvl
            // withdrawing 30 units pushes to 60/260 and weight to 23.07%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const bAssetRedeemAmount = simpleToExactAmount(30, 18)
            const maxMasset = simpleToExactAmount(31, 18)
            await mAsset.redeemExactBassets([bAssets[0].address], [bAssetRedeemAmount], maxMasset, sa.default.address)

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const redeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits)
            // sum of slippage is max 0.33% (incl 0.06% swap fee)
            expect(redeemed).to.eq(simpleToExactAmount(30, 18))

            const mAssetBurned = dataBefore.totalSupply.sub(dataAfter.totalSupply)
            expect(mAssetBurned).to.gt(simpleToExactAmount(30, 18))
            expect(mAssetBurned).to.lt(simpleToExactAmount(31, 18))

            assertBNClosePercent(dataAfter.surplus.sub(dataBefore.surplus), simpleToExactAmount(18, 15), 2)
        })
        it("should apply close to 5% penalty near hard min", async () => {
            // hard min is 10%, currently at 23.07% with 60/260 tvl
            // adding 37 units pushes to 23/223 and weight to 10.3%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const bAssetRedeemAmount = simpleToExactAmount(35, 18)
            const maxMasset = simpleToExactAmount(39, 18)
            await expect(
                mAsset.redeemExactBassets([bAssets[0].address], [bAssetRedeemAmount], simpleToExactAmount("35.3", 18), sa.default.address),
            ).to.be.revertedWith("Redeem mAsset qty > max quantity")
            await mAsset.redeemExactBassets([bAssets[0].address], [bAssetRedeemAmount], maxMasset, sa.default.address)

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const redeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits)
            expect(redeemed).to.eq(simpleToExactAmount(35, 18))

            const mAssetBurned = dataBefore.totalSupply.sub(dataAfter.totalSupply)
            expect(mAssetBurned).to.gt(simpleToExactAmount("35.4", 18))
            expect(mAssetBurned).to.lt(simpleToExactAmount(39, 18))
        })
    })
})
