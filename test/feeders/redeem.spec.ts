import { expect } from "chai"
import { Signer } from "ethers"
import { ethers } from "hardhat"

import { BN, simpleToExactAmount } from "@utils/math"
import { FeederDetails, FeederMachine, MassetMachine, StandardAccounts } from "@utils/machines"
import { ZERO_ADDRESS } from "@utils/constants"
import { FeederPool, MockERC20 } from "types/generated"
import { BassetStatus } from "@utils/mstable-objects"
import { Account } from "types"

interface RedeemOutput {
    outputQuantity: BN
    senderBassetBalBefore: BN
    senderBassetBalAfter: BN
    recipientBalBefore: BN
    recipientBalAfter: BN
}

describe("Feeder - Redeem", () => {
    let sa: StandardAccounts
    let feederMachine: FeederMachine
    let details: FeederDetails

    const runSetup = async (
        useLendingMarkets = false,
        useInterestValidator = false,
        feederWeights?: Array<BN | number>,
        mAssetWeights?: Array<BN | number>,
        use2dp = false,
        useRedemptionPrice = false,
    ): Promise<void> => {
        details = await feederMachine.deployFeeder(feederWeights, mAssetWeights, useLendingMarkets,
            useInterestValidator, use2dp, useRedemptionPrice)
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        feederMachine = await new FeederMachine(mAssetMachine)
        sa = mAssetMachine.sa
    })

    const assertFailedRedeem = async (
        expectedReason: string,
        poolContract: FeederPool,
        outputAsset: MockERC20,
        fpTokenQuantity: BN | number | string,
        outputExpected: BN | number | string = undefined,
        minOutputQuantity: BN | number | string = 0,
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        quantitiesAreExact = true,
    ): Promise<void> => {
        const pool = poolContract.connect(sender)

        const outputAssetDecimals = await outputAsset.decimals()
        const fpTokenQuantityExact = quantitiesAreExact
            ? BN.from(fpTokenQuantity)
            : simpleToExactAmount(fpTokenQuantity, outputAssetDecimals)
        const minOutputQuantityExact = quantitiesAreExact ? BN.from(minOutputQuantity) : simpleToExactAmount(minOutputQuantity, 18)

        await expect(
            pool.redeem(outputAsset.address, fpTokenQuantityExact, minOutputQuantityExact, recipient),
            `redeem tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)

        if (outputExpected === undefined) {
            await expect(
                pool.getRedeemOutput(outputAsset.address, fpTokenQuantityExact),
                `get redeem exact output should revert with "${expectedReason}"`,
            ).to.be.revertedWith(expectedReason)
        } else {
            const outputExpectedExact = quantitiesAreExact ? BN.from(outputExpected) : simpleToExactAmount(outputExpected, 18)
            const outputActual = await pool.getRedeemOutput(outputAsset.address, fpTokenQuantityExact)
            expect(outputActual, "getRedeemOutput call output").eq(outputExpectedExact)
        }
    }

    const assertFailedRedeemExact = async (
        expectedReason: string,
        poolContract: FeederPool,
        outputAssets: (MockERC20 | string)[],
        outputQuantities: (BN | number | string)[],
        fpTokenQuantityExpected: BN | number | string = undefined,
        maxFpTokenQuantity: BN | number | string = simpleToExactAmount(100),
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        quantitiesAreExact = true,
    ): Promise<void> => {
        const pool = poolContract.connect(sender)

        const outputAssetAddresses = outputAssets.map((asset) => (typeof asset === "string" ? asset : asset.address))
        const outputAssetDecimals = await Promise.all(
            outputAssets.map((asset) => (typeof asset === "string" ? Promise.resolve(18) : asset.decimals())),
        )

        // Convert to exact quantities
        const outputQuantitiesExact = quantitiesAreExact
            ? outputQuantities.map((q) => BN.from(q))
            : outputQuantities.map((q, i) => simpleToExactAmount(q, outputAssetDecimals[i]))
        const maxFpTokenQuantityExact = quantitiesAreExact ? BN.from(maxFpTokenQuantity) : simpleToExactAmount(maxFpTokenQuantity)

        await expect(
            pool.redeemExactBassets(outputAssetAddresses, outputQuantitiesExact, maxFpTokenQuantityExact, recipient),
            `redeem exact tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)

        if (fpTokenQuantityExpected === undefined) {
            await expect(
                pool.getRedeemExactBassetsOutput(outputAssetAddresses, outputQuantitiesExact),
                `get redeem exact output should revert with "${expectedReason}"`,
            ).to.be.revertedWith(expectedReason)
        } else {
            const fpTokenQuantityExpectedExact = quantitiesAreExact
                ? BN.from(fpTokenQuantityExpected)
                : simpleToExactAmount(fpTokenQuantityExpected)
            const fpTokenQuantityActual = await pool.getRedeemExactBassetsOutput(outputAssetAddresses, outputQuantitiesExact)
            expect(fpTokenQuantityActual, "redeem exact fp token qty").eq(fpTokenQuantityExpectedExact)
        }
    }

    const assertFailedRedeemProportionately = async (
        expectedReason: string,
        poolContract: FeederPool,
        fpTokenQuantity: BN | number | string,
        minOutputQuantities: [BN | number | string, BN | number | string] = [0, 0],
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        quantitiesAreExact = true,
    ): Promise<void> => {
        const pool = poolContract.connect(sender)

        const fpTokenQuantityExact = quantitiesAreExact ? BN.from(fpTokenQuantity) : simpleToExactAmount(fpTokenQuantity)
        const minOutputQuantityExact = minOutputQuantities.map((qty) => (quantitiesAreExact ? BN.from(qty) : simpleToExactAmount(qty)))

        await expect(
            pool.redeemProportionately(fpTokenQuantityExact, minOutputQuantityExact, recipient),
            `redeem proportionately tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)
    }

    const assertBasicRedeem = async (
        fd: FeederDetails,
        outputAsset: MockERC20,
        fpTokenQuantity: BN | number | string = simpleToExactAmount(1),
        outputQuantityExpected: BN | number | string = -1,
        minOutputQuantity: BN | number | string = 0,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        quantitiesAreExact = true,
    ): Promise<RedeemOutput> => {
        const pool = fd.pool.connect(sender.signer)

        const outputAssetDecimals = await outputAsset.decimals()

        // Get before balances
        const senderFpTokenBalBefore = await pool.balanceOf(sender.address)
        const recipientBalBefore = await outputAsset.balanceOf(recipient)
        const assetBefore = await feederMachine.getAsset(details, outputAsset.address)

        // Convert to exact quantities
        const fpTokenQuantityExact = quantitiesAreExact ? BN.from(fpTokenQuantity) : simpleToExactAmount(fpTokenQuantity)
        const minOutputQuantityExact = quantitiesAreExact
            ? BN.from(minOutputQuantity)
            : simpleToExactAmount(minOutputQuantity, outputAssetDecimals)
        const outputQuantityExpectedExact = quantitiesAreExact
            ? BN.from(outputQuantityExpected)
            : simpleToExactAmount(outputQuantityExpected, outputAssetDecimals)

        const platformInteraction = await FeederMachine.getPlatformInteraction(pool, "withdrawal", fpTokenQuantityExact, assetBefore)
        const integratorBalBefore = await assetBefore.contract.balanceOf(
            assetBefore.integrator ? assetBefore.integratorAddr : assetBefore.feederPoolOrMassetContract.address,
        )

        const outputActual = await pool.getRedeemOutput(outputAsset.address, fpTokenQuantityExact)
        if (outputQuantityExpectedExact.gte(0)) {
            expect(outputActual, "redeem output").to.eq(outputQuantityExpectedExact)
        }

        const tx = pool.redeem(outputAsset.address, fpTokenQuantityExact, minOutputQuantityExact, recipient)
        const receipt = await (await tx).wait()

        await expect(tx, "Redeem event").to.emit(pool, "Redeemed")
        // TODO replace when Waffle supports withNamedArgs
        const redeemEvent = receipt.events.find((event) => event.event === "Redeemed" && event.address === pool.address)
        expect(redeemEvent).to.not.equal(undefined)
        expect(redeemEvent.args.redeemer, "redeemer in Redeemer event").to.eq(sender.address)
        expect(redeemEvent.args.recipient, "recipient in Redeemer event").to.eq(recipient)
        expect(redeemEvent.args.mAssetQuantity, "mAssetQuantity in Redeemer event").to.eq(fpTokenQuantityExact)
        expect(redeemEvent.args.output, "output in Redeemer event").to.eq(outputAsset.address)
        if (outputActual.gte(0)) {
            expect(redeemEvent.args.outputQuantity, "outputQuantity in Redeemer event").to.eq(outputActual)
        }
        expect(redeemEvent.args.scaledFee, "scaledFee in Redeemed event").to.gte(0)

        // Burn feeder pool token
        await expect(tx, "Transfer event").to.emit(pool, "Transfer").withArgs(sender.address, ZERO_ADDRESS, fpTokenQuantityExact)

        // Transfers from lending platform or feeder pool to recipient
        await expect(tx, "Transfer event")
            .to.emit(outputAsset, "Transfer")
            .withArgs(
                assetBefore.integrator ? assetBefore.integratorAddr : assetBefore.feederPoolOrMassetContract.address,
                recipient,
                outputActual,
            )

        // Withdraw from lending platform, feeder pool or main pool
        const integratorBalAfter = await assetBefore.contract.balanceOf(
            assetBefore.integrator ? assetBefore.integratorAddr : assetBefore.feederPoolOrMassetContract.address,
        )
        // TODO Expected "199000412397088284203" to be equal 199000000000000000000
        if (platformInteraction.expectInteraction) {
            await expect(tx)
                .to.emit(fd.mAssetDetails.platform, "Withdraw")
                .withArgs(outputAsset.address, assetBefore.pToken, platformInteraction.amount)
        } else {
            expect(integratorBalAfter, "integrator balance after").eq(integratorBalBefore.sub(outputActual))
        }

        // Recipient should have redeemed asset after
        const recipientBalAfter = await outputAsset.balanceOf(recipient)
        expect(recipientBalAfter, "recipient balance after").eq(recipientBalBefore.add(outputActual))
        // Sender should have less asset after
        const senderFpTokenBalAfter = await pool.balanceOf(sender.address)
        expect(senderFpTokenBalAfter, "sender balance after").eq(senderFpTokenBalBefore.sub(fpTokenQuantityExact))
        // VaultBalance should update for this asset
        const assetAfter = await feederMachine.getAsset(details, outputAsset.address)
        expect(BN.from(assetAfter.vaultBalance), "vault balance after").eq(BN.from(assetBefore.vaultBalance).sub(outputActual))

        return {
            outputQuantity: outputActual,
            senderBassetBalBefore: senderFpTokenBalBefore,
            senderBassetBalAfter: senderFpTokenBalAfter,
            recipientBalBefore,
            recipientBalAfter,
        }
    }

    const assertRedeemExact = async (
        fd: FeederDetails,
        outputAssets: Array<MockERC20>,
        outputQuantities: Array<BN | number>,
        inputQuantityExpected: BN | number | string,
        maxFpTokenQuantity: BN | number | string = simpleToExactAmount(100),
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        quantitiesAreExact = true,
    ): Promise<void> => {
        const { pool: poolContract } = fd
        const pool = poolContract.connect(sender.signer)

        const outputAssetAddresses = outputAssets.map((asset) => asset.address)
        const outputAssetDecimals = await Promise.all(outputAssets.map((asset) => asset.decimals()))

        // Convert to exact quantities
        const outputQuantitiesExact = quantitiesAreExact
            ? outputQuantities.map((q) => BN.from(q))
            : outputQuantities.map((q, i) => simpleToExactAmount(q, outputAssetDecimals[i]))
        const maxFpTokenQuantityExact = quantitiesAreExact ? BN.from(maxFpTokenQuantity) : simpleToExactAmount(maxFpTokenQuantity)
        const inputQuantityExpectedExact = quantitiesAreExact ? BN.from(inputQuantityExpected) : simpleToExactAmount(inputQuantityExpected)

        const senderAssetsBalBefore = await pool.balanceOf(sender.address)
        const recipientOutputBalancesBefore = await Promise.all(outputAssets.map((b) => b.balanceOf(recipient)))
        const assetsBefore = await Promise.all(outputAssets.map((asset) => feederMachine.getAsset(details, asset.address)))

        const inputQuantityActual = await pool.getRedeemExactBassetsOutput(outputAssetAddresses, outputQuantitiesExact)
        expect(inputQuantityActual, "get redeem exact input").to.eq(inputQuantityExpectedExact)

        const tx = pool.redeemExactBassets(outputAssetAddresses, outputQuantitiesExact, maxFpTokenQuantityExact, recipient)
        const receipt = await (await tx).wait()

        await expect(tx).to.emit(pool, "RedeemedMulti")
        // TODO replace when Waffle supports withNamedArgs
        const redeemEvent = receipt.events.find((event) => event.event === "RedeemedMulti" && event.address === pool.address)
        expect(redeemEvent).to.not.equal(undefined)
        expect(redeemEvent.args.redeemer, "redeemer in RedeemedMulti event").to.eq(sender.address)
        expect(redeemEvent.args.recipient, "recipient in RedeemedMulti event").to.eq(recipient)
        expect(redeemEvent.args.mAssetQuantity, "mAssetQuantity in RedeemedMulti event").to.eq(inputQuantityExpectedExact)
        expect(redeemEvent.args.outputs, "outputs in RedeemedMulti event").to.eql(outputAssetAddresses)
        expect(redeemEvent.args.outputQuantity.length, "outputQuantity length RedeemedMulti event").to.eql(outputQuantitiesExact.length)
        redeemEvent.args.outputQuantity.forEach((qty, i) => {
            expect(qty, `outputQuantity at index ${i} in RedeemedMulti event`).to.eq(outputQuantitiesExact[i])
        })

        // Recipient should have mAsset quantity after
        const recipientOutputBalancesAfter = await Promise.all(outputAssets.map((b) => b.balanceOf(recipient)))
        recipientOutputBalancesAfter.forEach((balanceAfter, i) => {
            expect(balanceAfter, `recipient asset[${i}] balance after`).eq(recipientOutputBalancesBefore[i].add(outputQuantitiesExact[i]))
        })

        // Sender should have less feeder pool tokens after
        const senderAssetsBalAfter = await pool.balanceOf(sender.address)
        expect(senderAssetsBalAfter, `sender fp tokens after`).eq(senderAssetsBalBefore.sub(inputQuantityExpected))

        // VaultBalance should updated for this bAsset
        const assetsAfter = await Promise.all(outputAssets.map((asset) => feederMachine.getAsset(details, asset.address)))
        assetsAfter.forEach((assetAfter, i) => {
            expect(BN.from(assetAfter.vaultBalance), "vault balance after").eq(
                BN.from(assetsBefore[i].vaultBalance).sub(outputQuantitiesExact[i]),
            )
        })
    }

    const assertRedeemProportionately = async (
        fd: FeederDetails,
        fpTokenQuantity: BN | number | string = simpleToExactAmount(1),
        outputQuantitiesExpected: (BN | number | string)[] = undefined,
        minOutputQuantities: (BN | number | string)[] = [0, 0],
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        quantitiesAreExact = true,
    ): Promise<void> => {
        const { bAssets } = fd
        const pool = fd.pool.connect(sender.signer)

        const outputAssetAddresses = bAssets.map((asset) => asset.address)
        const outputAssetDecimals = await Promise.all(bAssets.map((asset) => asset.decimals()))

        // Get before balances
        const senderFpTokenBalBefore = await pool.balanceOf(sender.address)
        const recipientOutputBalancesBefore = await Promise.all(bAssets.map((b) => b.balanceOf(recipient)))
        const assetsBefore = await Promise.all(bAssets.map((asset) => feederMachine.getAsset(details, asset.address)))

        // Convert to exact quantities
        const fpTokenQuantityExact = quantitiesAreExact ? BN.from(fpTokenQuantity) : simpleToExactAmount(fpTokenQuantity)
        const minOutputQuantitiesExact = minOutputQuantities.map((qty) => (quantitiesAreExact ? BN.from(qty) : simpleToExactAmount(qty)))
        const outputQuantitiesExpectedExact = outputQuantitiesExpected.map((qty, i) =>
            quantitiesAreExact ? BN.from(qty) : simpleToExactAmount(qty, outputAssetDecimals[i]),
        )

        const tx = pool.redeemProportionately(fpTokenQuantityExact, minOutputQuantitiesExact, recipient)
        const receipt = await (await tx).wait()

        await expect(tx).to.emit(pool, "RedeemedMulti")
        // TODO replace when Waffle supports withNamedArgs
        const redeemEvent = receipt.events.find((event) => event.event === "RedeemedMulti" && event.address === pool.address)
        expect(redeemEvent).to.not.equal(undefined)
        expect(redeemEvent.args.redeemer, "redeemer in RedeemedMulti event").to.eq(sender.address)
        expect(redeemEvent.args.recipient, "recipient in RedeemedMulti event").to.eq(recipient)
        expect(redeemEvent.args.mAssetQuantity, "mAssetQuantity in RedeemedMulti event").to.eq(fpTokenQuantityExact)
        expect(redeemEvent.args.outputs, "outputs in RedeemedMulti event").to.deep.eq(outputAssetAddresses)
        expect(redeemEvent.args.outputQuantity.length, "outputQuantity length RedeemedMulti event").to.eql(
            outputQuantitiesExpectedExact.length,
        )
        redeemEvent.args.outputQuantity.forEach((qty, i) => {
            expect(qty, `outputQuantity at index ${i} in RedeemedMulti event`).to.eq(outputQuantitiesExpectedExact[i])
        })
        expect(redeemEvent.args.scaledFee, "scaledFee in RedeemedMulti event").to.gt(0)

        // Recipient should have asset quantity after
        const recipientOutputBalancesAfter = await Promise.all(bAssets.map((b) => b.balanceOf(recipient)))
        recipientOutputBalancesAfter.forEach((balanceAfter, i) => {
            expect(balanceAfter, `recipient asset[${i}] balance after`).eq(
                recipientOutputBalancesBefore[i].add(outputQuantitiesExpected[i]),
            )
        })

        // Sender should have less feeder pool tokens after
        const senderAssetsBalAfter = await pool.balanceOf(sender.address)
        expect(senderAssetsBalAfter, `sender fp tokens after`).eq(senderFpTokenBalBefore.sub(fpTokenQuantity))

        // VaultBalance should updated for this bAsset
        const assetsAfter = await Promise.all(bAssets.map((asset) => feederMachine.getAsset(details, asset.address)))
        assetsAfter.forEach((assetAfter, i) => {
            expect(BN.from(assetAfter.vaultBalance), "vault balance after").eq(
                BN.from(assetsBefore[i].vaultBalance).sub(outputQuantitiesExpectedExact[i]),
            )
        })
    }

    describe("Redeeming with a single asset", () => {
        context("when the basket is balanced", () => {
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should fail if recipient is 0x0", async () => {
                    const { pool, fAsset } = details
                    await assertFailedRedeem(
                        "Invalid recipient",
                        pool,
                        fAsset,
                        simpleToExactAmount(1),
                        "999591707839220549",
                        0,
                        sa.default.signer,
                        ZERO_ADDRESS,
                    )
                })
                it("should fail when zero fp token quantity", async () => {
                    const { fAsset, pool } = details
                    await assertFailedRedeem("Qty==0", pool, fAsset, 0)
                })
                it("should fail when input too small to redeem anything", async () => {
                    const { fAsset, pool } = details
                    await assertFailedRedeem("Must redeem > 1e6 units", pool, fAsset, 1)
                })
                it("should fail to redeem if slippage just too big", async () => {
                    const { pool, fAsset } = details
                    await assertFailedRedeem(
                        "bAsset qty < min qty",
                        pool,
                        fAsset,
                        simpleToExactAmount(1),
                        "999591707839220549",
                        "999600000000000000", // just over the expected output
                    )
                })
                it("should fail when sender doesn't have enough balance", async () => {
                    const { bAssets, pool } = details
                    const bAsset = bAssets[0]
                    const sender = sa.dummy1
                    expect(await bAsset.balanceOf(sender.address)).eq(0)
                    await assertFailedRedeem(
                        "ERC20: burn amount exceeds balance",
                        pool,
                        bAsset,
                        simpleToExactAmount(100),
                        "99836469880460054332",
                        0,
                        sender.signer,
                        sender.address,
                    )
                })
                it("should fail to redeem mStable asset when sender doesn't give approval", async () => {
                    const { mAsset, pool } = details
                    const sender = sa.dummy2
                    await mAsset.transfer(sender.address, 10000)
                    expect(await mAsset.allowance(sender.address, pool.address)).eq(0)
                    expect(await mAsset.balanceOf(sender.address)).eq(10000)
                    await assertFailedRedeem(
                        "ERC20: burn amount exceeds balance",
                        pool,
                        mAsset,
                        simpleToExactAmount(100),
                        "99836469880460054332",
                        0,
                        sender.signer,
                        sender.address,
                    )
                })
                it("should fail to redeem feeder asset when sender doesn't give approval", async () => {
                    const { fAsset, pool } = details
                    const sender = sa.dummy2
                    await fAsset.transfer(sender.address, 10000)
                    expect(await fAsset.allowance(sender.address, pool.address)).eq(0)
                    expect(await fAsset.balanceOf(sender.address)).eq(10000)
                    await assertFailedRedeem(
                        "ERC20: burn amount exceeds balance",
                        pool,
                        fAsset,
                        simpleToExactAmount(100),
                        "99836469880460054332",
                        0,
                        sender.signer,
                        sender.address,
                    )
                })
                it("should fail when the asset does not exist", async () => {
                    const { pool } = details
                    const invalidAsset = await feederMachine.mAssetMachine.loadBassetProxy("Mock", "MKK", 18, sa.default.address, 1000)
                    await assertFailedRedeem("Invalid asset", pool, invalidAsset, simpleToExactAmount(1))
                })

                context("when feeder pool is paused", () => {
                    before(async () => {
                        const { pool } = details
                        expect(await pool.paused(), "before pause").to.equal(false)
                        await pool.connect(sa.governor.signer).pause()
                        expect(await pool.paused(), "after pause").to.equal(true)
                    })
                    after(async () => {
                        const { pool } = details
                        expect(await pool.paused(), "before unpause").to.equal(true)
                        await pool.connect(sa.governor.signer).unpause()
                        expect(await pool.paused(), "after unpause").to.equal(false)
                    })
                    it("should fail to redeem feeder asset", async () => {
                        const { fAsset, pool } = details
                        await assertFailedRedeem("Unhealthy", pool, fAsset, simpleToExactAmount(1), "999591707839220549")
                    })
                    it("should fail to redeem mStable asset", async () => {
                        const { mAsset, pool } = details
                        await assertFailedRedeem("Unhealthy", pool, mAsset, simpleToExactAmount(1), "999591707839220549")
                    })
                    it("should fail to redeem a main pool assets", async () => {
                        const { bAssets, pool } = details
                        await assertFailedRedeem("Unhealthy", pool, bAssets[0], simpleToExactAmount(1), "999591707839220549", 0)
                    })
                })
            })
            context("reset before each", () => {
                beforeEach(async () => {
                    await runSetup()
                })
                it("should redeem a single mStable asset", async () => {
                    const { mAsset } = details
                    await assertBasicRedeem(details, mAsset, simpleToExactAmount(1), "999591707839220549", "999591707839220549")
                })
                it("should redeem a single feeder asset", async () => {
                    const { fAsset } = details
                    await assertBasicRedeem(details, fAsset, simpleToExactAmount(1), "999591707839220549", "999591707839220549")
                })
                it("should redeem a single main pool asset", async () => {
                    const { mAssetDetails } = details
                    await assertBasicRedeem(details, mAssetDetails.bAssets[0], simpleToExactAmount(1))
                })
            })
            context("scale fAsset by setting redemption price to 2", () => {
                beforeEach(async () => {
                    await runSetup(undefined, undefined, undefined,
                        undefined, undefined, true)
                    const {redemptionPriceSnap} = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("2000000000000000000000000000")
                })
                it("redeem 1 pool token for scaled mAsset quantity", async () => {
                    const {mAsset} = details
                    // TVL is 50% higher so 1 pool token should give about 1.5 mAssets.
                    await assertBasicRedeem(details, mAsset, simpleToExactAmount(1), "1493800546589159674")
                })
                it("redeem 1 pool token for scaled fAsset quantity", async () => {
                    const {fAsset} = details
                    // TVL is 50% higher and value of fAssets has doubled so should give about 1.5 / 2 per pool token.
                    await assertBasicRedeem(details, fAsset, simpleToExactAmount(1), "751092003565206370")
                })
                it("should redeem a single main pool asset independent of redemption price", async () => {
                    const {mAssetDetails} = details
                    await assertBasicRedeem(details, mAssetDetails.bAssets[0], simpleToExactAmount(1))
                })
            })
            context("enable using redemption price", () => {
                beforeEach(async () => {
                    await runSetup(undefined, undefined, undefined,
                        undefined, undefined, true)
                })
                it("Set RP so mAsset should fail redeem", async () => {
                    const {mAsset, pool, redemptionPriceSnap} = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("4500000000000000000000000000")
                    // Due to the RP fAsset is now overweight and redeeming mAsset should fail
                    await assertFailedRedeem("Exceeds weight limits", pool, mAsset, simpleToExactAmount(1))
                })
                it("Set RP so fAsset should fail redeem", async () => {
                    const {fAsset, pool, redemptionPriceSnap} = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("240000000000000000000000000")
                    // Due to the RP fAsset is now overweight and redeeming mAsset should fail
                    await assertFailedRedeem("Exceeds weight limits", pool, fAsset, simpleToExactAmount(1))
                })
            })
            context("with a bAsset with 2 dp", () => {
                beforeEach(async () => {
                    await runSetup(false, false, [50, 50], undefined, true)
                })
                it("should redeem 0 for 1e7 base units", async () => {
                    await assertFailedRedeem("Output == 0", details.pool, details.fAsset, simpleToExactAmount(1, 7), "0")
                })
                it("should redeem 1e2 for 1e18 base units", async () => {
                    await assertBasicRedeem(details, details.fAsset, simpleToExactAmount(1, 18), "99", "99")
                })
            })
            context("when a main pool asset has broken below peg", () => {
                before(async () => {
                    await runSetup()
                })
                before(async () => {
                    const { mAsset, mAssetDetails } = details
                    await mAsset.connect(sa.governor.signer).handlePegLoss(mAssetDetails.bAssets[0].address, true)
                    const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address)
                    expect(newBasset.personal.status).to.eq(BassetStatus.BrokenBelowPeg)
                })
                after(async () => {
                    const { mAsset, mAssetDetails } = details
                    await mAsset.connect(sa.governor.signer).negateIsolation(mAssetDetails.bAssets[0].address)
                    const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address)
                    expect(newBasset.personal.status).to.eq(BassetStatus.Normal)
                })
                it("should fail to redeem a main pool asset", async () => {
                    const { mAssetDetails, pool } = details
                    await assertFailedRedeem(
                        "VM Exception while processing transaction: revert",
                        pool,
                        mAssetDetails.bAssets[0],
                        simpleToExactAmount(1),
                        "998990470317456042",
                    )
                })
                it("should redeem a single mStable asset", async () => {
                    const { mAsset } = details
                    await assertBasicRedeem(details, mAsset, simpleToExactAmount(1), "999591707839220549")
                })
                it("should redeem a single feeder asset", async () => {
                    const { fAsset } = details
                    await assertBasicRedeem(details, fAsset, simpleToExactAmount(1), "999609194055423329")
                })
            })
            context("withdraw from lending markets", () => {
                beforeEach(async () => {
                    // Use lending market
                    await runSetup(true)

                    // Do another mint to ensure there is something in the lending platform
                    await feederMachine.approveFeeder(details.mAsset, details.pool.address, 100)
                    await feederMachine.approveFeeder(details.fAsset, details.pool.address, 100)
                    await details.pool.mintMulti(
                        [details.mAsset.address, details.fAsset.address],
                        [simpleToExactAmount(100), simpleToExactAmount(100)],
                        0,
                        sa.default.address,
                    )
                })
                it("should mint a single mStable asset", async () => {
                    await assertBasicRedeem(details, details.mAsset, simpleToExactAmount(20), "19989716067001609834")
                })
                it("should mint a single feeder asset", async () => {
                    await assertBasicRedeem(details, details.fAsset, simpleToExactAmount(20), "19989716067001609834")
                })
            })
        })
        context("when the basket is 80% mAsset, 20% fAsset", () => {
            beforeEach(async () => {
                await runSetup(false, false, [79, 21])
            })
            it("should fail redeem as zero output", async () => {
                const { fAsset, pool } = details
                await assertFailedRedeem("Must redeem > 1e6 units", pool, fAsset, 1)
            })
            it("should redeem fAsset to just over min weight of 20%", async () => {
                const { fAsset } = details
                await assertBasicRedeem(details, fAsset, simpleToExactAmount(1), "987164765843569218")
            })
            it("should fail redeem fAsset as just under min weight of 20%", async () => {
                const { pool, fAsset } = details
                await assertFailedRedeem("Exceeds weight limits", pool, fAsset, simpleToExactAmount(2))
            })
        })
    })
    describe("redeem exact amount of assets", () => {
        context("when the basket is balanced", () => {
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should fail to redeem exact if recipient is 0x0", async () => {
                    const { pool, bAssets } = details
                    await assertFailedRedeemExact(
                        "Invalid recipient",
                        pool,
                        bAssets,
                        [simpleToExactAmount(1), simpleToExactAmount(1)],
                        "2000800320128051221",
                        simpleToExactAmount(21, 17),
                        sa.default.signer,
                        ZERO_ADDRESS,
                    )
                })
                context("with incorrect asset array", async () => {
                    it("should fail if both input arrays are empty", async () => {
                        const { pool } = details
                        await assertFailedRedeemExact("Invalid array input", pool, [], [])
                    })
                    it("should fail if the bAsset input array is empty", async () => {
                        const { pool } = details
                        await assertFailedRedeemExact("Invalid array input", pool, [], [simpleToExactAmount(1)])
                    })
                    it("should fail if there is a length mismatch", async () => {
                        const { pool, bAssets } = details
                        await assertFailedRedeemExact(
                            "Invalid array input",
                            pool,
                            [bAssets[0].address],
                            [simpleToExactAmount(1), simpleToExactAmount(1)],
                        )
                    })
                    it("should fail if there is a length mismatch", async () => {
                        const { pool, bAssets } = details
                        await assertFailedRedeemExact("Invalid array input", pool, [bAssets[0].address], [10000, 10000, 10000, 10000])
                    })
                    it("should fail if there are duplicate bAsset addresses", async () => {
                        const { pool, bAssets } = details
                        await assertFailedRedeemExact("Duplicate asset", pool, [bAssets[0].address, bAssets[0].address], [10000, 10000])
                    })
                    it("should multi redeem a single main pool asset", async () => {
                        const { mAssetDetails, pool } = details
                        await assertFailedRedeemExact("Invalid asset", pool, [mAssetDetails.bAssets[0]], [10000])
                    })
                })
                context("when all quantities are zero", () => {
                    it("should fail to redeem exact fAsset and mAsset", async () => {
                        const { bAssets, pool } = details
                        await assertFailedRedeemExact("Must redeem > 1e6 units", pool, bAssets, [0, 0])
                    })
                    it("should fail to redeem exact feeder asset", async () => {
                        const { fAsset, pool } = details
                        await assertFailedRedeemExact("Must redeem > 1e6 units", pool, [fAsset], [0])
                    })
                    it("should fail to redeem exact mStable asset", async () => {
                        const { mAsset, pool } = details
                        await assertFailedRedeemExact("Must redeem > 1e6 units", pool, [mAsset], [0])
                    })
                })
                it("should fail if zero max feed pool token quantity", async () => {
                    const { bAssets, pool } = details
                    const bAsset = bAssets[0]
                    const sender = sa.default
                    await feederMachine.approveFeeder(bAsset, pool.address, 101, sender.signer)
                    await assertFailedRedeemExact(
                        "Qty==0",
                        pool,
                        [bAsset.address],
                        ["100000000000000000000"], // 100
                        "100164135324021457059",
                        0, // max feeder pool tokens
                        sender.signer,
                        sender.address,
                    )
                })
                it("should fail if slippage just too big", async () => {
                    const { bAssets, pool } = details
                    const bAsset = bAssets[0]
                    const sender = sa.default
                    await feederMachine.approveFeeder(bAsset, pool.address, 101, sender.signer)
                    await assertFailedRedeemExact(
                        "Redeem mAsset qty > max quantity",
                        pool,
                        [bAsset.address],
                        ["100000000000000000000"], // 100
                        "100164135324021457059",
                        "100000000000000000001", // just over 100
                        sender.signer,
                        sender.address,
                    )
                })
                it("should fail if sender doesn't have enough balance", async () => {
                    const { bAssets, pool } = details
                    const sender = sa.dummy2
                    expect(await pool.balanceOf(sender.address)).eq(0)
                    await assertFailedRedeemExact(
                        "ERC20: burn amount exceeds balance",
                        pool,
                        bAssets,
                        [simpleToExactAmount(100), simpleToExactAmount(100)],
                        "200080032012805122049",
                        simpleToExactAmount(201),
                        sender.signer,
                        sender.address,
                        true,
                    )
                })
                it("should fail when the asset does not exist", async () => {
                    const { pool } = details
                    const newBasset = await feederMachine.mAssetMachine.loadBassetProxy("Mock", "MKK", 18, sa.default.address, 1000)
                    await assertFailedRedeemExact("Invalid asset", pool, [newBasset], [1])
                })
                context("when feeder pool is paused", () => {
                    before(async () => {
                        const { pool } = details
                        expect(await pool.paused(), "before pause").to.equal(false)
                        await pool.connect(sa.governor.signer).pause()
                        expect(await pool.paused(), "after pause").to.equal(true)
                    })
                    after(async () => {
                        const { pool } = details
                        expect(await pool.paused(), "before unpause").to.equal(true)
                        await pool.connect(sa.governor.signer).unpause()
                        expect(await pool.paused(), "after unpause").to.equal(false)
                    })
                    it("should fail to redeem exact feeder asset", async () => {
                        const { fAsset, pool } = details
                        await assertFailedRedeemExact("Unhealthy", pool, [fAsset], [simpleToExactAmount(1)], "1000408462329643612")
                    })
                    it("should fail to redeem exact mStable asset", async () => {
                        const { mAsset, pool } = details
                        await assertFailedRedeemExact("Unhealthy", pool, [mAsset], [simpleToExactAmount(1)], "1000408462329643612")
                    })
                })
            })
            context("reset before each", () => {
                beforeEach(async () => {
                    await runSetup()
                })
                it("should redeem exact single mStable asset", async () => {
                    const { mAsset } = details
                    await assertRedeemExact(details, [mAsset], [simpleToExactAmount(1)], "1000408462329643612", simpleToExactAmount(11, 17))
                })
                it("should redeem exact a single feeder asset", async () => {
                    const { fAsset } = details
                    await assertRedeemExact(details, [fAsset], [simpleToExactAmount(1)], "1000408462329643612", simpleToExactAmount(11, 17))
                })
                it("should redeem smallest bAsset unit", async () => {
                    const { fAsset } = details
                    await assertFailedRedeemExact("Must redeem > 1e6 units", details.pool, [fAsset], [1])
                })
            })
            context("reset and set redemption to 2 before each", () => {
                beforeEach(async () => {
                    await runSetup(undefined, undefined, undefined,
                        undefined, undefined, true)
                    const {redemptionPriceSnap} = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("2000000000000000000000000000")
                })
                it("should redeem exact two thirds mStable asset", async () => {
                    const { mAsset } = details
                    // TVL has increased so 1 mAsset will cost less than 1 fptoken, expect 1/1.5
                    await assertRedeemExact(details, [mAsset], [simpleToExactAmount(1)], "669427234744509357", simpleToExactAmount(11, 17))
                })
                it("should redeem exact four thirds of feeder asset", async () => {
                    const { fAsset } = details
                    // fAssets have doubled in value and will cost more than 1 fptoken. Expect 1 / 0.75
                    await assertRedeemExact(details, [fAsset], [simpleToExactAmount(1)], "1331397899776025778", simpleToExactAmount(14, 17))
                })
                it("should redeem smallest bAsset unit, quantity independent of redemption price", async () => {
                    const { fAsset } = details
                    await assertFailedRedeemExact("Must redeem > 1e6 units", details.pool, [fAsset], [1])
                })
            })
            context("with a bAsset with 2 dp", () => {
                beforeEach(async () => {
                    await runSetup(false, false, [50, 50], undefined, true)
                })
                it("should redeem 1e16 for 1 base units", async () => {
                    await assertRedeemExact(details, [details.fAsset], [1], "10004004913554892")
                })
                it("should redeem 1e18 for 1e2 base units", async () => {
                    await assertRedeemExact(details, [details.fAsset], [simpleToExactAmount(1, 2)], "1000433623893269258")
                })
            })
            context("when a main pool asset has broken below peg", () => {
                before(async () => {
                    await runSetup()
                    const { mAsset, mAssetDetails } = details
                    await mAsset.connect(sa.governor.signer).handlePegLoss(mAssetDetails.bAssets[0].address, true)
                    const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address)
                    expect(newBasset.personal.status).to.eq(BassetStatus.BrokenBelowPeg)
                })
                after(async () => {
                    const { mAsset, mAssetDetails } = details
                    await mAsset.connect(sa.governor.signer).negateIsolation(mAssetDetails.bAssets[0].address)
                    const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address)
                    expect(newBasset.personal.status).to.eq(BassetStatus.Normal)
                })
                it("should redeem exact a single mStable asset", async () => {
                    const { mAsset } = details
                    await assertRedeemExact(details, [mAsset], [simpleToExactAmount(1)], "1000408462329643612")
                })
                it("should redeem exact a single feeder asset", async () => {
                    const { fAsset } = details
                    await assertRedeemExact(details, [fAsset], [simpleToExactAmount(1)], "1000390954820511967")
                })
                it("should redeem exact mStable and feeder asset", async () => {
                    const { bAssets } = details
                    await assertRedeemExact(details, bAssets, [simpleToExactAmount(1), simpleToExactAmount(1)], "2000796703680600534")
                })
            })
        })
        context("when the basket is 79% mAsset, 21% fAsset", () => {
            beforeEach(async () => {
                await runSetup(false, false, [79, 21])
            })
            it("should fail to multi redeem exact the smallest unit of fAsset", async () => {
                const { fAsset } = details
                await assertFailedRedeemExact("Must redeem > 1e6 units", details.pool, [fAsset], [1])
            })
            it("should multi redeem fAsset to just over min weight of 20%", async () => {
                const { fAsset } = details
                await assertRedeemExact(details, [fAsset], [simpleToExactAmount(1)], "1013010034952099562")
            })
            it("should fail multi redeem fAsset as just under min weight of 20%", async () => {
                const { pool, fAsset } = details
                await assertFailedRedeemExact("Exceeds weight limits", pool, [fAsset], [simpleToExactAmount(3)])
            })
        })
    })
    describe("Proportionately redeeming feeder and mStable assets", () => {
        context("when the basket is balanced", () => {
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should fail if recipient is 0x0", async () => {
                    const { pool } = details
                    await assertFailedRedeemProportionately(
                        "Invalid recipient",
                        pool,
                        simpleToExactAmount(1),
                        [0, 0],
                        sa.default.signer,
                        ZERO_ADDRESS,
                    )
                })
                it("should fail when zero fp token quantity", async () => {
                    const { pool } = details
                    await assertFailedRedeemProportionately("Qty==0", pool, 0)
                })
                it("should fail if slippage too big", async () => {
                    const { bAssets, pool } = details
                    const bAsset = bAssets[0]
                    const sender = sa.default
                    await feederMachine.approveFeeder(bAsset, pool.address, 101, sender.signer)
                    await assertFailedRedeemProportionately("bAsset qty < min qty", pool, simpleToExactAmount(1), [
                        simpleToExactAmount(5, 17),
                        simpleToExactAmount(5, 17),
                    ])
                })
                it("should fail when sender doesn't have enough balance", async () => {
                    const { bAssets, pool } = details
                    const bAsset = bAssets[0]
                    const sender = sa.dummy1
                    expect(await bAsset.balanceOf(sender.address)).eq(0)
                    await assertFailedRedeemProportionately(
                        "ERC20: burn amount exceeds balance",
                        pool,
                        simpleToExactAmount(100),
                        [0, 0],
                        sender.signer,
                        sender.address,
                    )
                })
                context("when feeder pool is paused", () => {
                    before(async () => {
                        const { pool } = details
                        expect(await pool.paused(), "before pause").to.equal(false)
                        await pool.connect(sa.governor.signer).pause()
                        expect(await pool.paused(), "after pause").to.equal(true)
                    })
                    after(async () => {
                        const { pool } = details
                        expect(await pool.paused(), "before unpause").to.equal(true)
                        await pool.connect(sa.governor.signer).unpause()
                        expect(await pool.paused(), "after unpause").to.equal(false)
                    })
                    it("should fail to redeem proportionately", async () => {
                        const { pool } = details
                        await assertFailedRedeemProportionately("Unhealthy", pool, simpleToExactAmount(1))
                    })
                })
            })
            context("reset before each", () => {
                beforeEach(async () => {
                    await runSetup()
                })
                it("should redeem proportionately", async () => {
                    await assertRedeemProportionately(details, simpleToExactAmount(1), ["499799999999999998", "499799999999999998"])
                })
            })
            context("using redemption getter", () => {
                beforeEach(async () => {
                    await runSetup(undefined, undefined, undefined,
                        undefined, undefined, true)
                })
                it("redeem proportionately. RP doubling should have no effect", async () => {
                    const { redemptionPriceSnap } = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("2000000000000000000000000000")
                    await assertRedeemProportionately(details, simpleToExactAmount(1), ["499799999999999998", "499799999999999998"])
                })
                it("redeem proportionately. RP halving should have no effect", async () => {
                    const { redemptionPriceSnap } = details
                    await redemptionPriceSnap.setRedemptionPriceSnap("500000000000000000000000000")
                    await assertRedeemProportionately(details, simpleToExactAmount(1), ["499799999999999998", "499799999999999998"])
                })
            })
            context("when a main pool asset has broken below peg", () => {
                before(async () => {
                    await runSetup()
                })
                before(async () => {
                    const { mAsset, mAssetDetails } = details
                    await mAsset.connect(sa.governor.signer).handlePegLoss(mAssetDetails.bAssets[0].address, true)
                    const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address)
                    expect(newBasset.personal.status).to.eq(BassetStatus.BrokenBelowPeg)
                })
                after(async () => {
                    const { mAsset, mAssetDetails } = details
                    await mAsset.connect(sa.governor.signer).negateIsolation(mAssetDetails.bAssets[0].address)
                    const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address)
                    expect(newBasset.personal.status).to.eq(BassetStatus.Normal)
                })
                it("should redeem proportionately", async () => {
                    await assertRedeemProportionately(details, simpleToExactAmount(1), ["499799999999999998", "499799999999999998"])
                })
            })
        })
    })
})
