"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const machines_1 = require("@utils/machines");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
const assertions_1 = require("@utils/assertions");
const utils_1 = require("ethers/lib/utils");
const mstable_objects_1 = require("@utils/mstable-objects");
const time_1 = require("@utils/time");
describe("Feeder Admin", () => {
    let sa;
    let mAssetMachine;
    let details;
    /**
     * @dev (Re)Sets the local variables for this test file
     * @param seedBasket mints 25 tokens for each bAsset
     * @param useTransferFees enables transfer fees on bAssets [2,3]
     */
    const runSetup = async (seedBasket = true, useTransferFees = false, useLendingMarkets = false, weights = [25, 25, 25, 25]) => {
        details = await mAssetMachine.deployMasset(useLendingMarkets, useTransferFees);
        if (seedBasket) {
            await mAssetMachine.seedWithWeightings(details, weights);
        }
    };
    before("Init contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        sa = mAssetMachine.sa;
        await runSetup();
    });
    describe("using basic setters", async () => {
        const newSize = math_1.simpleToExactAmount(1, 16); // 1%
        let mAsset;
        before("set up", async () => {
            await runSetup(true);
            mAsset = await details.mAsset.connect(sa.governor.signer);
        });
        describe("should allow changing of the cache size to ", () => {
            it("zero", async () => {
                const tx = mAsset.setCacheSize(0);
                await chai_1.expect(tx).to.emit(mAsset, "CacheSizeChanged").withArgs(0);
                const { cacheSize } = await mAsset.data();
                chai_1.expect(cacheSize).eq(0);
            });
            it("1%", async () => {
                const { cacheSize: oldSize } = await mAsset.data();
                chai_1.expect(oldSize).not.eq(newSize);
                const tx = mAsset.setCacheSize(newSize);
                await chai_1.expect(tx).to.emit(mAsset, "CacheSizeChanged").withArgs(newSize);
                const { cacheSize } = await mAsset.data();
                chai_1.expect(cacheSize).eq(newSize);
            });
            it("20% (cap limit)", async () => {
                const capLimit = math_1.simpleToExactAmount(20, 16); // 20%
                const tx = mAsset.setCacheSize(capLimit);
                await chai_1.expect(tx).to.emit(mAsset, "CacheSizeChanged").withArgs(capLimit);
                const { cacheSize } = await mAsset.data();
                chai_1.expect(cacheSize).eq(capLimit);
            });
        });
        describe("should fail changing the cache size if", () => {
            it("not governor", async () => {
                await chai_1.expect(details.mAsset.connect(sa.default.signer).setCacheSize(newSize)).to.be.revertedWith("Only governor can execute");
                await chai_1.expect(details.mAsset.connect(sa.dummy1.signer).setCacheSize(newSize)).to.be.revertedWith("Only governor can execute");
            });
            it("just over cap", async () => {
                const feeExceedingCap = math_1.BN.from("200000000000000001");
                await chai_1.expect(mAsset.setCacheSize(feeExceedingCap)).to.be.revertedWith("Must be <= 20%");
            });
            it("exceed cap by 1%", async () => {
                const feeExceedingCap = math_1.simpleToExactAmount(21, 16); // 21%
                await chai_1.expect(mAsset.setCacheSize(feeExceedingCap)).to.be.revertedWith("Must be <= 20%");
            });
            it("exceeding cap with max number", async () => {
                await chai_1.expect(mAsset.setCacheSize(constants_1.MAX_UINT256)).to.be.revertedWith("Must be <= 20%");
            });
        });
        describe("should change swap and redemption fees to", () => {
            it("0.5% and 0.25%", async () => {
                const { swapFee: oldSwapFee, redemptionFee: oldRedemptionFee } = await mAsset.data();
                const newSwapFee = math_1.simpleToExactAmount(0.5, 16);
                const newRedemptionFee = math_1.simpleToExactAmount(0.25, 16);
                chai_1.expect(oldSwapFee).not.eq(newSwapFee);
                chai_1.expect(oldRedemptionFee).not.eq(newRedemptionFee);
                const tx = mAsset.setFees(newSwapFee, newRedemptionFee);
                await chai_1.expect(tx).to.emit(mAsset, "FeesChanged").withArgs(newSwapFee, newRedemptionFee);
                const { swapFee, redemptionFee } = await mAsset.data();
                chai_1.expect(swapFee).eq(newSwapFee);
                chai_1.expect(redemptionFee).eq(newRedemptionFee);
            });
            it("1% (limit)", async () => {
                const newFee = math_1.simpleToExactAmount(1, 16);
                await mAsset.setFees(newFee, newFee);
                const tx = mAsset.setFees(newFee, newFee);
                await chai_1.expect(tx).to.emit(mAsset, "FeesChanged").withArgs(newFee, newFee);
                const { swapFee, redemptionFee } = await mAsset.data();
                chai_1.expect(swapFee).eq(newFee);
                chai_1.expect(redemptionFee).eq(newFee);
            });
        });
        describe("should fail to change swap fee rate when", () => {
            it("not governor", async () => {
                const fee = math_1.simpleToExactAmount(1, 16);
                await chai_1.expect(details.mAsset.setFees(fee, fee)).to.be.revertedWith("Only governor can execute");
            });
            it("Swap rate just exceeds 1% cap", async () => {
                await chai_1.expect(mAsset.setFees("10000000000000001", "10000000000000000")).to.be.revertedWith("Swap rate oob");
            });
            it("Redemption rate just exceeds 1% cap", async () => {
                await chai_1.expect(mAsset.setFees("10000000000000000", "10000000000000001")).to.be.revertedWith("Redemption rate oob");
            });
            it("3% rate exceeds 1% cap", async () => {
                const fee = math_1.simpleToExactAmount(3, 16); // 3%
                await chai_1.expect(mAsset.setFees(fee, fee)).to.be.revertedWith("Swap rate oob");
            });
            it("max rate", async () => {
                const fee = constants_1.MAX_UINT256;
                await chai_1.expect(mAsset.setFees(fee, fee)).to.be.revertedWith("Swap rate oob");
            });
        });
        it("should set max weight", async () => {
            const { weightLimits: beforeWeightLimits } = await mAsset.data();
            const newMinWeight = math_1.simpleToExactAmount(1, 16);
            const newMaxWeight = math_1.simpleToExactAmount(334, 15);
            const tx = mAsset.setWeightLimits(newMinWeight, newMaxWeight);
            await chai_1.expect(tx, "WeightLimitsChanged event").to.emit(mAsset, "WeightLimitsChanged").withArgs(newMinWeight, newMaxWeight);
            await tx;
            const { weightLimits: afterWeightLimits } = await mAsset.data();
            chai_1.expect(afterWeightLimits.min, "before and after min weight not equal").not.to.eq(beforeWeightLimits.min);
            chai_1.expect(afterWeightLimits.max, "before and after max weight not equal").not.to.eq(beforeWeightLimits.max);
            chai_1.expect(afterWeightLimits.min, "min weight set").to.eq(newMinWeight);
            chai_1.expect(afterWeightLimits.max, "max weight set").to.eq(newMaxWeight);
        });
        describe("failed set max weight", () => {
            const newMinWeight = math_1.simpleToExactAmount(1, 16);
            const newMaxWeight = math_1.simpleToExactAmount(620, 15);
            it("should fail setWeightLimits with default signer", async () => {
                await chai_1.expect(mAsset.connect(sa.default.signer).setWeightLimits(newMinWeight, newMaxWeight)).to.revertedWith("Only governor can execute");
            });
            it("should fail setWeightLimits with dummy signer", async () => {
                await chai_1.expect(mAsset.connect(sa.dummy1.signer).setWeightLimits(newMinWeight, newMaxWeight)).to.revertedWith("Only governor can execute");
            });
            it("should fail setWeightLimits with max weight too small", async () => {
                await chai_1.expect(mAsset.setWeightLimits(newMinWeight, math_1.simpleToExactAmount(332, 15))).to.revertedWith("Max weight oob");
            });
            it("should fail setWeightLimits with min weight too large", async () => {
                await chai_1.expect(mAsset.setWeightLimits(math_1.simpleToExactAmount(14, 16), newMaxWeight)).to.revertedWith("Min weight oob");
            });
        });
        describe("should set transfer fee flag", async () => {
            before(async () => {
                await runSetup(true, false, true);
            });
            it("when no integration balance", async () => {
                const { personal } = await details.mAsset.getBasset(details.bAssets[3].address);
                chai_1.expect(personal.hasTxFee).to.be.false;
                const tx = details.mAsset.connect(sa.governor.signer).setTransferFeesFlag(personal.addr, true);
                await chai_1.expect(tx).to.emit(details.wrappedManagerLib, "TransferFeeEnabled").withArgs(personal.addr, true);
                const { personal: after } = await details.mAsset.getBasset(details.bAssets[3].address);
                chai_1.expect(after.hasTxFee).to.be.true;
                // restore the flag back to false
                const tx2 = details.mAsset.connect(sa.governor.signer).setTransferFeesFlag(personal.addr, false);
                await chai_1.expect(tx2).to.emit(details.wrappedManagerLib, "TransferFeeEnabled").withArgs(personal.addr, false);
                await tx2;
                const { personal: end } = await details.mAsset.getBasset(details.bAssets[3].address);
                chai_1.expect(end.hasTxFee).to.be.false;
            });
            it("when an integration balance", async () => {
                const { personal } = await details.mAsset.getBasset(details.bAssets[2].address);
                chai_1.expect(personal.hasTxFee).to.be.false;
                const tx = details.mAsset.connect(sa.governor.signer).setTransferFeesFlag(personal.addr, true);
                await chai_1.expect(tx).to.emit(details.wrappedManagerLib, "TransferFeeEnabled").withArgs(personal.addr, true);
                const { personal: after } = await details.mAsset.getBasset(details.bAssets[2].address);
                chai_1.expect(after.hasTxFee).to.be.true;
                // restore the flag back to false
                const tx2 = details.mAsset.connect(sa.governor.signer).setTransferFeesFlag(personal.addr, false);
                await chai_1.expect(tx2).to.emit(details.wrappedManagerLib, "TransferFeeEnabled").withArgs(personal.addr, false);
                const { personal: end } = await details.mAsset.getBasset(details.bAssets[2].address);
                chai_1.expect(end.hasTxFee).to.be.false;
            });
        });
    });
    context("getters without setters", () => {
        before("init basset", async () => {
            await runSetup();
        });
        it("get config", async () => {
            const { mAsset } = details;
            const config = await mAsset.getConfig();
            chai_1.expect(config.limits.min, "minWeight").to.eq(math_1.simpleToExactAmount(5, 16));
            chai_1.expect(config.limits.max, "maxWeight").to.eq(math_1.simpleToExactAmount(65, 16));
            chai_1.expect(config.a, "a value").to.eq(10000);
            chai_1.expect(config.recolFee, "a value").to.eq(math_1.simpleToExactAmount(5, 13));
        });
        it("should get bAsset", async () => {
            const { mAsset, bAssets } = details;
            const bAsset = await mAsset.getBasset(bAssets[0].address);
            chai_1.expect(bAsset.personal.addr).to.eq(bAsset[0].addr);
            chai_1.expect(bAsset.personal.hasTxFee).to.false;
            chai_1.expect(bAsset.personal.integrator).to.eq(bAsset[0].integrator);
            chai_1.expect(bAsset.personal.status).to.eq(mstable_objects_1.BassetStatus.Normal);
        });
        it("should fail to get bAsset with address 0x0", async () => {
            await chai_1.expect(details.mAsset.getBasset(constants_1.ZERO_ADDRESS)).to.revertedWith("Invalid asset");
        });
        it("should fail to get bAsset not in basket", async () => {
            await chai_1.expect(details.mAsset.getBasset(sa.dummy1.address)).to.revertedWith("Invalid asset");
        });
    });
    context("collecting interest", async () => {
        const unbalancedWeights = [50, 50, 200, 300];
        beforeEach("init basset with vaults", async () => {
            await runSetup(true, false, true, unbalancedWeights);
            // 1.0 Simulate some activity on the lending markets
            // Fast forward a bit so platform interest can be collected
            await time_1.increaseTime(constants_1.TEN_MINS.toNumber());
        });
        it("Collect interest before any fees have been generated", async () => {
            const { mAsset } = details;
            // 1.0 Get all balances and data before
            const { surplus } = await mAsset.data();
            chai_1.expect(surplus).to.eq(0);
            const totalSupplyBefore = await mAsset.totalSupply();
            // 2.0 Static call collectInterest to validate the return values
            const { mintAmount, newSupply } = await mAsset.connect(sa.mockSavingsManager.signer).callStatic.collectInterest();
            chai_1.expect(mintAmount, "mintAmount").to.eq(0);
            chai_1.expect(newSupply, "totalSupply").to.eq(totalSupplyBefore);
            // 3.0 Collect the interest
            const tx = mAsset.connect(sa.mockSavingsManager.signer).collectInterest();
            await chai_1.expect(tx).to.not.emit(mAsset, "MintedMulti");
            // 4.0 Check outputs
            const { surplus: after } = await mAsset.data();
            chai_1.expect(after).to.eq(0);
        });
        it("should collect interest after fees generated from swap", async () => {
            const { bAssets, mAsset } = details;
            // 1.0 Do the necessary approvals before swap
            await mAssetMachine.approveMasset(bAssets[3], mAsset, 20);
            // Do a swap to generate some fees
            await mAsset.swap(bAssets[3].address, bAssets[2].address, math_1.simpleToExactAmount(20, 18), 0, sa.dummy1.address);
            // 2.0 Get all balances and data before
            const { surplus } = await mAsset.data();
            const mAssetBalBefore = await mAsset.balanceOf(sa.mockSavingsManager.address);
            const totalSupplyBefore = await mAsset.totalSupply();
            // 3.0 Check the SavingsManager in the mock Nexus contract
            const nexus = (await hardhat_1.ethers.getContractAt("MockNexus", await mAsset.nexus()));
            const savingsManagerInNexus = await nexus.getModule(utils_1.keccak256(utils_1.toUtf8Bytes("SavingsManager")));
            chai_1.expect(savingsManagerInNexus, "savingsManagerInNexus").to.eq(sa.mockSavingsManager.address);
            //  4.0 Static call collectInterest to validate the return values
            const { mintAmount, newSupply } = await mAsset.connect(sa.mockSavingsManager.signer).callStatic.collectInterest();
            chai_1.expect(mintAmount, "mintAmount").to.eq(surplus.sub(1));
            chai_1.expect(newSupply, "totalSupply").to.eq(totalSupplyBefore.add(surplus).sub(1));
            // 5.0 Collect the interest
            const tx = mAsset.connect(sa.mockSavingsManager.signer).collectInterest();
            // 6.0 Event emits correct unit
            await chai_1.expect(tx, "MintedMulti event").to.emit(mAsset, "MintedMulti");
            // .withArgs(mAsset.address, sa.mockSavingsManager.address, surplus.sub(1), [], [])
            await tx;
            // 7.0 Check outputs
            const { surplus: surplusEnd } = await mAsset.data();
            chai_1.expect(surplusEnd, "after surplus").to.eq(1);
            chai_1.expect(await mAsset.balanceOf(sa.mockSavingsManager.address), "after Saving Manager balance").eq(mAssetBalBefore.add(surplus).sub(1));
            chai_1.expect(await mAsset.totalSupply(), "after totalSupply").to.eq(totalSupplyBefore.add(surplus).sub(1));
        });
        it("should collect platform interest", async () => {
            // 1.0 Another Mint to generate platform interest to collect
            await mAssetMachine.seedWithWeightings(details, unbalancedWeights);
            // 2.0 Get all balances and data before
            const mAssetBalBefore = await details.mAsset.balanceOf(sa.mockSavingsManager.address);
            const bassetsBefore = await mAssetMachine.getBassetsInMasset(details);
            const sumOfVaultsBefore = bassetsBefore.reduce((p, c) => p.add(math_1.applyRatio(c.vaultBalance, c.ratio)), math_1.BN.from(0));
            const totalSupplyBefore = await details.mAsset.totalSupply();
            // 3.0 Check the SavingsManager in the mock Nexus contract
            const nexus = (await hardhat_1.ethers.getContractAt("MockNexus", await details.mAsset.nexus()));
            const savingsManagerInNexus = await nexus.getModule(utils_1.keccak256(utils_1.toUtf8Bytes("SavingsManager")));
            chai_1.expect(savingsManagerInNexus, "savingsManagerInNexus").eq(sa.mockSavingsManager.address);
            // 4.0 Static call of collectPlatformInterest
            const mAsset = details.mAsset.connect(sa.mockSavingsManager.signer);
            const { mintAmount, newSupply } = await mAsset.callStatic.collectPlatformInterest();
            // 5.0 Collect platform interest
            const collectPlatformInterestTx = mAsset.collectPlatformInterest();
            // 6.0 Event emits correct unit
            await chai_1.expect(collectPlatformInterestTx, "MintedMulti event on mAsset")
                .to.emit(mAsset, "MintedMulti")
                .withArgs(mAsset.address, sa.mockSavingsManager.address, mintAmount, [], [0, 0, math_1.simpleToExactAmount(4, 9), math_1.simpleToExactAmount(6, 15)]);
            await chai_1.expect(collectPlatformInterestTx, "Transfer event on mAsset")
                .to.emit(mAsset, "Transfer")
                .withArgs(constants_1.ZERO_ADDRESS, sa.mockSavingsManager.address, mintAmount);
            // 7.0 Check outputs
            const mAssetBalAfter = await details.mAsset.balanceOf(sa.mockSavingsManager.address);
            const bassetsAfter = await mAssetMachine.getBassetsInMasset(details);
            bassetsAfter.forEach((b, i) => {
                if (i > 1) {
                    chai_1.expect(b.vaultBalance, `balance of bAsset[${i}] not increased`).gt(bassetsBefore[i].vaultBalance);
                }
            });
            const totalSupplyAfter = await details.mAsset.totalSupply();
            chai_1.expect(newSupply).to.eq(totalSupplyAfter);
            // 6.1 totalSupply should only increase by <= 0.0005%
            // assertBNSlightlyGTPercent(totalSupplyAfter, totalSupplyBefore, systemMachine.isGanacheFork ? "0.001" : "0.01", true)
            assertions_1.assertBNSlightlyGTPercent(totalSupplyAfter, totalSupplyBefore, "0.01", true);
            // 6.2 check that increase in vault balance is equivalent to total balance
            const increasedTotalSupply = totalSupplyAfter.sub(totalSupplyBefore);
            chai_1.expect(mintAmount).to.eq(increasedTotalSupply);
            // 6.3 Ensure that the SavingsManager received the mAsset
            chai_1.expect(mAssetBalAfter, "mAssetBalAfter").eq(mAssetBalBefore.add(increasedTotalSupply));
        });
        it("should fail to collect platform interest after no activity", async () => {
            const mAsset = details.mAsset.connect(sa.mockSavingsManager.signer);
            await chai_1.expect(mAsset.callStatic.collectPlatformInterest()).to.revertedWith("Must collect something");
        });
        context("only allow the SavingsManager to collect interest", () => {
            it("should fail governor", async () => {
                const { signer } = sa.governor;
                await chai_1.expect(details.mAsset.connect(signer).collectInterest()).to.be.revertedWith("Must be savings manager");
                await chai_1.expect(details.mAsset.connect(signer).collectPlatformInterest()).to.be.revertedWith("Must be savings manager");
            });
            it("should fail the default signer that deployed the contracts", async () => {
                const { signer } = sa.default;
                await chai_1.expect(details.mAsset.connect(signer).collectInterest()).to.be.revertedWith("Must be savings manager");
                await chai_1.expect(details.mAsset.connect(signer).collectPlatformInterest()).to.be.revertedWith("Must be savings manager");
            });
        });
    });
    describe("migrating bAssets between platforms", () => {
        let newMigration;
        let maliciousIntegration;
        let transferringAsset;
        beforeEach(async () => {
            await runSetup(false, false, true);
            [, , , transferringAsset] = details.bAssets;
            newMigration = await (await new generated_1.MockPlatformIntegration__factory(sa.default.signer)).deploy(constants_1.DEAD_ADDRESS, details.aavePlatformAddress, details.bAssets.map((b) => b.address), details.pTokens);
            await newMigration.addWhitelist([details.mAsset.address]);
            maliciousIntegration = await (await new generated_1.MaliciousAaveIntegration__factory(sa.default.signer)).deploy(constants_1.DEAD_ADDRESS, details.aavePlatformAddress, details.bAssets.map((b) => b.address), details.pTokens);
            await maliciousIntegration.addWhitelist([details.mAsset.address]);
        });
        it("should fail if passed 0 bAssets", async () => {
            await chai_1.expect(details.mAsset.connect(sa.governor.signer).migrateBassets([], newMigration.address)).to.be.revertedWith("Must migrate some bAssets");
        });
        it("should fail if bAsset does not exist", async () => {
            await chai_1.expect(details.mAsset.connect(sa.governor.signer).migrateBassets([constants_1.DEAD_ADDRESS], newMigration.address)).to.be.revertedWith("Invalid asset");
        });
        it("should fail if integrator address is the same", async () => {
            await chai_1.expect(details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], details.platform.address)).to.be.revertedWith("Must transfer to new integrator");
        });
        it("should fail if new address is a dud", async () => {
            await chai_1.expect(details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], constants_1.DEAD_ADDRESS)).to.be
                .reverted;
        });
        it("should fail if the full amount is not transferred and deposited", async () => {
            await transferringAsset.transfer(details.platform.address, 10000);
            await details.platform.addWhitelist([sa.governor.address]);
            await details.platform.connect(sa.governor.signer).deposit(transferringAsset.address, 9000, false);
            await chai_1.expect(details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], maliciousIntegration.address)).to.be.revertedWith("Must transfer full amount");
        });
        it("should move all bAssets from a to b", async () => {
            await transferringAsset.transfer(details.platform.address, 10000);
            await details.platform.addWhitelist([sa.governor.address]);
            await details.platform.connect(sa.governor.signer).deposit(transferringAsset.address, 9000, false);
            // get balances before
            const bal = await details.platform.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(bal).eq(9000);
            const rawBal = await transferringAsset.balanceOf(details.platform.address);
            chai_1.expect(rawBal).eq(1000);
            const integratorAddress = (await details.mAsset.getBasset(transferringAsset.address))[0][1];
            chai_1.expect(integratorAddress).eq(details.platform.address);
            // call migrate
            const tx = details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], newMigration.address);
            // emits BassetsMigrated
            await chai_1.expect(tx)
                .to.emit(details.wrappedManagerLib, "BassetsMigrated")
                .withArgs([transferringAsset.address], newMigration.address);
            // moves all bAssets from old to new
            const migratedBal = await newMigration.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(migratedBal).eq(bal);
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address);
            chai_1.expect(migratedRawBal).eq(rawBal);
            // old balances should be empty
            const newRawBal = await transferringAsset.balanceOf(details.platform.address);
            chai_1.expect(newRawBal).eq(0);
            // updates the integrator address
            const [[, newIntegratorAddress]] = await details.mAsset.getBasset(transferringAsset.address);
            chai_1.expect(newIntegratorAddress).eq(newMigration.address);
        });
        it("should pass if either rawBalance or balance are 0", async () => {
            await transferringAsset.transfer(details.platform.address, 10000);
            await details.platform.addWhitelist([sa.governor.address]);
            await details.platform.connect(sa.governor.signer).deposit(transferringAsset.address, 10000, false);
            // get balances before
            const bal = await details.platform.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(bal).eq(10000);
            const rawBal = await transferringAsset.balanceOf(details.platform.address);
            chai_1.expect(rawBal).eq(0);
            const integratorAddress = (await details.mAsset.getBasset(transferringAsset.address))[0][1];
            chai_1.expect(integratorAddress).eq(details.platform.address);
            // call migrate
            const tx = details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], newMigration.address);
            // emits BassetsMigrated
            await chai_1.expect(tx)
                .to.emit(details.wrappedManagerLib, "BassetsMigrated")
                .withArgs([transferringAsset.address], newMigration.address);
            // moves all bAssets from old to new
            const migratedBal = await newMigration.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(migratedBal).eq(bal);
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address);
            chai_1.expect(migratedRawBal).eq(rawBal);
            // updates the integrator address
            const [[, newIntegratorAddress]] = await details.mAsset.getBasset(transferringAsset.address);
            chai_1.expect(newIntegratorAddress).eq(newMigration.address);
        });
    });
    describe("when going from no platform to a platform", () => {
        let newMigration;
        let transferringAsset;
        before(async () => {
            await runSetup(true, false, false);
            const lendingDetail = await mAssetMachine.loadATokens(details.bAssets);
            [, , , transferringAsset] = details.bAssets;
            newMigration = await (await new generated_1.MockPlatformIntegration__factory(sa.default.signer)).deploy(constants_1.DEAD_ADDRESS, lendingDetail.aavePlatformAddress, details.bAssets.map((b) => b.address), lendingDetail.aTokens.map((a) => a.aToken));
            await newMigration.addWhitelist([details.mAsset.address]);
        });
        it("should migrate everything correctly", async () => {
            // get balances before
            const rawBalBefore = await (await details.mAsset.getBasset(transferringAsset.address))[1][1];
            const integratorAddress = (await details.mAsset.getBasset(transferringAsset.address))[0][1];
            chai_1.expect(integratorAddress).eq(constants_1.ZERO_ADDRESS);
            // call migrate
            const tx = details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], newMigration.address);
            // emits BassetsMigrated
            await chai_1.expect(tx)
                .to.emit(details.wrappedManagerLib, "BassetsMigrated")
                .withArgs([transferringAsset.address], newMigration.address);
            // moves all bAssets from old to new
            const migratedBal = await newMigration.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(migratedBal).eq(0);
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address);
            chai_1.expect(migratedRawBal).eq(rawBalBefore);
            // old balances should be empty
            const newRawBal = await transferringAsset.balanceOf(details.mAsset.address);
            chai_1.expect(newRawBal).eq(0);
            // updates the integrator address
            const [[, newIntegratorAddress]] = await details.mAsset.getBasset(transferringAsset.address);
            chai_1.expect(newIntegratorAddress).eq(newMigration.address);
        });
    });
    describe("negateIsolation()", async () => {
        before("init basset with vaults", async () => {
            await runSetup(true, false, true);
        });
        it("should skip when Normal (by governor)", async () => {
            const { bAssets, mAsset, wrappedManagerLib } = details;
            const basketBefore = await mAsset.getBasket();
            chai_1.expect(basketBefore[0]).to.false;
            const tx = mAsset.connect(sa.governor.signer).negateIsolation(bAssets[0].address);
            await chai_1.expect(tx).to.emit(wrappedManagerLib, "BassetStatusChanged").withArgs(bAssets[0].address, mstable_objects_1.BassetStatus.Normal);
            const afterBefore = await mAsset.getBasket();
            chai_1.expect(afterBefore[0]).to.false;
        });
        it("should fail when called by default", async () => {
            const { bAssets, mAsset } = details;
            await chai_1.expect(mAsset.connect(sa.default.signer).negateIsolation(bAssets[0].address)).to.revertedWith("Only governor can execute");
        });
        it("should fail when not called by governor", async () => {
            const { bAssets, mAsset } = details;
            await chai_1.expect(mAsset.connect(sa.other.signer).negateIsolation(bAssets[0].address)).to.revertedWith("Only governor can execute");
        });
        it("should fail when wrong bAsset address passed", async () => {
            const { mAsset } = details;
            await chai_1.expect(mAsset.connect(sa.governor.signer).negateIsolation(sa.other.address)).to.be.revertedWith("Invalid asset");
        });
        it("should succeed when status is 'BrokenAbovePeg' (by governor)", async () => {
            const { bAssets, mAsset, wrappedManagerLib } = details;
            const bAsset = bAssets[1];
            const basketBefore = await mAsset.getBasket();
            chai_1.expect(basketBefore[0], "before undergoingRecol").to.false;
            const bAssetStateBefore = await mAsset.getBasset(bAsset.address);
            chai_1.expect(bAssetStateBefore.personal.status).to.eq(mstable_objects_1.BassetStatus.Normal);
            await mAsset.connect(sa.governor.signer).handlePegLoss(bAsset.address, false);
            const basketAfterPegLoss = await mAsset.getBasket();
            chai_1.expect(basketAfterPegLoss[0], "after handlePegLoss undergoingRecol").to.true;
            const bAssetStateAfterPegLoss = await mAsset.getBasset(bAsset.address);
            chai_1.expect(bAssetStateAfterPegLoss.personal.status, "after handlePegLoss personal.status").to.eq(mstable_objects_1.BassetStatus.BrokenAbovePeg);
            const tx = mAsset.connect(sa.governor.signer).negateIsolation(bAsset.address);
            await chai_1.expect(tx).to.emit(wrappedManagerLib, "BassetStatusChanged").withArgs(bAsset.address, mstable_objects_1.BassetStatus.Normal);
            await tx;
            const basketAfterNegateIsolation = await mAsset.getBasket();
            chai_1.expect(basketAfterNegateIsolation[0], "after negateIsolation undergoingRecol").to.false;
            const bAssetStateAfterNegateIsolation = await mAsset.getBasset(bAsset.address);
            chai_1.expect(bAssetStateAfterNegateIsolation.personal.status, "after negateIsolation personal.status").to.eq(mstable_objects_1.BassetStatus.Normal);
        });
        it("should succeed when two bAssets have BrokenBelowPeg", async () => {
            const { bAssets, mAsset, wrappedManagerLib } = details;
            const basketBefore = await mAsset.getBasket();
            chai_1.expect(basketBefore[0], "before undergoingRecol").to.false;
            await mAsset.connect(sa.governor.signer).handlePegLoss(bAssets[2].address, true);
            await mAsset.connect(sa.governor.signer).handlePegLoss(bAssets[3].address, true);
            const basketAfterPegLoss = await mAsset.getBasket();
            chai_1.expect(basketAfterPegLoss[0], "after handlePegLoss undergoingRecol").to.true;
            const bAsset2StateAfterPegLoss = await mAsset.getBasset(bAssets[2].address);
            chai_1.expect(bAsset2StateAfterPegLoss.personal.status, "after handlePegLoss personal.status 2").to.eq(mstable_objects_1.BassetStatus.BrokenBelowPeg);
            const bAsset3StateAfterPegLoss = await mAsset.getBasset(bAssets[3].address);
            chai_1.expect(bAsset3StateAfterPegLoss.personal.status, "after handlePegLoss personal.status 3").to.eq(mstable_objects_1.BassetStatus.BrokenBelowPeg);
            const tx = mAsset.connect(sa.governor.signer).negateIsolation(bAssets[3].address);
            await chai_1.expect(tx).to.emit(wrappedManagerLib, "BassetStatusChanged").withArgs(bAssets[3].address, mstable_objects_1.BassetStatus.Normal);
            await tx;
            const basketAfterNegateIsolation = await mAsset.getBasket();
            chai_1.expect(basketAfterNegateIsolation[0], "after negateIsolation undergoingRecol").to.true;
            const bAsset2AfterNegateIsolation = await mAsset.getBasset(bAssets[2].address);
            chai_1.expect(bAsset2AfterNegateIsolation.personal.status, "after negateIsolation personal.status 2").to.eq(mstable_objects_1.BassetStatus.BrokenBelowPeg);
            const bAsset3AfterNegateIsolation = await mAsset.getBasset(bAssets[3].address);
            chai_1.expect(bAsset3AfterNegateIsolation.personal.status, "after negateIsolation personal.status 3").to.eq(mstable_objects_1.BassetStatus.Normal);
        });
    });
    describe("Amplification coefficient", () => {
        before(async () => {
            await runSetup();
        });
        it("should succeed in starting increase over 2 weeks", async () => {
            const mAsset = details.mAsset.connect(sa.governor.signer);
            const { ampData: ampDataBefore } = await mAsset.data();
            // default values
            chai_1.expect(ampDataBefore.initialA, "before initialA").to.eq(10000);
            chai_1.expect(ampDataBefore.targetA, "before targetA").to.eq(10000);
            chai_1.expect(ampDataBefore.rampStartTime, "before rampStartTime").to.eq(0);
            chai_1.expect(ampDataBefore.rampEndTime, "before rampEndTime").to.eq(0);
            const startTime = await time_1.getTimestamp();
            const endTime = startTime.add(constants_1.ONE_WEEK.mul(2));
            const tx = mAsset.startRampA(120, endTime);
            await chai_1.expect(tx).to.emit(details.wrappedManagerLib, "StartRampA").withArgs(10000, 12000, startTime.add(1), endTime);
            // after values
            const { ampData: ampDataAfter } = await mAsset.data();
            chai_1.expect(ampDataAfter.initialA, "after initialA").to.eq(10000);
            chai_1.expect(ampDataAfter.targetA, "after targetA").to.eq(12000);
            chai_1.expect(ampDataAfter.rampStartTime, "after rampStartTime").to.eq(startTime.add(1));
            chai_1.expect(ampDataAfter.rampEndTime, "after rampEndTime").to.eq(endTime);
        });
        context("increasing A by 20 over 10 day period", () => {
            let startTime;
            let endTime;
            let mAsset;
            before(async () => {
                await runSetup();
                mAsset = details.mAsset.connect(sa.governor.signer);
                startTime = await time_1.getTimestamp();
                endTime = startTime.add(constants_1.ONE_DAY.mul(10));
                await mAsset.startRampA(120, endTime);
            });
            it("should succeed getting A just after start", async () => {
                chai_1.expect(await mAsset.getA()).to.eq(10000);
            });
            const testsData = [
                {
                    // 60 * 60 * 24 * 10 / 2000 = 432
                    desc: "just under before increment",
                    elapsedSeconds: 431,
                    expectedValaue: 10000,
                },
                {
                    desc: "just under after increment",
                    elapsedSeconds: 434,
                    expectedValaue: 10001,
                },
                {
                    desc: "after 1 day",
                    elapsedSeconds: constants_1.ONE_DAY.add(1),
                    expectedValaue: 10200,
                },
                {
                    desc: "after 9 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(9).add(1),
                    expectedValaue: 11800,
                },
                {
                    desc: "just under 10 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(10).sub(2),
                    expectedValaue: 11999,
                },
                {
                    desc: "after 10 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(10),
                    expectedValaue: 12000,
                },
                {
                    desc: "after 11 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(11),
                    expectedValaue: 12000,
                },
            ];
            for (const testData of testsData) {
                it(`should succeed getting A ${testData.desc}`, async () => {
                    const currentTime = await time_1.getTimestamp();
                    const incrementSeconds = startTime.add(testData.elapsedSeconds).sub(currentTime);
                    await time_1.increaseTime(incrementSeconds);
                    chai_1.expect(await mAsset.getA()).to.eq(testData.expectedValaue);
                });
            }
        });
        context("A target changes just in range", () => {
            let currentA;
            let startTime;
            let endTime;
            beforeEach(async () => {
                await runSetup();
                currentA = await details.mAsset.getA();
                startTime = await time_1.getTimestamp();
                endTime = startTime.add(constants_1.ONE_DAY.mul(7));
            });
            it("should increase target A 10x", async () => {
                // target = current * 10 / 100
                // the 100 is the precision
                const targetA = currentA.div(10);
                await details.mAsset.connect(sa.governor.signer).startRampA(targetA, endTime);
                const { ampData: ampDataAfter } = await details.mAsset.data();
                chai_1.expect(ampDataAfter.targetA, "after targetA").to.eq(targetA.mul(100));
            });
            it("should decrease target A 10x", async () => {
                // target = current / 100 / 10
                // the 100 is the precision
                const targetA = currentA.div(1000);
                await details.mAsset.connect(sa.governor.signer).startRampA(targetA, endTime);
                const { ampData: ampDataAfter } = await details.mAsset.data();
                chai_1.expect(ampDataAfter.targetA, "after targetA").to.eq(targetA.mul(100));
            });
        });
        context("decreasing A by 50 over 5 days", () => {
            let startTime;
            let endTime;
            let mAsset;
            before(async () => {
                await runSetup();
                mAsset = details.mAsset.connect(sa.governor.signer);
                startTime = await time_1.getTimestamp();
                endTime = startTime.add(constants_1.ONE_DAY.mul(5));
                await mAsset.startRampA(50, endTime);
            });
            it("should succeed getting A just after start", async () => {
                chai_1.expect(await mAsset.getA()).to.eq(10000);
            });
            const testsData = [
                {
                    // 60 * 60 * 24 * 5 / 5000 = 86
                    desc: "just under before increment",
                    elapsedSeconds: 84,
                    expectedValaue: 10000,
                },
                {
                    desc: "just under after increment",
                    elapsedSeconds: 88,
                    expectedValaue: 9999,
                },
                {
                    desc: "after 1 day",
                    elapsedSeconds: constants_1.ONE_DAY.add(1),
                    expectedValaue: 9000,
                },
                {
                    desc: "after 4 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(4).add(1),
                    expectedValaue: 6000,
                },
                {
                    desc: "just under 5 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(5).sub(2),
                    expectedValaue: 5001,
                },
                {
                    desc: "after 5 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(5),
                    expectedValaue: 5000,
                },
                {
                    desc: "after 6 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(6),
                    expectedValaue: 5000,
                },
            ];
            for (const testData of testsData) {
                it(`should succeed getting A ${testData.desc}`, async () => {
                    const currentTime = await time_1.getTimestamp();
                    const incrementSeconds = startTime.add(testData.elapsedSeconds).sub(currentTime);
                    await time_1.increaseTime(incrementSeconds);
                    chai_1.expect(await mAsset.getA()).to.eq(testData.expectedValaue);
                });
            }
        });
        describe("should fail to start ramp A", () => {
            before(async () => {
                await runSetup();
            });
            it("when ramp up time only 1 hour", async () => {
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).startRampA(12000, constants_1.ONE_HOUR)).to.revertedWith("Ramp time too short");
            });
            it("when ramp up time just less than 1 day", async () => {
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).startRampA(12000, constants_1.ONE_DAY.sub(1))).to.revertedWith("Ramp time too short");
            });
            it("when A target too big", async () => {
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).startRampA(1000000, endTime)).to.revertedWith("A target out of bounds");
            });
            it("when A target increase greater than 10x", async () => {
                const currentA = await details.mAsset.getA();
                // target = current * 10 / 100
                // the 100 is the precision
                const targetA = currentA.div(10).add(1);
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).startRampA(targetA, endTime)).to.revertedWith("A target increase too big");
            });
            it("when A target decrease greater than 10x", async () => {
                const currentA = await details.mAsset.getA();
                // target = current / 100 / 10
                // the 100 is the precision
                const targetA = currentA.div(1000).sub(1);
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).startRampA(targetA, endTime)).to.revertedWith("A target decrease too big");
            });
            it("when A target is zero", async () => {
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).startRampA(0, endTime)).to.revertedWith("A target out of bounds");
            });
            it("when starting just less than a day after the last finished", async () => {
                const mAsset = details.mAsset.connect(sa.governor.signer);
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(2));
                await mAsset.startRampA(130, endTime);
                // increment 1 day
                await time_1.increaseTime(constants_1.ONE_HOUR.mul(20));
                const secondStartTime = await time_1.getTimestamp();
                const secondEndTime = secondStartTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(mAsset.startRampA(150, secondEndTime)).to.revertedWith("Sufficient period of previous ramp has not elapsed");
            });
        });
        context("stop ramp A", () => {
            let startTime;
            let endTime;
            let mAsset;
            before(async () => {
                await runSetup();
                mAsset = details.mAsset.connect(sa.governor.signer);
                startTime = await time_1.getTimestamp();
                endTime = startTime.add(constants_1.ONE_DAY.mul(5));
                await mAsset.startRampA(50, endTime);
            });
            it("should stop decreasing A after a day", async () => {
                // increment 1 day
                await time_1.increaseTime(constants_1.ONE_DAY);
                const currentA = await mAsset.getA();
                const currentTime = await time_1.getTimestamp();
                const tx = mAsset.stopRampA();
                await chai_1.expect(tx).to.emit(details.wrappedManagerLib, "StopRampA").withArgs(currentA, currentTime.add(1));
                chai_1.expect(await mAsset.getA()).to.eq(currentA);
                const { ampData: ampDataAfter } = await mAsset.data();
                chai_1.expect(ampDataAfter.initialA, "after initialA").to.eq(currentA);
                chai_1.expect(ampDataAfter.targetA, "after targetA").to.eq(currentA);
                chai_1.expect(ampDataAfter.rampStartTime.toNumber(), "after rampStartTime").to.within(currentTime.toNumber(), currentTime.add(2).toNumber());
                chai_1.expect(ampDataAfter.rampEndTime.toNumber(), "after rampEndTime").to.within(currentTime.toNumber(), currentTime.add(2).toNumber());
                // increment another 2 days
                await time_1.increaseTime(constants_1.ONE_DAY.mul(2));
                chai_1.expect(await mAsset.getA()).to.eq(currentA);
            });
        });
        describe("should fail to stop ramp A", () => {
            before(async () => {
                await runSetup();
                const mAsset = details.mAsset.connect(sa.governor.signer);
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(2));
                await mAsset.startRampA(50, endTime);
            });
            it("After ramp has complete", async () => {
                // increment 2 days
                await time_1.increaseTime(constants_1.ONE_DAY.mul(2).add(1));
                await chai_1.expect(details.mAsset.connect(sa.governor.signer).stopRampA()).to.revertedWith("Amplification not changing");
            });
        });
    });
});
//# sourceMappingURL=admin.spec.js.map