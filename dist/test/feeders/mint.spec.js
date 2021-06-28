"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const math_1 = require("@utils/math");
const machines_1 = require("@utils/machines");
const constants_1 = require("@utils/constants");
const mstable_objects_1 = require("@utils/mstable-objects");
describe("Feeder - Mint", () => {
    let sa;
    let feederMachine;
    let details;
    const runSetup = async (useLendingMarkets = false, useInterestValidator = false, feederWeights, mAssetWeights, use2dp = false) => {
        details = await feederMachine.deployFeeder(feederWeights, mAssetWeights, useLendingMarkets, useInterestValidator, use2dp);
    };
    before("Init contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        feederMachine = await new machines_1.FeederMachine(mAssetMachine);
        sa = mAssetMachine.sa;
    });
    const assertFailedMint = async (expectedReason, poolContract, inputAsset, inputAssetQuantity, outputExpected = undefined, minOutputQuantity = 0, sender = sa.default.signer, recipient = sa.default.address, quantitiesAreExact = true, approval = true) => {
        const pool = poolContract.connect(sender);
        if (approval) {
            await feederMachine.approveFeeder(inputAsset, pool.address, inputAssetQuantity, sender, quantitiesAreExact);
        }
        const inputAssetDecimals = await inputAsset.decimals();
        const inputAssetQuantityExact = quantitiesAreExact
            ? math_1.BN.from(inputAssetQuantity)
            : math_1.simpleToExactAmount(inputAssetQuantity, inputAssetDecimals);
        const minOutputQuantityExact = quantitiesAreExact ? math_1.BN.from(minOutputQuantity) : math_1.simpleToExactAmount(minOutputQuantity, 18);
        await chai_1.expect(pool.mint(inputAsset.address, inputAssetQuantityExact, minOutputQuantityExact, recipient), `mint tx should revert with "${expectedReason}"`).to.be.revertedWith(expectedReason);
        if (outputExpected === undefined) {
            await chai_1.expect(pool.getMintOutput(inputAsset.address, inputAssetQuantityExact), `getMintOutput call should revert with "${expectedReason}"`).to.be.revertedWith(expectedReason);
        }
        else {
            const outputExpectedExact = quantitiesAreExact ? math_1.BN.from(outputExpected) : math_1.simpleToExactAmount(outputExpected, 18);
            const outputActual = await pool.getMintOutput(inputAsset.address, inputAssetQuantityExact);
            chai_1.expect(outputActual, "getMintOutput call output").eq(outputExpectedExact);
        }
    };
    const assertFailedMintMulti = async (expectedReason, poolContract, inputAssets, inputAssetQuantities, outputExpected = undefined, minOutputQuantity = 0, quantitiesAreExact = false, sender = sa.default.signer, recipient = sa.default.address, approval = true) => {
        const pool = poolContract.connect(sender);
        if (approval) {
            const approvePromises = inputAssets.map((b, i) => typeof b === "string"
                ? Promise.resolve(math_1.BN.from(0))
                : feederMachine.approveFeeder(b, pool.address, inputAssetQuantities[i], sender, quantitiesAreExact));
            await Promise.all(approvePromises);
        }
        const inputAssetAddresses = inputAssets.map((asset) => (typeof asset === "string" ? asset : asset.address));
        const inputAssetDecimals = await Promise.all(inputAssets.map((asset) => (typeof asset === "string" ? Promise.resolve(18) : asset.decimals())));
        // Convert to exact quantities
        const inputAssetQuantitiesExact = quantitiesAreExact
            ? inputAssetQuantities.map((q) => math_1.BN.from(q))
            : inputAssetQuantities.map((q, i) => math_1.simpleToExactAmount(q, inputAssetDecimals[i]));
        const minOutputQuantityExact = quantitiesAreExact ? math_1.BN.from(minOutputQuantity) : math_1.simpleToExactAmount(minOutputQuantity, 18);
        await chai_1.expect(pool.mintMulti(inputAssetAddresses, inputAssetQuantitiesExact, minOutputQuantityExact, recipient), `mintMulti tx should revert with "${expectedReason}"`).to.be.revertedWith(expectedReason);
        if (outputExpected === undefined) {
            await chai_1.expect(pool.getMintMultiOutput(inputAssetAddresses, inputAssetQuantitiesExact), `getMintMultiOutput call should revert with "${expectedReason}"`).to.be.revertedWith(expectedReason);
        }
        else {
            const outputExpectedExact = quantitiesAreExact ? math_1.BN.from(outputExpected) : math_1.simpleToExactAmount(outputExpected, 18);
            const outputActual = await pool.getMintMultiOutput(inputAssetAddresses, inputAssetQuantitiesExact);
            chai_1.expect(outputActual, "getMintMultiOutput call output").eq(outputExpectedExact);
        }
    };
    // Helper to assert basic minting conditions, i.e. balance before and after
    const assertBasicMint = async (fd, inputAsset, inputAssetQuantity = math_1.simpleToExactAmount(1), outputQuantity, minOutputAssetQuantity = 0, recipient = sa.default.address, sender = sa.default, quantitiesAreExact = true) => {
        const pool = fd.pool.connect(sender.signer);
        // Get before balances
        const senderAssetBalBefore = await inputAsset.balanceOf(sender.address);
        const recipientBalBefore = await pool.balanceOf(recipient);
        const assetBefore = await feederMachine.getAsset(details, inputAsset.address);
        // Convert to exact quantities
        const assetQuantityExact = quantitiesAreExact
            ? math_1.BN.from(inputAssetQuantity)
            : math_1.simpleToExactAmount(inputAssetQuantity, await inputAsset.decimals());
        const minMassetQuantityExact = quantitiesAreExact
            ? math_1.BN.from(minOutputAssetQuantity)
            : math_1.simpleToExactAmount(minOutputAssetQuantity, 18);
        const outputQuantityExact = quantitiesAreExact ? math_1.BN.from(outputQuantity) : math_1.simpleToExactAmount(outputQuantity, 18);
        const platformInteraction = await machines_1.FeederMachine.getPlatformInteraction(pool, "deposit", assetQuantityExact, assetBefore);
        const integratorBalBefore = await assetBefore.contract.balanceOf(assetBefore.integrator ? assetBefore.integratorAddr : assetBefore.feederPoolOrMassetContract.address);
        await feederMachine.approveFeeder(inputAsset, pool.address, assetQuantityExact, sender.signer, true);
        const feederOutput = await pool.getMintOutput(inputAsset.address, assetQuantityExact);
        chai_1.expect(feederOutput, "mAssetOutput").to.eq(outputQuantityExact);
        const tx = pool.mint(inputAsset.address, assetQuantityExact, minMassetQuantityExact, recipient);
        await chai_1.expect(tx, "Minted event")
            .to.emit(pool, "Minted")
            .withArgs(sender.address, recipient, outputQuantityExact, inputAsset.address, assetQuantityExact);
        // Transfers to lending platform
        if (!assetBefore.isMpAsset) {
            await chai_1.expect(tx, "Transfer event")
                .to.emit(inputAsset, "Transfer")
                .withArgs(sender.address, assetBefore.integrator ? assetBefore.integratorAddr : pool.address, assetQuantityExact);
        }
        // Mint feeder pool token
        await chai_1.expect(tx, "Transfer event").to.emit(pool, "Transfer").withArgs(constants_1.ZERO_ADDRESS, recipient, outputQuantityExact);
        // Deposits into lending platform
        const integratorBalAfter = await assetBefore.contract.balanceOf(assetBefore.integrator ? assetBefore.integratorAddr : assetBefore.feederPoolOrMassetContract.address);
        // If not a main pool asset, so only a fAsset or mAsset
        // and expecting a deposit into lending markets
        if (!assetBefore.isMpAsset && platformInteraction.expectInteraction) {
            await chai_1.expect(tx)
                .to.emit(fd.mAssetDetails.platform, "Deposit")
                .withArgs(assetBefore.isMpAsset ? fd.mAsset.address : inputAsset.address, assetBefore.isMpAsset ? fd.mAsset.address : assetBefore.pToken, platformInteraction.amount);
            // TODO this check is not working for mAssets or fAssets using a lending market
            // expect(integratorBalAfter, "integrator balance after").eq(integratorBalBefore.add(platformInteraction.amount))
        }
        else {
            chai_1.expect(integratorBalAfter, "integrator balance after").eq(integratorBalBefore.add(assetQuantityExact));
        }
        // Recipient should have pool quantity after
        const recipientBalAfter = await pool.balanceOf(recipient);
        chai_1.expect(recipientBalAfter, "recipient balance after").eq(recipientBalBefore.add(outputQuantityExact));
        // Sender should have less asset after
        const senderAssetBalAfter = await inputAsset.balanceOf(sender.address);
        chai_1.expect(senderAssetBalAfter, "sender balance after").eq(senderAssetBalBefore.sub(assetQuantityExact));
        // VaultBalance should update for this asset
        const assetAfter = await feederMachine.getAsset(details, inputAsset.address);
        chai_1.expect(math_1.BN.from(assetAfter.vaultBalance), "vault balance after").eq(math_1.BN.from(assetBefore.vaultBalance).add(assetQuantityExact));
        return {
            outputQuantity: outputQuantityExact,
            senderBassetBalBefore: senderAssetBalBefore,
            senderBassetBalAfter: senderAssetBalAfter,
            recipientBalBefore,
            recipientBalAfter,
        };
    };
    // Helper to assert basic minting conditions, i.e. balance before and after
    const assertMintMulti = async (fd, inputAssets, inputAssetQuantities, outputQuantity, minOutputQuantity = 0, quantitiesAreExact = true, recipient = sa.default.address, sender = sa.default) => {
        const { pool: poolContract } = fd;
        const pool = poolContract.connect(sender.signer);
        const inputAssetAddresses = inputAssets.map((asset) => (typeof asset === "string" ? asset : asset.address));
        const inputAssetDecimals = await Promise.all(inputAssets.map((asset) => asset.decimals()));
        // Convert to exact quantities
        const inputAssetQuantitiesExact = quantitiesAreExact
            ? inputAssetQuantities.map((q) => math_1.BN.from(q))
            : inputAssetQuantities.map((q, i) => math_1.simpleToExactAmount(q, inputAssetDecimals[i]));
        const minOutputQuantityExact = quantitiesAreExact ? math_1.BN.from(minOutputQuantity) : math_1.simpleToExactAmount(minOutputQuantity, 18);
        const outputQuantityExact = quantitiesAreExact ? math_1.BN.from(outputQuantity) : math_1.simpleToExactAmount(outputQuantity, 18);
        const senderAssetsBalBefore = await Promise.all(inputAssets.map((asset) => asset.balanceOf(sender.address)));
        const recipientBalBefore = await pool.balanceOf(recipient);
        const assetsBefore = await Promise.all(inputAssets.map((asset) => feederMachine.getAsset(details, asset.address)));
        await Promise.all(inputAssets.map((a, i) => feederMachine.approveFeeder(a, pool.address, inputAssetQuantitiesExact[i], sender.signer, true)));
        const feederOutput = await pool.getMintMultiOutput(inputAssetAddresses, inputAssetQuantitiesExact);
        chai_1.expect(feederOutput, "get mint multi output").to.eq(outputQuantityExact);
        const tx = pool.mintMulti(inputAssetAddresses, inputAssetQuantitiesExact, minOutputQuantityExact, recipient);
        await chai_1.expect(tx)
            .to.emit(pool, "MintedMulti")
            .withArgs(sender.address, recipient, outputQuantityExact, inputAssetAddresses, inputAssetQuantitiesExact);
        // Recipient should have mAsset quantity after
        const recipientBalAfter = await pool.balanceOf(recipient);
        chai_1.expect(recipientBalAfter, "recipient balance after").eq(recipientBalBefore.add(outputQuantityExact));
        // Sender should have less asset balance after
        const senderAssetsBalAfter = await Promise.all(inputAssets.map((asset) => asset.balanceOf(sender.address)));
        senderAssetsBalAfter.map((asset, i) => chai_1.expect(asset, `sender ${i} balance after`).eq(senderAssetsBalBefore[i].sub(inputAssetQuantitiesExact[i])));
        // VaultBalance should updated for this bAsset
        const assetsAfter = await Promise.all(inputAssets.map((asset) => feederMachine.getAsset(details, asset.address)));
        assetsAfter.forEach((assetAfter, i) => {
            chai_1.expect(math_1.BN.from(assetAfter.vaultBalance), "vault balance after").eq(math_1.BN.from(assetsBefore[i].vaultBalance).add(inputAssetQuantitiesExact[i]));
        });
    };
    describe("minting with a single asset", () => {
        context("when the basket is balanced", () => {
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should fail if recipient is 0x0", async () => {
                    await assertFailedMint("Invalid recipient", details.pool, details.fAsset, math_1.simpleToExactAmount(1), "999991742447046384", 0, sa.default.signer, constants_1.ZERO_ADDRESS);
                });
                it("should fail when 0 quantity", async () => {
                    const { fAsset, pool } = details;
                    await assertFailedMint("Qty==0", pool, fAsset, 0);
                });
                it("should fail when sender doesn't have enough balance", async () => {
                    const bAsset = details.bAssets[0];
                    const sender = sa.dummy1;
                    chai_1.expect(await bAsset.balanceOf(sender.address)).eq(0);
                    await assertFailedMint("ERC20: transfer amount exceeds balance", details.pool, bAsset, math_1.simpleToExactAmount(100), "99931034449956916600", 0, sender.signer, sender.address);
                });
                it("should fail to mint mStable asset when sender doesn't give approval", async () => {
                    const { mAsset, pool } = details;
                    const sender = sa.dummy2;
                    await mAsset.transfer(sender.address, 10000);
                    chai_1.expect(await mAsset.allowance(sender.address, pool.address)).eq(0);
                    chai_1.expect(await mAsset.balanceOf(sender.address)).eq(10000);
                    await assertFailedMint("ERC20: transfer amount exceeds balance", pool, mAsset, math_1.simpleToExactAmount(100), "99931034449956916600", 0, sender.signer, sender.address);
                });
                it("should fail to mint feeder asset when sender doesn't give approval", async () => {
                    const { fAsset, pool } = details;
                    const sender = sa.dummy2;
                    await fAsset.transfer(sender.address, 10000);
                    chai_1.expect(await fAsset.allowance(sender.address, pool.address)).eq(0);
                    chai_1.expect(await fAsset.balanceOf(sender.address)).eq(10000);
                    await assertFailedMint("ERC20: transfer amount exceeds balance", pool, fAsset, math_1.simpleToExactAmount(100), "99931034449956916600", 0, sender.signer, sender.address);
                });
                it("should fail when the asset does not exist", async () => {
                    const newBasset = await feederMachine.mAssetMachine.loadBassetProxy("Mock", "MKK", 18, sa.default.address, 1000);
                    await assertFailedMint("Invalid asset", details.pool, newBasset, 1);
                });
                it("should fail to mint if too much slippage", async () => {
                    await assertFailedMint("Mint quantity < min qty", details.pool, details.bAssets[0], math_1.simpleToExactAmount(1), "999991742447046384", math_1.simpleToExactAmount(1));
                });
                context("when feeder pool is paused", () => {
                    before(async () => {
                        const { pool } = details;
                        chai_1.expect(await pool.paused(), "before pause").to.be.false;
                        await pool.connect(sa.governor.signer).pause();
                        chai_1.expect(await pool.paused(), "after pause").to.be.true;
                    });
                    after(async () => {
                        const { pool } = details;
                        chai_1.expect(await pool.paused(), "before unpause").to.be.true;
                        await pool.connect(sa.governor.signer).unpause();
                        chai_1.expect(await pool.paused(), "after unpause").to.be.false;
                    });
                    it("should fail to mint feeder asset", async () => {
                        await assertFailedMint("Unhealthy", details.pool, details.fAsset, math_1.simpleToExactAmount(1), "999991742447046384");
                    });
                    it("should fail to mint mStable asset", async () => {
                        await assertFailedMint("Unhealthy", details.pool, details.mAsset, math_1.simpleToExactAmount(1), "999991742447046384");
                    });
                    it("should fail to mint a main pool assets", async () => {
                        await assertFailedMint("Unhealthy", details.pool, details.bAssets[0], math_1.simpleToExactAmount(1), "999991742447046384");
                    });
                });
            });
            context("using bAssets with no transfer fees", async () => {
                context("reset before each", () => {
                    beforeEach(async () => {
                        await runSetup();
                    });
                    it("should mint a single mStable asset", async () => {
                        await assertBasicMint(details, details.mAsset, math_1.simpleToExactAmount(1), "999991742447046384");
                    });
                    it("should mint a single feeder asset", async () => {
                        await assertBasicMint(details, details.fAsset, math_1.simpleToExactAmount(1), "999991742447046384");
                    });
                    it("should mint a single main pool asset", async () => {
                        await assertBasicMint(details, details.mAssetDetails.bAssets[0], math_1.simpleToExactAmount(1), "999990257669407574");
                    });
                    it("should mint nothing with the smallest unit of fp token", async () => {
                        await assertFailedMint("Must add > 1e6 units", details.pool, details.fAsset, 1);
                    });
                });
                context("with a bAsset with 2 dp", () => {
                    beforeEach(async () => {
                        await runSetup(false, false, [50, 50], undefined, true);
                    });
                    it("should mint 1e16 per 1 base unit", async () => {
                        await assertBasicMint(details, details.fAsset, "1", "9999996689072780", "9999996689072780");
                    });
                    it("should mint 1e18 per 1e2 base unit", async () => {
                        await assertBasicMint(details, details.fAsset, math_1.simpleToExactAmount(1, 2), "999967212071635916", "999967212071635916");
                    });
                });
                context("when a main pool asset has broken below peg", () => {
                    before(async () => {
                        await runSetup();
                    });
                    before(async () => {
                        const { mAsset, mAssetDetails } = details;
                        await mAsset.connect(sa.governor.signer).handlePegLoss(mAssetDetails.bAssets[0].address, true);
                        const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address);
                        chai_1.expect(newBasset.personal.status).to.eq(mstable_objects_1.BassetStatus.BrokenBelowPeg);
                    });
                    after(async () => {
                        const { mAsset, mAssetDetails } = details;
                        await mAsset.connect(sa.governor.signer).negateIsolation(mAssetDetails.bAssets[0].address);
                        const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address);
                        chai_1.expect(newBasset.personal.status).to.eq(mstable_objects_1.BassetStatus.Normal);
                    });
                    it("should fail to mint a main pool asset", async () => {
                        await assertFailedMint("VM Exception while processing transaction: revert", details.pool, details.mAssetDetails.bAssets[0], math_1.simpleToExactAmount(1), "999990257669407574");
                    });
                    it("should mint from a single mStable asset", async () => {
                        await assertBasicMint(details, details.mAsset, math_1.simpleToExactAmount(1), "999991742447046384");
                    });
                    it("should mint from a single feeder asset", async () => {
                        await assertBasicMint(details, details.fAsset, math_1.simpleToExactAmount(1), "1000008257552953616");
                    });
                });
            });
        });
        context("when the basket is 75% mAsset, 25% fAsset", () => {
            beforeEach(async () => {
                await runSetup(false, false, [75, 25]);
            });
            it("should mint mAsset to just under max weight", async () => {
                await assertBasicMint(details, details.mAsset, math_1.simpleToExactAmount(4), "3983329877010604242");
            });
            it("should fail mint mAsset over max weight", async () => {
                await assertFailedMint("Exceeds weight limits", details.pool, details.mAsset, math_1.simpleToExactAmount(40));
            });
            context("mAsset is overweight", () => {
                beforeEach(async () => {
                    // set new weight limits to 10% and 90% so the mAsset is overweight
                    await details.pool.connect(sa.governor.signer).setWeightLimits(math_1.simpleToExactAmount(30, 16), math_1.simpleToExactAmount(70, 16));
                });
                it("should fail to mint the overweight mAsset", async () => {
                    await assertFailedMint("Exceeds weight limits", details.pool, details.mAsset, math_1.simpleToExactAmount(1, 7));
                });
                it("should fail to mint fAsset if mAsset is still overweight", async () => {
                    await assertFailedMint("Exceeds weight limits", details.pool, details.mAsset, math_1.simpleToExactAmount(1));
                });
                it("should mint fAsset so mAsset is underweight", async () => {
                    await assertBasicMint(details, details.fAsset, math_1.simpleToExactAmount(40), "40107755459881495840");
                });
            });
        });
        context("when using lending markets", async () => {
            context("deposit to lending markets", () => {
                beforeEach(async () => {
                    // Use lending market
                    await runSetup(true);
                });
                it("should mint a single mStable asset", async () => {
                    await assertBasicMint(details, details.mAsset, math_1.simpleToExactAmount(500), "498673496146378809664");
                });
                it("should mint a single feeder asset", async () => {
                    await assertBasicMint(details, details.fAsset, math_1.simpleToExactAmount(500), "498673496146378809664");
                });
                it("should mint a single main pool asset", async () => {
                    await assertBasicMint(details, details.mAssetDetails.bAssets[0], math_1.simpleToExactAmount(500), "498339345218159685928");
                });
            });
        });
    });
    describe("minting with multiple bAssets", () => {
        context("when the weights are within the ForgeValidator limit", () => {
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should fail to multi mint if recipient is 0x0", async () => {
                    await assertFailedMintMulti("Invalid recipient", details.pool, details.bAssets, [1, 1], 2, 0, false, sa.default.signer, constants_1.ZERO_ADDRESS);
                });
                context("with incorrect bAsset array", async () => {
                    it("should fail if both input arrays are empty", async () => {
                        await assertFailedMintMulti("Input array mismatch", details.pool, [], []);
                    });
                    it("should fail if the bAsset input array is empty", async () => {
                        await assertFailedMintMulti("Input array mismatch", details.pool, [], [1]);
                    });
                    it("should fail if there is a length mismatch", async () => {
                        await assertFailedMintMulti("Input array mismatch", details.pool, [details.bAssets[0].address], [1, 1]);
                    });
                    it("should fail if there is a length mismatch", async () => {
                        await assertFailedMintMulti("Input array mismatch", details.pool, [details.bAssets[0].address], [1, 1, 1, 1]);
                    });
                    it("should fail if there are duplicate bAsset addresses", async () => {
                        const { bAssets } = details;
                        await assertFailedMintMulti("Duplicate asset", details.pool, [bAssets[0].address, bAssets[0].address], [1, 1]);
                    });
                    it("should multi mint a single main pool asset", async () => {
                        await assertFailedMintMulti("Invalid asset", details.pool, [details.mAssetDetails.bAssets[0]], [1]);
                    });
                });
                context("when all quantities are zero", () => {
                    it("should fail to mint fAsset and mAsset", async () => {
                        await assertFailedMintMulti("Zero mAsset quantity", details.pool, details.bAssets, [0, 0], 0);
                    });
                    it("should fail to mint feeder asset", async () => {
                        await assertFailedMintMulti("Zero mAsset quantity", details.pool, [details.fAsset], [0], 0);
                    });
                    it("should fail to mint mStable asset", async () => {
                        await assertFailedMintMulti("Zero mAsset quantity", details.pool, [details.mAsset], [0], 0);
                    });
                });
                it("should fail to multi mint if slippage just too big", async () => {
                    const { bAssets, pool } = details;
                    const bAsset = bAssets[0];
                    const sender = sa.default;
                    await feederMachine.approveFeeder(bAsset, pool.address, 101, sender.signer);
                    await assertFailedMintMulti("Mint quantity < min qty", pool, [bAsset.address], ["100000000000000000000"], // 100
                    "99931034449956916600", // 100
                    "100000000000000000001", // just over 100
                    true);
                });
                it("should fail when sender doesn't have enough balance", async () => {
                    const { bAssets, pool } = details;
                    const bAsset = bAssets[0];
                    const sender = sa.dummy1;
                    chai_1.expect(await bAsset.balanceOf(sender.address)).eq(0);
                    await assertFailedMintMulti("ERC20: transfer amount exceeds balance", pool, bAssets, [100, 100], 200, 0, true, sender.signer, sender.address, false);
                });
                it("should fail to mint mStable asset when sender doesn't give approval", async () => {
                    const { bAssets, mAsset, pool } = details;
                    const sender = sa.dummy2;
                    await mAsset.transfer(sender.address, 10000);
                    chai_1.expect(await mAsset.allowance(sender.address, pool.address)).eq(0);
                    chai_1.expect(await mAsset.balanceOf(sender.address)).eq(10000);
                    await assertFailedMintMulti("ERC20: transfer amount exceeds balance", pool, bAssets, [100, 100], 200, 0, false, sender.signer, sender.address, false);
                });
                it("should fail to mint feeder asset when sender doesn't give approval", async () => {
                    const { bAssets, fAsset, pool } = details;
                    const sender = sa.dummy2;
                    await fAsset.transfer(sender.address, 10000);
                    chai_1.expect(await fAsset.allowance(sender.address, pool.address)).eq(0);
                    chai_1.expect(await fAsset.balanceOf(sender.address)).eq(10000);
                    await assertFailedMintMulti("ERC20: transfer amount exceeds balance", pool, bAssets, [100, 100], 200, 0, false, sender.signer, sender.address, false);
                });
                it("should fail when the asset does not exist", async () => {
                    const newBasset = await feederMachine.mAssetMachine.loadBassetProxy("Mock", "MKK", 18, sa.default.address, 1000);
                    await assertFailedMintMulti("Invalid asset", details.pool, [newBasset], [1]);
                });
                context("when feeder pool is paused", () => {
                    before(async () => {
                        const { pool } = details;
                        chai_1.expect(await pool.paused(), "before pause").to.be.false;
                        await pool.connect(sa.governor.signer).pause();
                        chai_1.expect(await pool.paused(), "after pause").to.be.true;
                    });
                    after(async () => {
                        const { pool } = details;
                        chai_1.expect(await pool.paused(), "before unpause").to.be.true;
                        await pool.connect(sa.governor.signer).unpause();
                        chai_1.expect(await pool.paused(), "after unpause").to.be.false;
                    });
                    it("should fail to multi mint feeder asset", async () => {
                        await assertFailedMintMulti("Unhealthy", details.pool, [details.fAsset], [math_1.simpleToExactAmount(1)], "999991742447046384", 0, true);
                    });
                    it("should fail to multi mint mStable asset", async () => {
                        await assertFailedMintMulti("Unhealthy", details.pool, [details.mAsset], [math_1.simpleToExactAmount(1)], "999991742447046384", 0, true);
                    });
                });
            });
            context("using bAssets with no transfer fees", async () => {
                context("reset before each", () => {
                    beforeEach(async () => {
                        await runSetup();
                    });
                    it("should multi mint a single mStable asset", async () => {
                        await assertMintMulti(details, [details.mAsset], [math_1.simpleToExactAmount(1)], "999991742447046384", 0);
                    });
                    it("should multi mint a single feeder asset", async () => {
                        await assertMintMulti(details, [details.fAsset], [math_1.simpleToExactAmount(1)], "999991742447046384", 0);
                    });
                });
                context("with a bAsset with 2 dp", () => {
                    beforeEach(async () => {
                        await runSetup(false, false, [50, 50], undefined, true);
                    });
                    it("should mint 1e16 per 1 base unit", async () => {
                        await assertMintMulti(details, [details.fAsset], [1], "9999996689072780", "9999996689072780");
                    });
                    it("should mint 1e18 per 1e2 base unit", async () => {
                        await assertMintMulti(details, [details.fAsset], [math_1.simpleToExactAmount(1, 2)], "999967212071635916", "999967212071635916");
                    });
                });
                context("when a main pool asset has broken below peg", () => {
                    before(async () => {
                        await runSetup();
                    });
                    before(async () => {
                        const { mAsset, mAssetDetails } = details;
                        await mAsset.connect(sa.governor.signer).handlePegLoss(mAssetDetails.bAssets[0].address, true);
                        const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address);
                        chai_1.expect(newBasset.personal.status).to.eq(mstable_objects_1.BassetStatus.BrokenBelowPeg);
                    });
                    after(async () => {
                        const { mAsset, mAssetDetails } = details;
                        await mAsset.connect(sa.governor.signer).negateIsolation(mAssetDetails.bAssets[0].address);
                        const newBasset = await mAsset.getBasset(mAssetDetails.bAssets[0].address);
                        chai_1.expect(newBasset.personal.status).to.eq(mstable_objects_1.BassetStatus.Normal);
                    });
                    it("should multi mint a single mStable asset", async () => {
                        await assertMintMulti(details, [details.mAsset], [math_1.simpleToExactAmount(1)], "999991742447046384", 0);
                    });
                    it("should multi mint a single feeder asset", async () => {
                        await assertMintMulti(details, [details.fAsset], [math_1.simpleToExactAmount(1)], "1000008257552953616", 0);
                    });
                    it("should multi mint mStable and feeder assets", async () => {
                        await assertMintMulti(details, details.bAssets, [1, 1], 2, 0, false);
                    });
                });
            });
        });
        context("when the basket is 21% mAsset, 79% fAsset", () => {
            beforeEach(async () => {
                await runSetup(false, false, [21, 79]);
            });
            it("should fail to multi mint the smallest unit of fAsset", async () => {
                await assertFailedMintMulti("Zero mAsset quantity", details.pool, [details.fAsset], [1], 0, 0, true);
            });
            it("should multi mint fAsset to just under max weight", async () => {
                await assertMintMulti(details, [details.fAsset], [math_1.simpleToExactAmount(1)], "994648380532098808");
            });
            it("should fail multi mint fAsset over max weight", async () => {
                await assertFailedMintMulti("Exceeds weight limits", details.pool, [details.fAsset], [math_1.simpleToExactAmount(15)], undefined, 0, true);
            });
            context("fAsset is overweight", () => {
                beforeEach(async () => {
                    // set new weight limits to 10% and 90% so the fAsset is overweight
                    await details.pool.connect(sa.governor.signer).setWeightLimits(math_1.simpleToExactAmount(20, 16), math_1.simpleToExactAmount(79, 16));
                });
                it("should fail to multi mint the overweight fAsset", async () => {
                    await assertFailedMintMulti("Exceeds weight limits", details.pool, [details.fAsset], [1], undefined, 0, false);
                });
                it("should fail to multi mint mAsset if fAsset is still overweight", async () => {
                    await assertFailedMintMulti("Exceeds weight limits", details.pool, [details.fAsset], [math_1.simpleToExactAmount(1)], undefined, 0, true);
                });
                it("should mint mAsset so fAsset is underweight", async () => {
                    await assertMintMulti(details, [details.mAsset], [math_1.simpleToExactAmount(30)], "30146363829134129434");
                });
            });
        });
    });
});
//# sourceMappingURL=mint.spec.js.map