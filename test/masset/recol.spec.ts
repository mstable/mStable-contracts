import { expect } from "chai"
import { ethers, network } from "hardhat"

import { assertBNSlightlyGTPercent } from "@utils/assertions"
import { BN, simpleToExactAmount } from "@utils/math"
import { MassetDetails, MassetMachine, StandardAccounts } from "@utils/machines"
import { ONE_DAY } from "@utils/constants"
import { ExposedMassetLogic, MassetLogic__factory } from "types/generated"
import { getTimestamp, increaseTime } from "@utils/time"

const one = simpleToExactAmount(1)
const swapFee = simpleToExactAmount(6, 14)
const recolFee = simpleToExactAmount(5, 13)

const snapshot = async (): Promise<number> => {
    const id = await network.provider.request({
        method: "evm_snapshot",
    })
    return id as number
}

const revert = async (id: number): Promise<void> => {
    await network.provider.request({
        method: "evm_revert",
        params: [id],
    })
}

describe("Recol functions", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine

    let details: MassetDetails
    let validator: ExposedMassetLogic

    const runSetup = async (): Promise<void> => {
        details = await mAssetMachine.deployMasset()
        await mAssetMachine.seedWithWeightings(details, [22, 28, 23, 24])

        const logicLib = await new MassetLogic__factory(sa.default.signer).deploy()
        const linkedAddress = {
            libraries: {
                MassetLogic: logicLib.address,
            },
        }
        const massetFactory = await ethers.getContractFactory("ExposedMassetLogic", linkedAddress)
        validator = (await massetFactory.deploy()) as ExposedMassetLogic
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        await runSetup()
    })

    const changeCollateralisation = async (over: boolean) => {
        const { mAsset } = details
        const time = await getTimestamp()
        const currentA = (await mAsset.getConfig()).a
        const futureA = over ? currentA.mul(4) : currentA.div(4)
        await mAsset.connect(sa.governor.signer).startRampA(futureA.div(100), time.add(ONE_DAY.add(1)))
        await increaseTime(ONE_DAY.add(1))
    }

    describe("recol fee application", () => {
        context("when over collateralised", () => {
            before(async () => {
                await runSetup()
                await changeCollateralisation(true)
                const price = await details.mAsset.getPrice()
                expect(price.price).gt(one)
            })
            it("should not apply fee", async () => {
                const { mAsset } = details
                const bAssetData = (await mAsset.getBassets())[1]
                const config = await mAsset.getConfig()
                const noRecol = {
                    ...config,
                    recolFee: BN.from(0),
                }
                const withRecol = {
                    ...config,
                    recolFee,
                }

                // mint
                const mintWithNone = await validator.computeMint(bAssetData, 0, one, noRecol)
                const mintWithRecol = await validator.computeMint(bAssetData, 0, one, withRecol)
                expect(mintWithNone).eq(mintWithRecol)

                // mintMulti
                const multiWithNone = await validator.computeMintMulti(bAssetData, [0], [one], noRecol)
                const multiWithRecol = await validator.computeMintMulti(bAssetData, [0], [one], withRecol)
                expect(multiWithNone).eq(multiWithRecol)

                // swap
                const [swapWithNone] = await validator.computeSwap(bAssetData, 0, 1, one, swapFee, noRecol)
                const [swapWithRecol] = await validator.computeSwap(bAssetData, 0, 1, one, swapFee, withRecol)
                expect(swapWithNone).eq(swapWithRecol)

                // redeem
                const [redeemWithNone] = await validator.computeRedeem(bAssetData, 0, one, noRecol, swapFee)
                const [redeemWithRecol] = await validator.computeRedeem(bAssetData, 0, one, withRecol, swapFee)
                expect(redeemWithNone).eq(redeemWithRecol)

                // redeemExact
                const [exactWithNone] = await validator.computeRedeemExact(bAssetData, [0], [one], noRecol, swapFee)
                const [exactWithRecol] = await validator.computeRedeemExact(bAssetData, [0], [one], withRecol, swapFee)
                expect(exactWithNone).eq(exactWithRecol)

                // redeemProportionately
                const sID = await snapshot()
                await mAsset.simulateRedeemMasset(one, [0, 0, 0, 0], 0)
                const vaultsWithNone = (await mAsset.getBassets())[1]
                await revert(sID)
                await mAsset.simulateRedeemMasset(one, [0, 0, 0, 0], simpleToExactAmount(5, 13))
                const vaultsWithRecol = (await mAsset.getBassets())[1]
                vaultsWithRecol.map((v, i) => expect(v.vaultBalance).eq(vaultsWithNone[i].vaultBalance))
            })
        })
        context("when under collateralised", () => {
            before(async () => {
                await runSetup()
                await changeCollateralisation(false)
                const price = await details.mAsset.getPrice()
                expect(price.price).lt(one)
            })
            it("should deduct fee if set", async () => {
                const { mAsset } = details
                const bAssetData = (await mAsset.getBassets())[1]
                const config = await mAsset.getConfig()
                const noRecol = {
                    ...config,
                    recolFee: BN.from(0),
                }
                const withRecol = {
                    ...config,
                    recolFee,
                }

                // mint
                const mintWithNone = await validator.computeMint(bAssetData, 0, one, noRecol)
                const mintWithRecol = await validator.computeMint(bAssetData, 0, one, withRecol)
                assertBNSlightlyGTPercent(mintWithNone, mintWithRecol, "0.006", true)

                // mintMulti
                const multiWithNone = await validator.computeMintMulti(bAssetData, [0], [one], noRecol)
                const multiWithRecol = await validator.computeMintMulti(bAssetData, [0], [one], withRecol)
                assertBNSlightlyGTPercent(multiWithNone, multiWithRecol, "0.006", true)

                // swap
                const [swapWithNone] = await validator.computeSwap(bAssetData, 0, 1, one, swapFee, noRecol)
                const [swapWithRecol] = await validator.computeSwap(bAssetData, 0, 1, one, swapFee, withRecol)
                assertBNSlightlyGTPercent(swapWithNone, swapWithRecol, "0.006", true)

                // redeem
                const [redeemWithNone] = await validator.computeRedeem(bAssetData, 0, one, noRecol, swapFee)
                const [redeemWithRecol] = await validator.computeRedeem(bAssetData, 0, one, withRecol, swapFee)
                assertBNSlightlyGTPercent(redeemWithNone, redeemWithRecol, "0.006", true)

                // redeemExact
                const [exactWithNone] = await validator.computeRedeemExact(bAssetData, [0], [one], noRecol, swapFee)
                const [exactWithRecol] = await validator.computeRedeemExact(bAssetData, [0], [one], withRecol, swapFee)
                assertBNSlightlyGTPercent(exactWithRecol, exactWithNone, "0.006", true)

                // redeemProportionately
                const sID = await snapshot()
                await mAsset.simulateRedeemMasset(one, [0, 0, 0, 0], 0)
                const vaultsWithNone = (await mAsset.getBassets())[1]
                await revert(sID)
                await mAsset.simulateRedeemMasset(one, [0, 0, 0, 0], simpleToExactAmount(5, 13))
                const vaultsWithRecol = (await mAsset.getBassets())[1]
                vaultsWithRecol.map((v, i) => assertBNSlightlyGTPercent(v.vaultBalance, vaultsWithNone[i].vaultBalance, "0.006", true))
            })
        })
    })
    describe("manually re-setting collateraliastion", () => {
        context("when over collateralised", () => {
            before(async () => {
                await runSetup()
                await changeCollateralisation(true)
                const price = await details.mAsset.getPrice()
                expect(price.price).gt(one)
            })
            it("should fail to burnSurplus", async () => {
                await expect(details.mAsset.connect(sa.governor.signer).burnSurplus()).to.be.revertedWith("No surplus")
            })
            it("should distribute surplus to savers", async () => {
                const { mAsset } = details

                const { surplus } = await mAsset.data()
                let supply = await mAsset.totalSupply()
                const { k } = await mAsset.getPrice()

                const diff = await k.sub(supply.add(surplus))

                const tx = mAsset.connect(sa.governor.signer).mintDeficit()
                await expect(tx).to.emit(mAsset, "DeficitMinted").withArgs(diff)

                const { surplus: surplusAfter } = await mAsset.data()
                supply = await mAsset.totalSupply()
                const { price, k: kAfter } = await mAsset.getPrice()

                expect(k).eq(kAfter)
                expect(price).eq(simpleToExactAmount(1))
                expect(surplusAfter).eq(surplus.add(diff))
                expect(k).eq(supply.add(surplusAfter))
            })
            it("should do nothing if called again", async () => {
                await expect(details.mAsset.connect(sa.governor.signer).mintDeficit()).to.be.revertedWith("No deficit")
            })
        })
        context("when under collateralised", () => {
            before(async () => {
                await runSetup()
                await changeCollateralisation(false)
                const price = await details.mAsset.getPrice()
                expect(price.price).lt(one)
            })
            it("should fail to mintDeficit", async () => {
                await expect(details.mAsset.connect(sa.governor.signer).mintDeficit()).to.be.revertedWith("No deficit")
            })
            it("should deduct deficit from sender and reset", async () => {
                const { mAsset } = details

                const balBefore = await mAsset.balanceOf(sa.default.address)

                const { surplus } = await mAsset.data()
                const supplyBefore = await mAsset.totalSupply()
                const { k } = await mAsset.getPrice()

                const diff = await supplyBefore.add(surplus).sub(k)

                const tx = mAsset.connect(sa.default.signer).burnSurplus()
                await expect(tx).to.emit(mAsset, "SurplusBurned").withArgs(sa.default.address, diff)

                const balAfter = await mAsset.balanceOf(sa.default.address)
                const { surplus: surplusAfter } = await mAsset.data()
                const supplyafter = await mAsset.totalSupply()
                const { price, k: kAfter } = await mAsset.getPrice()

                expect(k).eq(kAfter)
                expect(price).eq(simpleToExactAmount(1))
                expect(surplusAfter).eq(surplus)
                expect(balAfter).eq(balBefore.sub(diff))
                expect(supplyafter).eq(supplyBefore.sub(diff))
            })
            it("should do nothing if called again", async () => {
                await expect(details.mAsset.connect(sa.default.signer).burnSurplus()).to.be.revertedWith("No surplus")
            })
        })
    })
})
