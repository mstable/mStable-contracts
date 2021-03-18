/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable no-await-in-loop */

import { expect } from "chai"
import { Signer } from "ethers"
import { ethers } from "hardhat"

import { BN, simpleToExactAmount } from "@utils/math"
import { Account, FeederDetails, FeederMachine, MassetMachine, StandardAccounts } from "@utils/machines"
import { ZERO_ADDRESS } from "@utils/constants"
import { FeederPool, Masset, MockERC20 } from "types/generated"
import { BassetStatus } from "@utils/mstable-objects"

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
    ): Promise<void> => {
        details = await feederMachine.deployFeeder(false, feederWeights, mAssetWeights, useLendingMarkets, useInterestValidator)
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
                `getRedeemOutput call should revert with "${expectedReason}"`,
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
                `redeem exact call should revert with "${expectedReason}"`,
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
            `redeemProportionately tx should revert with "${expectedReason}"`,
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

        const platformInteraction = await feederMachine.getPlatformInteraction(pool, "withdrawal", fpTokenQuantityExact, assetBefore)
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
        expect(redeemEvent).to.exist
        expect(redeemEvent.args.redeemer, "redeemer in Redeemer event").to.eq(sender.address)
        expect(redeemEvent.args.recipient, "recipient in Redeemer event").to.eq(recipient)
        expect(redeemEvent.args.mAssetQuantity, "mAssetQuantity in Redeemer event").to.eq(fpTokenQuantityExact)
        expect(redeemEvent.args.output, "output in Redeemer event").to.eq(outputAsset.address)
        if (outputQuantityExpectedExact.gte(0)) {
            expect(redeemEvent.args.outputQuantity, "outputQuantity in Redeemer event").to.eq(outputQuantityExpectedExact)
        }
        expect(redeemEvent.args.scaledFee, "scaledFee in Redeemer event").to.gt(0)

        // Burn feeder pool token
        await expect(tx, "Transfer event").to.emit(pool, "Transfer").withArgs(sender.address, ZERO_ADDRESS, fpTokenQuantityExact)

        // Transfers from lending platform or feeder pool to recipient
        await expect(tx, "Transfer event")
            .to.emit(outputAsset, "Transfer")
            .withArgs(
                assetBefore.integrator ? assetBefore.integratorAddr : assetBefore.feederPoolOrMassetContract.address,
                recipient,
                outputQuantityExpectedExact,
            )

        // Withdraw from lending platform, feeder pool or main pool
        const integratorBalAfter = await assetBefore.contract.balanceOf(
            assetBefore.integrator ? assetBefore.integratorAddr : assetBefore.feederPoolOrMassetContract.address,
        )
        // TODO Expected "199000412397088284203" to be equal 199000000000000000000
        // ALEX - should be outputQuantityExpectedExact?
        expect(integratorBalAfter, "integrator balance after").eq(integratorBalBefore.sub(outputQuantityExpected))
        if (platformInteraction.expectInteraction) {
            await expect(tx)
                .to.emit(fd.mAssetDetails.platform, "Withdraw")
                .withArgs(outputAsset.address, assetBefore.pToken, platformInteraction.amount)
        }

        // Recipient should have redeemed asset after
        const recipientBalAfter = await outputAsset.balanceOf(recipient)
        expect(recipientBalAfter, "recipient balance after").eq(recipientBalBefore.add(outputQuantityExpectedExact))
        // Sender should have less asset after
        const senderFpTokenBalAfter = await pool.balanceOf(sender.address)
        expect(senderFpTokenBalAfter, "sender balance after").eq(senderFpTokenBalBefore.sub(fpTokenQuantityExact))
        // VaultBalance should update for this asset
        const assetAfter = await feederMachine.getAsset(details, outputAsset.address)
        expect(BN.from(assetAfter.vaultBalance), "vault balance after").eq(
            BN.from(assetBefore.vaultBalance).sub(outputQuantityExpectedExact),
        )

        return {
            outputQuantity: outputQuantityExpectedExact,
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
        expect(redeemEvent).to.exist
        expect(redeemEvent.args.redeemer, "redeemer in RedeemedMulti event").to.eq(sender.address)
        expect(redeemEvent.args.recipient, "recipient in RedeemedMulti event").to.eq(recipient)
        expect(redeemEvent.args.mAssetQuantity, "mAssetQuantity in RedeemedMulti event").to.eq(inputQuantityExpectedExact)
        expect(redeemEvent.args.outputs, "outputs in RedeemedMulti event").to.deep.eq(outputAssetAddresses)
        expect(redeemEvent.args.outputQuantity, "outputQuantity in RedeemedMulti event").to.deep.eq(outputQuantitiesExact)

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
        expect(redeemEvent).to.exist
        expect(redeemEvent.args.redeemer, "redeemer in RedeemedMulti event").to.eq(sender.address)
        expect(redeemEvent.args.recipient, "recipient in RedeemedMulti event").to.eq(recipient)
        expect(redeemEvent.args.mAssetQuantity, "mAssetQuantity in RedeemedMulti event").to.eq(fpTokenQuantityExact)
        expect(redeemEvent.args.outputs, "outputs in RedeemedMulti event").to.deep.eq(outputAssetAddresses)
        expect(redeemEvent.args.outputQuantity, "outputQuantity in RedeemedMulti event").to.deep.eq(outputQuantitiesExpectedExact)
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
                        "999587602911715797",
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
                    await assertFailedRedeem("Output == 0", pool, fAsset, 1, 0, 0)
                })
                it("should fail to redeem if slippage just too big", async () => {
                    const { pool, fAsset } = details
                    await assertFailedRedeem(
                        "bAsset qty < min qty",
                        pool,
                        fAsset,
                        simpleToExactAmount(1),
                        "999587602911715797",
                        "999587602911715798", // just over the expected output
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
                        "99775801309797227274",
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
                        "99775801309797227274",
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
                        "99775801309797227274",
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
                        expect(await pool.paused(), "before pause").to.be.false
                        await pool.connect(sa.governor.signer).pause()
                        expect(await pool.paused(), "after pause").to.be.true
                    })
                    after(async () => {
                        const { pool } = details
                        expect(await pool.paused(), "before unpause").to.be.true
                        await pool.connect(sa.governor.signer).unpause()
                        expect(await pool.paused(), "after unpause").to.be.false
                    })
                    it("should fail to redeem feeder asset", async () => {
                        const { fAsset, pool } = details
                        await assertFailedRedeem("Unhealthy", pool, fAsset, simpleToExactAmount(1), "999587602911715797")
                    })
                    it("should fail to redeem mStable asset", async () => {
                        const { mAsset, pool } = details
                        await assertFailedRedeem("Unhealthy", pool, mAsset, simpleToExactAmount(1), "999587602911715797")
                    })
                    it("should fail to redeem a main pool assets", async () => {
                        const { bAssets, pool } = details
                        await assertFailedRedeem("Unhealthy", pool, bAssets[0], simpleToExactAmount(1), "999587602911715797", 0)
                    })
                })
            })
            context("reset before each", () => {
                beforeEach(async () => {
                    await runSetup()
                })
                it("should redeem a single mStable asset", async () => {
                    const { mAsset } = details
                    await assertBasicRedeem(details, mAsset, simpleToExactAmount(1), "999587602911715797", "999587602911715797")
                })
                it("should redeem a single feeder asset", async () => {
                    const { fAsset } = details
                    await assertBasicRedeem(details, fAsset, simpleToExactAmount(1), "999587602911715797", "999587602911715797")
                })
                it("should redeem a single main pool asset", async () => {
                    const { mAssetDetails } = details
                    await assertBasicRedeem(
                        details,
                        mAssetDetails.bAssets[0],
                        simpleToExactAmount(1),
                        "998986367865085229",
                        "998986367865085229",
                    )
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
                        "998986367865085229",
                    )
                })
                it("should redeem a single mStable asset", async () => {
                    const { mAsset } = details
                    await assertBasicRedeem(details, mAsset, simpleToExactAmount(1), "999587602911715797")
                })
                it("should redeem a single feeder asset", async () => {
                    const { fAsset } = details
                    await assertBasicRedeem(details, fAsset, simpleToExactAmount(1), "999613298982922415")
                })
            })
        })
        context("when the basket is 95% mAsset, 5% fAsset", () => {
            beforeEach(async () => {
                await runSetup(false, false, [950, 50])
            })
            it("should fail redeem as zero output", async () => {
                const { fAsset, pool } = details
                await assertFailedRedeem("Output == 0", pool, fAsset, 1, 0)
            })
            it("should redeem fAsset to just over min weight of 3%", async () => {
                const { mAsset } = details
                await assertBasicRedeem(details, mAsset, simpleToExactAmount(20), "20854727086699605851")
            })
            it("should fail redeem fAsset as just under min weight of 3%", async () => {
                const { pool, fAsset } = details
                await assertFailedRedeem("Exceeds weight limits", pool, fAsset, simpleToExactAmount(35))
            })
        })
    })
    describe("redeem exact amount of assets", () => {
        context("when the weights are within the ForgeValidator limit", () => {
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
                        await assertFailedRedeemExact("Must redeem some mAssets", pool, bAssets, [0, 0], 0)
                    })
                    it("should fail to redeem exact feeder asset", async () => {
                        const { fAsset, pool } = details
                        await assertFailedRedeemExact("Must redeem some mAssets", pool, [fAsset], [0], 0)
                    })
                    it("should fail to redeem exact mStable asset", async () => {
                        const { mAsset, pool } = details
                        await assertFailedRedeemExact("Must redeem some mAssets", pool, [mAsset], [0], 0)
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
                        "100225391632663607816",
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
                        "100225391632663607816",
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
                        expect(await pool.paused(), "before pause").to.be.false
                        await pool.connect(sa.governor.signer).pause()
                        expect(await pool.paused(), "after pause").to.be.true
                    })
                    after(async () => {
                        const { pool } = details
                        expect(await pool.paused(), "before unpause").to.be.true
                        await pool.connect(sa.governor.signer).unpause()
                        expect(await pool.paused(), "after unpause").to.be.false
                    })
                    it("should fail to redeem exact feeder asset", async () => {
                        const { fAsset, pool } = details
                        await assertFailedRedeemExact("Unhealthy", pool, [fAsset], [simpleToExactAmount(1)], "1000412572361491063")
                    })
                    it("should fail to redeem exact mStable asset", async () => {
                        const { mAsset, pool } = details
                        await assertFailedRedeemExact("Unhealthy", pool, [mAsset], [simpleToExactAmount(1)], "1000412572361491063")
                    })
                })
            })
            context("reset before each", () => {
                beforeEach(async () => {
                    await runSetup()
                })
                it("should redeem exact single mStable asset", async () => {
                    const { mAsset } = details
                    await assertRedeemExact(details, [mAsset], [simpleToExactAmount(1)], "1000412572361491063", simpleToExactAmount(11, 17))
                })
                it("should redeem exact a single feeder asset", async () => {
                    const { fAsset } = details
                    await assertRedeemExact(details, [fAsset], [simpleToExactAmount(1)], "1000412572361491063", simpleToExactAmount(11, 17))
                })
                it("should redeem smallest bAsset unit", async () => {
                    const { fAsset } = details
                    await assertRedeemExact(details, [fAsset], [1], 2, 2)
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
                    await assertRedeemExact(details, [mAsset], [simpleToExactAmount(1)], "1000412572361491063")
                })
                it("should redeem exact a single feeder asset", async () => {
                    const { fAsset } = details
                    await assertRedeemExact(details, [fAsset], [simpleToExactAmount(1)], "1000386844788655296")
                })
                it("should redeem exact mStable and feeder asset", async () => {
                    const { bAssets } = details
                    await assertRedeemExact(details, bAssets, [simpleToExactAmount(1), simpleToExactAmount(1)], "2000796703680600580")
                })
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
                        expect(await pool.paused(), "before pause").to.be.false
                        await pool.connect(sa.governor.signer).pause()
                        expect(await pool.paused(), "after pause").to.be.true
                    })
                    after(async () => {
                        const { pool } = details
                        expect(await pool.paused(), "before unpause").to.be.true
                        await pool.connect(sa.governor.signer).unpause()
                        expect(await pool.paused(), "after unpause").to.be.false
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
                    await assertRedeemProportionately(details, simpleToExactAmount(1), ["499799999999999999", "499799999999999999"])
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
                    await assertRedeemProportionately(details, simpleToExactAmount(1), ["499799999999999999", "499799999999999999"])
                })
            })
        })
    })
})
