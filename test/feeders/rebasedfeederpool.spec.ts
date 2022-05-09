import { expect } from "chai"
import { ethers } from "hardhat"
import { BN, simpleToExactAmount } from "@utils/math"
import { FeederDetails, FeederMachine, MassetMachine, StandardAccounts } from "@utils/machines"
import { MAX_UINT256, ONE_DAY, ONE_HOUR, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { getTimestamp, increaseTime } from "@utils/time"
import { BassetStatus } from "@utils/mstable-objects"
import { assertBNClose, assertBNClosePercent } from "@utils/assertions"
import { Account } from "types"
import { RebasedFeederPool, MockUsdPlusToken, MockERC20 } from "types/generated"

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

// Check example of some protection against `Exceeds weight limits`
// test/feeders/mint.spec.ts#513   ,   // mAsset is now over 80% and mint should fail
describe("RebasedFeederPool", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let feederMachine: FeederMachine
    let details: FeederDetails

    const runSetup = async (
        feederWeights: Array<BN | number> = [200, 200],
        mAssetWeights: Array<BN | number> = [2500, 2500, 2500, 2500],
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
            useRebasedFeederPool,
        )
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
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
        const priceBefore = await fd.pool.getPrice()
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

        // mint
        await pool.mint(inputAsset.address, assetQuantityExact, minMassetQuantityExact, recipient)

        // Recipient should have pool quantity after
        const recipientBalAfter = await pool.balanceOf(recipient)
        expect(recipientBalAfter, "recipient balance after").eq(recipientBalBefore.add(outputQuantityExact))
        // Sender should have less asset after
        const senderAssetBalAfter = await inputAsset.balanceOf(sender.address)
        expect(senderAssetBalAfter, "sender balance after").eq(senderAssetBalBefore.sub(assetQuantityExact))
        // VaultBalance should update for this asset
        const assetAfter = await feederMachine.getAsset(details, inputAsset.address)
        expect(BN.from(assetAfter.vaultBalance), "vault balance after").eq(BN.from(assetBefore.vaultBalance).add(assetQuantityExact))
        const priceAfter = await fd.pool.getPrice()

        console.log("priceBefore", priceBefore.toString(), "priceAfter", priceAfter.toString())

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

        // mintMulti
        const tx = await pool.mintMulti(inputAssetAddresses, inputAssetQuantitiesExact, minOutputQuantityExact, recipient)

        // Recipient should have mAsset quantity after
        const recipientBalAfter = await pool.balanceOf(recipient)
        expect(recipientBalAfter, "recipient balance after").eq(recipientBalBefore.add(outputQuantityExact))

        // Sender should have less asset balance after
        const senderAssetsBalAfter = await Promise.all(inputAssets.map((asset) => asset.balanceOf(sender.address)))
        senderAssetsBalAfter.forEach((asset, i) =>
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

        // redeem
        const tx = await pool.redeem(outputAsset.address, fpTokenQuantityExact, minOutputQuantityExact, recipient)

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

        // redeemExactBassets
        const tx = await pool.redeemExactBassets(outputAssetAddresses, outputQuantitiesExact, maxFpTokenQuantityExact, recipient)

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

        // redeemProportionately
        const tx = pool.redeemProportionately(fpTokenQuantityExact, minOutputQuantitiesExact, recipient)
        const receipt = await (await tx).wait()
        const redeemEvent = receipt.events.find((event) => event.event === "RedeemedMulti" && event.address === pool.address)

        // outputQuantitiesExpected
        redeemEvent.args.outputQuantity.forEach((qty, i) => {
            expect(qty, `outputQuantity at index ${i} in RedeemedMulti event`).to.eq(outputQuantitiesExpectedExact[i])
        })

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

        // swap
        const swapTx = await pool.swap(inputAsset.address, outputAsset.address, inputQuantityExact, minOutputQuantityExact, recipient)

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
            it("example of push price up, TODO add validations/ protection ", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(1, 27))
                // await assertBasicMint(details, fAsset, simpleToExactAmount(200, 6), "266850499004204775857")
                let poolBalance = await fAsset.balanceOf(details.pool.address)
                let defaultBalance = await fAsset.balanceOf(sa.default.address)
                
                console.log("poolBalance", poolBalance.toString(), "defaultBalance", defaultBalance.toString(), (await details.pool.getPrice()).toString())
                // 300000000
                // await fAsset.connect(sa.default.signer).allowance(sa.default.address, details.pool.address)
                await fAsset.connect(sa.default.signer).approve(details.pool.address, simpleToExactAmount(4000000, 6))
                // const allowance = await fAsset.connect(sa.default.signer).allowance(sa.default.address, details.pool.address)
                // console.log("allowance", allowance.toString())
                await fAsset.connect(sa.default.signer).transfer(details.pool.address, simpleToExactAmount(3000, 6))
                 poolBalance = await fAsset.balanceOf(details.pool.address)
                 defaultBalance = await fAsset.balanceOf(sa.default.address)
                console.log("poolBalance", poolBalance.toString(), "defaultBalance", defaultBalance.toString(), (await details.pool.getPrice()).toString())
                // await assertBasicMint(details, fAsset, simpleToExactAmount(200, 6), "166083124016421483524")              
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
                await assertMintMulti(
                    details,
                    details.bAssets,
                    [simpleToExactAmount(10), simpleToExactAmount(10, 6)],
                    "20000000000000000000",
                )
            })
            it("mint multi 10 mUSD and 10 USD+ with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertMintMulti(
                    details,
                    details.bAssets,
                    [simpleToExactAmount(10), simpleToExactAmount(10, 6)],
                    "13345439813678363339",
                )
            })
            it("mint multi 10 mUSD and 10 USD+ with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertMintMulti(
                    details,
                    details.bAssets,
                    [simpleToExactAmount(10), simpleToExactAmount(10, 6)],
                    "26690339591781671112",
                )
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
                await assertRedeemExact(
                    details,
                    details.bAssets,
                    [simpleToExactAmount(10), simpleToExactAmount(10, 6)],
                    "20008003201280512205",
                )
            })
            it("redeem exact 10 mUSD and 10 USD+ with liquidityIndex = 2", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(2, 27))
                await assertRedeemExact(
                    details,
                    details.bAssets,
                    [simpleToExactAmount(10), simpleToExactAmount(10, 6)],
                    "13351400347028192872",
                )
            })
            it("redeem exact 10 mUSD and 10 USD+ with liquidityIndex = 0.5", async () => {
                const fAsset = details.fAsset as MockUsdPlusToken
                await fAsset.setLiquidityIndex(simpleToExactAmount(5, 26))
                await assertRedeemExact(
                    details,
                    details.bAssets,
                    [simpleToExactAmount(10), simpleToExactAmount(10, 6)],
                    "26703518046865555724",
                )
            })
        })
    })

    describe("redeem proportionately", () => {
        context("when pool balance 200 mUSD / 200 USD+ and total 400 fpTokens", () => {
            beforeEach(async () => {
                await runSetup()
            })
            it("redeem proportionately mUSD and USD+ and burn 10 fpTokens with liquidityIndex = 1", async () => {
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

    describe("using basic setters", async () => {
        const newSize = simpleToExactAmount(1, 16) // 1%
        let pool: RebasedFeederPool
        before("set up", async () => {
            await runSetup()
            pool = details.pool.connect(sa.governor.signer) as RebasedFeederPool
        })
        describe("should allow changing of the cache size to ", () => {
            it("zero", async () => {
                const tx = pool.setCacheSize(0)
                await expect(tx).to.emit(pool, "CacheSizeChanged").withArgs(0)
                const { cacheSize } = await pool.data()
                expect(cacheSize).eq(0)
            })
            it("1%", async () => {
                const { cacheSize: oldSize } = await pool.data()
                expect(oldSize).not.eq(newSize)
                const tx = pool.setCacheSize(newSize)
                await expect(tx).to.emit(pool, "CacheSizeChanged").withArgs(newSize)
                const { cacheSize } = await pool.data()
                expect(cacheSize).eq(newSize)
            })
            it("20% (cap limit)", async () => {
                const capLimit = simpleToExactAmount(20, 16) // 20%
                const tx = pool.setCacheSize(capLimit)
                await expect(tx).to.emit(pool, "CacheSizeChanged").withArgs(capLimit)
                const { cacheSize } = await pool.data()
                expect(cacheSize).eq(capLimit)
            })
        })
        describe("should fail changing the cache size if", () => {
            it("not governor", async () => {
                await expect(details.pool.connect(sa.default.signer).setCacheSize(newSize)).to.be.revertedWith("Only governor can execute")
                await expect(details.pool.connect(sa.dummy1.signer).setCacheSize(newSize)).to.be.revertedWith("Only governor can execute")
            })
            it("just over cap", async () => {
                const feeExceedingCap = BN.from("200000000000000001")
                await expect(pool.setCacheSize(feeExceedingCap)).to.be.revertedWith("Must be <= 20%")
            })
            it("exceed cap by 1%", async () => {
                const feeExceedingCap = simpleToExactAmount(21, 16) // 21%
                await expect(pool.setCacheSize(feeExceedingCap)).to.be.revertedWith("Must be <= 20%")
            })
            it("exceeding cap with max number", async () => {
                await expect(pool.setCacheSize(MAX_UINT256)).to.be.revertedWith("Must be <= 20%")
            })
        })
        describe("should change swap and redemption fees to", () => {
            it("0.5% and 0.25%", async () => {
                const poolData = await pool.data()
                const newSwapFee = simpleToExactAmount(0.5, 16)
                const newRedemptionFee = simpleToExactAmount(0.25, 16)
                const newGovFee = simpleToExactAmount(2, 17)
                expect(poolData.swapFee).not.eq(newSwapFee)
                expect(poolData.redemptionFee).not.eq(newRedemptionFee)
                expect(poolData.govFee).not.eq(newGovFee)
                const tx = pool.setFees(newSwapFee, newRedemptionFee, newGovFee)
                await expect(tx).to.emit(pool, "FeesChanged").withArgs(newSwapFee, newRedemptionFee, newGovFee)
                const { swapFee, redemptionFee, govFee } = await pool.data()
                expect(swapFee).eq(newSwapFee)
                expect(redemptionFee).eq(newRedemptionFee)
                expect(govFee).eq(newGovFee)
            })
            it("1% (limit)", async () => {
                const newFee = simpleToExactAmount(1, 16)
                const tx = pool.setFees(newFee, newFee, newFee)
                await expect(tx).to.emit(pool, "FeesChanged").withArgs(newFee, newFee, newFee)
                const { swapFee, redemptionFee } = await pool.data()
                expect(swapFee).eq(newFee)
                expect(redemptionFee).eq(newFee)
            })
            it("50% limit for gov fee", async () => {
                const newFee = simpleToExactAmount(1, 15)
                const newGovFee = simpleToExactAmount(5, 17)
                const tx = pool.setFees(newFee, newFee, newGovFee)
                await expect(tx).to.emit(pool, "FeesChanged").withArgs(newFee, newFee, newGovFee)
                const { swapFee, redemptionFee, govFee } = await pool.data()
                expect(swapFee).eq(newFee)
                expect(redemptionFee).eq(newFee)
                expect(govFee).eq(newGovFee)
            })
        })
        describe("should fail to change swap fee rate when", () => {
            const cap = "10000000000000000"
            const overCap = "10000000000000001"
            const overGovCap = "500000000000000001"
            it("not governor", async () => {
                const fee = simpleToExactAmount(2, 16)
                await expect(details.pool.setFees(fee, fee, fee)).to.be.revertedWith("Only governor can execute")
            })
            it("Swap rate just exceeds 1% cap", async () => {
                await expect(pool.setFees(overCap, cap, cap)).to.be.revertedWith("Swap rate oob")
            })
            it("Redemption rate just exceeds 1% cap", async () => {
                await expect(pool.setFees(cap, overCap, cap)).to.be.revertedWith("Redemption rate oob")
            })
            it("Gov rate just exceeds 50% cap", async () => {
                await expect(pool.setFees(cap, cap, overGovCap)).to.be.revertedWith("Gov fee rate oob")
            })
            it("2% rate exceeds 1% cap", async () => {
                const fee = simpleToExactAmount(2, 16) // 2%
                await expect(pool.setFees(fee, fee, cap)).to.be.revertedWith("Swap rate oob")
            })
            it("max rate", async () => {
                const fee = MAX_UINT256
                await expect(pool.setFees(fee, fee, fee)).to.be.revertedWith("Swap rate oob")
            })
        })
        it("should set weights", async () => {
            let poolData = await pool.data()
            const beforeWeightLimits = poolData.weightLimits
            const newMinWeight = simpleToExactAmount(30, 16)
            const newMaxWeight = simpleToExactAmount(70, 16)
            const tx = pool.setWeightLimits(newMinWeight, newMaxWeight)
            await expect(tx, "WeightLimitsChanged event").to.emit(pool, "WeightLimitsChanged").withArgs(newMinWeight, newMaxWeight)
            await tx
            poolData = await pool.data()
            const afterWeightLimits = poolData.weightLimits
            expect(afterWeightLimits.min, "before and after min weight not equal").not.to.eq(beforeWeightLimits.min)
            expect(afterWeightLimits.max, "before and after max weight not equal").not.to.eq(beforeWeightLimits.max)
            expect(afterWeightLimits.min, "min weight set").to.eq(newMinWeight)
            expect(afterWeightLimits.max, "max weight set").to.eq(newMaxWeight)
        })
        describe("failed set max weight", () => {
            const newMinWeight = simpleToExactAmount(1, 16)
            const newMaxWeight = simpleToExactAmount(620, 15)
            it("should fail setWeightLimits with default signer", async () => {
                await expect(pool.connect(sa.default.signer).setWeightLimits(newMinWeight, newMaxWeight)).to.revertedWith(
                    "Only governor can execute",
                )
            })
            it("should fail setWeightLimits with dummy signer", async () => {
                await expect(pool.connect(sa.dummy1.signer).setWeightLimits(newMinWeight, newMaxWeight)).to.revertedWith(
                    "Only governor can execute",
                )
            })
            it("should fail setWeightLimits with max weight too small", async () => {
                await expect(pool.setWeightLimits(newMinWeight, simpleToExactAmount(699, 15))).to.revertedWith("Weights oob")
            })
            it("should fail setWeightLimits with min weight too large", async () => {
                await expect(pool.setWeightLimits(simpleToExactAmount(299, 15), newMaxWeight)).to.revertedWith("Weights oob")
            })
        })
    })
    context.skip("getters without setters", () => {
        before("init basset", async () => {
            await runSetup()
        })
        it("get config", async () => {
            const { pool } = details
            const config = await pool.getConfig()
            expect(config.limits.min, "minWeight").to.eq(simpleToExactAmount(20, 16))
            expect(config.limits.max, "maxWeight").to.eq(simpleToExactAmount(80, 16))
            expect(config.a, "a value").to.eq(30000)
        })
        it("should get mStable asset", async () => {
            const { pool, mAsset } = details
            const asset = await pool.getBasset(mAsset.address)
            expect(asset.personal.addr, "personal.addr").to.eq(mAsset.address)
            expect(asset.personal.hasTxFee, "personal.hasTxFee").to.equal(false)
            expect(asset.personal.integrator, "personal.integrator").to.eq(ZERO_ADDRESS)
            expect(asset.personal.status, "personal.status").to.eq(BassetStatus.Normal)
            expect(asset.vaultData.ratio).to.eq(simpleToExactAmount(1, 8)) // 26 - 18
            expect(asset.vaultData.vaultBalance, "vaultData.vaultBalance").to.gt(0)
        })
        it("should get feeder asset", async () => {
            const { pool, fAsset } = details
            const asset = await pool.getBasset(fAsset.address)
            expect(asset.personal.addr, "personal.addr").to.eq(fAsset.address)
            expect(asset.personal.hasTxFee, "personal.hasTxFee").to.equal(false)
            expect(asset.personal.integrator, "personal.integrator").to.eq(ZERO_ADDRESS)
            expect(asset.personal.status, "personal.status").to.eq(BassetStatus.Normal)
            expect(asset.vaultData.ratio).to.eq(simpleToExactAmount(100)) // 26 - 18
            expect(asset.vaultData.vaultBalance, "vaultData.vaultBalance").to.gt(0)
        })
        it("should fail to get bAsset with address 0x0", async () => {
            await expect(details.pool.getBasset(ZERO_ADDRESS)).to.revertedWith("Invalid asset")
        })
        it("should fail to get bAsset not in basket", async () => {
            await expect(details.pool.getBasset(sa.dummy1.address)).to.revertedWith("Invalid asset")
        })
    })
    describe("Amplification coefficient", () => {
        before(async () => {
            await runSetup()
        })
        it("should succeed in starting increase over 2 weeks", async () => {
            const pool = details.pool.connect(sa.governor.signer)
            const { ampData: ampDataBefore } = await pool.data()

            // default values
            expect(ampDataBefore.initialA, "before initialA").to.eq(30000)
            expect(ampDataBefore.targetA, "before targetA").to.eq(30000)
            expect(ampDataBefore.rampStartTime, "before rampStartTime").to.eq(0)
            expect(ampDataBefore.rampEndTime, "before rampEndTime").to.eq(0)

            const startTime = await getTimestamp()
            const endTime = startTime.add(ONE_WEEK.mul(2))
            const tx = pool.startRampA(400, endTime)
            await expect(tx).to.emit(pool, "StartRampA").withArgs(30000, 40000, startTime.add(1), endTime)

            // after values
            const { ampData: ampDataAfter } = await pool.data()
            expect(ampDataAfter.initialA, "after initialA").to.eq(30000)
            expect(ampDataAfter.targetA, "after targetA").to.eq(40000)
            expect(ampDataAfter.rampStartTime, "after rampStartTime").to.eq(startTime.add(1))
            expect(ampDataAfter.rampEndTime, "after rampEndTime").to.eq(endTime)
        })
        context("increasing A by 20 over 10 day period", () => {
            let startTime: BN
            let endTime: BN
            let pool: RebasedFeederPool
            before(async () => {
                await runSetup()
                pool = details.pool.connect(sa.governor.signer) as RebasedFeederPool
                startTime = await getTimestamp()
                endTime = startTime.add(ONE_DAY.mul(10))
                await pool.startRampA(400, endTime)
            })
            it("should succeed getting A just after start", async () => {
                const config = await pool.getConfig()
                expect(config.a).to.eq(30000)
            })
            const testsData = [
                {
                    // 60 * 60 * 24 * 10 / 2000 = 432
                    desc: "just under before increment",
                    elapsedSeconds: 61,
                    expectedValue: 30000,
                },
                {
                    desc: "just under after increment",
                    elapsedSeconds: 434,
                    expectedValue: 30005,
                },
                {
                    desc: "after 1 day",
                    elapsedSeconds: ONE_DAY.add(1),
                    expectedValue: 31000,
                },
                {
                    desc: "after 9 days",
                    elapsedSeconds: ONE_DAY.mul(9).add(1),
                    expectedValue: 39000,
                },
                {
                    desc: "just under 10 days",
                    elapsedSeconds: ONE_DAY.mul(10).sub(2),
                    expectedValue: 39999,
                },
                {
                    desc: "after 10 days",
                    elapsedSeconds: ONE_DAY.mul(10),
                    expectedValue: 40000,
                },
                {
                    desc: "after 11 days",
                    elapsedSeconds: ONE_DAY.mul(11),
                    expectedValue: 40000,
                },
            ]
            testsData.forEach((testData) => {
                it(`should succeed getting A ${testData.desc}`, async () => {
                    const currentTime = await getTimestamp()
                    const incrementSeconds = startTime.add(testData.elapsedSeconds).sub(currentTime)
                    await increaseTime(incrementSeconds)
                    const config = await pool.getConfig()
                    assertBNClose(config.a, BN.from(testData.expectedValue), 20)
                })
            })
        })
        context("A target changes just in range", () => {
            let currentA: BN
            let startTime: BN
            let endTime: BN
            beforeEach(async () => {
                await runSetup()
                const config = await details.pool.getConfig()
                currentA = config.a
                startTime = await getTimestamp()
                endTime = startTime.add(ONE_DAY.mul(7))
            })
            it("should increase target A 10x", async () => {
                const { pool } = details
                const { ampData: ampDataBefore } = await details.pool.data()
                expect(ampDataBefore.initialA, "before initialA").to.eq(currentA)
                expect(ampDataBefore.targetA, "before targetA").to.eq(currentA)

                const targetA = currentA.mul(10).div(100)
                const tx = details.pool.connect(sa.governor.signer).startRampA(targetA, endTime)
                await expect(tx).to.emit(pool, "StartRampA")

                const { ampData: ampDataAfter } = await details.pool.data()
                expect(ampDataAfter.initialA, "after initialA").to.eq(currentA)
                expect(ampDataAfter.targetA, "after targetA").to.eq(currentA.mul(10))
            })
            it("should decrease target A 10x", async () => {
                const { pool } = details
                const { ampData: ampDataBefore } = await details.pool.data()
                expect(ampDataBefore.initialA, "before initialA").to.eq(currentA)
                expect(ampDataBefore.targetA, "before targetA").to.eq(currentA)

                const targetA = currentA.div(10).div(100)
                const tx = details.pool.connect(sa.governor.signer).startRampA(targetA, endTime)
                await expect(tx).to.emit(pool, "StartRampA")

                const { ampData: ampDataAfter } = await details.pool.data()
                expect(ampDataAfter.initialA, "after initialA").to.eq(currentA)
                expect(ampDataAfter.targetA, "after targetA").to.eq(currentA.div(10))
            })
        })
        context("decreasing A by 50 over 5 days", () => {
            let startTime: BN
            let endTime: BN
            let pool: RebasedFeederPool
            before(async () => {
                await runSetup()
                pool = details.pool.connect(sa.governor.signer) as RebasedFeederPool
                startTime = await getTimestamp()
                endTime = startTime.add(ONE_DAY.mul(5))
                await pool.startRampA(150, endTime)
            })
            it("should succeed getting A just after start", async () => {
                const config = await pool.getConfig()
                expect(config.a).to.eq(30000)
            })
            const testsData = [
                {
                    // 60 * 60 * 24 * 5 / 5000 = 86
                    desc: "just under before increment",
                    elapsedSeconds: 24,
                    expectedValue: 30000,
                },
                {
                    desc: "just under after increment",
                    elapsedSeconds: 88,
                    expectedValue: 29997,
                },
                {
                    desc: "after 1 day",
                    elapsedSeconds: ONE_DAY.add(1),
                    expectedValue: 27000,
                },
                {
                    desc: "after 4 days",
                    elapsedSeconds: ONE_DAY.mul(4).add(1),
                    expectedValue: 18000,
                },
                {
                    desc: "just under 5 days",
                    elapsedSeconds: ONE_DAY.mul(5).sub(2),
                    expectedValue: 15001,
                },
                {
                    desc: "after 5 days",
                    elapsedSeconds: ONE_DAY.mul(5),
                    expectedValue: 15000,
                },
                {
                    desc: "after 6 days",
                    elapsedSeconds: ONE_DAY.mul(6),
                    expectedValue: 15000,
                },
            ]
            testsData.forEach((testData) => {
                it(`should succeed getting A ${testData.desc}`, async () => {
                    const currentTime = await getTimestamp()
                    const incrementSeconds = startTime.add(testData.elapsedSeconds).sub(currentTime)
                    await increaseTime(incrementSeconds)
                    const config = await pool.getConfig()
                    assertBNClose(config.a, BN.from(testData.expectedValue), 10)
                })
            })
        })
        describe("should fail to start ramp A", () => {
            before(async () => {
                await runSetup()
            })
            it("when ramp up time only 1 hour", async () => {
                await expect(details.pool.connect(sa.governor.signer).startRampA(12000, ONE_HOUR)).to.revertedWith("Ramp time too short")
            })
            it("when ramp up time just less than 1 day", async () => {
                await expect(details.pool.connect(sa.governor.signer).startRampA(12000, ONE_DAY.sub(1))).to.revertedWith(
                    "Ramp time too short",
                )
            })
            it("when A target too big", async () => {
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(7))
                await expect(details.pool.connect(sa.governor.signer).startRampA(1000000, endTime)).to.revertedWith(
                    "A target out of bounds",
                )
            })
            it("when A target increase greater than 10x", async () => {
                const config = await details.pool.getConfig()
                const currentA = config.a
                // target = current * 10 / 100
                // the 100 is the precision
                const targetA = currentA.div(10).add(1)
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(7))
                await expect(details.pool.connect(sa.governor.signer).startRampA(targetA, endTime)).to.revertedWith(
                    "A target increase too big",
                )
            })
            it("when A target decrease greater than 10x", async () => {
                const config = await details.pool.getConfig()
                const currentA = config.a
                // target = current / 100 / 10
                // the 100 is the precision
                const targetA = currentA.div(1000).sub(1)
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(7))
                await expect(details.pool.connect(sa.governor.signer).startRampA(targetA, endTime)).to.revertedWith(
                    "A target decrease too big",
                )
            })
            it("when A target is zero", async () => {
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(7))
                await expect(details.pool.connect(sa.governor.signer).startRampA(0, endTime)).to.revertedWith("A target out of bounds")
            })
            it("when starting just less than a day after the last finished", async () => {
                const pool = details.pool.connect(sa.governor.signer)
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(2))
                await pool.startRampA(130, endTime)

                // increment 1 day
                await increaseTime(ONE_HOUR.mul(20))

                const secondStartTime = await getTimestamp()
                const secondEndTime = secondStartTime.add(ONE_DAY.mul(7))
                await expect(pool.startRampA(150, secondEndTime)).to.revertedWith("Sufficient period of previous ramp has not elapsed")
            })
        })
        context("stop ramp A", () => {
            let startTime: BN
            let endTime: BN
            let pool: RebasedFeederPool
            before(async () => {
                await runSetup()
                pool = details.pool.connect(sa.governor.signer) as RebasedFeederPool
                startTime = await getTimestamp()
                endTime = startTime.add(ONE_DAY.mul(5))
                await pool.startRampA(50, endTime)
            })
            it("should stop decreasing A after a day", async () => {
                // increment 1 day
                await increaseTime(ONE_DAY)

                let config = await details.pool.getConfig()
                const currentA = config.a
                const currentTime = await getTimestamp()
                const tx = pool.stopRampA()
                await expect(tx).to.emit(pool, "StopRampA")
                config = await details.pool.getConfig()
                expect(config.a).to.eq(currentA)

                const { ampData: ampDataAfter } = await pool.data()
                expect(ampDataAfter.initialA, "after initialA").to.eq(currentA)
                expect(ampDataAfter.targetA, "after targetA").to.eq(currentA)
                expect(ampDataAfter.rampStartTime.toNumber(), "after rampStartTime").to.within(
                    currentTime.toNumber(),
                    currentTime.add(3).toNumber(),
                )
                expect(ampDataAfter.rampEndTime.toNumber(), "after rampEndTime").to.within(
                    currentTime.toNumber(),
                    currentTime.add(3).toNumber(),
                )

                // increment another 2 days
                await increaseTime(ONE_DAY.mul(2))
                config = await details.pool.getConfig()
                expect(config.a).to.eq(currentA)
            })
        })
        describe("should fail to stop ramp A", () => {
            before(async () => {
                await runSetup()
                const pool = details.pool.connect(sa.governor.signer)
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(2))
                await pool.startRampA(50, endTime)
            })
            it("After ramp has complete", async () => {
                // increment 2 days
                await increaseTime(ONE_DAY.mul(2).add(1))
                await expect(details.pool.connect(sa.governor.signer).stopRampA()).to.revertedWith("Amplification not changing")
            })
        })
    })

    context.skip("Collect platform interest", async () => {
        context("with no platform integration", () => {
            before(async () => {
                await runSetup()
            })
            it("Should collect zero platform interest", async () => {
                const { pool } = details
                const tx = pool.connect(sa.mockInterestValidator.signer).collectPlatformInterest()
                await expect(tx).to.emit(pool, "MintedMulti").withArgs(pool.address, sa.mockInterestValidator.address, 0, [], [0, 0])
            })
            it("Should collect zero platform interest even after minting a mAsset", async () => {
                const { pool, mAsset } = details

                // increase the test chain by 12 hours + 20 seconds
                await increaseTime(ONE_HOUR.mul(12).add(20))

                // Mint mAsset to generate some interest in the lending market
                await feederMachine.approveFeeder(mAsset, pool.address, 1000)
                await pool.mint(mAsset.address, simpleToExactAmount(500), 0, sa.default.address)

                const tx = pool.connect(sa.mockInterestValidator.signer).collectPlatformInterest()
                await expect(tx).to.emit(pool, "MintedMulti").withArgs(pool.address, sa.mockInterestValidator.address, 0, [], [0, 0])
            })
        })

        context("using the interest validator contract to collect pending govFees", () => {
            before(async () => {
                await runSetup([200, 200], [2500, 2500, 2500, 2500], false, true)
            })
            it("redeems fpTokens for mAsset and then sends to savingsManager", async () => {
                const { interestValidator, pool, bAssets, mAsset } = details
                // Accrue some fees for gov
                await pool.redeem(bAssets[0].address, simpleToExactAmount(10), 0, sa.default.address)
                const { pendingFees: beforePendingFees } = await pool.data()
                expect(beforePendingFees).gt(simpleToExactAmount(1, 13))
                const expectedOutput = await pool["getRedeemOutput(address,uint256)"](mAsset.address, beforePendingFees)
                // Get balance of SM
                const balBefore = await mAsset.balanceOf(sa.mockSavingsManager.address)

                const tx = interestValidator.connect(sa.governor.signer).collectGovFees([pool.address])
                await expect(tx).to.emit(interestValidator, "GovFeeCollected").withArgs(pool.address, mAsset.address, expectedOutput)
                await (await tx).wait()
                const { pendingFees: afterPendingFees } = await pool.data()
                const balAfter = await mAsset.balanceOf(sa.mockSavingsManager.address)
                expect(afterPendingFees).lt(beforePendingFees)
                expect(balAfter).eq(balBefore.add(expectedOutput))
            })
            it("fails if given invalid fPool addr", async () => {
                const { interestValidator, pool } = details
                await expect(interestValidator.collectGovFees([pool.address])).to.revertedWith("Only governor")
            })
            it("fails if not called by governor", async () => {
                const { interestValidator } = details
                await expect(interestValidator.collectGovFees([sa.default.address])).to.reverted
            })
        })
    })
    context.skip("Collect pending fees", async () => {
        before(async () => {
            await runSetup()
        })
        it("should not collect any fees if no swaps or redemptions", async () => {
            const { pool } = details
            const tx = pool.connect(sa.mockInterestValidator.signer).collectPendingFees()
            await expect(tx).to.not.emit(pool, "MintedMulti")
        })
        it("should collect gov fee as the interest validator", async () => {
            const { pool, fAsset, mAsset } = details

            // Swap mAsset for fAsset to generate some gov fees
            await feederMachine.approveFeeder(mAsset, pool.address, simpleToExactAmount(10), sa.default.signer, true)
            const swapTx = await pool.swap(mAsset.address, fAsset.address, simpleToExactAmount(10), 0, sa.default.address)
            const swapReceipt = await swapTx.wait()
            const swapReceiptEvent = swapReceipt.events.find((event) => event.event === "Swapped" && event.address === pool.address)
            expect(swapReceiptEvent.event).to.eq("Swapped")
            const swapFee = swapReceiptEvent.args.fee

            const tx = details.pool.connect(sa.mockInterestValidator.signer).collectPendingFees()
            await expect(tx).to.emit(pool, "MintedMulti")
            const receipt = await (await tx).wait()
            const receiptEvent = receipt.events.find((event) => event.event === "MintedMulti" && event.address === pool.address)
            expect(receiptEvent.event).to.eq("MintedMulti")
            expect(receiptEvent.args.minter).to.eq(details.pool.address)
            expect(receiptEvent.args.recipient).to.eq(sa.mockInterestValidator.address)
            // gov fee is 10% of the swap fee - 1
            expect(receiptEvent.args.output).to.eq(swapFee.div(10).sub(1))
            expect(receiptEvent.args.inputs).to.length(0)
            expect(receiptEvent.args.inputQuantities).to.length(0)
        })
        it("should not collect any fees if already collected pending fees", async () => {
            const { pool } = details
            const tx = pool.connect(sa.mockInterestValidator.signer).collectPendingFees()
            await expect(tx).to.not.emit(pool, "MintedMulti")
        })
        context("should fail to collect pending fees when sender is", () => {
            it("governor", async () => {
                await expect(details.pool.connect(sa.governor.signer).collectPendingFees()).to.revertedWith("Only validator")
            })
            it("default", async () => {
                await expect(details.pool.connect(sa.default.signer).collectPendingFees()).to.revertedWith("Only validator")
            })
            it("fundManager", async () => {
                await expect(details.pool.connect(sa.fundManager.signer).collectPendingFees()).to.revertedWith("Only validator")
            })
        })
    })
})
