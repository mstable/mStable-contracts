/* eslint-disable no-await-in-loop */

import { expect } from "chai"
import { Signer } from "ethers"
import { ethers } from "hardhat"

import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions"
import { applyRatio, BN, simpleToExactAmount } from "@utils/math"
import { Account, MassetDetails, MassetMachine, StandardAccounts } from "@utils/machines"
import { BassetStatus } from "@utils/mstable-objects"
import { ZERO_ADDRESS } from "@utils/constants"
import { Masset, MockERC20 } from "types/generated"

interface MintOutput {
    mAssets: BN
    senderBassetBalBefore: BN
    senderBassetBalAfter: BN
    recipientBalBefore: BN
    recipientBalAfter: BN
}

describe("Masset - Mint", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine

    let details: MassetDetails

    const runSetup = async (seedBasket = true, useTransferFees = false, useLendingMarkets = false): Promise<void> => {
        details = await mAssetMachine.deployMasset(true, useLendingMarkets, useTransferFees)
        if (seedBasket) {
            await mAssetMachine.seedWithWeightings(details, [25, 25, 25, 25])
        }
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        await runSetup()
    })

    const assertFailedMint = async (
        expectedReason: string,
        mAssetContract: Masset,
        bAsset: MockERC20,
        bAssetQuantity: BN | number | string,
        minMassetQuantity: BN | number | string = 0,
        approval = true,
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        mintOutputRevertExpected = true,
        mintOutputExpected: BN | number | string = 0,
        quantitiesAreExact = false,
    ): Promise<void> => {
        const mAsset = mAssetContract.connect(sender)
        if (approval) {
            await mAssetMachine.approveMasset(bAsset, mAsset, bAssetQuantity, sender, quantitiesAreExact)
        }

        const bAssetDecimals = await bAsset.decimals()
        const bAssetQuantityExact = quantitiesAreExact ? BN.from(bAssetQuantity) : simpleToExactAmount(bAssetQuantity, bAssetDecimals)
        const minMassetQuantityExact = quantitiesAreExact ? BN.from(minMassetQuantity) : simpleToExactAmount(minMassetQuantity, 18)

        await expect(
            mAsset.mint(bAsset.address, bAssetQuantityExact, minMassetQuantityExact, recipient),
            `mint tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)

        if (mintOutputRevertExpected) {
            await expect(
                mAsset.getMintOutput(bAsset.address, bAssetQuantityExact),
                `getMintOutput call should revert with "${expectedReason}"`,
            ).to.be.revertedWith(expectedReason)
        } else {
            const mintOutputExpectedExact = quantitiesAreExact ? BN.from(mintOutputExpected) : simpleToExactAmount(mintOutputExpected, 18)
            const output = await mAsset.getMintOutput(bAsset.address, bAssetQuantityExact)
            expect(output, "getMintOutput call output").eq(mintOutputExpectedExact)
        }
    }

    const assertFailedMintMulti = async (
        expectedReason: string,
        mAssetContract: Masset,
        bAssets: (MockERC20 | string)[],
        bAssetRedeemQuantities: (BN | number | string)[],
        minMassetQuantity: BN | number | string = 0,
        approval = true,
        sender: Signer = sa.default.signer,
        recipient: string = sa.default.address,
        mintMultiOutputRevertExpected = true,
        outputExpected: BN | number | string = 0,
        quantitiesAreExact = false,
    ): Promise<void> => {
        const mAsset = mAssetContract.connect(sender)
        if (approval) {
            const approvePromises = bAssets.map((b, i) =>
                typeof b === "string"
                    ? Promise.resolve(BN.from(0))
                    : mAssetMachine.approveMasset(b, mAsset, bAssetRedeemQuantities[i], sender, quantitiesAreExact),
            )
            await Promise.all(approvePromises)
        }

        const bAssetAddresses = bAssets.map((bAsset) => (typeof bAsset === "string" ? bAsset : bAsset.address))
        const bAssetsDecimals = await Promise.all(
            bAssets.map((bAsset) => (typeof bAsset === "string" ? Promise.resolve(18) : bAsset.decimals())),
        )

        // Convert to exact quantities
        const bAssetRedeemQuantitiesExact = quantitiesAreExact
            ? bAssetRedeemQuantities.map((q) => BN.from(q))
            : bAssetRedeemQuantities.map((q, i) => simpleToExactAmount(q, bAssetsDecimals[i]))
        const minMassetQuantityExact = quantitiesAreExact ? BN.from(minMassetQuantity) : simpleToExactAmount(minMassetQuantity, 18)

        await expect(
            mAsset.mintMulti(bAssetAddresses, bAssetRedeemQuantitiesExact, minMassetQuantityExact, recipient),
            `mintMulti tx should revert with "${expectedReason}"`,
        ).to.be.revertedWith(expectedReason)

        if (mintMultiOutputRevertExpected) {
            await expect(
                mAsset.getMintMultiOutput(bAssetAddresses, bAssetRedeemQuantitiesExact),
                `getMintMultiOutput call should revert with "${expectedReason}"`,
            ).to.be.revertedWith(expectedReason)
        } else {
            const outputExpectedExact = quantitiesAreExact ? BN.from(outputExpected) : simpleToExactAmount(outputExpected, 18)
            const output = await mAsset.getMintMultiOutput(bAssetAddresses, bAssetRedeemQuantitiesExact)
            expect(output, "getMintMultiOutput call output").eq(outputExpectedExact)
        }
    }

    // Helper to assert basic minting conditions, i.e. balance before and after
    const assertBasicMint = async (
        md: MassetDetails,
        bAsset: MockERC20,
        bAssetQuantity: BN | number | string,
        minMassetQuantity: BN | number | string = 0,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        ignoreHealthAssertions = true,
        quantitiesAreExact = false,
    ): Promise<MintOutput> => {
        const { platform } = md
        const mAsset = md.mAsset.connect(sender.signer)
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

        // Get before balances
        const senderBassetBalBefore = await bAsset.balanceOf(sender.address)
        const recipientBalBefore = await mAsset.balanceOf(recipient)
        const bAssetBefore = await mAssetMachine.getBasset(details, bAsset.address)

        // Convert to exact quantities
        const bAssetQuantityExact = quantitiesAreExact
            ? BN.from(bAssetQuantity)
            : simpleToExactAmount(bAssetQuantity, await bAsset.decimals())
        const minMassetQuantityExact = quantitiesAreExact ? BN.from(minMassetQuantity) : simpleToExactAmount(minMassetQuantity, 18)
        const mAssetQuantityExact = applyRatio(bAssetQuantityExact, bAssetBefore.ratio)

        const platformInteraction = await mAssetMachine.getPlatformInteraction(mAsset, "deposit", bAssetQuantityExact, bAssetBefore)
        const integratorBalBefore = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator ? bAssetBefore.integratorAddr : mAsset.address,
        )

        await mAssetMachine.approveMasset(bAsset, mAsset, bAssetQuantityExact, sender.signer, quantitiesAreExact)

        const mAssetOutput = await mAsset.getMintOutput(bAsset.address, bAssetQuantityExact)
        expect(mAssetOutput, "mAssetOutput").to.eq(mAssetQuantityExact)

        const tx = mAsset.mint(bAsset.address, bAssetQuantityExact, minMassetQuantityExact, recipient)

        await expect(tx, "Minted event")
            .to.emit(mAsset, "Minted")
            .withArgs(sender.address, recipient, mAssetQuantityExact, bAsset.address, bAssetQuantityExact)
        // Transfers to lending platform
        await expect(tx, "Transfer event")
            .to.emit(bAsset, "Transfer")
            .withArgs(sender.address, bAssetBefore.integrator ? bAssetBefore.integratorAddr : mAsset.address, bAssetQuantityExact)

        // Deposits into lending platform
        const integratorBalAfter = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator ? bAssetBefore.integratorAddr : mAsset.address,
        )
        expect(integratorBalAfter, "integratorBalAfter").eq(integratorBalBefore.add(bAssetQuantityExact))
        if (platformInteraction.expectInteraction) {
            await expect(tx).to.emit(platform, "Deposit").withArgs(bAsset.address, bAssetBefore.pToken, platformInteraction.amount)
        }

        // Recipient should have mAsset quantity after
        const recipientBalAfter = await mAsset.balanceOf(recipient)
        expect(recipientBalAfter, "recipientBal after").eq(recipientBalBefore.add(mAssetQuantityExact))
        // Sender should have less bAsset after
        const senderBassetBalAfter = await bAsset.balanceOf(sender.address)
        expect(senderBassetBalAfter, "senderBassetBal after").eq(senderBassetBalBefore.sub(bAssetQuantityExact))
        // VaultBalance should update for this bAsset
        const bAssetAfter = await mAsset.getBasset(bAsset.address)
        expect(BN.from(bAssetAfter.data.vaultBalance), "vaultBalance after").eq(BN.from(bAssetBefore.vaultBalance).add(bAssetQuantityExact))

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)
        return {
            mAssets: mAssetQuantityExact,
            senderBassetBalBefore,
            senderBassetBalAfter,
            recipientBalBefore,
            recipientBalAfter,
        }
    }

    describe("minting with a single bAsset", () => {
        context("when the weights are within the ForgeValidator limit", () => {
            context("using bAssets with no transfer fees", async () => {
                before("reset", async () => {
                    await runSetup()
                })
                it("should send mUSD when recipient is a contract", async () => {
                    const { bAssets, forgeValidator } = details
                    const recipient = forgeValidator.address
                    await assertBasicMint(details, bAssets[0], 1, 0, recipient)
                })
                it("should send mUSD when the recipient is an EOA", async () => {
                    const { bAssets } = details
                    const recipient = sa.dummy1.address
                    await assertBasicMint(details, bAssets[1], 1, 0, recipient)
                })
                it("should mint mAssets to 18 decimals from 1 base bAsset unit with 12 decimals", async () => {
                    const bAsset = details.bAssets[2]
                    const decimals = await bAsset.decimals()
                    expect(decimals).eq(12)

                    const result = await assertBasicMint(details, bAsset, 1, 0, sa.default.address, sa.default, false, true)
                    expect(result.mAssets).to.eq("1000000") // 18 - 12 = 6 decimals
                })
                it("should mint mAssets to 18 decimals from 2 base bAsset units with 6 decimals", async () => {
                    const bAsset = details.bAssets[1]
                    const decimals = await bAsset.decimals()
                    expect(decimals).eq(6)

                    const result = await assertBasicMint(details, bAsset, 2, 0, sa.default.address, sa.default, false, true)
                    expect(result.mAssets).to.eq("2000000000000") // 18 - 6 = 12 decimals
                })
            })
            context("using bAssets with transfer fees", async () => {
                before(async () => {
                    await runSetup(false, true, true)
                })
                it("should handle tokens with transfer fees", async () => {
                    const { bAssets, mAsset, platform } = details
                    await assertBasketIsHealthy(mAssetMachine, details)

                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3]
                    const basket = await mAssetMachine.getBasketComposition(details)
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true)

                    // 2.0 Get balances
                    const minterBassetBalBefore = await bAsset.balanceOf(sa.default.address)
                    const recipient = sa.dummy3
                    const recipientBalBefore = await mAsset.balanceOf(recipient.address)
                    expect(recipientBalBefore).eq(0)
                    const mAssetMintAmount = 10
                    const approval0: BN = await mAssetMachine.approveMasset(bAsset, mAsset, mAssetMintAmount)
                    // 3.0 Do the mint
                    const tx = mAsset.mint(bAsset.address, approval0, 0, recipient.address)

                    const mAssetQuantity = simpleToExactAmount(mAssetMintAmount, 18)
                    const bAssetQuantity = simpleToExactAmount(mAssetMintAmount, await bAsset.decimals())

                    // take 0.1% off for the transfer fee = amount * (1 - 0.001)
                    const bAssetAmountLessFee = bAssetQuantity.mul(999).div(1000)
                    // 3.1 Check Transfers to lending platform
                    await expect(tx).to.emit(bAsset, "Transfer").withArgs(sa.default.address, platform.address, bAssetAmountLessFee)
                    // 3.2 Check Deposits into lending platform
                    await expect(tx)
                        .to.emit(platform, "Deposit")
                        .withArgs(bAsset.address, await platform.bAssetToPToken(bAsset.address), bAssetAmountLessFee)
                    // 4.0 Recipient should have mAsset quantity after
                    const recipientBalAfter = await mAsset.balanceOf(recipient.address)
                    // Assert that we minted gt 99% of the bAsset
                    assertBNSlightlyGTPercent(recipientBalBefore.add(mAssetQuantity), recipientBalAfter, "0.3", true)
                    // Sender should have less bAsset after
                    const minterBassetBalAfter = await bAsset.balanceOf(sa.default.address)
                    expect(minterBassetBalAfter).eq(minterBassetBalBefore.sub(bAssetQuantity))
                    // VaultBalance should update for this bAsset
                    const bAssetAfter = await mAsset.getBasset(bAsset.address)
                    expect(BN.from(bAssetAfter.data.vaultBalance)).eq(recipientBalAfter)

                    // Complete basket should remain in healthy state
                    // await assertBasketIsHealthy(mAssetMachine, details);
                })
                it("should fail if the token charges a fee but we don't know about it", async () => {
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)

                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3]
                    const basket = await mAssetMachine.getBasketComposition(details)
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true)
                    await mAsset.connect(sa.governor.signer).setTransferFeesFlag(bAsset.address, false)

                    // 2.0 Get balances
                    const mAssetMintAmount = 10
                    const approval0: BN = await mAssetMachine.approveMasset(bAsset, mAsset, mAssetMintAmount)
                    // 3.0 Do the mint
                    await expect(mAsset.mint(bAsset.address, approval0, 0, sa.default.address)).to.revertedWith(
                        "Asset not fully transferred",
                    )
                })
            })
            context("with an affected bAsset", async () => {
                it("should fail if bAsset is broken below peg", async () => {
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)

                    const bAsset = bAssets[0]
                    await mAsset.connect(sa.governor.signer).handlePegLoss(bAsset.address, true)
                    const newBasset = await mAsset.getBasset(bAsset.address)
                    expect(newBasset.personal.status).to.eq(BassetStatus.BrokenBelowPeg)
                    await assertFailedMint("Unhealthy", mAsset, bAsset, 1, 0, true, sa.default.signer, sa.default.address, false, 1)
                })
            })
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should fail if recipient is 0x0", async () => {
                    const { mAsset, bAssets } = details
                    await assertFailedMint("Invalid recipient", mAsset, bAssets[0], 1, 0, true, sa.default.signer, ZERO_ADDRESS, false, 1)
                })
                it("should revert when 0 quantities", async () => {
                    const { bAssets, mAsset } = details
                    await assertFailedMint("Qty==0", mAsset, bAssets[0], 0)
                })
                it("should fail if sender doesn't have balance", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    const sender = sa.dummy1
                    expect(await bAsset.balanceOf(sender.address)).eq(0)
                    await assertFailedMint(
                        "ERC20: transfer amount exceeds balance",
                        mAsset,
                        bAsset,
                        100,
                        99,
                        true,
                        sender.signer,
                        sender.address,
                        false,
                        100,
                    )
                })
                it("should fail if sender doesn't give approval", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    const sender = sa.dummy2
                    await bAsset.transfer(sender.address, 10000)
                    expect(await bAsset.allowance(sender.address, mAsset.address)).eq(0)
                    expect(await bAsset.balanceOf(sender.address)).eq(10000)
                    await assertFailedMint(
                        "ERC20: transfer amount exceeds allowance",
                        mAsset,
                        bAsset,
                        100,
                        99,
                        false,
                        sender.signer,
                        sender.address,
                        false,
                        100,
                        true,
                    )
                })
                it("should fail if the bAsset does not exist", async () => {
                    const { mAsset } = details
                    const newBasset = await mAssetMachine.loadBassetProxy("Mock", "MKK", 18, sa.default.address, 1000)
                    await assertFailedMint("Invalid asset", mAsset, newBasset, 1)
                })
            })
            context("should mint single bAsset", () => {
                const indexes = [0, 1, 2, 3]
                indexes.forEach((i) => {
                    it(`should mint single bAsset[${i}]`, async () => {
                        await assertBasicMint(details, details.bAssets[i], 1)
                    })
                })
            })
        })
    })
    describe("minting with multiple bAssets", () => {
        // Helper to assert basic minting conditions, i.e. balance before and after
        const assertMintMulti = async (
            md: MassetDetails,
            mAssetMintAmounts: Array<BN | number>,
            bAssets: Array<MockERC20>,
            recipient: string = sa.default.address,
            sender: Account = sa.default,
            ignoreHealthAssertions = false,
        ): Promise<void> => {
            const { mAsset } = md

            if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)

            const minterBassetBalBefore = await Promise.all(bAssets.map((b) => b.balanceOf(sender.address)))
            const recipientBalBefore = await mAsset.balanceOf(recipient)
            const bAssetDecimals = await Promise.all(bAssets.map((b) => b.decimals()))
            const bAssetBefore = await Promise.all(bAssets.map((b) => mAsset.getBasset(b.address)))
            const approvals: Array<BN> = await Promise.all(
                bAssets.map((b, i) => mAssetMachine.approveMasset(b, mAsset, mAssetMintAmounts[i])),
            )
            const tx = mAsset.connect(sender.signer).mintMulti(
                bAssetBefore.map((b) => b.personal.addr),
                approvals,
                0,
                recipient,
            )

            const mAssetQuantity = simpleToExactAmount(
                mAssetMintAmounts.reduce((p, c) => BN.from(p).add(BN.from(c)), BN.from(0)),
                18,
            )
            await expect(tx)
                .to.emit(mAsset, "MintedMulti")
                .withArgs(
                    sender.address,
                    recipient,
                    mAssetQuantity,
                    bAssetBefore.map((b) => b.personal.addr),
                    approvals,
                )

            const bAssetQuantities = mAssetMintAmounts.map((m, i) => simpleToExactAmount(m, bAssetDecimals[i]))
            // Recipient should have mAsset quantity after
            const recipientBalAfter = await mAsset.balanceOf(recipient)
            expect(recipientBalAfter).eq(recipientBalBefore.add(mAssetQuantity))
            // Sender should have less bAsset after
            const minterBassetBalAfter = await Promise.all(bAssets.map((b) => b.balanceOf(sender.address)))
            minterBassetBalAfter.map((b, i) => expect(b).eq(minterBassetBalBefore[i].sub(bAssetQuantities[i])))
            // VaultBalance should updated for this bAsset
            const bAssetAfter = await Promise.all(bAssets.map((b) => mAsset.getBasset(b.address)))
            bAssetAfter.map((b, i) =>
                expect(BN.from(b.data.vaultBalance)).eq(BN.from(bAssetBefore[i].data.vaultBalance).add(bAssetQuantities[i])),
            )

            // Complete basket should remain in healthy state
            if (!ignoreHealthAssertions) await assertBasketIsHealthy(mAssetMachine, md)
        }

        before(async () => {
            await runSetup()
        })
        context("when the weights are within the ForgeValidator limit", () => {
            context("and sending to a specific recipient", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should mint selected bAssets only", async () => {
                    const comp = await mAssetMachine.getBasketComposition(details)
                    await assertMintMulti(details, [5, 10], [details.bAssets[2], details.bAssets[0]])
                    const compAfter = await mAssetMachine.getBasketComposition(details)
                    expect(comp.bAssets[1].vaultBalance).eq(compAfter.bAssets[1].vaultBalance)
                    expect(comp.bAssets[3].vaultBalance).eq(compAfter.bAssets[3].vaultBalance)
                })
                it("should send mUSD when recipient is a contract", async () => {
                    const { bAssets, forgeValidator } = details
                    const recipient = forgeValidator.address
                    await assertMintMulti(details, [1], [bAssets[0]], recipient)
                })
                it("should send mUSD when the recipient is an EOA", async () => {
                    const { bAssets } = details
                    const recipient = sa.dummy1
                    await assertMintMulti(details, [1], [bAssets[0]], recipient.address)
                })
            })
            context("and specifying one bAsset base unit", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should mint a higher q of mAsset base units when using bAsset with 18", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    const decimals = await bAsset.decimals()
                    expect(decimals).eq(18)

                    await bAsset.approve(mAsset.address, 1)

                    const minterBassetBalBefore = await bAsset.balanceOf(sa.default.address)
                    const recipientBalBefore = await mAsset.balanceOf(sa.default.address)

                    const tx = mAsset.mintMulti([bAsset.address], [1], 0, sa.default.address)
                    const expectedMasset = BN.from(10).pow(BN.from(18).sub(decimals))
                    await expect(tx)
                        .to.emit(mAsset, "MintedMulti")
                        .withArgs(sa.default.address, sa.default.address, expectedMasset, [bAsset.address], [1])
                    // Recipient should have mAsset quantity after
                    const recipientBalAfter = await mAsset.balanceOf(sa.default.address)
                    expect(recipientBalAfter).eq(recipientBalBefore.add(expectedMasset))
                    // Sender should have less bAsset after
                    const minterBassetBalAfter = await bAsset.balanceOf(sa.default.address)
                    expect(minterBassetBalAfter).eq(minterBassetBalBefore.sub(1))
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(mAssetMachine, details)
                })
            })
            context("using bAssets with transfer fees", async () => {
                before(async () => {
                    await runSetup(false, true, true)
                })
                it("should handle tokens with transfer fees", async () => {
                    const { bAssets, mAsset, platform } = details
                    await assertBasketIsHealthy(mAssetMachine, details)

                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3]
                    const basket = await mAssetMachine.getBasketComposition(details)
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true)

                    // 2.0 Get balances
                    const minterBassetBalBefore = await bAsset.balanceOf(sa.default.address)
                    const recipient = sa.dummy3
                    const recipientBalBefore = await mAsset.balanceOf(recipient.address)
                    expect(recipientBalBefore).eq(0)
                    const mAssetMintAmount = 10
                    const approval0: BN = await mAssetMachine.approveMasset(bAsset, mAsset, mAssetMintAmount)
                    // 3.0 Do the mint
                    const tx = mAsset.mintMulti([bAsset.address], [approval0], 0, recipient.address)

                    const mAssetQuantity = simpleToExactAmount(mAssetMintAmount, 18)
                    const bAssetQuantity = simpleToExactAmount(mAssetMintAmount, await bAsset.decimals())
                    // take 0.1% off for the transfer fee = amount * (1 - 0.001)
                    const bAssetAmountLessFee = bAssetQuantity.mul(999).div(1000)
                    const platformToken = await platform.bAssetToPToken(bAsset.address)
                    const lendingPlatform = await platform.platformAddress()
                    // 3.1 Check Transfers from sender to platform integration
                    await expect(tx).to.emit(bAsset, "Transfer").withArgs(sa.default.address, platform.address, bAssetAmountLessFee)
                    // 3.2 Check Transfers from platform integration to lending platform
                    await expect(tx).to.emit(bAsset, "Transfer").withArgs(
                        platform.address,
                        lendingPlatform,
                        bAssetAmountLessFee.mul(999).div(1000), // Take another 0.1% off the transfer value
                    )
                    // 3.3 Check Deposits into lending platform
                    await expect(tx).to.emit(platform, "Deposit").withArgs(bAsset.address, platformToken, bAssetAmountLessFee)
                    // 4.0 Recipient should have mAsset quantity after
                    const recipientBalAfter = await mAsset.balanceOf(recipient.address)
                    // Assert that we minted gt 99% of the bAsset
                    assertBNSlightlyGTPercent(recipientBalBefore.add(mAssetQuantity), recipientBalAfter, "0.3")
                    // Sender should have less bAsset afterz
                    const minterBassetBalAfter = await bAsset.balanceOf(sa.default.address)
                    expect(minterBassetBalAfter).eq(minterBassetBalBefore.sub(bAssetQuantity))
                    // VaultBalance should update for this bAsset
                    const bAssetAfter = await mAsset.getBasset(bAsset.address)
                    expect(BN.from(bAssetAfter.data.vaultBalance)).eq(recipientBalAfter)

                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(mAssetMachine, details)
                })
                it("should fail if the token charges a fee but we don't know about it", async () => {
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)

                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3]
                    const basket = await mAssetMachine.getBasketComposition(details)
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true)
                    await mAsset.connect(sa.governor.signer).setTransferFeesFlag(bAsset.address, false)

                    // 2.0 Get balances
                    const mAssetMintAmount = 10
                    const approval0: BN = await mAssetMachine.approveMasset(bAsset, mAsset, mAssetMintAmount)
                    // 3.0 Do the mint
                    await expect(mAsset.mintMulti([bAsset.address], [approval0], 0, sa.default.address)).to.revertedWith(
                        "Asset not fully transferred",
                    )
                })
            })
            context("with an affected bAsset", async () => {
                it("should fail if bAsset is broken below peg", async () => {
                    const { bAssets, mAsset } = details
                    await assertBasketIsHealthy(mAssetMachine, details)

                    const bAsset = bAssets[0]
                    await mAsset.connect(sa.governor.signer).handlePegLoss(bAsset.address, true)
                    const newBasset = await mAsset.getBasset(bAsset.address)
                    expect(newBasset.personal.status).to.eq(BassetStatus.BrokenBelowPeg)
                    await mAssetMachine.approveMasset(bAsset, mAsset, 1)
                    await assertFailedMintMulti(
                        "Unhealthy",
                        mAsset,
                        [bAsset.address],
                        [1],
                        0,
                        true,
                        sa.default.signer,
                        sa.default.address,
                        false,
                        1,
                    )
                })
            })
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup()
                })
                it("should fail if recipient is 0x0", async () => {
                    const { mAsset, bAssets } = details
                    await assertFailedMintMulti(
                        "Invalid recipient",
                        mAsset,
                        [bAssets[0].address],
                        [1],
                        0,
                        true,
                        sa.default.signer,
                        ZERO_ADDRESS,
                        false,
                        1,
                        true,
                    )
                })
                context("with incorrect bAsset array", async () => {
                    it("should fail if both input arrays are empty", async () => {
                        const { mAsset } = details
                        await assertFailedMintMulti("Input array mismatch", mAsset, [], [])
                    })
                    it("should fail if the bAsset input array is empty", async () => {
                        const { mAsset } = details
                        await assertFailedMintMulti("Input array mismatch", mAsset, [], [1])
                    })
                    it("should fail if there is a length mismatch", async () => {
                        const { mAsset, bAssets } = details
                        await assertFailedMintMulti("Input array mismatch", mAsset, [bAssets[0].address], [1, 1])
                    })
                    it("should fail if there is a length mismatch", async () => {
                        const { mAsset, bAssets } = details
                        await assertFailedMintMulti("Input array mismatch", mAsset, [bAssets[0].address], [1, 1, 1, 1])
                    })
                    it("should fail if there are duplicate bAsset addresses", async () => {
                        const { mAsset, bAssets } = details
                        await assertFailedMintMulti("Duplicate asset", mAsset, [bAssets[0].address, bAssets[0].address], [1, 1])
                    })
                })
                describe("minting with some 0 quantities", async () => {
                    it("should allow minting with some 0 quantities", async () => {
                        const { bAssets } = details
                        const recipient = sa.dummy1
                        await assertMintMulti(details, [1, 0], [bAssets[0], bAssets[1]], recipient.address)
                    })
                    it("should fail if output mAsset quantity is 0", async () => {
                        const { mAsset, bAssets } = details
                        // Get all before balances
                        const bAssetBefore = await Promise.all(bAssets.map((b) => mAsset.getBasset(b.address)))
                        // Approve spending of the bAssets
                        await Promise.all(bAssets.map((b) => mAssetMachine.approveMasset(b, mAsset, 1)))
                        // Pass all 0's
                        await assertFailedMintMulti(
                            "Zero mAsset quantity",
                            mAsset,
                            bAssetBefore.map((b) => b.personal.addr),
                            [0, 0, 0, 0],
                            0,
                            true,
                            sa.default.signer,
                            sa.default.address,
                            false,
                            0,
                        )
                    })
                })
                it("should fail if slippage just too big", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    const sender = sa.default
                    await mAssetMachine.approveMasset(bAsset, mAsset, 101, sender.signer)
                    await assertFailedMintMulti(
                        "Mint quantity < min qty",
                        mAsset,
                        [bAsset.address],
                        ["100000000000000000000"], // 100
                        "100000000000000000001", // just over 100
                        true,
                        sender.signer,
                        sender.address,
                        false,
                        "100000000000000000000", // 100
                        true,
                    )
                })
                it("should fail if sender doesn't have balance", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    const sender = sa.dummy2
                    expect(await bAsset.balanceOf(sender.address)).eq(0)
                    await assertFailedMintMulti(
                        "ERC20: transfer amount exceeds balance",
                        mAsset,
                        [bAsset.address],
                        [100],
                        0,
                        false,
                        sender.signer,
                        sender.address,
                        false,
                        100,
                    )
                })
                it("should fail if sender doesn't give approval", async () => {
                    const { bAssets, mAsset } = details
                    const bAsset = bAssets[0]
                    const sender = sa.dummy3
                    await bAsset.transfer(sender.address, 10000)
                    expect(await bAsset.allowance(sender.address, mAsset.address)).eq(0)
                    expect(await bAsset.balanceOf(sender.address)).eq(10000)
                    await assertFailedMintMulti(
                        "ERC20: transfer amount exceeds allowance",
                        mAsset,
                        [bAsset.address],
                        [100],
                        0,
                        false,
                        sender.signer,
                        sa.default.address,
                        false,
                        100,
                        true,
                    )
                })
                it("should fail if the bAsset does not exist", async () => {
                    const { mAsset } = details
                    await assertFailedMintMulti("Invalid asset", mAsset, [sa.dummy4.address], [100])
                })
            })
            describe("minting with various orders", async () => {
                before(async () => {
                    await runSetup()
                })

                it("should mint quantities relating to the order of the bAsset indexes", async () => {
                    const { bAssets, mAsset } = details
                    const compBefore = await mAssetMachine.getBasketComposition(details)
                    await mAssetMachine.approveMasset(bAssets[0], mAsset, 100)
                    await mAssetMachine.approveMasset(bAssets[1], mAsset, 100)

                    // Minting with 2 and 1.. they should correspond to lowest index first
                    await mAsset.mintMulti([bAssets[0].address, bAssets[1].address], [2, 1], 0, sa.default.address)
                    const compAfter = await mAssetMachine.getBasketComposition(details)
                    expect(compAfter.bAssets[0].vaultBalance).eq(BN.from(compBefore.bAssets[0].vaultBalance).add(BN.from(2)))
                    expect(compAfter.bAssets[1].vaultBalance).eq(BN.from(compBefore.bAssets[1].vaultBalance).add(BN.from(1)))
                })
                it("should mint using multiple bAssets", async () => {
                    const { bAssets, mAsset } = details
                    // It's only possible to mint a single base unit of mAsset, if the bAsset also has 18 decimals
                    // For those tokens with 12 decimals, they can at minimum mint 1*10**6 mAsset base units.
                    // Thus, these basic calculations should work in whole mAsset units, with specific tests for
                    // low decimal bAssets
                    const approvals = await mAssetMachine.approveMassetMulti(
                        [bAssets[0], bAssets[1], bAssets[2]],
                        mAsset,
                        1,
                        sa.default.signer,
                    )
                    await mAsset.mintMulti([bAssets[0].address, bAssets[1].address, bAssets[2].address], approvals, 0, sa.default.address)
                    const approvals2 = await mAssetMachine.approveMassetMulti(
                        [bAssets[0], bAssets[1], bAssets[2], bAssets[3]],
                        mAsset,
                        1,
                        sa.default.signer,
                    )
                    const mUsdBalBefore = await mAsset.balanceOf(sa.default.address)
                    await mAsset.mintMulti(
                        [bAssets[0].address, bAssets[1].address, bAssets[2].address, bAssets[3].address],
                        approvals2,
                        0,
                        sa.default.address,
                    )
                    const mUsdBalAfter = await mAsset.balanceOf(sa.default.address)
                    expect(mUsdBalAfter, "Must mint 4 full units of mUSD").eq(mUsdBalBefore.add(simpleToExactAmount(4, 18)))
                })
                it("should mint using 2 bAssets", async () => {
                    const { bAssets, mAsset } = details
                    const approvals = await mAssetMachine.approveMassetMulti([bAssets[0], bAssets[2]], mAsset, 1, sa.default.signer)
                    await mAsset.mintMulti([bAssets[0].address, bAssets[2].address], approvals, 0, sa.default.address)
                })
            })
        })
        context("when the mAsset is undergoing re-collateralisation", () => {
            before(async () => {
                await runSetup(true)
            })
            it("should revert any mints", async () => {
                const { bAssets, mAsset } = details
                await assertBasketIsHealthy(mAssetMachine, details)
                const bAsset0 = bAssets[0]
                await mAsset.connect(sa.governor.signer).handlePegLoss(bAsset0.address, true)

                await mAssetMachine.approveMasset(bAsset0, mAsset, 2)
                await expect(mAsset.mintMulti([bAsset0.address], [1], 0, sa.default.address)).to.revertedWith("Unhealthy")
            })
        })
    })
})
