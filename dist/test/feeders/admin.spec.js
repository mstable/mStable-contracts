"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const machines_1 = require("@utils/machines");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
const mstable_objects_1 = require("@utils/mstable-objects");
const time_1 = require("@utils/time");
describe("Feeder Admin", () => {
    let sa;
    let mAssetMachine;
    let feederMachine;
    let details;
    const runSetup = async (useLendingMarkets = false, useInterestValidator = false, feederWeights, mAssetWeights) => {
        details = await feederMachine.deployFeeder(feederWeights, mAssetWeights, useLendingMarkets, useInterestValidator);
    };
    before("Init contract", async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        feederMachine = await new machines_1.FeederMachine(mAssetMachine);
        sa = mAssetMachine.sa;
    });
    describe("using basic setters", async () => {
        const newSize = math_1.simpleToExactAmount(1, 16); // 1%
        let pool;
        before("set up", async () => {
            await runSetup();
            pool = await details.pool.connect(sa.governor.signer);
        });
        describe("should allow changing of the cache size to ", () => {
            it("zero", async () => {
                const tx = pool.setCacheSize(0);
                await chai_1.expect(tx).to.emit(pool, "CacheSizeChanged").withArgs(0);
                const { cacheSize } = await pool.data();
                chai_1.expect(cacheSize).eq(0);
            });
            it("1%", async () => {
                const { cacheSize: oldSize } = await pool.data();
                chai_1.expect(oldSize).not.eq(newSize);
                const tx = pool.setCacheSize(newSize);
                await chai_1.expect(tx).to.emit(pool, "CacheSizeChanged").withArgs(newSize);
                const { cacheSize } = await pool.data();
                chai_1.expect(cacheSize).eq(newSize);
            });
            it("20% (cap limit)", async () => {
                const capLimit = math_1.simpleToExactAmount(20, 16); // 20%
                const tx = pool.setCacheSize(capLimit);
                await chai_1.expect(tx).to.emit(pool, "CacheSizeChanged").withArgs(capLimit);
                const { cacheSize } = await pool.data();
                chai_1.expect(cacheSize).eq(capLimit);
            });
        });
        describe("should fail changing the cache size if", () => {
            it("not governor", async () => {
                await chai_1.expect(details.pool.connect(sa.default.signer).setCacheSize(newSize)).to.be.revertedWith("Only governor can execute");
                await chai_1.expect(details.pool.connect(sa.dummy1.signer).setCacheSize(newSize)).to.be.revertedWith("Only governor can execute");
            });
            it("just over cap", async () => {
                const feeExceedingCap = math_1.BN.from("200000000000000001");
                await chai_1.expect(pool.setCacheSize(feeExceedingCap)).to.be.revertedWith("Must be <= 20%");
            });
            it("exceed cap by 1%", async () => {
                const feeExceedingCap = math_1.simpleToExactAmount(21, 16); // 21%
                await chai_1.expect(pool.setCacheSize(feeExceedingCap)).to.be.revertedWith("Must be <= 20%");
            });
            it("exceeding cap with max number", async () => {
                await chai_1.expect(pool.setCacheSize(constants_1.MAX_UINT256)).to.be.revertedWith("Must be <= 20%");
            });
        });
        describe("should change swap and redemption fees to", () => {
            it("0.5% and 0.25%", async () => {
                const poolData = await pool.data();
                const newSwapFee = math_1.simpleToExactAmount(0.5, 16);
                const newRedemptionFee = math_1.simpleToExactAmount(0.25, 16);
                const newGovFee = math_1.simpleToExactAmount(2, 17);
                chai_1.expect(poolData.swapFee).not.eq(newSwapFee);
                chai_1.expect(poolData.redemptionFee).not.eq(newRedemptionFee);
                chai_1.expect(poolData.govFee).not.eq(newGovFee);
                const tx = pool.setFees(newSwapFee, newRedemptionFee, newGovFee);
                await chai_1.expect(tx).to.emit(pool, "FeesChanged").withArgs(newSwapFee, newRedemptionFee, newGovFee);
                const { swapFee, redemptionFee, govFee } = await pool.data();
                chai_1.expect(swapFee).eq(newSwapFee);
                chai_1.expect(redemptionFee).eq(newRedemptionFee);
                chai_1.expect(govFee).eq(newGovFee);
            });
            it("1% (limit)", async () => {
                const newFee = math_1.simpleToExactAmount(1, 16);
                const tx = pool.setFees(newFee, newFee, newFee);
                await chai_1.expect(tx).to.emit(pool, "FeesChanged").withArgs(newFee, newFee, newFee);
                const { swapFee, redemptionFee } = await pool.data();
                chai_1.expect(swapFee).eq(newFee);
                chai_1.expect(redemptionFee).eq(newFee);
            });
            it("50% limit for gov fee", async () => {
                const newFee = math_1.simpleToExactAmount(1, 15);
                const newGovFee = math_1.simpleToExactAmount(5, 17);
                const tx = pool.setFees(newFee, newFee, newGovFee);
                await chai_1.expect(tx).to.emit(pool, "FeesChanged").withArgs(newFee, newFee, newGovFee);
                const { swapFee, redemptionFee, govFee } = await pool.data();
                chai_1.expect(swapFee).eq(newFee);
                chai_1.expect(redemptionFee).eq(newFee);
                chai_1.expect(govFee).eq(newGovFee);
            });
        });
        describe("should fail to change swap fee rate when", () => {
            const cap = "10000000000000000";
            const overCap = "10000000000000001";
            const overGovCap = "500000000000000001";
            it("not governor", async () => {
                const fee = math_1.simpleToExactAmount(2, 16);
                await chai_1.expect(details.pool.setFees(fee, fee, fee)).to.be.revertedWith("Only governor can execute");
            });
            it("Swap rate just exceeds 1% cap", async () => {
                await chai_1.expect(pool.setFees(overCap, cap, cap)).to.be.revertedWith("Swap rate oob");
            });
            it("Redemption rate just exceeds 1% cap", async () => {
                await chai_1.expect(pool.setFees(cap, overCap, cap)).to.be.revertedWith("Redemption rate oob");
            });
            it("Gov rate just exceeds 50% cap", async () => {
                await chai_1.expect(pool.setFees(cap, cap, overGovCap)).to.be.revertedWith("Gov fee rate oob");
            });
            it("2% rate exceeds 1% cap", async () => {
                const fee = math_1.simpleToExactAmount(2, 16); // 2%
                await chai_1.expect(pool.setFees(fee, fee, cap)).to.be.revertedWith("Swap rate oob");
            });
            it("max rate", async () => {
                const fee = constants_1.MAX_UINT256;
                await chai_1.expect(pool.setFees(fee, fee, fee)).to.be.revertedWith("Swap rate oob");
            });
        });
        it("should set weights", async () => {
            let poolData = await pool.data();
            const beforeWeightLimits = poolData.weightLimits;
            const newMinWeight = math_1.simpleToExactAmount(30, 16);
            const newMaxWeight = math_1.simpleToExactAmount(70, 16);
            const tx = pool.setWeightLimits(newMinWeight, newMaxWeight);
            await chai_1.expect(tx, "WeightLimitsChanged event").to.emit(pool, "WeightLimitsChanged").withArgs(newMinWeight, newMaxWeight);
            await tx;
            poolData = await pool.data();
            const afterWeightLimits = poolData.weightLimits;
            chai_1.expect(afterWeightLimits.min, "before and after min weight not equal").not.to.eq(beforeWeightLimits.min);
            chai_1.expect(afterWeightLimits.max, "before and after max weight not equal").not.to.eq(beforeWeightLimits.max);
            chai_1.expect(afterWeightLimits.min, "min weight set").to.eq(newMinWeight);
            chai_1.expect(afterWeightLimits.max, "max weight set").to.eq(newMaxWeight);
        });
        describe("failed set max weight", () => {
            const newMinWeight = math_1.simpleToExactAmount(1, 16);
            const newMaxWeight = math_1.simpleToExactAmount(620, 15);
            it("should fail setWeightLimits with default signer", async () => {
                await chai_1.expect(pool.connect(sa.default.signer).setWeightLimits(newMinWeight, newMaxWeight)).to.revertedWith("Only governor can execute");
            });
            it("should fail setWeightLimits with dummy signer", async () => {
                await chai_1.expect(pool.connect(sa.dummy1.signer).setWeightLimits(newMinWeight, newMaxWeight)).to.revertedWith("Only governor can execute");
            });
            it("should fail setWeightLimits with max weight too small", async () => {
                await chai_1.expect(pool.setWeightLimits(newMinWeight, math_1.simpleToExactAmount(699, 15))).to.revertedWith("Weights oob");
            });
            it("should fail setWeightLimits with min weight too large", async () => {
                await chai_1.expect(pool.setWeightLimits(math_1.simpleToExactAmount(299, 15), newMaxWeight)).to.revertedWith("Weights oob");
            });
        });
    });
    context("getters without setters", () => {
        before("init basset", async () => {
            await runSetup();
        });
        it("get config", async () => {
            const { pool } = details;
            const config = await pool.getConfig();
            chai_1.expect(config.limits.min, "minWeight").to.eq(math_1.simpleToExactAmount(20, 16));
            chai_1.expect(config.limits.max, "maxWeight").to.eq(math_1.simpleToExactAmount(80, 16));
            chai_1.expect(config.a, "a value").to.eq(30000);
        });
        it("should get mStable asset", async () => {
            const { pool, mAsset } = details;
            const asset = await pool.getBasset(mAsset.address);
            chai_1.expect(asset.personal.addr, "personal.addr").to.eq(mAsset.address);
            chai_1.expect(asset.personal.hasTxFee, "personal.hasTxFee").to.false;
            chai_1.expect(asset.personal.integrator, "personal.integrator").to.eq(constants_1.ZERO_ADDRESS);
            chai_1.expect(asset.personal.status, "personal.status").to.eq(mstable_objects_1.BassetStatus.Normal);
            chai_1.expect(asset.vaultData.ratio).to.eq(math_1.simpleToExactAmount(1, 8)); // 26 - 18
            chai_1.expect(asset.vaultData.vaultBalance, "vaultData.vaultBalance").to.gt(0);
        });
        it("should get feeder asset", async () => {
            const { pool, fAsset } = details;
            const asset = await pool.getBasset(fAsset.address);
            chai_1.expect(asset.personal.addr, "personal.addr").to.eq(fAsset.address);
            chai_1.expect(asset.personal.hasTxFee, "personal.hasTxFee").to.false;
            chai_1.expect(asset.personal.integrator, "personal.integrator").to.eq(constants_1.ZERO_ADDRESS);
            chai_1.expect(asset.personal.status, "personal.status").to.eq(mstable_objects_1.BassetStatus.Normal);
            chai_1.expect(asset.vaultData.ratio).to.eq(math_1.simpleToExactAmount(1, 8)); // 26 - 18
            chai_1.expect(asset.vaultData.vaultBalance, "vaultData.vaultBalance").to.gt(0);
        });
        it("should fail to get bAsset with address 0x0", async () => {
            await chai_1.expect(details.pool.getBasset(constants_1.ZERO_ADDRESS)).to.revertedWith("Invalid asset");
        });
        it("should fail to get bAsset not in basket", async () => {
            await chai_1.expect(details.pool.getBasset(sa.dummy1.address)).to.revertedWith("Invalid asset");
        });
    });
    describe("Amplification coefficient", () => {
        before(async () => {
            await runSetup();
        });
        it("should succeed in starting increase over 2 weeks", async () => {
            const pool = details.pool.connect(sa.governor.signer);
            const { ampData: ampDataBefore } = await pool.data();
            // default values
            chai_1.expect(ampDataBefore.initialA, "before initialA").to.eq(30000);
            chai_1.expect(ampDataBefore.targetA, "before targetA").to.eq(30000);
            chai_1.expect(ampDataBefore.rampStartTime, "before rampStartTime").to.eq(0);
            chai_1.expect(ampDataBefore.rampEndTime, "before rampEndTime").to.eq(0);
            const startTime = await time_1.getTimestamp();
            const endTime = startTime.add(constants_1.ONE_WEEK.mul(2));
            const tx = pool.startRampA(400, endTime);
            await chai_1.expect(tx).to.emit(pool, "StartRampA").withArgs(30000, 40000, startTime.add(1), endTime);
            // after values
            const { ampData: ampDataAfter } = await pool.data();
            chai_1.expect(ampDataAfter.initialA, "after initialA").to.eq(30000);
            chai_1.expect(ampDataAfter.targetA, "after targetA").to.eq(40000);
            chai_1.expect(ampDataAfter.rampStartTime, "after rampStartTime").to.eq(startTime.add(1));
            chai_1.expect(ampDataAfter.rampEndTime, "after rampEndTime").to.eq(endTime);
        });
        context("increasing A by 20 over 10 day period", () => {
            let startTime;
            let endTime;
            let pool;
            before(async () => {
                await runSetup();
                pool = details.pool.connect(sa.governor.signer);
                startTime = await time_1.getTimestamp();
                endTime = startTime.add(constants_1.ONE_DAY.mul(10));
                await pool.startRampA(400, endTime);
            });
            it("should succeed getting A just after start", async () => {
                const config = await pool.getConfig();
                chai_1.expect(config.a).to.eq(30000);
            });
            const testsData = [
                {
                    // 60 * 60 * 24 * 10 / 2000 = 432
                    desc: "just under before increment",
                    elapsedSeconds: 61,
                    expectedValaue: 30000,
                },
                {
                    desc: "just under after increment",
                    elapsedSeconds: 434,
                    expectedValaue: 30005,
                },
                {
                    desc: "after 1 day",
                    elapsedSeconds: constants_1.ONE_DAY.add(1),
                    expectedValaue: 31000,
                },
                {
                    desc: "after 9 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(9).add(1),
                    expectedValaue: 39000,
                },
                {
                    desc: "just under 10 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(10).sub(2),
                    expectedValaue: 39999,
                },
                {
                    desc: "after 10 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(10),
                    expectedValaue: 40000,
                },
                {
                    desc: "after 11 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(11),
                    expectedValaue: 40000,
                },
            ];
            for (const testData of testsData) {
                it(`should succeed getting A ${testData.desc}`, async () => {
                    const currentTime = await time_1.getTimestamp();
                    const incrementSeconds = startTime.add(testData.elapsedSeconds).sub(currentTime);
                    await time_1.increaseTime(incrementSeconds);
                    const config = await pool.getConfig();
                    chai_1.expect(config.a).to.eq(testData.expectedValaue);
                });
            }
        });
        context("A target changes just in range", () => {
            let currentA;
            let startTime;
            let endTime;
            beforeEach(async () => {
                await runSetup();
                const config = await details.pool.getConfig();
                currentA = config.a;
                startTime = await time_1.getTimestamp();
                endTime = startTime.add(constants_1.ONE_DAY.mul(7));
            });
            it("should increase target A 10x", async () => {
                const { pool } = details;
                const { ampData: ampDataBefore } = await details.pool.data();
                chai_1.expect(ampDataBefore.initialA, "before initialA").to.eq(currentA);
                chai_1.expect(ampDataBefore.targetA, "before targetA").to.eq(currentA);
                const targetA = currentA.mul(10).div(100);
                const tx = details.pool.connect(sa.governor.signer).startRampA(targetA, endTime);
                await chai_1.expect(tx).to.emit(pool, "StartRampA");
                const { ampData: ampDataAfter } = await details.pool.data();
                chai_1.expect(ampDataAfter.initialA, "after initialA").to.eq(currentA);
                chai_1.expect(ampDataAfter.targetA, "after targetA").to.eq(currentA.mul(10));
            });
            it("should decrease target A 10x", async () => {
                const { pool } = details;
                const { ampData: ampDataBefore } = await details.pool.data();
                chai_1.expect(ampDataBefore.initialA, "before initialA").to.eq(currentA);
                chai_1.expect(ampDataBefore.targetA, "before targetA").to.eq(currentA);
                const targetA = currentA.div(10).div(100);
                const tx = details.pool.connect(sa.governor.signer).startRampA(targetA, endTime);
                await chai_1.expect(tx).to.emit(pool, "StartRampA");
                const { ampData: ampDataAfter } = await details.pool.data();
                chai_1.expect(ampDataAfter.initialA, "after initialA").to.eq(currentA);
                chai_1.expect(ampDataAfter.targetA, "after targetA").to.eq(currentA.div(10));
            });
        });
        context("decreasing A by 50 over 5 days", () => {
            let startTime;
            let endTime;
            let pool;
            before(async () => {
                await runSetup();
                pool = details.pool.connect(sa.governor.signer);
                startTime = await time_1.getTimestamp();
                endTime = startTime.add(constants_1.ONE_DAY.mul(5));
                await pool.startRampA(150, endTime);
            });
            it("should succeed getting A just after start", async () => {
                const config = await pool.getConfig();
                chai_1.expect(config.a).to.eq(30000);
            });
            const testsData = [
                {
                    // 60 * 60 * 24 * 5 / 5000 = 86
                    desc: "just under before increment",
                    elapsedSeconds: 24,
                    expectedValaue: 30000,
                },
                {
                    desc: "just under after increment",
                    elapsedSeconds: 88,
                    expectedValaue: 29997,
                },
                {
                    desc: "after 1 day",
                    elapsedSeconds: constants_1.ONE_DAY.add(1),
                    expectedValaue: 27000,
                },
                {
                    desc: "after 4 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(4).add(1),
                    expectedValaue: 18000,
                },
                {
                    desc: "just under 5 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(5).sub(2),
                    expectedValaue: 15001,
                },
                {
                    desc: "after 5 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(5),
                    expectedValaue: 15000,
                },
                {
                    desc: "after 6 days",
                    elapsedSeconds: constants_1.ONE_DAY.mul(6),
                    expectedValaue: 15000,
                },
            ];
            for (const testData of testsData) {
                it(`should succeed getting A ${testData.desc}`, async () => {
                    const currentTime = await time_1.getTimestamp();
                    const incrementSeconds = startTime.add(testData.elapsedSeconds).sub(currentTime);
                    await time_1.increaseTime(incrementSeconds);
                    const config = await pool.getConfig();
                    chai_1.expect(config.a).to.eq(testData.expectedValaue);
                });
            }
        });
        describe("should fail to start ramp A", () => {
            before(async () => {
                await runSetup();
            });
            it("when ramp up time only 1 hour", async () => {
                await chai_1.expect(details.pool.connect(sa.governor.signer).startRampA(12000, constants_1.ONE_HOUR)).to.revertedWith("Ramp time too short");
            });
            it("when ramp up time just less than 1 day", async () => {
                await chai_1.expect(details.pool.connect(sa.governor.signer).startRampA(12000, constants_1.ONE_DAY.sub(1))).to.revertedWith("Ramp time too short");
            });
            it("when A target too big", async () => {
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(details.pool.connect(sa.governor.signer).startRampA(1000000, endTime)).to.revertedWith("A target out of bounds");
            });
            it("when A target increase greater than 10x", async () => {
                const config = await details.pool.getConfig();
                const currentA = config.a;
                // target = current * 10 / 100
                // the 100 is the precision
                const targetA = currentA.div(10).add(1);
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(details.pool.connect(sa.governor.signer).startRampA(targetA, endTime)).to.revertedWith("A target increase too big");
            });
            it("when A target decrease greater than 10x", async () => {
                const config = await details.pool.getConfig();
                const currentA = config.a;
                // target = current / 100 / 10
                // the 100 is the precision
                const targetA = currentA.div(1000).sub(1);
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(details.pool.connect(sa.governor.signer).startRampA(targetA, endTime)).to.revertedWith("A target decrease too big");
            });
            it("when A target is zero", async () => {
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(details.pool.connect(sa.governor.signer).startRampA(0, endTime)).to.revertedWith("A target out of bounds");
            });
            it("when starting just less than a day after the last finished", async () => {
                const pool = details.pool.connect(sa.governor.signer);
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(2));
                await pool.startRampA(130, endTime);
                // increment 1 day
                await time_1.increaseTime(constants_1.ONE_HOUR.mul(20));
                const secondStartTime = await time_1.getTimestamp();
                const secondEndTime = secondStartTime.add(constants_1.ONE_DAY.mul(7));
                await chai_1.expect(pool.startRampA(150, secondEndTime)).to.revertedWith("Sufficient period of previous ramp has not elapsed");
            });
        });
        context("stop ramp A", () => {
            let startTime;
            let endTime;
            let pool;
            before(async () => {
                await runSetup();
                pool = details.pool.connect(sa.governor.signer);
                startTime = await time_1.getTimestamp();
                endTime = startTime.add(constants_1.ONE_DAY.mul(5));
                await pool.startRampA(50, endTime);
            });
            it("should stop decreasing A after a day", async () => {
                // increment 1 day
                await time_1.increaseTime(constants_1.ONE_DAY);
                let config = await details.pool.getConfig();
                const currentA = config.a;
                const currentTime = await time_1.getTimestamp();
                const tx = pool.stopRampA();
                await chai_1.expect(tx).to.emit(pool, "StopRampA").withArgs(currentA, currentTime.add(1));
                config = await details.pool.getConfig();
                chai_1.expect(config.a).to.eq(currentA);
                const { ampData: ampDataAfter } = await pool.data();
                chai_1.expect(ampDataAfter.initialA, "after initialA").to.eq(currentA);
                chai_1.expect(ampDataAfter.targetA, "after targetA").to.eq(currentA);
                chai_1.expect(ampDataAfter.rampStartTime.toNumber(), "after rampStartTime").to.within(currentTime.toNumber(), currentTime.add(2).toNumber());
                chai_1.expect(ampDataAfter.rampEndTime.toNumber(), "after rampEndTime").to.within(currentTime.toNumber(), currentTime.add(2).toNumber());
                // increment another 2 days
                await time_1.increaseTime(constants_1.ONE_DAY.mul(2));
                config = await details.pool.getConfig();
                chai_1.expect(config.a).to.eq(currentA);
            });
        });
        describe("should fail to stop ramp A", () => {
            before(async () => {
                await runSetup();
                const pool = details.pool.connect(sa.governor.signer);
                const startTime = await time_1.getTimestamp();
                const endTime = startTime.add(constants_1.ONE_DAY.mul(2));
                await pool.startRampA(50, endTime);
            });
            it("After ramp has complete", async () => {
                // increment 2 days
                await time_1.increaseTime(constants_1.ONE_DAY.mul(2).add(1));
                await chai_1.expect(details.pool.connect(sa.governor.signer).stopRampA()).to.revertedWith("Amplification not changing");
            });
        });
    });
    context("Collect platform interest", async () => {
        context("with no platform integration", () => {
            before(async () => {
                await runSetup();
            });
            it("Should collect zero platform interest", async () => {
                const { pool } = details;
                const tx = pool.connect(sa.mockInterestValidator.signer).collectPlatformInterest();
                await chai_1.expect(tx).to.emit(pool, "MintedMulti").withArgs(pool.address, sa.mockInterestValidator.address, 0, [], [0, 0]);
            });
            it("Should collect zero platform interest even after minting a mAsset", async () => {
                const { pool, mAsset } = details;
                // increase the test chain by 12 hours + 20 seconds
                await time_1.increaseTime(constants_1.ONE_HOUR.mul(12).add(20));
                // Mint mAsset to generate some interest in the lending market
                await feederMachine.approveFeeder(mAsset, pool.address, 1000);
                await pool.mint(mAsset.address, math_1.simpleToExactAmount(500), 0, sa.default.address);
                const tx = pool.connect(sa.mockInterestValidator.signer).collectPlatformInterest();
                await chai_1.expect(tx).to.emit(pool, "MintedMulti").withArgs(pool.address, sa.mockInterestValidator.address, 0, [], [0, 0]);
            });
        });
        context("mocking the interest validator", () => {
            before(async () => {
                // Deploy feeder pool using lending market
                await runSetup(true);
            });
            it("Should collect zero platform interest", async () => {
                const { pool } = details;
                const tx = pool.connect(sa.mockInterestValidator.signer).collectPlatformInterest();
                await chai_1.expect(tx).to.emit(pool, "MintedMulti");
            });
            it("Should collect interest from mAsset", async () => {
                const { pool, mAsset } = details;
                // increase the test chain by 12 hours + 20 seconds
                await time_1.increaseTime(constants_1.ONE_HOUR.mul(12).add(20));
                // Mint mAsset to generate some interest in the lending market
                await feederMachine.approveFeeder(mAsset, pool.address, 1000);
                await pool.mint(mAsset.address, math_1.simpleToExactAmount(500), 0, sa.default.address);
                const tx = pool.connect(sa.mockInterestValidator.signer).collectPlatformInterest();
                await chai_1.expect(tx).to.emit(pool, "MintedMulti");
            });
            it("Should collect interest from fAsset", async () => {
                const { fAsset, pool } = details;
                // increase the test chain by 12 hours + 20 seconds
                await time_1.increaseTime(constants_1.ONE_HOUR.mul(12).add(20));
                // Mint fAsset to generate some interest in the lending market
                await feederMachine.approveFeeder(fAsset, pool.address, 1000);
                await pool.mint(fAsset.address, math_1.simpleToExactAmount(500), 0, sa.default.address);
                const tx = pool.connect(sa.mockInterestValidator.signer).collectPlatformInterest();
                await chai_1.expect(tx).to.emit(pool, "MintedMulti");
            });
            it("Should collect interest from mAsset and fAsset", async () => {
                const { fAsset, pool, mAsset } = details;
                // increase the test chain by 12 hours + 20 seconds
                await time_1.increaseTime(constants_1.ONE_HOUR.mul(12).add(20));
                // Mint mAsset to generate some interest in the lending market
                await feederMachine.approveFeeder(mAsset, pool.address, 1000);
                await pool.mint(mAsset.address, math_1.simpleToExactAmount(500), 0, sa.default.address);
                // Mint fAsset to generate some interest in the lending market
                await feederMachine.approveFeeder(fAsset, pool.address, 1000);
                await pool.mint(fAsset.address, math_1.simpleToExactAmount(500), 0, sa.default.address);
                const tx = pool.connect(sa.mockInterestValidator.signer).collectPlatformInterest();
                await chai_1.expect(tx).to.emit(pool, "MintedMulti");
            });
            context("should fail to collect interest when sender is", () => {
                it("governor", async () => {
                    await chai_1.expect(details.pool.connect(sa.governor.signer).collectPlatformInterest()).to.revertedWith("Only validator");
                });
                it("default", async () => {
                    await chai_1.expect(details.pool.connect(sa.default.signer).collectPlatformInterest()).to.revertedWith("Only validator");
                });
                it("fundManager", async () => {
                    await chai_1.expect(details.pool.connect(sa.fundManager.signer).collectPlatformInterest()).to.revertedWith("Only validator");
                });
            });
        });
        context("using the interest validator contract and lending markets", () => {
            before(async () => {
                // Deploy interest validation contract with the feeder pool and lending market
                await runSetup(true, true);
            });
            it("should collect zero platform interest", async () => {
                const { interestValidator, pool } = details;
                const tx = interestValidator.collectAndValidateInterest([pool.address]);
                await chai_1.expect(tx).to.emit(interestValidator, "InterestCollected");
                await chai_1.expect(tx).to.emit(pool, "MintedMulti");
            });
            it("should collect platform interest", async () => {
                const { interestValidator, fAsset, pool } = details;
                // increase the test chain by 12 hours + 20 seconds
                await time_1.increaseTime(constants_1.ONE_HOUR.mul(12).add(20));
                // Mint to generate some interest in the lending market
                await feederMachine.approveFeeder(fAsset, pool.address, 1000);
                await pool.mint(fAsset.address, math_1.simpleToExactAmount(500), 0, sa.default.address);
                const tx = interestValidator.collectAndValidateInterest([pool.address]);
                await chai_1.expect(tx).to.emit(interestValidator, "InterestCollected");
                await chai_1.expect(tx).to.emit(pool, "MintedMulti");
            });
            it("should fail to collect platform interest twice in 12 hours", async () => {
                const { interestValidator, pool } = details;
                const tx = interestValidator.collectAndValidateInterest([pool.address]);
                await chai_1.expect(tx).to.revertedWith("Cannot collect twice in 12 hours");
            });
            it("should fail to collect platform interest twice just before 12 hours", async () => {
                const { interestValidator, fAsset, pool } = details;
                // Mint to generate some interest in the lending markets
                await feederMachine.approveFeeder(fAsset, pool.address, 1000);
                await pool.mint(fAsset.address, math_1.simpleToExactAmount(5), 0, sa.default.address);
                // increase the test chain by 12 hours - 20 seconds
                await time_1.increaseTime(constants_1.ONE_HOUR.mul(12).sub(20));
                const tx = interestValidator.collectAndValidateInterest([pool.address]);
                await chai_1.expect(tx).to.revertedWith("Cannot collect twice in 12 hours");
            });
            it("should collect platform interest after 12 hours", async () => {
                const { interestValidator, pool } = details;
                await time_1.increaseTime(constants_1.ONE_MIN);
                const tx = interestValidator.collectAndValidateInterest([pool.address]);
                await chai_1.expect(tx).to.emit(interestValidator, "InterestCollected");
                await chai_1.expect(tx).to.emit(pool, "MintedMulti");
            });
        });
        context("using the interest validator contract to collect pending govFees", () => {
            before(async () => {
                await runSetup(false, true);
            });
            it("redeems fpTokens for mAsset and then sends to savingsManager", async () => {
                const { interestValidator, pool, bAssets, mAsset } = details;
                // Accrue some fees for gov
                await pool.redeem(bAssets[0].address, math_1.simpleToExactAmount(10), 0, sa.default.address);
                const { pendingFees: beforePendingFees } = await pool.data();
                chai_1.expect(beforePendingFees).gt(math_1.simpleToExactAmount(1, 13));
                const expectedOutput = await pool["getRedeemOutput(address,uint256)"](mAsset.address, beforePendingFees);
                // Get balance of SM
                const balBefore = await mAsset.balanceOf(sa.mockSavingsManager.address);
                const tx = interestValidator.connect(sa.governor.signer).collectGovFees([pool.address]);
                await chai_1.expect(tx).to.emit(interestValidator, "GovFeeCollected").withArgs(pool.address, mAsset.address, expectedOutput);
                await (await tx).wait();
                const { pendingFees: afterPendingFees } = await pool.data();
                const balAfter = await mAsset.balanceOf(sa.mockSavingsManager.address);
                chai_1.expect(afterPendingFees).lt(beforePendingFees);
                chai_1.expect(balAfter).eq(balBefore.add(expectedOutput));
            });
            it("fails if given invalid fPool addr", async () => {
                const { interestValidator, pool } = details;
                await chai_1.expect(interestValidator.collectGovFees([pool.address])).to.revertedWith("Only governor");
            });
            it("fails if not called by governor", async () => {
                const { interestValidator } = details;
                await chai_1.expect(interestValidator.collectGovFees([sa.default.address])).to.reverted;
            });
        });
    });
    context("Collect pending fees", async () => {
        before(async () => {
            await runSetup();
        });
        it("should not collect any fees if no swaps or redemptions", async () => {
            const { pool } = details;
            const tx = pool.connect(sa.mockInterestValidator.signer).collectPendingFees();
            await chai_1.expect(tx).to.not.emit(pool, "MintedMulti");
        });
        it("should collect gov fee as the interest validator", async () => {
            const { pool, fAsset, mAsset } = details;
            // Swap mAsset for fAsset to generate some gov fees
            await feederMachine.approveFeeder(mAsset, pool.address, math_1.simpleToExactAmount(10), sa.default.signer, true);
            const swapTx = await pool.swap(mAsset.address, fAsset.address, math_1.simpleToExactAmount(10), 0, sa.default.address);
            const swapReceipt = await swapTx.wait();
            chai_1.expect(swapReceipt.events[3].event).to.eq("Swapped");
            const swapFee = swapReceipt.events[3].args.fee;
            const tx = details.pool.connect(sa.mockInterestValidator.signer).collectPendingFees();
            await chai_1.expect(tx).to.emit(pool, "MintedMulti");
            const receipt = await (await tx).wait();
            chai_1.expect(receipt.events[1].event).to.eq("MintedMulti");
            chai_1.expect(receipt.events[1].args.minter).to.eq(details.pool.address);
            chai_1.expect(receipt.events[1].args.recipient).to.eq(sa.mockInterestValidator.address);
            // gov fee is 10% of the swap fee - 1
            chai_1.expect(receipt.events[1].args.output).to.eq(swapFee.div(10).sub(1));
            chai_1.expect(receipt.events[1].args.inputs).to.length(0);
            chai_1.expect(receipt.events[1].args.inputQuantities).to.length(0);
        });
        it("should not collect any fees if already collected pending fees", async () => {
            const { pool } = details;
            const tx = pool.connect(sa.mockInterestValidator.signer).collectPendingFees();
            await chai_1.expect(tx).to.not.emit(pool, "MintedMulti");
        });
        context("should fail to collect pending fees when sender is", () => {
            it("governor", async () => {
                await chai_1.expect(details.pool.connect(sa.governor.signer).collectPendingFees()).to.revertedWith("Only validator");
            });
            it("default", async () => {
                await chai_1.expect(details.pool.connect(sa.default.signer).collectPendingFees()).to.revertedWith("Only validator");
            });
            it("fundManager", async () => {
                await chai_1.expect(details.pool.connect(sa.fundManager.signer).collectPendingFees()).to.revertedWith("Only validator");
            });
        });
    });
    describe("migrating bAssets between platforms", () => {
        let newMigration;
        let maliciousIntegration;
        let transferringAsset;
        before(async () => {
            // Deploy using lending markets and do not seed the pool
            await runSetup(true, false, []);
            const { bAssets, fAsset, mAssetDetails, pool, pTokens } = details;
            const { platform } = details.mAssetDetails;
            transferringAsset = fAsset;
            newMigration = await (await new generated_1.MockPlatformIntegration__factory(sa.default.signer)).deploy(constants_1.DEAD_ADDRESS, mAssetDetails.aavePlatformAddress, bAssets.map((b) => b.address), pTokens);
            await newMigration.addWhitelist([pool.address]);
            maliciousIntegration = await (await new generated_1.MaliciousAaveIntegration__factory(sa.default.signer)).deploy(constants_1.DEAD_ADDRESS, mAssetDetails.aavePlatformAddress, bAssets.map((b) => b.address), pTokens);
            await maliciousIntegration.addWhitelist([pool.address]);
            await platform.addWhitelist([sa.governor.address]);
            await transferringAsset.transfer(platform.address, 10000);
            await platform.connect(sa.governor.signer).deposit(transferringAsset.address, 9000, false);
        });
        it("should fail if passed 0 bAssets", async () => {
            await chai_1.expect(details.pool.connect(sa.governor.signer).migrateBassets([], newMigration.address)).to.be.revertedWith("Must migrate some bAssets");
        });
        it("should fail if bAsset does not exist", async () => {
            await chai_1.expect(details.pool.connect(sa.governor.signer).migrateBassets([constants_1.DEAD_ADDRESS], newMigration.address)).to.be.revertedWith("Invalid asset");
        });
        it("should fail if integrator address is the same", async () => {
            await chai_1.expect(details.pool
                .connect(sa.governor.signer)
                .migrateBassets([transferringAsset.address], details.mAssetDetails.platform.address)).to.be.revertedWith("Must transfer to new integrator");
        });
        it("should fail if new address is a dud", async () => {
            await chai_1.expect(details.pool.connect(sa.governor.signer).migrateBassets([transferringAsset.address], constants_1.DEAD_ADDRESS)).to.be.reverted;
        });
        it("should fail if the full amount is not transferred and deposited", async () => {
            await chai_1.expect(details.pool.connect(sa.governor.signer).migrateBassets([transferringAsset.address], maliciousIntegration.address)).to.be.revertedWith("Must transfer full amount");
        });
        it("should move all bAssets from a to b", async () => {
            const { pool } = details;
            const { platform } = details.mAssetDetails;
            // get balances before
            const bal = await platform.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(bal).eq(9000);
            const rawBal = await transferringAsset.balanceOf(platform.address);
            chai_1.expect(rawBal).eq(1000);
            const integratorAddress = (await details.pool.getBasset(transferringAsset.address))[0][1];
            chai_1.expect(integratorAddress).eq(platform.address);
            // call migrate
            const tx = pool.connect(sa.governor.signer).migrateBassets([transferringAsset.address], newMigration.address);
            // emits BassetsMigrated
            await chai_1.expect(tx).to.emit(pool, "BassetsMigrated").withArgs([transferringAsset.address], newMigration.address);
            // moves all bAssets from old to new
            const migratedBal = await newMigration.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(migratedBal).eq(bal);
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address);
            chai_1.expect(migratedRawBal).eq(rawBal);
            // old balances should be empty
            const newRawBal = await transferringAsset.balanceOf(platform.address);
            chai_1.expect(newRawBal).eq(0);
            // updates the integrator address
            const [[, newIntegratorAddress]] = await pool.getBasset(transferringAsset.address);
            chai_1.expect(newIntegratorAddress).eq(newMigration.address);
        });
        it("should pass if either rawBalance or balance are 0", async () => {
            // Deploy using lending markets and do not seed the pool
            await runSetup(true, false, []);
            const { bAssets, fAsset, mAssetDetails, pool, pTokens } = details;
            const { platform } = details.mAssetDetails;
            transferringAsset = fAsset;
            newMigration = await (await new generated_1.MockPlatformIntegration__factory(sa.default.signer)).deploy(constants_1.DEAD_ADDRESS, mAssetDetails.aavePlatformAddress, bAssets.map((b) => b.address), pTokens);
            await newMigration.addWhitelist([pool.address]);
            maliciousIntegration = await (await new generated_1.MaliciousAaveIntegration__factory(sa.default.signer)).deploy(constants_1.DEAD_ADDRESS, mAssetDetails.aavePlatformAddress, bAssets.map((b) => b.address), pTokens);
            await maliciousIntegration.addWhitelist([pool.address]);
            await transferringAsset.transfer(platform.address, 10000);
            await platform.addWhitelist([sa.governor.address]);
            await platform.connect(sa.governor.signer).deposit(transferringAsset.address, 10000, false);
            // get balances before
            const bal = await platform.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(bal).eq(10000);
            const rawBal = await transferringAsset.balanceOf(platform.address);
            chai_1.expect(rawBal).eq(0);
            const integratorAddress = (await pool.getBasset(transferringAsset.address))[0][1];
            chai_1.expect(integratorAddress).eq(platform.address);
            // call migrate
            const tx = pool.connect(sa.governor.signer).migrateBassets([transferringAsset.address], newMigration.address);
            // emits BassetsMigrated
            await chai_1.expect(tx).to.emit(pool, "BassetsMigrated").withArgs([transferringAsset.address], newMigration.address);
            // moves all bAssets from old to new
            const migratedBal = await newMigration.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(migratedBal).eq(bal);
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address);
            chai_1.expect(migratedRawBal).eq(rawBal);
            // updates the integrator address
            const [[, newIntegratorAddress]] = await pool.getBasset(transferringAsset.address);
            chai_1.expect(newIntegratorAddress).eq(newMigration.address);
        });
    });
    describe("when going from no platform to a platform", () => {
        let newMigration;
        let transferringAsset;
        before(async () => {
            await runSetup();
            const lendingDetail = await mAssetMachine.loadATokens(details.bAssets);
            [, transferringAsset] = details.bAssets;
            newMigration = await (await new generated_1.MockPlatformIntegration__factory(sa.default.signer)).deploy(constants_1.DEAD_ADDRESS, lendingDetail.aavePlatformAddress, details.bAssets.map((b) => b.address), lendingDetail.aTokens.map((a) => a.aToken));
            await newMigration.addWhitelist([details.pool.address]);
        });
        it("should migrate everything correctly", async () => {
            const { pool } = details;
            // get balances before
            const rawBalBefore = await (await pool.getBasset(transferringAsset.address))[1][1];
            const integratorAddress = (await pool.getBasset(transferringAsset.address))[0][1];
            chai_1.expect(integratorAddress).eq(constants_1.ZERO_ADDRESS);
            // call migrate
            const tx = pool.connect(sa.governor.signer).migrateBassets([transferringAsset.address], newMigration.address);
            // emits BassetsMigrated
            await chai_1.expect(tx).to.emit(pool, "BassetsMigrated").withArgs([transferringAsset.address], newMigration.address);
            // moves all bAssets from old to new
            const migratedBal = await newMigration.callStatic.checkBalance(transferringAsset.address);
            chai_1.expect(migratedBal).eq(0);
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address);
            chai_1.expect(migratedRawBal).eq(rawBalBefore);
            // old balances should be empty
            const newRawBal = await transferringAsset.balanceOf(pool.address);
            chai_1.expect(newRawBal).eq(0);
            // updates the integrator address
            const [[, newIntegratorAddress]] = await pool.getBasset(transferringAsset.address);
            chai_1.expect(newIntegratorAddress).eq(newMigration.address);
        });
    });
});
//# sourceMappingURL=admin.spec.js.map