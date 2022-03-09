import { expect } from "chai"
import { Signer } from "ethers"
import { ethers } from "hardhat"

import { BN, simpleToExactAmount } from "@utils/math"
import { FeederDetails, FeederMachine, MassetMachine, StandardAccounts } from "@utils/machines"
import { ZERO_ADDRESS } from "@utils/constants"
import { RebasedFeederPool, MockERC20, MockUsdPlusToken } from "types/generated"
import { BassetStatus } from "@utils/mstable-objects"
import { assertBNClosePercent } from "@utils/assertions"
import { Account } from "types"

interface MintOutput {
    outputQuantity: BN
    senderBassetBalBefore: BN
    senderBassetBalAfter: BN
    recipientBalBefore: BN
    recipientBalAfter: BN
}

interface RedeemOutput {
    outputQuantity: BN
    senderBassetBalBefore: BN
    senderBassetBalAfter: BN
    recipientBalBefore: BN
    recipientBalAfter: BN
}

describe("RebasedFeederPool", () => {
    let sa: StandardAccounts
    let feederMachine: FeederMachine
    let details: FeederDetails

    const runSetup = async (
        feederWeights?: Array<BN | number>,
        mAssetWeights?: Array<BN | number>,
        useLendingMarkets = false,
        useInterestValidator = false,
        use2dp = false,
        useRedemptionPrice = false,
        useRebasedFeederPool = true,
    ): Promise<void> => {
        details = await feederMachine.deployFeeder(
            feederWeights,
            mAssetWeights,
            useLendingMarkets,
            useInterestValidator,
            use2dp,
            useRedemptionPrice,
            useRebasedFeederPool)
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        feederMachine = await new FeederMachine(mAssetMachine)
        sa = mAssetMachine.sa
    })

    const assertBasicMint = async (
        fd: FeederDetails,
        inputAsset: MockERC20 | MockUsdPlusToken,
        inputAssetQuantity: BN | number | string,
        outputQuantity: BN | number | string = 0,
        minOutputAssetQuantity: BN | number | string = 0,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        quantitiesAreExact = true,
    ): Promise<MintOutput> => {
        const pool = fd.pool.connect(sender.signer)

        // Get before balances
        const senderAssetBalBefore = await inputAsset.balanceOf(sender.address)
        const recipientBalBefore = await pool.balanceOf(recipient)
        const assetBefore = await feederMachine.getAsset(details, inputAsset.address)

        // Convert to exact quantities
        const assetQuantityExact = quantitiesAreExact
            ? BN.from(inputAssetQuantity)
            : simpleToExactAmount(inputAssetQuantity, await inputAsset.decimals())
        const minMassetQuantityExact = quantitiesAreExact
            ? BN.from(minOutputAssetQuantity)
            : simpleToExactAmount(minOutputAssetQuantity, 18)
        const outputQuantityExact = quantitiesAreExact ? BN.from(outputQuantity) : simpleToExactAmount(outputQuantity, 18)

        // mintOutput
        const mintOutput = await pool.getMintOutput(inputAsset.address, assetQuantityExact)
        expect(mintOutput, "mintOutput").to.eq(outputQuantityExact)

        await feederMachine.approveFeeder(inputAsset, pool.address, assetQuantityExact, sender.signer, true)

        // log before mint
        let inputAssetSymbol = await inputAsset.symbol()
        console.log(inputAssetSymbol + " to mint: " + inputAssetQuantity)
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // mint
        const tx = await pool.mint(inputAsset.address, assetQuantityExact, minMassetQuantityExact, recipient)

        // log after mint
        console.log("fpToken minted: " + mintOutput)
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // Recipient should have pool quantity after
        const recipientBalAfter = await pool.balanceOf(recipient)
        expect(recipientBalAfter, "recipient balance after").eq(recipientBalBefore.add(outputQuantityExact))
        // Sender should have less asset after
        const senderAssetBalAfter = await inputAsset.balanceOf(sender.address)
        expect(senderAssetBalAfter, "sender balance after").eq(senderAssetBalBefore.sub(assetQuantityExact))
        // VaultBalance should update for this asset
        const assetAfter = await feederMachine.getAsset(details, inputAsset.address)
        expect(BN.from(assetAfter.vaultBalance), "vault balance after").eq(BN.from(assetBefore.vaultBalance).add(assetQuantityExact))

        return {
            outputQuantity: outputQuantityExact,
            senderBassetBalBefore: senderAssetBalBefore,
            senderBassetBalAfter: senderAssetBalAfter,
            recipientBalBefore,
            recipientBalAfter,
        }
    }

    const assertMintMulti = async (
        fd: FeederDetails,
        inputAssets: Array<MockERC20 | MockUsdPlusToken>,
        inputAssetQuantities: Array<BN | number>,
        outputQuantity: BN | number | string = 0,
        minOutputQuantity: BN | number | string = 0,
        quantitiesAreExact = true,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
    ): Promise<void> => {
        const { pool: poolContract } = fd
        const pool = poolContract.connect(sender.signer)

        const inputAssetAddresses = inputAssets.map((asset) => (typeof asset === "string" ? asset : asset.address))
        const inputAssetDecimals = await Promise.all(inputAssets.map((asset) => asset.decimals()))

        // Convert to exact quantities
        const inputAssetQuantitiesExact = quantitiesAreExact
            ? inputAssetQuantities.map((q) => BN.from(q))
            : inputAssetQuantities.map((q, i) => simpleToExactAmount(q, inputAssetDecimals[i]))
        const minOutputQuantityExact = quantitiesAreExact ? BN.from(minOutputQuantity) : simpleToExactAmount(minOutputQuantity, 18)
        const outputQuantityExact = quantitiesAreExact ? BN.from(outputQuantity) : simpleToExactAmount(outputQuantity, 18)

        const senderAssetsBalBefore = await Promise.all(inputAssets.map((asset) => asset.balanceOf(sender.address)))
        const recipientBalBefore = await pool.balanceOf(recipient)
        const assetsBefore = await Promise.all(inputAssets.map((asset) => feederMachine.getAsset(details, asset.address)))

        await Promise.all(
            inputAssets.map((a, i) => feederMachine.approveFeeder(a, pool.address, inputAssetQuantitiesExact[i], sender.signer, true)),
        )

        // feederOutput
        const feederOutput = await pool.getMintMultiOutput(inputAssetAddresses, inputAssetQuantitiesExact)
        expect(feederOutput, "feederOutput").to.eq(outputQuantityExact)

        // log before mint
        for (let i = 0; i < inputAssets.length; i++) {
            let inputAssetSymbol = await inputAssets[i].symbol()
            console.log(inputAssetSymbol + " to mint: " + inputAssetQuantities[i])
        }
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // mintMulti
        const tx = await pool.mintMulti(inputAssetAddresses, inputAssetQuantitiesExact, minOutputQuantityExact, recipient)

        // log after mint
        console.log("fpToken minted: " + feederOutput)
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // Recipient should have mAsset quantity after
        const recipientBalAfter = await pool.balanceOf(recipient)
        expect(recipientBalAfter, "recipient balance after").eq(recipientBalBefore.add(outputQuantityExact))

        // Sender should have less asset balance after
        const senderAssetsBalAfter = await Promise.all(inputAssets.map((asset) => asset.balanceOf(sender.address)))
        senderAssetsBalAfter.map((asset, i) =>
            expect(asset, `sender ${i} balance after`).eq(senderAssetsBalBefore[i].sub(inputAssetQuantitiesExact[i])),
        )

        // VaultBalance should updated for this bAsset
        const assetsAfter = await Promise.all(inputAssets.map((asset) => feederMachine.getAsset(details, asset.address)))
        assetsAfter.forEach((assetAfter, i) => {
            expect(BN.from(assetAfter.vaultBalance), "vault balance after").eq(
                BN.from(assetsBefore[i].vaultBalance).add(inputAssetQuantitiesExact[i]),
            )
        })
    }

    const assertBasicRedeem = async (
        fd: FeederDetails,
        outputAsset: MockERC20 | MockUsdPlusToken,
        fpTokenQuantity: BN | number | string = simpleToExactAmount(1),
        outputQuantityExpected: BN | number | string = 0,
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

        // redeemOutput
        const redeemOutput = await pool.getRedeemOutput(outputAsset.address, fpTokenQuantityExact)
        expect(redeemOutput, "redeemOutput").to.eq(outputQuantityExpectedExact)

        // log before redeem
        console.log("fpToken to burn: " + fpTokenQuantity)
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // redeem
        const tx = await pool.redeem(outputAsset.address, fpTokenQuantityExact, minOutputQuantityExact, recipient)

        // log after redeem
        let outputAssetSymbol = await outputAsset.symbol()
        console.log(outputAssetSymbol + " redeemed: " + redeemOutput)
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // Recipient should have redeemed asset after
        const recipientBalAfter = await outputAsset.balanceOf(recipient)
        expect(recipientBalAfter, "recipient balance after").eq(recipientBalBefore.add(redeemOutput))

        // Sender should have less asset after
        const senderFpTokenBalAfter = await pool.balanceOf(sender.address)
        expect(senderFpTokenBalAfter, "sender balance after").eq(senderFpTokenBalBefore.sub(fpTokenQuantityExact))

        // VaultBalance should update for this asset
        const assetAfter = await feederMachine.getAsset(details, outputAsset.address)
        expect(BN.from(assetAfter.vaultBalance), "vault balance after").eq(BN.from(assetBefore.vaultBalance).sub(redeemOutput))

        return {
            outputQuantity: redeemOutput,
            senderBassetBalBefore: senderFpTokenBalBefore,
            senderBassetBalAfter: senderFpTokenBalAfter,
            recipientBalBefore,
            recipientBalAfter,
        }
    }

    const assertRedeemExact = async (
        fd: FeederDetails,
        outputAssets: Array<MockERC20 | MockUsdPlusToken>,
        outputQuantities: Array<BN | number>,
        inputQuantityExpected: BN | number | string = 0,
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

        // redeemExactBassetsOutput
        const redeemExactBassetsOutput = await pool.getRedeemExactBassetsOutput(outputAssetAddresses, outputQuantitiesExact)
        expect(redeemExactBassetsOutput, "redeemExactBassetsOutput").to.eq(inputQuantityExpectedExact)

        // log before redeem
        for (let i = 0; i < outputAssets.length; i++) {
            let outputAssetSymbol = await outputAssets[i].symbol()
            console.log(outputAssetSymbol + " to redeem: " + outputQuantities[i])
        }
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // redeemExactBassets
        const tx = await pool.redeemExactBassets(outputAssetAddresses, outputQuantitiesExact, maxFpTokenQuantityExact, recipient)

        // log after redeem
        console.log("fpToken burned: " + redeemExactBassetsOutput)
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

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

        // log before redeem
        console.log("fpToken to burn: " + fpTokenQuantity)
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // redeemProportionately
        const tx = pool.redeemProportionately(fpTokenQuantityExact, minOutputQuantitiesExact, recipient)
        const receipt = await (await tx).wait()
        const redeemEvent = receipt.events.find((event) => event.event === "RedeemedMulti" && event.address === pool.address)

        // outputQuantitiesExpected
        redeemEvent.args.outputQuantity.forEach((qty, i) => {
            expect(qty, `outputQuantity at index ${i} in RedeemedMulti event`).to.eq(outputQuantitiesExpectedExact[i])
        })

        // log after redeem
        for (let i = 0; i < redeemEvent.args.outputs.length; i++) {
            for (let j = 0; j < details.bAssets.length; j++) {
                if (details.bAssets[j].address === redeemEvent.args.outputs[i]) {
                    let bAssetSymbol = await details.bAssets[j].symbol()
                    console.log(bAssetSymbol + " redeemed: " + redeemEvent.args.outputQuantity[i])
                    break
                }
            }
        }
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

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

    const assertSwap = async (
        fd: FeederDetails,
        inputAsset: MockERC20 | MockUsdPlusToken,
        outputAsset: MockERC20 | MockUsdPlusToken,
        inputQuantity: BN | number | string,
        outputExpected: BN | number | string = 0,
        minOutputQuantity: BN | number | string = 0,
        quantitiesAreExact = true,
        recipient: string = sa.default.address,
        sender: Account = sa.default,
        skipEmits = false,
        looseAmounts = false,
    ): Promise<BN> => {
        const pool = fd.pool.connect(sender.signer)

        const inputAssetDecimals = await inputAsset.decimals()
        const inputQuantityExact = quantitiesAreExact ? BN.from(inputQuantity) : simpleToExactAmount(inputQuantity, inputAssetDecimals)
        const outputDecimals = await outputAsset.decimals()
        const outputExpectedExact = quantitiesAreExact ? BN.from(outputExpected) : simpleToExactAmount(outputExpected, outputDecimals)
        const minOutputQuantityExact = quantitiesAreExact
            ? BN.from(minOutputQuantity)
            : simpleToExactAmount(minOutputQuantity, outputDecimals)

        // Get basic before data about the actors balances
        const swapperInputBalBefore = await inputAsset.balanceOf(sender.address)
        const recipientOutputBalBefore = await outputAsset.balanceOf(recipient)

        // Get basic before data on the swap assets
        const inputAssetBefore = await feederMachine.getAsset(details, inputAsset.address)
        const outputAssetBefore = await feederMachine.getAsset(details, outputAsset.address)

        // Do the necessary approvals and make the calls
        await feederMachine.approveFeeder(inputAsset, pool.address, inputQuantityExact, sender.signer, true)

        // Call the swap output function to check if results match
        const swapOutput = await pool.getSwapOutput(inputAsset.address, outputAsset.address, inputQuantityExact)
        if (looseAmounts) {
            assertBNClosePercent(swapOutput, outputExpectedExact, "0.1")
        } else {
            expect(swapOutput, "swap output").to.eq(outputExpectedExact)
        }

        // log before swap
        let inputAssetSymbol = await inputAsset.symbol()
        console.log(inputAssetSymbol + " to swap: " + inputQuantity)
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // swap
        const swapTx = await pool.swap(inputAsset.address, outputAsset.address, inputQuantityExact, minOutputQuantityExact, recipient)

        // log after swap
        let outputAssetSymbol = await outputAsset.symbol()
        console.log(outputAssetSymbol + " swaped: " + swapOutput)
        for (let i = 0; i < details.bAssets.length; i++) {
            let bAssetSymbol = await details.bAssets[i].symbol()
            let bAssetData = await feederMachine.getAsset(details, details.bAssets[i].address)
            console.log(bAssetSymbol + " in pool: " + bAssetData.vaultBalance)
        }

        // Sender should have less input bAsset after
        const swapperAssetBalAfter = await inputAsset.balanceOf(sender.address)
        expect(swapperAssetBalAfter, "swapper input asset balance after").eq(swapperInputBalBefore.sub(inputQuantityExact))

        // VaultBalance should update for input asset
        const inputAssetAfter = await feederMachine.getAsset(details, inputAsset.address)
        expect(BN.from(inputAssetAfter.vaultBalance), "input asset balance after").eq(
            BN.from(inputAssetBefore.vaultBalance).add(inputQuantityExact),
        )

        // Recipient should have output asset quantity after (minus fee)
        const recipientBalAfter = await outputAsset.balanceOf(recipient)
        expect(recipientBalAfter, "recipientBalAfter").eq(recipientOutputBalBefore.add(swapOutput))

        // Swap estimation should match up
        expect(swapOutput, "expectedOutputValue").eq(recipientBalAfter.sub(recipientOutputBalBefore))

        // VaultBalance should update for output asset
        const outputAssetAfter = await feederMachine.getAsset(details, outputAsset.address)
        expect(BN.from(outputAssetAfter.vaultBalance), "output asset after").eq(BN.from(outputAssetBefore.vaultBalance).sub(swapOutput))

        return swapOutput
    }

    describe("mint", () => {
        context("when pool balance 200 mUSD / 200 USD+ and total 400 fpTokens", () => {
            beforeEach(async () => {
                await runSetup()
            })
            it("mint 10 mUSD with liquidityIndex = 1", async () => {
                await assertBasicMint(details, details.mAsset, simpleToExactAmount(10), "9999191898481404962")
            })
            it("mint 10 mUSD with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertBasicMint(details, details.mAsset, simpleToExactAmount(10), "6690285423924506647")
            })
            it("mint 10 mUSD with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertBasicMint(details, details.mAsset, simpleToExactAmount(10), "13307299273443568912")
            })
            it("mint 10 USD+ with liquidityIndex = 1", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await assertBasicMint(details, fAsset, simpleToExactAmount(10, 6), "9999191898481404962")
            })
            it("mint 10 USD+ with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertBasicMint(details, fAsset, simpleToExactAmount(10, 6), "6653956398612562325")
            })
            it("mint 10 USD+ with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertBasicMint(details, fAsset, simpleToExactAmount(10, 6), "13378390682822164613")
            })
        })
    })

    describe("mint multi", () => {
        context("when pool balance 200 mUSD / 200 USD+ and total 400 fpTokens", () => {
            beforeEach(async () => {
                await runSetup()
            })
            it("mint multi 10 mUSD with liquidityIndex = 1", async () => {
                await assertMintMulti(details, [details.mAsset], [simpleToExactAmount(10)], "9999191898481404962")
            })
            it("mint multi 10 mUSD with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertMintMulti(details, [details.mAsset], [simpleToExactAmount(10)], "6690285423924506647")
            })
            it("mint multi 10 mUSD with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertMintMulti(details, [details.mAsset], [simpleToExactAmount(10)], "13307299273443568912")
            })
            it("mint multi 10 USD+ with liquidityIndex = 1", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await assertMintMulti(details, [details.fAsset], [simpleToExactAmount(10, 6)], "9999191898481404962")
            })
            it("mint multi 10 USD+ with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertMintMulti(details, [details.fAsset], [simpleToExactAmount(10, 6)], "6653956398612562325")
            })
            it("mint multi 10 USD+ with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertMintMulti(details, [details.fAsset], [simpleToExactAmount(10, 6)], "13378390682822164613")
            })
            it("mint multi 10 mUSD and 10 USD+ with liquidityIndex = 1", async () => {
                await assertMintMulti(details, details.bAssets, [simpleToExactAmount(10), simpleToExactAmount(10, 6)], "20000000000000000000")
            })
            it("mint multi 10 mUSD and 10 USD+ with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertMintMulti(details, details.bAssets, [simpleToExactAmount(10), simpleToExactAmount(10, 6)], "13345439813678363339")
            })
            it("mint multi 10 mUSD and 10 USD+ with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertMintMulti(details, details.bAssets, [simpleToExactAmount(10), simpleToExactAmount(10, 6)], "26690339591781671112")
            })
        })
    })

    describe("redeem", () => {
        context("when pool balance 200 mUSD / 200 USD+ and total 400 fpTokens", () => {
            beforeEach(async () => {
                await runSetup()
            })
            it("redeem mUSD and burn 10 fpTokens with liquidityIndex = 1", async () => {
                const mAsset = details.mAsset
                await assertBasicRedeem(details, mAsset, simpleToExactAmount(10), "9995151239333269451")
            })
            it("redeem mUSD and burn 10 fpTokens with liquidityIndex = 2", async () => {
                const mAsset = details.mAsset
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertBasicRedeem(details, mAsset, simpleToExactAmount(10), "14934003010652487732")
            })
            it("redeem mUSD and burn 10 fpTokens with liquidityIndex = 0.5", async () => {
                const mAsset = details.mAsset
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertBasicRedeem(details, mAsset, simpleToExactAmount(10), "7510445816583173777")
            })
            it("redeem USD+ and burn 10 fpTokens with liquidityIndex = 1", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await assertBasicRedeem(details, fAsset, simpleToExactAmount(10), "9995151")
            })
            it("redeem USD+ and burn 10 fpTokens with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertBasicRedeem(details, fAsset, simpleToExactAmount(10), "15020891")
            })
            it("redeem USD+ and burn 10 fpTokens with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertBasicRedeem(details, fAsset, simpleToExactAmount(10), "7467001")
            })
        })
    })

    describe("redeem exact", () => {
        context("when pool balance 200 mUSD / 200 USD+ and total 400 fpTokens", () => {
            beforeEach(async () => {
                await runSetup()
            })
            it("redeem exact 10 mUSD with liquidityIndex = 1", async () => {
                await assertRedeemExact(details, [details.mAsset], [simpleToExactAmount(10)], "10004851536082418618")
            })
            it("redeem exact 10 mUSD with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertRedeemExact(details, [details.mAsset], [simpleToExactAmount(10)], "6695443302559607199")
            })
            it("redeem exact 10 mUSD with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertRedeemExact(details, [details.mAsset], [simpleToExactAmount(10)], "13315100236244624333")
            })
            it("redeem exact 10 USD+ with liquidityIndex = 1", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await assertRedeemExact(details, [details.fAsset], [simpleToExactAmount(10, 6)], "10004851536082418618")
            })
            it("redeem exact 10 USD+ with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertRedeemExact(details, [details.fAsset], [simpleToExactAmount(10, 6)], "6657237894521283974")
            })
            it("redeem exact 10 USD+ with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertRedeemExact(details, [details.fAsset], [simpleToExactAmount(10, 6)], "13393733293503224353")
            })
            it("redeem exact 10 mUSD and 10 USD+ with liquidityIndex = 1", async () => {
                await assertRedeemExact(details, details.bAssets, [simpleToExactAmount(10), simpleToExactAmount(10, 6)], "20008003201280512205")
            })
            it("redeem exact 10 mUSD and 10 USD+ with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertRedeemExact(details, details.bAssets, [simpleToExactAmount(10), simpleToExactAmount(10, 6)], "13351400347028192872")
            })
            it("redeem exact 10 mUSD and 10 USD+ with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertRedeemExact(details, details.bAssets, [simpleToExactAmount(10), simpleToExactAmount(10, 6)], "26703518046865555724")
            })
        })
    })

    describe("redeem proportionately", () => {
        context("when pool balance 200 mUSD / 200 USD+ and total 400 fpTokens", () => {
            beforeEach(async () => {
                await runSetup()
            })
            it("redeem proportionately mUSD and USD+ and burn 10 fpTokens with liquidityIndex = 1", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await assertRedeemProportionately(details, simpleToExactAmount(10), ["4997999999999999998", "4997998"])
            })
            it("redeem proportionately mUSD and USD+ and burn 10 fpTokens with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertRedeemProportionately(details, simpleToExactAmount(10), ["4997999999999999998", "9995998"])
            })
            it("redeem proportionately mUSD and USD+ and burn 10 fpTokens with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertRedeemProportionately(details, simpleToExactAmount(10), ["4997999999999999998", "2498998"])
            })
        })
    })

    describe("swap", () => {
        context("when pool balance 200 mUSD / 200 USD+ and total 400 fpTokens", () => {
            before(async () => {
                await runSetup()
            })
            it("swap 10 mUSD on USD+ with liquidityIndex = 1", async () => {
                const mAsset = details.mAsset
                const fAsset = details.fAsset as MockUsdPlusToken
                await assertSwap(details, mAsset, fAsset, simpleToExactAmount(10), "9992683")
            })
            it("swap 10 mUSD on USD+ with liquidityIndex = 2", async () => {
                const mAsset = details.mAsset
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertSwap(details, mAsset, fAsset, simpleToExactAmount(10), "10037890")
            })
            it("swap 10 mUSD on USD+ with liquidityIndex = 0.5", async () => {
                const mAsset = details.mAsset
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertSwap(details, mAsset, fAsset, simpleToExactAmount(10), "9906949")
            })
            it("swap 10 USD+ on mUSD with liquidityIndex = 1", async () => {
                const mAsset = details.mAsset
                const fAsset = details.fAsset as MockUsdPlusToken
                await assertSwap(details, fAsset, mAsset, simpleToExactAmount(10, 6), "10089774252770818641")
            })
            it("swap 10 USD+ on mUSD with liquidityIndex = 2", async () => {
                const mAsset = details.mAsset
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertSwap(details, fAsset, mAsset, simpleToExactAmount(10, 6), "9958149768068475268")
            })
            it("swap 10 USD+ on mUSD with liquidityIndex = 0.5", async () => {
                const mAsset = details.mAsset
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertSwap(details, fAsset, mAsset, simpleToExactAmount(10, 6), "10058754309806194155")
            })
        })
    })
})
