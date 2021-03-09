import { expect } from "chai"
import { ethers } from "hardhat"
import { Signer } from "ethers"

import { simpleToExactAmount, BN, applyRatio } from "@utils/math"
import { MassetDetails, MassetMachine, StandardAccounts, Account } from "@utils/machines"
import { MockERC20, Masset } from "types/generated"
import { fullScale, ZERO_ADDRESS } from "@utils/constants"
import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions"
import { BassetStatus } from "@utils/mstable-objects"

describe("Masset - Redeem", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let details: MassetDetails

    /**
     * @dev (Re)Sets the local variables for this test file
     * @param seedBasket mints 25 tokens for each bAsset
     * @param useTransferFees enables transfer fees on bAssets [2,3]
     */
    const runSetup = async (
        seedBasket = true,
        useTransferFees = false,
        useLendingMarkets = false,
        useMockValidator = true,
        weights: number[] = [25, 25, 25, 25],
    ): Promise<void> => {
        details = await mAssetMachine.deployMasset(useMockValidator, useLendingMarkets, useTransferFees)
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

    const assertFailedBasicRedemption = async (
        expectedReason: string,
        mAssetContract: Masset,
        bAsset: MockERC20 | string,
        mAssetRedeemQuantity: BN | number | string,
        minBassetOutput: BN | number | string = BN.from(0),
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        quantitiesAreExact = false,
        redeemOutputRevertExpected = true,
        expectedBassetQuantity: BN | number | string = BN.from(0),
    ): Promise<void> => {
        const mAsset = mAssetContract.connect(sender)
        const bAssetAddress = typeof bAsset === "string" ? bAsset : bAsset.address
        const bAssetDecimals = typeof bAsset === "string" ? 18 : await bAsset.decimals()
        const mAssetRedeemQuantityExact = quantitiesAreExact ? BN.from(mAssetRedeemQuantity) : simpleToExactAmount(mAssetRedeemQuantity, 18)
        const minBassetOutputExact = quantitiesAreExact ? BN.from(minBassetOutput) : simpleToExactAmount(minBassetOutput, bAssetDecimals)
        const expectedBassetQuantityExact = quantitiesAreExact
            ? BN.from(expectedBassetQuantity)
            : simpleToExactAmount(expectedBassetQuantity, bAssetDecimals)
        await expect(
            mAsset.redeem(bAssetAddress, mAssetRedeemQuantityExact, minBassetOutputExact, recipient),
            `redeem tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)

        if (redeemOutputRevertExpected) {
            await expect(
                mAsset.getRedeemOutput(bAssetAddress, mAssetRedeemQuantityExact),
                `getRedeemOutput call should revert with "${expectedReason}"`,
            ).to.be.revertedWith(expectedReason)
        } else {
            const redeemedBassetQuantity = await mAsset.getRedeemOutput(bAssetAddress, mAssetRedeemQuantityExact)
            expect(redeemedBassetQuantity, "getRedeemOutput call output").eq(expectedBassetQuantityExact)
        }
    }
    const assertFailedMassetRedemption = async (
        expectedReason: string,
        mAssetContract: Masset,
        mAssetQuantity: BN | number | string,
        minBassetQuantitiesNet: (BN | number | string)[] = [0, 0, 0, 0],
        bAssets: MockERC20[],
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        quantitiesAreExact = false,
    ): Promise<void> => {
        const mAsset = mAssetContract.connect(sender)
        const bAssetsDecimals = await Promise.all(bAssets.map((bAsset) => bAsset.decimals()))
        const mAssetQuantityExact = quantitiesAreExact ? BN.from(mAssetQuantity) : simpleToExactAmount(mAssetQuantity, 18)
        const minBassetQuantitiesExact = quantitiesAreExact
            ? minBassetQuantitiesNet.map((q) => BN.from(q))
            : minBassetQuantitiesNet.map((q, i) => simpleToExactAmount(q, bAssetsDecimals[i]))
        await expect(
            mAsset.redeemMasset(mAssetQuantityExact, minBassetQuantitiesExact, recipient),
            `redeem tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)
    }
    const assertFailedExactBassetsRedemption = async (
        expectedReason: string,
        mAssetContract: Masset,
        bAssets: (MockERC20 | string)[],
        bAssetRedeemQuantities: (BN | number | string)[],
        maxMassetBurntQuantity: BN | number | string = 100,
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        quantitiesAreExact = false,
        redeemOutputRevertExpected = true,
        expectedMassetQuantityExact: BN | number | string = BN.from(1),
    ): Promise<void> => {
        const mAsset = mAssetContract.connect(sender)
        const bAssetAddresses = bAssets.map((bAsset) => (typeof bAsset === "string" ? bAsset : bAsset.address))
        const bAssetsDecimals = await Promise.all(
            bAssets.map((bAsset) => (typeof bAsset === "string" ? Promise.resolve(18) : bAsset.decimals())),
        )
        // Convert to exact quantities
        const bAssetRedeemQuantitiesExact = quantitiesAreExact
            ? bAssetRedeemQuantities.map((q) => BN.from(q))
            : bAssetRedeemQuantities.map((q, i) => simpleToExactAmount(q, bAssetsDecimals[i]))
        const maxMassetBurntQuantityExact = quantitiesAreExact
            ? BN.from(maxMassetBurntQuantity)
            : simpleToExactAmount(maxMassetBurntQuantity, 18)

        await expect(
            mAsset.redeemExactBassets(bAssetAddresses, bAssetRedeemQuantitiesExact, maxMassetBurntQuantityExact, recipient),
            `redeem tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)

        if (redeemOutputRevertExpected) {
            await expect(
                mAsset.getRedeemExactBassetsOutput(bAssetAddresses, bAssetRedeemQuantitiesExact),
                `getRedeemExactBassetsOutput call should revert with "${expectedReason}"`,
            ).to.be.revertedWith(expectedReason)
        } else {
            const redeemedMassetQuantity = await mAsset.getRedeemExactBassetsOutput(bAssetAddresses, bAssetRedeemQuantitiesExact)
            expect(redeemedMassetQuantity, "getRedeemExactBassetsOutput call output").eq(expectedMassetQuantityExact)
        }
    }

    // Helper to assert basic redemption conditions, e.g. balance before and after
    // redeem takes mAsset input and returns bAsset amount
    const assertBasicRedemption = async (
        md: MassetDetails,
        bAsset: MockERC20,
        mAssetBurnQuantity: BN | number | string,
        minBassetOutput: BN | number | string = 0,
        expectFee = true,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        ignoreHealthAssertions = false,
        quantitiesAreExact = false,
        hasTransferFee = false,
    ): Promise<BN> => {
        const { platform } = md
        const mAsset = md.mAsset.connect(sender.signer)
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

        // Get balances before
        const senderMassetBalBefore = await mAsset.balanceOf(sender.address)
        const mAssetSupplyBefore = await mAsset.totalSupply()
        const recipientBassetBalBefore = await bAsset.balanceOf(recipient)
        const bAssetBefore = await mAssetMachine.getBasset(details, bAsset.address)
        const bAssetDecimals = await bAsset.decimals()
        const mAssetQuantityExact = quantitiesAreExact ? BN.from(mAssetBurnQuantity) : simpleToExactAmount(mAssetBurnQuantity, 18)
        const minBassetOutputExact = quantitiesAreExact ? BN.from(minBassetOutput) : simpleToExactAmount(minBassetOutput, bAssetDecimals)
        const surplusBefore = await mAsset.surplus()

        let scaledFee = BN.from(0)
        let feeRate = BN.from(0)
        //    If there is a fee expected, then deduct it from output
        if (expectFee) {
            feeRate = await mAsset.swapFee()
            expect(feeRate, "fee rate > 0").gt(0)
            expect(feeRate, "fee rate < fullScale / 50").lt(fullScale.div(50))
            scaledFee = mAssetQuantityExact.mul(feeRate).div(fullScale)
        }

        const bAssetQuantityExact = await mAsset.getRedeemOutput(bAsset.address, mAssetQuantityExact)

        const platformInteraction = await mAssetMachine.getPlatformInteraction(mAsset, "withdrawal", bAssetQuantityExact, bAssetBefore)

        // Execute the redemption
        const tx = mAsset.redeem(bAsset.address, mAssetQuantityExact, minBassetOutputExact, recipient)
        const integratorBalBefore = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator ? bAssetBefore.integratorAddr : mAsset.address,
        )

        // Check the emitted events
        await expect(tx)
            .to.emit(mAsset, "Redeemed")
            .withArgs(sender.address, recipient, mAssetQuantityExact, bAsset.address, bAssetQuantityExact, scaledFee)
        // - Withdraws from lending platform or mAsset
        if (platformInteraction.expectInteraction) {
            await expect(tx, "PlatformWithdrawal event").to.emit(platform, "PlatformWithdrawal")
            // .withArgs(bAsset.address, bAssetBefore.pToken, platformInteraction.amount, bAssetQuantityExact)
        } else if (platformInteraction.hasLendingMarket) {
            await expect(tx, "Withdrawal event").to.emit(platform, "Withdrawal").withArgs(bAsset.address, bAssetQuantityExact)
        }
        // Transfer events
        await expect(tx, "Transfer event to burn the redeemed mAssets")
            .to.emit(mAsset, "Transfer")
            .withArgs(sender.address, ZERO_ADDRESS, mAssetQuantityExact)
        if (!hasTransferFee) {
            await expect(tx, "Transfer event for bAsset from platform integration or mAsset to recipient")
                .to.emit(bAsset, "Transfer")
                .withArgs(bAssetBefore.integrator ? bAssetBefore.integratorAddr : mAsset.address, recipient, bAssetQuantityExact)
        }
        await tx

        // VaultBalance should line up
        const integratorBalAfter = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator ? bAssetBefore.integratorAddr : mAsset.address,
        )
        // Calculate after balance
        // expect(integratorBalAfter, "integratorBalAfter").eq(integratorBalBefore.sub(bAssetQuantityExact))
        // Sender should have less mAsset
        const senderMassetBalAfter = await mAsset.balanceOf(sender.address)
        expect(senderMassetBalAfter, "senderMassetBalAfter").eq(senderMassetBalBefore.sub(mAssetQuantityExact))
        // Total mAsset supply should be less
        const mAssetSupplyAfter = await mAsset.totalSupply()
        expect(mAssetSupplyAfter, "mAssetSupplyAfter").eq(mAssetSupplyBefore.sub(mAssetQuantityExact))
        // Recipient should have more bAsset, minus fee

        if (!hasTransferFee) {
            const recipientBassetBalAfter = await bAsset.balanceOf(recipient)
            expect(recipientBassetBalAfter, "recipientBassetBalAfter").eq(recipientBassetBalBefore.add(bAssetQuantityExact))
        }
        // VaultBalance should update for this bAsset, including fee
        const bAssetAfter = await mAssetMachine.getBasset(details, bAsset.address)
        expect(BN.from(bAssetAfter.vaultBalance), "bAssetAfter.vaultBalance").eq(
            BN.from(bAssetBefore.vaultBalance).sub(bAssetQuantityExact),
        )
        const surplusAfter = await mAsset.surplus()
        expect(surplusAfter, "surplusAfter").eq(surplusBefore.add(scaledFee))

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

        return bAssetQuantityExact
    }

    const assertExactBassetsRedemption = async (
        md: MassetDetails,
        bAssets: MockERC20[],
        bAssetRedeemQuantities: (BN | number | string)[],
        maxMassetBurntQuantity: BN | number | string = 0,
        expectFee = true,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        ignoreHealthAssertions = false,
        quantitiesAreExact = false,
    ): Promise<BN> => {
        const { mAsset } = md
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

        // Get bAsset details
        const bAssetsBefore = await mAssetMachine.getBassetsInMasset(details)
        const bAssetAddresses = bAssets.map((b) => b.address)
        const bAssetsDecimals = await Promise.all(bAssets.map((b) => b.decimals()))

        // Convert to exact quantities
        const bAssetRedeemQuantitiesExact = quantitiesAreExact
            ? bAssetRedeemQuantities.map((q) => BN.from(q))
            : bAssetRedeemQuantities.map((q, i) => simpleToExactAmount(q, bAssetsDecimals[i]))
        const maxMassetBurntQuantityExact = quantitiesAreExact
            ? BN.from(maxMassetBurntQuantity)
            : simpleToExactAmount(maxMassetBurntQuantity, 18)

        // Get balances before
        const senderMassetBalBefore = await mAsset.balanceOf(sender.address)
        const mAssetSupplyBefore = await mAsset.totalSupply()
        const recipientBassetBalsBefore: BN[] = await Promise.all(bAssets.map((b) => b.balanceOf(recipient)))
        const surplusBefore = await mAsset.surplus()

        // Convert mBasset quantities to mAsset quantity
        const mAssetsBurnt = bAssetRedeemQuantitiesExact.reduce((acc, bAssetRedeemQuantityExact, i) => {
            const mAssetQuantity = applyRatio(bAssetRedeemQuantityExact, bAssetsBefore[i].ratio)
            return acc.add(mAssetQuantity)
        }, BN.from(0))

        // Calculate redemption fee
        let scaledFee = BN.from(0)
        let feeRate = BN.from(0)
        //    If there is a fee expected, then deduct it from output
        if (expectFee) {
            feeRate = await mAsset.swapFee()
            expect(feeRate, "fee rate > 0").gt(BN.from(0))
            expect(feeRate, "fee rate < fullScale / 50").lt(fullScale.div(BN.from(50)))
            // fee = mAsset qty * feeRate / (1 - feeRate)
            scaledFee = mAssetsBurnt.mul(feeRate).div(fullScale.sub(feeRate))
            expect(scaledFee, "scaled fee > 0").gt(BN.from(0))
        }

        const mAssetQuantityExact = await mAsset.getRedeemExactBassetsOutput(bAssetAddresses, bAssetRedeemQuantitiesExact)
        expect(mAssetQuantityExact, "mAssetQuantityExact").to.eq(mAssetsBurnt.add(scaledFee).add(1))

        // Execute the redemption
        const tx = mAsset.redeemExactBassets(bAssetAddresses, bAssetRedeemQuantitiesExact, maxMassetBurntQuantityExact, recipient)

        // Check the emitted events
        await expect(tx)
            .to.emit(mAsset, "RedeemedMulti")
            .withArgs(
                sender.address,
                recipient,
                mAssetsBurnt.add(scaledFee).add(1),
                bAssetAddresses,
                bAssetRedeemQuantitiesExact,
                scaledFee,
            )
        // Transfer events
        await expect(tx, "Transfer event to burn the redeemed mAssets")
            .to.emit(mAsset, "Transfer")
            .withArgs(sender.address, ZERO_ADDRESS, mAssetQuantityExact)
        // Check all the bAsset transfers
        await Promise.all(
            bAssets.map((bAsset, i) => {
                if (bAssetRedeemQuantitiesExact[i].gt(0)) {
                    return expect(tx, `Transfer event for bAsset[${i}] from platform integration or mAsset to recipient`)
                        .to.emit(bAsset, "Transfer")
                        .withArgs(
                            bAssetsBefore[i].integrator ? bAssetsBefore[i].integratorAddr : mAsset.address,
                            recipient,
                            bAssetRedeemQuantitiesExact[i],
                        )
                }
                return Promise.resolve()
            }),
        )
        await tx

        // Sender should have less mAsset
        const senderMassetBalAfter = await mAsset.balanceOf(sender.address)
        expect(senderMassetBalAfter, "senderMassetBalAfter").eq(senderMassetBalBefore.sub(mAssetQuantityExact))
        // Total mAsset supply should be less
        const mAssetSupplyAfter = await mAsset.totalSupply()
        expect(mAssetSupplyAfter, "mAssetSupplyAfter").eq(mAssetSupplyBefore.sub(mAssetQuantityExact))
        // Recipient should have more bAsset, minus fee
        const recipientBassetBalsAfter = await Promise.all(bAssets.map((b) => b.balanceOf(recipient)))
        recipientBassetBalsAfter.forEach((recipientBassetBalAfter, i) => {
            expect(recipientBassetBalAfter, `recipientBassetBalAfter[${i}]`).eq(
                recipientBassetBalsBefore[i].add(bAssetRedeemQuantitiesExact[i]),
            )
        })

        // VaultBalance should update for this bAsset, including fee
        const bAssetsAfter = await mAssetMachine.getBassetsInMasset(details)
        bAssetsAfter.forEach((bAssetAfter, i) => {
            expect(BN.from(bAssetAfter.vaultBalance), `bAssetAfter[${i}].vaultBalance`).eq(
                BN.from(bAssetsBefore[i].vaultBalance).sub(bAssetRedeemQuantitiesExact[i]),
            )
        })
        const surplusAfter = await mAsset.surplus()
        expect(surplusAfter, "surplusAfter").eq(surplusBefore.add(scaledFee))

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

        return mAssetQuantityExact
    }

    const assertMassetRedemption = async (
        md: MassetDetails,
        mAssetQuantityGross: BN | number | string,
        minBassetQuantitiesNet: (BN | number | string)[] = [0, 0, 0, 0],
        expectFee = true,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        ignoreHealthAssertions = false,
        quantitiesAreExact = false,
    ): Promise<BN> => {
        const { mAsset, bAssets } = md
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

        // Get bAsset details
        const bAssetsBefore = await mAssetMachine.getBassetsInMasset(details)
        const bAssetAddresses = bAssets.map((b) => b.address)
        const bAssetsDecimals = await Promise.all(bAssets.map((b) => b.decimals()))

        // Convert to exact quantities
        const mAssetQuantityExact = quantitiesAreExact ? BN.from(mAssetQuantityGross) : simpleToExactAmount(mAssetQuantityGross, 18)
        const minBassetQuantitiesExact = quantitiesAreExact
            ? minBassetQuantitiesNet.map((q) => BN.from(q))
            : minBassetQuantitiesNet.map((q, i) => simpleToExactAmount(q, bAssetsDecimals[i]))

        // Get balances before
        const senderMassetBalBefore = await mAsset.balanceOf(sender.address)
        const mAssetSupplyBefore = await mAsset.totalSupply()
        const recipientBassetBalsBefore: BN[] = await Promise.all(bAssets.map((b) => b.balanceOf(recipient)))
        const surplusBefore = await mAsset.surplus()

        // Calculate redemption fee
        let scaledFee = BN.from(0)
        let feeRate = BN.from(0)
        //    If there is a fee expected, then deduct it from output
        if (expectFee) {
            feeRate = await mAsset.redemptionFee()
            expect(feeRate, "fee rate > 0").gt(BN.from(0))
            expect(feeRate, "fee rate < fullScale / 50").lt(fullScale.div(BN.from(50)))
            // fee = mAsset qty * fee rate
            scaledFee = mAssetQuantityExact.mul(feeRate).div(fullScale)
            expect(scaledFee, "scaled fee > 0").gt(BN.from(0))
        }

        // Execute the redemption
        const tx = mAsset.redeemMasset(mAssetQuantityExact, minBassetQuantitiesExact, recipient)

        // (mAsset qty / 4) * (1 - redemption fee)
        const mAssetRedemptionAmountNet = mAssetQuantityExact.sub(mAssetQuantityExact.mul(feeRate).div(fullScale))
        const bAssetRedeemQuantitiesExact = bAssets.map((b, i) => {
            // netBassetRedemptionAmount = bAsset vault balance * mAsset quantity to be burnt / (total mAsset mAsset + surplus)
            const netBassetRedemptionAmount = BN.from(bAssetsBefore[i].vaultBalance)
                .mul(mAssetRedemptionAmountNet)
                .div(mAssetSupplyBefore.add(surplusBefore))
            return netBassetRedemptionAmount.eq(0) ? netBassetRedemptionAmount : netBassetRedemptionAmount.sub(1)
        })
        // Check the emitted events
        await expect(tx)
            .to.emit(mAsset, "RedeemedMulti")
            .withArgs(sender.address, recipient, mAssetQuantityExact, bAssetAddresses, bAssetRedeemQuantitiesExact, scaledFee)
        // Transfer events
        await expect(tx, "Transfer event to burn the redeemed mAssets")
            .to.emit(mAsset, "Transfer")
            .withArgs(sender.address, ZERO_ADDRESS, mAssetQuantityExact)
        // Check all the bAsset transfers
        await Promise.all(
            bAssets.map((bAsset, i) => {
                if (bAssetRedeemQuantitiesExact[i].gt(0)) {
                    return expect(tx, `Transfer event for bAsset[${i}] from platform integration or mAsset to recipient`)
                        .to.emit(bAsset, "Transfer")
                        .withArgs(
                            bAssetsBefore[i].integrator ? bAssetsBefore[i].integratorAddr : mAsset.address,
                            recipient,
                            bAssetRedeemQuantitiesExact[i],
                        )
                }
                return Promise.resolve()
            }),
        )
        await tx

        // Sender should have less mAsset
        const senderMassetBalAfter = await mAsset.balanceOf(sender.address)
        expect(senderMassetBalAfter, "senderMassetBalAfter").eq(senderMassetBalBefore.sub(mAssetQuantityExact))
        // Total mAsset supply should be less
        const mAssetSupplyAfter = await mAsset.totalSupply()
        expect(mAssetSupplyAfter, "mAssetSupplyAfter").eq(mAssetSupplyBefore.sub(mAssetQuantityExact))
        // Recipient should have more bAsset, minus fee
        const recipientBassetBalsAfter = await Promise.all(bAssets.map((b) => b.balanceOf(recipient)))
        recipientBassetBalsAfter.forEach((recipientBassetBalAfter, i) => {
            expect(recipientBassetBalAfter, `recipientBassetBalAfter[${i}]`).eq(
                recipientBassetBalsBefore[i].add(bAssetRedeemQuantitiesExact[i]),
            )
        })

        // VaultBalance should update for this bAsset, including fee
        const bAssetsAfter = await mAssetMachine.getBassetsInMasset(details)
        bAssetsAfter.forEach((bAssetAfter, i) => {
            expect(BN.from(bAssetAfter.vaultBalance), `bAssetAfter[${i}].vaultBalance`).eq(
                BN.from(bAssetsBefore[i].vaultBalance).sub(bAssetRedeemQuantitiesExact[i]),
            )
        })
        const surplusAfter = await mAsset.surplus()
        expect(surplusAfter, "surplusAfter").eq(surplusBefore.add(scaledFee))

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

        return mAssetQuantityExact
    }

    describe("redeeming with a single bAsset", () => {
        context("when the weights are within the validator limit", () => {
            context("and no lending market integration", async () => {
                before(async () => {
                    await runSetup(true, false, false)
                })
                it("should redeem 1 bAsset[0] to a contract", async () => {
                    const { bAssets } = details
                    const recipient = details.forgeValidator.address
                    await assertBasicRedemption(details, bAssets[0], 1, 0.9, true, recipient)
                })
                it("should redeem 1 bAsset[1]", async () => {
                    const { bAssets } = details
                    const recipient = sa.dummy1
                    await assertBasicRedemption(details, bAssets[1], 1, 0.9, true, recipient.address)
                })
                it("should redeem 12 bAsset[1]", async () => {
                    const { bAssets } = details
                    const recipient = sa.dummy1
                    await assertBasicRedemption(details, bAssets[1], 12, 9, true, recipient.address)
                })
                it("should redeem smallest number of bAsset[0] with 18 decimals", async () => {
                    const { bAssets } = details
                    expect(await bAssets[0].decimals()).eq(18)
                    await assertBasicRedemption(details, bAssets[0], 2, 1, true, undefined, undefined, undefined, true)
                })
                it("should redeem smallest number of bAsset[2] with 12 decimals", async () => {
                    const { bAssets } = details
                    expect(await bAssets[2].decimals()).eq(12)
                    await assertFailedBasicRedemption(
                        "Output == 0",
                        details.mAsset,
                        bAssets[2],
                        1,
                        0,
                        sa.default.signer,
                        sa.default.address,
                        true,
                        false,
                        0,
                    )
                })
            })
            context("and lending market integration", async () => {
                before(async () => {
                    await runSetup(true, false, true)
                })
                it("should redeem 1 bAsset[0] to a contract", async () => {
                    const { bAssets } = details
                    const recipient = details.forgeValidator.address
                    await assertBasicRedemption(details, bAssets[0], 1, 0.9, true, recipient)
                })
                it("should send 1 bAsset[1] to EOA", async () => {
                    const { bAssets } = details
                    const recipient = sa.dummy1
                    await assertBasicRedemption(details, bAssets[1], 1, 0.9, true, recipient.address)
                })
                it("should send 12 bAsset[1] to EOA", async () => {
                    const { bAssets } = details
                    const recipient = sa.dummy1
                    await assertBasicRedemption(details, bAssets[1], 12, 9, true, recipient.address)
                })
                it("should send 16 bAsset[0] to EOA", async () => {
                    const { bAssets } = details
                    const recipient = sa.dummy1
                    await assertBasicRedemption(details, bAssets[0], 16, 9, true, recipient.address)
                })
            })
            context("and the feeRate changes", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should deduct the suitable fee", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    const bAssetBefore = await mAsset.getBasset(bAsset.address)
                    // Set a new fee recipient
                    const newSwapFee = simpleToExactAmount("8.1", 15)
                    const newRedemptionFee = simpleToExactAmount("5.234234", 15)
                    await mAsset.connect(sa.governor.signer).setFees(newSwapFee, newRedemptionFee)
                    // Calc mAsset burn amounts based on bAsset quantities
                    const bAssetQuantity = simpleToExactAmount(BN.from(1), await bAsset.decimals())
                    const mAssetQuantity = applyRatio(bAssetQuantity, bAssetBefore.data.ratio)
                    const bAssetFee = bAssetQuantity.mul(newSwapFee).div(fullScale)
                    const massetBalBefore = await mAsset.balanceOf(sa.default.address)
                    const bassetBalBefore = await bAsset.balanceOf(sa.default.address)
                    // Run the redemption
                    await assertBasicRedemption(details, bAsset, BN.from(1), BN.from(0))
                    const massetBalAfter = await mAsset.balanceOf(sa.default.address)
                    const bassetBalAfter = await bAsset.balanceOf(sa.default.address)
                    // Assert balance increase
                    expect(massetBalAfter).eq(massetBalBefore.sub(mAssetQuantity))
                    expect(bassetBalAfter).eq(bassetBalBefore.add(bAssetQuantity).sub(bAssetFee))
                })
                it("should deduct nothing if the fee is 0", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    const bAssetBefore = await mAsset.getBasset(bAsset.address)
                    // Set a new fee recipient
                    const newFee = BN.from(0)
                    await mAsset.connect(sa.governor.signer).setFees(newFee, newFee)
                    // Calc mAsset burn amounts based on bAsset quantities
                    const bAssetQuantity = simpleToExactAmount(BN.from(1), await bAsset.decimals())
                    const mAssetQuantity = applyRatio(bAssetQuantity, bAssetBefore.data.ratio)
                    const massetBalBefore = await mAsset.balanceOf(sa.default.address)
                    const bassetBalBefore = await bAsset.balanceOf(sa.default.address)
                    // Run the redemption
                    await assertBasicRedemption(details, bAsset, BN.from(1), BN.from(0), false)
                    const massetBalAfter = await mAsset.balanceOf(sa.default.address)
                    const bassetBalAfter = await bAsset.balanceOf(sa.default.address)
                    // Assert balance increase
                    expect(massetBalAfter).eq(massetBalBefore.sub(mAssetQuantity))
                    expect(bassetBalAfter).eq(bassetBalBefore.add(bAssetQuantity))
                })
            })
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should revert when bAsset is 0x0", async () => {
                    const { mAsset } = details
                    await assertFailedBasicRedemption("Invalid asset", mAsset, ZERO_ADDRESS, 1)
                })
                it("should fail if the bAsset does not exist", async () => {
                    const { mAsset } = details
                    const invalidBasset = await mAssetMachine.loadBassetProxy("Wrapped ETH", "WETH", 18)
                    await assertFailedBasicRedemption("Invalid asset", mAsset, invalidBasset, 1)
                })
                it("should revert when 0 quantity", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedBasicRedemption("Qty==0", mAsset, bAssets[0], 0)
                })
                it("should revert when quantity < min quantity", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedBasicRedemption(
                        "bAsset qty < min qty",
                        mAsset,
                        bAssets[0],
                        "10000000000000000000",
                        "9995000000000000000",
                        undefined,
                        undefined,
                        true,
                        false,
                        // Assuming 0.06% swap fee = 6 bps
                        // 10 * (1 - 0.06 / 100) = 9.994
                        "9994000000000000000",
                    )
                })
                it("should fail if recipient is 0x0", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedBasicRedemption(
                        "Invalid recipient",
                        mAsset,
                        bAssets[0],
                        "10000000000000000000",
                        "9994000000000000000",
                        undefined,
                        ZERO_ADDRESS,
                        true,
                        false,
                        // Assuming 0.06% swap fee = 6 bps
                        // 10 * (1 - 0.06 / 100) = 9.994
                        "9994000000000000000",
                    )
                })
                it("should fail if sender doesn't have mAsset balance", async () => {
                    const { bAssets, mAsset } = details
                    const sender = sa.dummy1
                    expect(await mAsset.balanceOf(sender.address)).eq(0)
                    await assertFailedBasicRedemption(
                        "ERC20: burn amount exceeds balance",
                        mAsset,
                        bAssets[0],
                        "10000000000000000000",
                        "9900000000000000000",
                        sender.signer,
                        undefined,
                        false,
                        false,
                        "9994000000000000000",
                    )
                })
            })
            context("with an affected bAsset", async () => {
                beforeEach(async () => {
                    await runSetup()
                })
                it("should fail if bAsset is broken above peg", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    await mAsset.connect(sa.governor.signer).handlePegLoss(bAsset.address, false)
                    const newBasset = await mAsset.getBasset(bAsset.address)
                    expect(newBasset.personal.status, "bAsset broken above peg").to.eq(BassetStatus.BrokenAbovePeg)
                    await assertFailedBasicRedemption(
                        "In recol",
                        mAsset,
                        bAsset,
                        1,
                        0,
                        sa.default.signer,
                        sa.default.address,
                        false,
                        false,
                        0.9994,
                    )
                })
                it("should fail if bAsset in basket is broken below peg", async () => {
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)
                    const bAsset = bAssets[1]
                    await mAsset.connect(sa.governor.signer).handlePegLoss(bAsset.address, true)
                    const newBasset = await mAsset.getBasset(bAsset.address)
                    expect(newBasset.personal.status, "bAsset broken below peg").to.eq(BassetStatus.BrokenBelowPeg)
                    await assertFailedBasicRedemption(
                        "In recol",
                        mAsset,
                        bAsset,
                        1,
                        0,
                        sa.default.signer,
                        sa.default.address,
                        false,
                        false,
                        0.9994,
                    )
                })
                it("should fail if other bAssets in basket have broken peg", async () => {
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)
                    await mAsset.connect(sa.governor.signer).handlePegLoss(bAssets[0].address, false)
                    const abovePegBasset = await mAsset.getBasset(bAssets[0].address)
                    await mAsset.connect(sa.governor.signer).handlePegLoss(bAssets[1].address, true)
                    const belowPegBasset = await mAsset.getBasset(bAssets[1].address)
                    expect(abovePegBasset.personal.status, "bAsset broken above peg").to.eq(BassetStatus.BrokenAbovePeg)
                    expect(belowPegBasset.personal.status, "bAsset broken below peg").to.eq(BassetStatus.BrokenBelowPeg)
                    await assertFailedBasicRedemption(
                        "In recol",
                        mAsset,
                        bAssets[2],
                        1,
                        0,
                        sa.default.signer,
                        sa.default.address,
                        false,
                        false,
                        0.9994,
                    )
                })
            })
            context("performing multiple redemptions in a row", async () => {
                before("reset", async () => {
                    await runSetup(true)
                })
                it("should redeem with single bAsset", async () => {
                    const { bAssets, mAsset } = details
                    const oneMasset = simpleToExactAmount(1, 18)
                    const mAssetSupplyBefore = await mAsset.totalSupply()
                    await Promise.all(
                        bAssets.map(async (b) => {
                            const bAssetDecimals = await b.decimals()
                            return mAsset.redeem(
                                b.address,
                                simpleToExactAmount(1, 18),
                                simpleToExactAmount("0.9", bAssetDecimals),
                                sa.default.address,
                            )
                        }),
                    )
                    const mAssetSupplyAfter = await mAsset.totalSupply()
                    expect(mAssetSupplyAfter).eq(mAssetSupplyBefore.sub(BN.from(bAssets.length).mul(oneMasset)))
                })
            })
            context("using bAssets with transfer fees", async () => {
                beforeEach(async () => {
                    await runSetup(true, true)
                })
                it("should handle tokens with transfer fees", async () => {
                    // // It should burn the full amount of mAsset, but the fees deducted mean the redeemer receives less
                    const { bAssets, mAsset } = details

                    const recipient = sa.dummy3
                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3]
                    const bAssetDecimals = await bAsset.decimals()
                    const oneBasset = simpleToExactAmount(1, bAssetDecimals)
                    const bAssetBefore = await mAsset.getBasset(bAsset.address)
                    expect(bAssetBefore.personal.hasTxFee).to.eq(true)

                    // 2.0 Get balances
                    const totalSupplyBefore = await mAsset.totalSupply()
                    const recipientBassetBalBefore = await bAsset.balanceOf(recipient.address)
                    expect(recipientBassetBalBefore).eq(0)

                    // 3.0 Do the redemption
                    await assertBasicRedemption(details, bAsset, 1, BN.from(0), true, recipient.address, sa.default, false, false, true)
                    // const tx = await mAsset.redeemTo(bAsset.address, oneBasset, recipient)
                    const expectedBassetQuantity = applyRatio(oneBasset, bAssetBefore.data.ratio)
                    // expect(actualBassetQuantity, "bAsset quantity").to.eq(expectedBassetQuantity)
                    const feeRate = await mAsset.swapFee()
                    const bAssetFee = oneBasset.mul(feeRate).div(fullScale)

                    // 4.0 Total supply goes down, and recipient bAsset goes up slightly
                    const recipientBassetBalAfter = await bAsset.balanceOf(recipient.address)
                    // Assert that we redeemed gt 99% of the bAsset
                    assertBNSlightlyGTPercent(recipientBassetBalBefore.add(oneBasset.sub(bAssetFee)), recipientBassetBalAfter, "0.4", true)
                    // Total supply goes down full amount
                    const totalSupplyAfter = await mAsset.totalSupply()
                    expect(totalSupplyAfter, "after total supply").eq(totalSupplyBefore.sub(expectedBassetQuantity))

                    // VaultBalance should update for this bAsset
                    const bAssetAfter = await mAsset.getBasset(bAsset.address)
                    expect(BN.from(bAssetAfter.data.vaultBalance), "before != after + fee").eq(
                        BN.from(bAssetBefore.data.vaultBalance).sub(oneBasset).add(bAssetFee),
                    )
                })
                it("should send less output to user if fee unexpected", async () => {
                    // It should burn the full amount of mAsset, but the fees deducted mean the redeemer receives less
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)
                    const recipient = sa.dummy3
                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3]
                    const basket = await mAssetMachine.getBasketComposition(details)
                    const bAssetDecimals = await bAsset.decimals()
                    const oneBasset = simpleToExactAmount(1, bAssetDecimals)
                    const feeRate = await mAsset.swapFee()
                    const bAssetFee = oneBasset.mul(feeRate).div(fullScale)
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true)
                    await mAsset.connect(sa.governor.signer).setTransferFeesFlag(bAsset.address, false)
                    const recipientBassetBalBefore = await bAsset.balanceOf(recipient.address)
                    await mAsset.redeem(bAsset.address, oneBasset, 0, recipient.address)
                    // 4.0 Total supply goes down, and recipient bAsset goes up slightly
                    const recipientBassetBalAfter = await bAsset.balanceOf(recipient.address)
                    // Assert that we redeemed gt 99% of the bAsset
                    assertBNSlightlyGTPercent(recipientBassetBalBefore.add(oneBasset.sub(bAssetFee)), recipientBassetBalAfter, "0.4", true)
                })
            })
        })
    })
    describe("redeeming multiple exact bAssets", () => {
        context("when the weights are within the validator limit", () => {
            before(async () => {
                await runSetup()
            })
            it("should redeem with all different bAsset quantities", async () => {
                const { bAssets } = details
                const recipient = details.forgeValidator.address
                await assertExactBassetsRedemption(details, bAssets, [1, 2, 3, 4], 11, true, recipient)
            })
            it("should redeem with only one bAsset quantity", async () => {
                const { bAssets } = details
                const recipient = details.forgeValidator.address
                await assertExactBassetsRedemption(details, bAssets, [0, 0, 0, 10], 11, true, recipient)
            })
            it("should redeem when max equals mAsset redeem quantity", async () => {
                const { bAssets } = details
                const recipient = details.forgeValidator.address
                await assertExactBassetsRedemption(
                    details,
                    bAssets,
                    ["1000000000000000000", "2000000", "3000000000000", "4000000000000000000"],
                    // mAsset = 10 / (1 - 0.06 / 100) = 10.00600360216129677807
                    // but solidity calculate its to be 10.006003602161296778
                    // and then 1 is added to give 10.006003602161296779
                    "10006003602161296779",
                    true,
                    recipient,
                    undefined,
                    undefined,
                    true,
                )
            })
        })
        context("passing invalid arguments", async () => {
            before(async () => {
                await runSetup()
            })
            context("when invalid bAssets", () => {
                let invalidBassets: (MockERC20 | string)[]
                before(() => {
                    invalidBassets = [...details.bAssets]
                })
                it("should fail when empty bAsset and quantities arrays", async () => {
                    const { mAsset } = details
                    await assertFailedExactBassetsRedemption("Invalid array input", mAsset, [], [], 1)
                })
                it("should fail when empty bAsset and some quantities array input", async () => {
                    const { mAsset } = details
                    await assertFailedExactBassetsRedemption("Invalid array input", mAsset, [], [1, 2], 4)
                })
                it("should fail when some bAssets and empty quantities arrays", async () => {
                    const { mAsset } = details
                    await assertFailedExactBassetsRedemption("Invalid array input", mAsset, details.bAssets, [], 4)
                })
                it("should fail when bAssets to quantities array len do not match", async () => {
                    const { mAsset } = details
                    await assertFailedExactBassetsRedemption("Invalid array input", mAsset, details.bAssets, [1, 2], 4)
                })
                it("should fail when first bAsset is 0x0", async () => {
                    const { mAsset } = details
                    invalidBassets[0] = ZERO_ADDRESS
                    await assertFailedExactBassetsRedemption("Invalid asset", mAsset, invalidBassets, [1, 2, 3, 4], 11)
                })
                it("should fail when last bAsset is 0x0", async () => {
                    const { mAsset } = details
                    invalidBassets[3] = ZERO_ADDRESS
                    await assertFailedExactBassetsRedemption("Invalid asset", mAsset, invalidBassets, [1, 2, 3, 4], 11)
                })
                it("should fail if first bAsset does not exist", async () => {
                    const { mAsset } = details
                    const invalidBasset = await mAssetMachine.loadBassetProxy("Wrapped ETH", "WETH", 18)
                    invalidBassets[0] = invalidBasset
                    await assertFailedExactBassetsRedemption("Invalid asset", mAsset, invalidBassets, [1, 2, 3, 4], 11)
                })
                it("should fail if last bAsset does not exist", async () => {
                    const { mAsset } = details
                    const invalidBasset = await mAssetMachine.loadBassetProxy("Wrapped ETH", "WETH", 18)
                    invalidBassets[3] = invalidBasset
                    await assertFailedExactBassetsRedemption("Invalid asset", mAsset, invalidBassets, [1, 2, 3, 4], 11)
                })
            })
            it("should fail when all quantities are 0", async () => {
                const { bAssets, mAsset } = details
                await assertFailedExactBassetsRedemption(
                    "Must redeem some mAssets",
                    mAsset,
                    bAssets,
                    [0, 0, 0, 0],
                    11,
                    undefined,
                    undefined,
                    false,
                    false,
                )
            })
            it("should fail when max quantity is 0", async () => {
                const { bAssets, mAsset } = details
                await assertFailedExactBassetsRedemption(
                    "Qty==0",
                    mAsset,
                    bAssets,
                    ["1000000000000000000", "2000000", "3000000000000", "4000000000000000000"],
                    0,
                    sa.default.signer,
                    sa.default.address,
                    true,
                    false,
                    "10006003602161296779",
                )
            })
            it("should revert when redeemed mAsset quantity > max mAsset quantity", async () => {
                const { bAssets, mAsset } = details
                await assertFailedExactBassetsRedemption(
                    "Redeem mAsset qty > max quantity",
                    mAsset,
                    bAssets,
                    ["1000000000000000000", "2000000", "3000000000000", "4000000000000000000"],
                    "10000000000000000000",
                    sa.default.signer,
                    sa.default.address,
                    true,
                    false,
                    "10006003602161296779",
                )
            })
            context("when redeemed mAsset quantity just greater than max mAsset quantity", () => {
                it("should revert with high rounded number", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedExactBassetsRedemption(
                        "Redeem mAsset qty > max quantity",
                        mAsset,
                        bAssets,
                        ["1000000000000000000", "2000000", "3000000000000", "4000000000000000000"],
                        // mAsset = 10 / (1 - 0.06 / 100) = 10.00600360216129677807
                        // 1 - 0.06 / 100 = 0.9994
                        // but solidity calculate its to be 10.006003602161296777
                        // and then 1 is added to give 10.006003602161296778
                        "10006003602161296778",
                        sa.default.signer,
                        sa.default.address,
                        true,
                        false,
                        "10006003602161296779",
                    )
                })
                it("should revert when low rounded number", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedExactBassetsRedemption(
                        "Redeem mAsset qty > max quantity",
                        mAsset,
                        bAssets,
                        ["1000000000000000000", "2000000", "3000000000000", "7000000000000000000"],
                        // 13 * (1 - 0.06 / 100) = 13.00780468280968581149
                        "13007804682809685811",
                        undefined,
                        undefined,
                        true,
                        false,
                        "13007804682809685812",
                    )
                })
            })
            it("should fail if recipient is 0x0", async () => {
                const { bAssets, mAsset } = details
                await assertFailedExactBassetsRedemption(
                    "Invalid recipient",
                    mAsset,
                    bAssets,
                    [1, 2, 3, 4],
                    10,
                    undefined,
                    ZERO_ADDRESS,
                    false,
                    false,
                    "10006003602161296779",
                )
            })
            it("should fail if sender doesn't have mAsset balance", async () => {
                const { bAssets, mAsset } = details
                const sender = sa.dummy1
                expect(await mAsset.balanceOf(sender.address)).eq(0)
                await assertFailedExactBassetsRedemption(
                    "ERC20: burn amount exceeds balance",
                    mAsset,
                    bAssets,
                    [1, 2, 3, 4],
                    11,
                    sender.signer,
                    undefined,
                    false,
                    false,
                    "10006003602161296779",
                )
            })
        })
    })
    describe("redeeming mAssets for multiple proportional bAssets", () => {
        context("even bAsset weights", () => {
            before(async () => {
                await runSetup()
            })
            it("should redeem with all different bAsset quantities", async () => {
                const recipient = details.forgeValidator.address
                await assertMassetRedemption(details, 10, [2, 2, 2, 2], true, recipient)
            })
            it("should redeem with bAsset minimums exactly equal", async () => {
                const recipient = details.forgeValidator.address
                await assertMassetRedemption(
                    details,
                    "10000000000000000000",
                    ["2499249999999999999", "2499249", "2499249999999", "2499249999999999999"],
                    true,
                    recipient,
                    undefined,
                    false,
                    true,
                )
            })
        })
        context("uneven bAsset weights", () => {
            before(async () => {
                await runSetup(true, false, false, true, [1, 4, 30, 15])
            })
            it("should redeem", async () => {
                const recipient = details.forgeValidator.address
                await assertMassetRedemption(details, 10, [0, 0, 5, 2], true, recipient)
            })
        })
        context("when most of basket in second bAsset", () => {
            beforeEach(async () => {
                await runSetup(true, false, false, true, [25, 125, 25, 25])
            })
            it("should redeem some of the bAssets", async () => {
                const recipient = details.forgeValidator.address
                // 10 * (1 - 0.03 / 100) - 0.000001 = 9996999
                await assertMassetRedemption(
                    details,
                    simpleToExactAmount(8, 18),
                    [simpleToExactAmount(9, 17), "4800000", simpleToExactAmount(9, 11), simpleToExactAmount(9, 17)],
                    true,
                    recipient,
                    undefined,
                    false,
                    true,
                )
            })
        })
        describe("passing invalid arguments", async () => {
            before(async () => {
                await runSetup()
            })
            it("should revert when mAsset quantity is zero", async () => {
                const { bAssets, mAsset } = details
                await assertFailedMassetRedemption("Qty==0", mAsset, 0, [2, 2, 2, 2], bAssets)
            })
            it("should fail if recipient is 0x0", async () => {
                const { bAssets, mAsset } = details
                await assertFailedMassetRedemption("Invalid recipient", mAsset, 0, [2, 2, 2, 2], bAssets, undefined, ZERO_ADDRESS)
            })
        })
        describe("failures other than invalid arguments", () => {
            before(async () => {
                await runSetup()
            })
            context("when a bAsset minimum is not reached", () => {
                const testData = [
                    {
                        desc: "first bAsset < min",
                        minBassetQuantities: [3, 2, 2, 2],
                    },
                    {
                        desc: "last bAsset < min",
                        minBassetQuantities: [2, 2, 2, 3],
                    },
                    {
                        desc: "all bAsset < min",
                        minBassetQuantities: [3, 3, 3, 3],
                    },
                    {
                        desc: "all zero except last bAsset < min",
                        minBassetQuantities: [0, 0, 0, 3],
                    },
                    {
                        desc: "first bAsset just below min",
                        minBassetQuantities: ["2499250000000000000", "2499249", "2499249999999", "2499249999999999999"],
                        mAssetQuantity: "10000000000000000000",
                        quantitiesAreExact: true,
                    },
                    {
                        desc: "second bAsset just below min",
                        minBassetQuantities: ["2499249999999999999", "2499250", "2499249999999", "2499249999999999999"],
                        mAssetQuantity: "10000000000000000000",
                        quantitiesAreExact: true,
                    },
                ]
                testData.forEach((data) => {
                    it(`should revert when ${data.desc}`, async () => {
                        const { bAssets, mAsset } = details
                        await assertFailedMassetRedemption(
                            "bAsset qty < min qty",
                            mAsset,
                            data.mAssetQuantity || 10,
                            data.minBassetQuantities,
                            bAssets,
                            undefined,
                            undefined,
                            data.quantitiesAreExact,
                        )
                    })
                })
            })
            it("should fail if sender doesn't have mAsset balance", async () => {
                const { bAssets, mAsset } = details
                const sender = sa.dummy1
                expect(await mAsset.balanceOf(sender.address)).eq(0)
                await assertFailedMassetRedemption("ERC20: burn amount exceeds balance", mAsset, 10, [2, 2, 2, 2], bAssets, sender.signer)
            })
            context("when a bAsset has broken its peg", () => {
                it("should fail if broken below peg", async () => {
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)
                    const bAsset = bAssets[1]
                    await mAsset.connect(sa.governor.signer).handlePegLoss(bAsset.address, true)
                    const newBasset = await mAsset.getBasset(bAsset.address)
                    expect(newBasset.personal.status, "bAsset broken below peg").to.eq(BassetStatus.BrokenBelowPeg)
                    await assertFailedMassetRedemption("In recol", mAsset, 10, [2, 2, 2, 2], bAssets)
                })
                it("should fail if broken above peg", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    await mAsset.connect(sa.governor.signer).handlePegLoss(bAsset.address, false)
                    const newBasset = await mAsset.getBasset(bAsset.address)
                    expect(newBasset.personal.status, "bAsset broken above peg").to.eq(BassetStatus.BrokenAbovePeg)
                    await assertFailedMassetRedemption("In recol", mAsset, 10, [2, 2, 2, 2], bAssets)
                })
            })
        })
    })
})
