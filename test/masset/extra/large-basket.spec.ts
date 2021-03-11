import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount } from "@utils/math"
import { MassetDetails, MassetMachine, StandardAccounts } from "@utils/machines"

import { DEAD_ADDRESS, ZERO_ADDRESS } from "@utils/constants"
import { BasketComposition } from "types"
import { InvariantValidator__factory, Masset__factory, AssetProxy__factory, ExposedMasset__factory } from "types/generated"
import { assertBNClosePercent } from "@utils/assertions"

describe("Many asset Masset", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let details: MassetDetails

    const runSetup = async (): Promise<void> => {
        const renBtc = await mAssetMachine.loadBassetProxy("Ren BTC", "renBTC", 18)
        const sbtc = await mAssetMachine.loadBassetProxy("Synthetix BTC", "sBTC", 18)
        const wbtc = await mAssetMachine.loadBassetProxy("Wrapped BTC", "wBTC", 12)
        const btc4 = await mAssetMachine.loadBassetProxy("BTC4", "BTC4", 18)
        const btc5 = await mAssetMachine.loadBassetProxy("BTC5", "BTC5", 18)
        const bAssets = [renBtc, sbtc, wbtc, btc4, btc5]
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
                    max: simpleToExactAmount(37, 16),
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
                simpleToExactAmount(99),
                sa.default.address,
            )
            const dataEnd = await mAssetMachine.getBasketComposition(details)

            expect(dataEnd.totalSupply).eq(simpleToExactAmount(500, 18))
        })
        it("should mint less when going into penalty zone", async () => {
            // soft max is 30%, currently all are at 20% with 300 tvl
            // adding 90 units pushes tvl to 590 and weight to 32.2%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 90)
            await mAsset["mint(address,uint256,uint256,address)"](bAssets[0].address, approval, simpleToExactAmount(89), sa.default.address)

            const dataEnd = await mAssetMachine.getBasketComposition(details)
            const minted = dataEnd.totalSupply.sub(dataBefore.totalSupply)

            expect(minted).lt(simpleToExactAmount(90, 18))
            expect(minted).gt(simpleToExactAmount("89.6", 18))
        })
        it("should apply close to 5% penalty near hard max", async () => {
            // hard max is 37%, currently at 32.2% with 590 tvl
            // adding 40 units pushes tvl to 630 and weight to 36.5%
            // other weights then are 15.8%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 40)
            await mAsset["mint(address,uint256,uint256,address)"](bAssets[0].address, approval, simpleToExactAmount(37), sa.default.address)

            const dataEnd = await mAssetMachine.getBasketComposition(details)
            const minted = dataEnd.totalSupply.sub(dataBefore.totalSupply)

            expect(minted).lt(simpleToExactAmount(40, 18))
            expect(minted).gt(simpleToExactAmount("39.3", 18))
        })
        it("should fail if we go over max", async () => {
            const { bAssets, mAsset } = details
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 30)
            await expect(
                mAsset["mint(address,uint256,uint256,address)"](bAssets[0].address, approval, simpleToExactAmount(10), sa.default.address),
            ).to.be.revertedWith("Exceeds weight limits")
        })
        it("should allow lots of minting", async () => {
            const { bAssets, mAsset } = details
            const approval = await mAssetMachine.approveMasset(bAssets[1], mAsset, 80)
            await mAsset["mint(address,uint256,uint256,address)"](bAssets[1].address, approval.div(80), 0, sa.default.address)
            await mAsset["mint(address,uint256,uint256,address)"](bAssets[1].address, approval.div(80), 0, sa.default.address)
            await mAsset["mint(address,uint256,uint256,address)"](bAssets[1].address, approval.div(80), 0, sa.default.address)
            await bAssets[2].transfer(sa.dummy2.address, simpleToExactAmount(50, await bAssets[2].decimals()))
            const approval2 = await mAssetMachine.approveMasset(bAssets[2], mAsset, 50, sa.dummy2.signer)
            await mAsset
                .connect(sa.dummy2.signer)
                ["mint(address,uint256,uint256,address)"](bAssets[2].address, approval2.div(5), 0, sa.default.address)
            await mAsset
                .connect(sa.dummy2.signer)
                ["mint(address,uint256,uint256,address)"](bAssets[2].address, approval2.div(5), 0, sa.default.address)
            await mAsset
                .connect(sa.dummy2.signer)
                ["mint(address,uint256,uint256,address)"](bAssets[2].address, approval2.div(5), 0, sa.default.address)
            await mAsset
                .connect(sa.dummy2.signer)
                ["mint(address,uint256,uint256,address)"](bAssets[2].address, approval2.div(5), 0, sa.default.address)
            await mAsset
                .connect(sa.dummy2.signer)
                ["mint(address,uint256,uint256,address)"](bAssets[2].address, approval2.div(5), 0, sa.default.address)
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
                99,
                sa.default.address,
            )
            dataStart = await mAssetMachine.getBasketComposition(details)

            expect(dataStart.totalSupply).eq(simpleToExactAmount(500, 18))
        })
        it("should swap almost 1:1(-fee) within normal range", async () => {
            // soft max is 30%, currently all are at 20% with 500 tvl
            // adding 10 units should result in 9.9994 output and 22%
            const { bAssets, mAsset } = details

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 10)
            await mAsset["swap(address,address,uint256,uint256,address)"](
                bAssets[0].address,
                bAssets[1].address,
                approval,
                simpleToExactAmount("9.95"),
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const swappedOut = dataStart.bAssets[1].mAssetUnits.sub(dataAfter.bAssets[1].mAssetUnits)
            assertBNClosePercent(swappedOut, simpleToExactAmount("9.994", 18), "0.1")

            expect(dataAfter.bAssets[0].mAssetUnits.sub(dataStart.bAssets[0].mAssetUnits)).eq(simpleToExactAmount(10, 18))

            expect(dataAfter.totalSupply).eq(dataStart.totalSupply)
        })
        it("should apply minute fee when 2% over soft max ", async () => {
            // soft max is 30%, currently at 22% with 110/500 tvl
            // adding 50 units pushes to 160/500 and weight to 32%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 50)
            await mAsset["swap(address,address,uint256,uint256,address)"](
                bAssets[0].address,
                bAssets[2].address,
                approval,
                simpleToExactAmount(49, 12),
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const swappedOut = dataBefore.bAssets[2].mAssetUnits.sub(dataAfter.bAssets[2].mAssetUnits)
            // sum of fee is 0.5% (incl 0.06% swap fee)
            expect(swappedOut).gt(simpleToExactAmount("49.6", 18))
            expect(swappedOut).lt(simpleToExactAmount(50, 18))
        })
        it("should apply close to 5% penalty near hard max", async () => {
            // hard max is 37%, currently at 32% with 160/500 tvl
            // adding 24 units pushes to 184/500 and weight to 36.8%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 24)
            await mAsset["swap(address,address,uint256,uint256,address)"](
                bAssets[0].address,
                bAssets[1].address,
                approval,
                simpleToExactAmount(22),
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const swappedOut = dataBefore.bAssets[1].mAssetUnits.sub(dataAfter.bAssets[1].mAssetUnits)
            // sum of fee is 0.5% (incl 0.06% swap fee)
            expect(swappedOut).lt(simpleToExactAmount(24, 18))
            expect(swappedOut).gt(simpleToExactAmount("22.8", 18))
        })
        it("should fail if we go over max", async () => {
            const { bAssets, mAsset } = details
            const approval = await mAssetMachine.approveMasset(bAssets[0], mAsset, 10)
            await expect(
                mAsset["swap(address,address,uint256,uint256,address)"](
                    bAssets[0].address,
                    bAssets[2].address,
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

            expect(dataStart.totalSupply).eq(simpleToExactAmount(500, 18))
        })
        it("should redeem almost 1:1(-fee) within normal range", async () => {
            // soft min is 10%, currently all are at 20% with 500 tvl
            const { bAssets, mAsset } = details

            const mAssetRedeemAmount = simpleToExactAmount(10, 18)
            const minBassetAmount = simpleToExactAmount(9, 18)
            await mAsset["redeem(address,uint256,uint256,address)"](
                bAssets[0].address,
                mAssetRedeemAmount,
                minBassetAmount,
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const redeemed = dataStart.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits)
            assertBNClosePercent(redeemed, simpleToExactAmount("9.994", 18), "0.1")

            expect(dataAfter.totalSupply).eq(dataStart.totalSupply.sub(mAssetRedeemAmount))
        })
        it("should apply minute fee when 2% under soft min ", async () => {
            // soft min is 20%, currently at 90/490 tvl
            // withdrawing 50 units pushes to 40/440 and weight to 9.1%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const mAssetRedeemAmount = simpleToExactAmount(50, 18)
            const minBassetAmount = simpleToExactAmount(49, 18)
            await mAsset["redeem(address,uint256,uint256,address)"](
                bAssets[0].address,
                mAssetRedeemAmount,
                minBassetAmount,
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const redeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits)
            // sum of slippage is max 0.33% (incl 0.06% swap fee)
            expect(redeemed).gt(simpleToExactAmount("49.6", 18))
            expect(redeemed).lt(simpleToExactAmount("49.95", 18))

            expect(dataAfter.totalSupply).eq(dataBefore.totalSupply.sub(mAssetRedeemAmount))
            expect(dataAfter.surplus.sub(dataBefore.surplus)).eq(simpleToExactAmount(30, 15))
        })
        it("should apply close to 5% penalty near hard min", async () => {
            // hard min is 5%, currently at 9.1% with 40/440 tvl
            // redeeming 18 units pushes to 22/422 and weight to 5.2%
            const { bAssets, mAsset } = details

            const dataBefore = await mAssetMachine.getBasketComposition(details)

            const mAssetRedeemAmount = simpleToExactAmount(18, 18)
            const minBassetAmount = simpleToExactAmount(14, 18)
            await mAsset["redeem(address,uint256,uint256,address)"](
                bAssets[0].address,
                mAssetRedeemAmount,
                minBassetAmount,
                sa.default.address,
            )

            const dataAfter = await mAssetMachine.getBasketComposition(details)

            const bAssetRedeemed = dataBefore.bAssets[0].mAssetUnits.sub(dataAfter.bAssets[0].mAssetUnits)
            // max slippage around 9%
            expect(bAssetRedeemed).gt(simpleToExactAmount("16.6", 18))
            expect(bAssetRedeemed).lt(simpleToExactAmount("17.52", 18))

            expect(dataAfter.totalSupply).eq(dataBefore.totalSupply.sub(mAssetRedeemAmount))
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

            expect(dataStart.totalSupply).eq(simpleToExactAmount(300, 18))
        })
    })
})
