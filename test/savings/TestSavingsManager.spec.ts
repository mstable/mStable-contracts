/* eslint-disable @typescript-eslint/camelcase */

import { assertBNClose, assertBNClosePercent, assertBNSlightlyGTPercent } from "@utils/assertions";
import { expectEvent, time, expectRevert } from "@openzeppelin/test-helpers";
import { StandardAccounts } from "@utils/machines";
import { simpleToExactAmount } from "@utils/math";
import envSetup from "@utils/env_setup";
import { BN } from "@utils/tools";
import {
    ZERO_ADDRESS,
    MAX_UINT256,
    ZERO,
    fullScale,
    TEN_MINS,
    ONE_DAY,
    ONE_MIN,
    ONE_WEEK,
    DEAD_ADDRESS,
} from "@utils/constants";
import * as t from "types/generated";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";
import shouldBehaveLikePausableModule from "../shared/behaviours/PausableModule.behaviour";

const { expect } = envSetup.configure();

const SavingsManager = artifacts.require("SavingsManager");
const MockNexus = artifacts.require("MockNexus");
const MockMasset = artifacts.require("MockMasset");
const MockMasset1 = artifacts.require("MockMasset1");
const SavingsContract = artifacts.require("SavingsContract");
const MockRevenueRecipient = artifacts.require("MockRevenueRecipient");

contract("SavingsManager", async (accounts) => {
    const TEN = new BN(10);
    const TEN_TOKENS = TEN.mul(fullScale);
    const FIVE_TOKENS = TEN_TOKENS.div(new BN(2));
    const THIRTY_MINUTES = TEN_MINS.mul(new BN(3)).add(new BN(1));
    // 1.2 million tokens
    const INITIAL_MINT = new BN(1200000);
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const manager = sa.dummy2;
    const ctx: { module?: t.PausableModuleInstance } = {};

    let nexus: t.MockNexusInstance;
    let savingsContract: t.SavingsContractInstance;
    let savingsManager: t.SavingsManagerInstance;
    let mUSD: t.MockMassetInstance;
    const liquidator = sa.fundManager;

    async function createNewSavingsManager(mintAmount: BN = INITIAL_MINT): Promise<void> {
        mUSD = await MockMasset.new("mUSD", "mUSD", 18, sa.default, mintAmount);

        savingsContract = await SavingsContract.new();
        await savingsContract.initialize(
            nexus.address,
            sa.default,
            mUSD.address,
            "Savings Credit",
            "imUSD",
        );
        savingsManager = await SavingsManager.new(
            nexus.address,
            mUSD.address,
            savingsContract.address,
        );
        // Set new SavingsManager address in Nexus
        await nexus.setSavingsManager(savingsManager.address);
        await nexus.setLiquidator(liquidator);
        await mUSD.transfer(liquidator, simpleToExactAmount(1, 23), { from: sa.default });
    }

    before(async () => {
        nexus = await MockNexus.new(sa.governor, governance, manager);

        await createNewSavingsManager();
    });

    describe("behaviours", async () => {
        describe("should behave like a Module", async () => {
            beforeEach(async () => {
                await createNewSavingsManager();
                ctx.module = savingsManager as t.PausableModuleInstance;
            });
            shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
            shouldBehaveLikePausableModule(ctx as { module: t.PausableModuleInstance }, sa);
        });
    });

    describe("constructor", async () => {
        it("should fail when nexus address is zero", async () => {
            await expectRevert(
                SavingsManager.new(ZERO_ADDRESS, mUSD.address, savingsContract.address),
                "Nexus is zero address",
            );
        });

        it("should fail when mAsset address is zero", async () => {
            await expectRevert(
                SavingsManager.new(nexus.address, ZERO_ADDRESS, savingsContract.address),
                "Must be valid address",
            );
        });

        it("should fail when savingsContract address is zero", async () => {
            await expectRevert(
                SavingsManager.new(nexus.address, mUSD.address, ZERO_ADDRESS),
                "Must be valid address",
            );
        });

        it("should have valid state after deployment", async () => {
            const savingsContractAddr = await savingsManager.savingsContracts(mUSD.address);
            expect(savingsContractAddr).to.equal(savingsContract.address);

            const allowance = await mUSD.allowance(savingsManager.address, savingsContract.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);
        });
    });

    describe("adding a SavingsContract", async () => {
        let mockMasset: t.MockERC20Instance;
        const mockSavingsContract = sa.dummy4;

        before(async () => {
            mockMasset = await MockMasset.new("MOCK", "MOCK", 18, sa.default, new BN(10000));
        });

        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsManager.addSavingsContract(mockMasset.address, mockSavingsContract, {
                    from: sa.other,
                }),
                "Only governor can execute",
            );
        });

        it("should fail when mAsset address is zero", async () => {
            await expectRevert(
                savingsManager.addSavingsContract(ZERO_ADDRESS, mockSavingsContract, {
                    from: sa.governor,
                }),
                "Must be valid address",
            );
        });

        it("should fail when savingsContract address is zero", async () => {
            await expectRevert(
                savingsManager.addSavingsContract(mockMasset.address, ZERO_ADDRESS, {
                    from: sa.governor,
                }),
                "Must be valid address",
            );
        });

        it("should fail when mAsset entry already exist", async () => {
            await expectRevert(
                savingsManager.addSavingsContract(mUSD.address, savingsContract.address, {
                    from: sa.governor,
                }),
                "Savings contract already exists",
            );
        });

        it("should succeed with valid parameter", async () => {
            let savingsContractAddr = await savingsManager.savingsContracts(mUSD.address);
            expect(savingsContractAddr).to.equal(savingsContract.address);

            savingsContractAddr = await savingsManager.savingsContracts(mockMasset.address);
            expect(ZERO_ADDRESS).to.equal(savingsContractAddr);

            const tx = await savingsManager.addSavingsContract(
                mockMasset.address,
                mockSavingsContract,
                {
                    from: sa.governor,
                },
            );
            expectEvent(tx.receipt, "SavingsContractAdded", {
                mAsset: mockMasset.address,
                savingsContract: mockSavingsContract,
            });

            savingsContractAddr = await savingsManager.savingsContracts(mUSD.address);
            expect(savingsContractAddr).to.equal(savingsContract.address);

            savingsContractAddr = await savingsManager.savingsContracts(mockMasset.address);
            expect(mockSavingsContract).to.equal(savingsContractAddr);
        });
    });

    describe("updating a SavingsContract", async () => {
        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsManager.updateSavingsContract(mUSD.address, savingsContract.address, {
                    from: sa.other,
                }),
                "Only governor can execute",
            );
        });

        it("should fail when mAsset address is zero", async () => {
            await expectRevert(
                savingsManager.updateSavingsContract(ZERO_ADDRESS, savingsContract.address, {
                    from: sa.governor,
                }),
                "Savings contract does not exist",
            );
        });

        it("should fail when savingsContract address is zero", async () => {
            await expectRevert(
                savingsManager.updateSavingsContract(mUSD.address, ZERO_ADDRESS, {
                    from: sa.governor,
                }),
                "Must be valid address",
            );
        });

        it("should fail when savingsContract not found", async () => {
            await expectRevert(
                savingsManager.updateSavingsContract(sa.other, savingsContract.address, {
                    from: sa.governor,
                }),
                "Savings contract does not exist",
            );
        });

        it("should succeed with valid parameters", async () => {
            let savingsContractAddr = await savingsManager.savingsContracts(mUSD.address);
            expect(savingsContractAddr).to.equal(savingsContract.address);

            const tx = await savingsManager.updateSavingsContract(mUSD.address, sa.other, {
                from: sa.governor,
            });

            expectEvent(tx.receipt, "SavingsContractUpdated", {
                mAsset: mUSD.address,
                savingsContract: sa.other,
            });

            savingsContractAddr = await savingsManager.savingsContracts(mUSD.address);
            expect(sa.other).to.equal(savingsContractAddr);
        });
    });

    describe("freezing streams", async () => {
        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsManager.freezeStreams({ from: sa.other }),
                "Only governor can execute",
            );
        });
        it("should stop all streaming from being initialized", async () => {
            const tx = await savingsManager.freezeStreams({ from: sa.governor });
            expectEvent(tx.receipt, "StreamsFrozen");

            await expectRevert(
                savingsManager.collectAndStreamInterest(mUSD.address),
                "Streaming is currently frozen",
            );
        });
    });

    describe("adding a revenue recipient", async () => {
        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsManager.setRevenueRecipient(mUSD.address, DEAD_ADDRESS, { from: sa.other }),
                "Only governor can execute",
            );
        });
        it("should simply update the recipient and emit an event", async () => {
            const tx = await savingsManager.setRevenueRecipient(mUSD.address, sa.fundManager, {
                from: sa.governor,
            });
            expectEvent(tx.receipt, "RevenueRecipientSet", {
                mAsset: mUSD.address,
                recipient: sa.fundManager,
            });
            const recipient = await savingsManager.revenueRecipients(mUSD.address);
            expect(recipient).eq(sa.fundManager);
        });
    });

    describe("modifying the savings rate", async () => {
        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsManager.setSavingsRate(fullScale, { from: sa.other }),
                "Only governor can execute",
            );
        });

        it("should fail when not in range (lower range)", async () => {
            await expectRevert(
                savingsManager.setSavingsRate(simpleToExactAmount(1, 16), { from: sa.governor }),
                "Must be a valid rate",
            );
        });

        it("should fail when not in range (higher range)", async () => {
            await expectRevert(
                savingsManager.setSavingsRate(simpleToExactAmount(1, 20), { from: sa.governor }),
                "Must be a valid rate",
            );
        });

        it("should succeed when in valid range (min value)", async () => {
            const newRate = simpleToExactAmount(6, 17);
            const tx = await savingsManager.setSavingsRate(newRate, {
                from: sa.governor,
            });

            expectEvent(tx.receipt, "SavingsRateChanged", { newSavingsRate: newRate });
        });

        it("should succeed when in valid range (max value)", async () => {
            const newRate = simpleToExactAmount(1, 18);
            const tx = await savingsManager.setSavingsRate(newRate, {
                from: sa.governor,
            });

            expectEvent(tx.receipt, "SavingsRateChanged", { newSavingsRate: newRate });
        });
    });

    describe("collecting and distributing Interest", async () => {
        beforeEach(async () => {
            await createNewSavingsManager();
        });
        context("with invalid arguments", async () => {
            it("should fail when mAsset not exist", async () => {
                await expectRevert(
                    savingsManager.collectAndDistributeInterest(sa.other),
                    "Must have a valid savings contract",
                );
            });
        });
        context("when the contract is paused", async () => {
            it("should fail", async () => {
                // Pause contract
                await savingsManager.pause({ from: sa.governor });

                await expectRevert(
                    savingsManager.collectAndDistributeInterest(mUSD.address),
                    "Pausable: paused",
                );
            });
        });
        context("when there is no interest to collect", async () => {
            before(async () => {
                await createNewSavingsManager();
            });

            it("should succeed when interest collected is zero", async () => {
                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);
                expectEvent(tx.receipt, "InterestCollected", {
                    mAsset: mUSD.address,
                    interest: new BN(0),
                    newTotalSupply: INITIAL_MINT.mul(new BN(10).pow(new BN(18))),
                    apy: new BN(0),
                });
            });
        });

        context("with a broken mAsset", async () => {
            it("fails if the mAsset does not send required mAsset", async () => {
                const mUSD2 = await MockMasset1.new("mUSD", "mUSD", 18, sa.default, INITIAL_MINT);

                savingsContract = await SavingsContract.new();
                await savingsContract.initialize(
                    nexus.address,
                    sa.default,
                    mUSD.address,
                    "Savings Credit",
                    "imUSD",
                );
                savingsManager = await SavingsManager.new(
                    nexus.address,
                    mUSD2.address,
                    savingsContract.address,
                );
                // Set new SavingsManager address in Nexus
                nexus.setSavingsManager(savingsManager.address);

                const newInterest = new BN(10).mul(fullScale);
                await mUSD2.setAmountForCollectInterest(newInterest);

                // should move 1 day in future
                await time.increase(THIRTY_MINUTES);
                await expectRevert(
                    savingsManager.collectAndDistributeInterest(mUSD2.address),
                    "Must receive mUSD",
                );
            });
        });

        interface Stream {
            end: BN;
            rate: BN;
        }

        interface Data {
            lastPeriodStart: BN;
            lastCollection: BN;
            periodYield: BN;
            liqStream: Stream;
            yieldStream: Stream;
            savingsManagerBal: BN;
            savingsContractBal: BN;
            lastBatchCollected: BN;
        }
        const snapshotData = async (): Promise<Data> => {
            const liqStream = await savingsManager.liqStream(mUSD.address);
            const yieldStream = await savingsManager.yieldStream(mUSD.address);
            return {
                lastPeriodStart: await savingsManager.lastPeriodStart(mUSD.address),
                lastCollection: await savingsManager.lastCollection(mUSD.address),
                periodYield: await savingsManager.periodYield(mUSD.address),
                liqStream: { end: liqStream[0], rate: liqStream[1] },
                yieldStream: { end: yieldStream[0], rate: yieldStream[1] },
                savingsManagerBal: await mUSD.balanceOf(savingsManager.address),
                savingsContractBal: await mUSD.balanceOf(savingsContract.address),
                lastBatchCollected: await savingsManager.lastBatchCollected(mUSD.address),
            };
        };
        context("testing the boundaries of liquidated deposits", async () => {
            // Initial supply of 10m units
            const initialSupply = new BN(10000000);
            const liquidated1 = simpleToExactAmount(100, 18);
            const liquidated2 = simpleToExactAmount(200, 18);
            const liquidated3 = simpleToExactAmount(300, 18);
            beforeEach(async () => {
                await createNewSavingsManager(initialSupply);
            });
            it("should fail if deposit not called by the liquidator", async () => {
                await expectRevert(
                    savingsManager.depositLiquidation(mUSD.address, liquidated1, {
                        from: sa.dummy2,
                    }),
                    "Only liquidator can execute",
                );
            });
            it("should fail if sender has no mUSD approved", async () => {
                await expectRevert(
                    savingsManager.depositLiquidation(mUSD.address, liquidated1, {
                        from: liquidator,
                    }),
                    "SafeERC20: low-level call failed",
                );
            });
            it("should set the streamRate and finish time correctly", async () => {
                const before = await snapshotData();
                await mUSD.approve(savingsManager.address, liquidated1, { from: liquidator });

                const tx = await savingsManager.depositLiquidation(mUSD.address, liquidated1, {
                    from: liquidator,
                });
                expectEvent(tx.receipt, "LiquidatorDeposited", {
                    mAsset: mUSD.address,
                    amount: liquidated1,
                });
                const t0 = await time.latest();

                const after = await snapshotData();
                expect(after.savingsManagerBal).bignumber.eq(
                    before.savingsManagerBal.add(liquidated1),
                );
                assertBNClose(after.lastCollection, t0, 2);
                expect(after.lastPeriodStart).bignumber.eq(after.lastCollection);
                expect(after.periodYield).bignumber.eq(new BN(0));
                expect(after.liqStream.end).bignumber.eq(after.lastCollection.add(ONE_WEEK));
                assertBNClosePercent(after.liqStream.rate, liquidated1.div(ONE_WEEK), "0.001");
            });
            it("should work over multiple periods", async () => {
                //   0         1         2         3
                //   | - - - - | - - - - | - - - - |
                //   ^      ^^^           ^ ^  ^
                //  start   567          1516 18
                //  @time - Description (periodStart, lastCollection, periodYield)
                //  @0  - Deposit is made
                //  @5  - Yield collects days 0-5
                //  @6  - Deposit is made - second period begins
                //  @7  - Yield collects days 6-7
                //  @15 - Yield collects days 7-13 but not 14
                //  @16 - Yield collects nothing
                //  @18 - Deposit is made

                // @0
                const s = await snapshotData();
                expect(s.liqStream.rate).bignumber.eq(new BN(0));
                expect(s.savingsManagerBal).bignumber.eq(new BN(0));

                await mUSD.approve(savingsManager.address, liquidated1, { from: liquidator });
                await savingsManager.depositLiquidation(mUSD.address, liquidated1, {
                    from: liquidator,
                });

                const s0 = await snapshotData();
                assertBNClosePercent(s0.liqStream.rate, liquidated1.div(ONE_WEEK), "0.001");

                await time.increase(ONE_DAY.muln(5));
                // @5

                let expectedInterest = ONE_DAY.muln(5).mul(s0.liqStream.rate);
                await mUSD.setAmountForCollectInterest(1);
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                const s5 = await snapshotData();

                assertBNClosePercent(
                    s5.savingsManagerBal,
                    s0.savingsManagerBal.sub(expectedInterest),
                    "0.01",
                );

                assertBNClosePercent(
                    s5.savingsContractBal,
                    s0.savingsContractBal.add(expectedInterest),
                    "0.01",
                );

                await time.increase(ONE_DAY);
                // @6
                const leftOverRewards = ONE_DAY.mul(s0.liqStream.rate);
                const totalRewards = leftOverRewards.add(liquidated2);

                await mUSD.approve(savingsManager.address, liquidated2, { from: liquidator });
                await savingsManager.depositLiquidation(mUSD.address, liquidated2, {
                    from: liquidator,
                });

                const s6 = await snapshotData();

                assertBNClosePercent(s6.liqStream.rate, totalRewards.div(ONE_WEEK), "0.01");
                expect(s6.liqStream.end).bignumber.eq(s6.lastCollection.add(ONE_WEEK));

                await time.increase(ONE_DAY);
                // @7
                expectedInterest = ONE_DAY.mul(s6.liqStream.rate);
                await mUSD.setAmountForCollectInterest(1);
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                const s7 = await snapshotData();
                assertBNClosePercent(
                    s7.savingsManagerBal,
                    s6.savingsManagerBal.sub(expectedInterest),
                    "0.01",
                );

                await time.increase(ONE_DAY.muln(8));
                // @15
                expectedInterest = ONE_DAY.muln(6).mul(s6.liqStream.rate);
                await mUSD.setAmountForCollectInterest(1);
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                const s15 = await snapshotData();
                assertBNClosePercent(
                    s15.savingsManagerBal,
                    s7.savingsManagerBal.sub(expectedInterest),
                    "0.01",
                );

                expect(s15.liqStream.end).bignumber.lt(s15.lastCollection as any);
                expect(s15.liqStream.rate).bignumber.eq(s7.liqStream.rate);
                assertBNClose(s15.savingsManagerBal, new BN(0), simpleToExactAmount(1, 6));

                await time.increase(ONE_DAY);
                // @16
                expectedInterest = new BN(0);
                await mUSD.setAmountForCollectInterest(1);
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                const s16 = await snapshotData();
                expect(s16.savingsManagerBal).bignumber.eq(s15.savingsManagerBal);

                await time.increase(ONE_DAY.muln(2));
                // @18
                await mUSD.approve(savingsManager.address, liquidated3, { from: liquidator });
                await savingsManager.depositLiquidation(mUSD.address, liquidated3, {
                    from: liquidator,
                });
                const s18 = await snapshotData();
                assertBNClosePercent(s18.liqStream.rate, liquidated3.div(ONE_WEEK), "0.001");
            });
        });

        context("testing the collection and streaming of mAsset interest", async () => {
            // Initial supply of 10m units
            const initialSupply = new BN(10000000);
            const liquidated1 = simpleToExactAmount(100, 18);
            const platformInterest1 = simpleToExactAmount(10, 18);
            const platformInterest2 = simpleToExactAmount(50, 18);
            const platformInterest3 = simpleToExactAmount(20, 18);
            const platformInterest4 = simpleToExactAmount(40, 18);
            // check lastBatchCollected
            beforeEach(async () => {
                await createNewSavingsManager(initialSupply);
            });
            it("should fail if streams are frozen", async () => {
                await savingsManager.freezeStreams({ from: sa.governor });
                await expectRevert(
                    savingsManager.collectAndStreamInterest(mUSD.address),
                    "Streaming is currently frozen",
                );
            });
            it("should fail if there is no valid savings contract", async () => {
                await expectRevert(
                    savingsManager.collectAndStreamInterest(sa.dummy1, {
                        from: sa.dummy2,
                    }),
                    "Must have a valid savings contract",
                );
            });
            it("should fail if called twice within 6 hours", async () => {
                await mUSD.setAmountForPlatformInterest(new BN(10000));
                await savingsManager.collectAndStreamInterest(mUSD.address);
                await expectRevert(
                    savingsManager.collectAndStreamInterest(mUSD.address, {
                        from: sa.dummy2,
                    }),
                    "Cannot deposit twice in 6 hours",
                );
            });
            it("should have no effect if there is no interest to collect", async () => {
                const before = await snapshotData();
                const tx = await savingsManager.collectAndStreamInterest(mUSD.address);
                expectEvent(tx.receipt, "InterestCollected", {
                    interest: new BN(0),
                    apy: new BN(0),
                });
                const timeAfter = await time.latest();
                const after = await snapshotData();
                expect(before.yieldStream.rate).bignumber.eq(after.yieldStream.rate);
                expect(before.yieldStream.end).bignumber.eq(after.yieldStream.end);
                // It should first collect and distribute existing interest
                assertBNClose(after.lastCollection, timeAfter, 2);
                expect(before.lastCollection).bignumber.eq(new BN(0));
            });
            it("should fail if the APY is too high", async () => {
                await mUSD.setAmountForPlatformInterest(new BN(10000));
                await savingsManager.collectAndStreamInterest(mUSD.address);

                await time.increase(ONE_DAY.divn(2).addn(1));
                // max APY = 1500%
                // initial liq = 10m
                // 12h increase = ~~205k
                await mUSD.setAmountForPlatformInterest(simpleToExactAmount(210000, 18));
                await expectRevert(
                    savingsManager.collectAndStreamInterest(mUSD.address, {
                        from: sa.dummy2,
                    }),
                    "Interest protected from inflating past maxAPY",
                );
                await mUSD.setAmountForPlatformInterest(simpleToExactAmount(200000, 18));
                const tx = await savingsManager.collectAndStreamInterest(mUSD.address);
                expectEvent(tx.receipt, "InterestCollected", {
                    interest: simpleToExactAmount(200000, 18),
                });
            });
            it("should factor in new mUSD, initialise stream and emit an event", async () => {
                const before = await snapshotData();
                expect(before.lastBatchCollected).bignumber.eq(new BN(0));
                expect(before.lastCollection).bignumber.eq(new BN(0));
                expect(before.lastPeriodStart).bignumber.eq(new BN(0));
                expect(before.periodYield).bignumber.eq(new BN(0));
                expect(before.savingsContractBal).bignumber.eq(new BN(0));
                expect(before.savingsManagerBal).bignumber.eq(new BN(0));
                expect(before.yieldStream.rate).bignumber.eq(new BN(0));
                expect(before.yieldStream.end).bignumber.eq(new BN(0));

                const ts = await time.latest();
                const collectionAmount = simpleToExactAmount(100, 18);
                await mUSD.setAmountForPlatformInterest(collectionAmount);
                const tx = await savingsManager.collectAndStreamInterest(mUSD.address);

                const after = await snapshotData();
                assertBNClose(after.lastBatchCollected, ts, 5);
                expect(after.lastCollection).bignumber.eq(after.lastBatchCollected);
                expect(after.lastPeriodStart).bignumber.eq(after.lastBatchCollected);
                expect(after.periodYield).bignumber.eq(new BN(0));
                expect(after.savingsContractBal).bignumber.eq(new BN(0));
                expect(after.savingsManagerBal).bignumber.eq(collectionAmount);
                assertBNClosePercent(
                    after.yieldStream.rate,
                    simpleToExactAmount("1.157", 15),
                    "0.1",
                );
                expect(after.yieldStream.end).bignumber.eq(after.lastBatchCollected.add(ONE_DAY));
                assertBNSlightlyGTPercent(
                    collectionAmount,
                    after.yieldStream.rate.mul(after.yieldStream.end.sub(after.lastCollection)),
                    "0.1",
                    true,
                );

                expectEvent(tx.receipt, "InterestCollected", {
                    mAsset: mUSD.address,
                    interest: collectionAmount,
                    newTotalSupply: simpleToExactAmount(initialSupply, 18).add(collectionAmount),
                });
            });

            it("should coexist with liquidator stream to allow simultaneous streaming", async () => {
                //   0             1             2             3
                //   | - - - - - - | - - - - - - | - - - - - - |
                //   ^  ^     ^         ^ ^         ^ ^
                //   0  1     5        11 |        16 |
                //                       11.5        16.5
                //  @time - Action
                //  @0  - Liquidation is made
                //  @1  - Stream interest is made
                //  @5  - Yield collects days 1-5
                //  @11 - Stream interest is made
                //  @11.5- Stream interest is made
                //  @16 - Yield collects 11.5-12.5
                //  @16.5 - Stream interest is made
                // @0
                const s = await snapshotData();
                expect(s.liqStream.rate).bignumber.eq(new BN(0));
                expect(s.savingsManagerBal).bignumber.eq(new BN(0));
                await mUSD.approve(savingsManager.address, liquidated1, { from: liquidator });
                await savingsManager.depositLiquidation(mUSD.address, liquidated1, {
                    from: liquidator,
                });
                const s0 = await snapshotData();
                assertBNClosePercent(s0.liqStream.rate, liquidated1.div(ONE_WEEK), "0.001");
                await time.increase(ONE_DAY.muln(1));
                // @1
                await mUSD.setAmountForPlatformInterest(platformInterest1);
                await savingsManager.collectAndStreamInterest(mUSD.address);
                const s1 = await snapshotData();
                assertBNClosePercent(s1.yieldStream.rate, platformInterest1.div(ONE_DAY), "0.001");
                expect(s1.liqStream.end).bignumber.eq(s0.liqStream.end);
                expect(s1.liqStream.rate).bignumber.eq(s0.liqStream.rate);
                expect(s1.yieldStream.end).bignumber.eq(s1.lastCollection.add(ONE_DAY));
                expect(s1.lastBatchCollected).bignumber.eq(s1.lastCollection);
                await time.increase(ONE_DAY.muln(4));
                // @5
                let expectedInterest = ONE_DAY.muln(4).mul(s1.liqStream.rate);
                expectedInterest = expectedInterest.add(ONE_DAY.mul(s1.yieldStream.rate));
                await mUSD.setAmountForCollectInterest(1);
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                const s5 = await snapshotData();
                assertBNClosePercent(
                    s5.savingsManagerBal,
                    s1.savingsManagerBal.sub(expectedInterest),
                    "0.01",
                );
                assertBNClosePercent(
                    s5.savingsContractBal,
                    s1.savingsContractBal.add(expectedInterest),
                    "0.01",
                );
                await time.increase(ONE_DAY.muln(6));
                // @t11
                expectedInterest = ONE_DAY.muln(2).mul(s0.liqStream.rate);
                await mUSD.setAmountForPlatformInterest(platformInterest2);
                await savingsManager.collectAndStreamInterest(mUSD.address);
                const s11 = await snapshotData();
                assertBNClosePercent(s11.yieldStream.rate, platformInterest2.div(ONE_DAY), "0.001");
                expect(s11.yieldStream.end).bignumber.eq(s11.lastCollection.add(ONE_DAY));
                expect(s11.lastBatchCollected).bignumber.eq(s11.lastCollection);
                assertBNClosePercent(
                    s11.savingsManagerBal,
                    s5.savingsManagerBal.sub(expectedInterest).add(platformInterest2),
                    "0.01",
                );
                assertBNClosePercent(
                    s11.savingsContractBal,
                    s5.savingsContractBal.add(expectedInterest),
                    "0.01",
                );
                await time.increase(ONE_DAY.divn(2));
                // @11.5
                const leftOverRewards = ONE_DAY.divn(2).mul(s11.yieldStream.rate);
                const total = leftOverRewards.add(platformInterest3);
                await mUSD.setAmountForPlatformInterest(platformInterest3);
                await savingsManager.collectAndStreamInterest(mUSD.address);
                const s115 = await snapshotData();
                expect(s115.yieldStream.end).bignumber.eq(s115.lastCollection.add(ONE_DAY));
                assertBNClosePercent(s115.yieldStream.rate, total.div(ONE_DAY), "0.01");
                await time.increase(ONE_DAY.muln(9).divn(2));
                // @16
                expectedInterest = s115.yieldStream.rate.mul(ONE_DAY);
                await mUSD.setAmountForCollectInterest(1);
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                const s16 = await snapshotData();
                assertBNClosePercent(
                    s16.savingsManagerBal,
                    s115.savingsManagerBal.sub(expectedInterest),
                    "0.01",
                );
                assertBNClosePercent(
                    s16.savingsContractBal,
                    s115.savingsContractBal.add(expectedInterest),
                    "0.01",
                );
                // all mUSD should be drained now
                expect(s16.savingsManagerBal).bignumber.lt(simpleToExactAmount(1, 16) as any);
                await time.increase(ONE_DAY.divn(2));
                // @16.5
                const ts17 = await time.latest();
                await mUSD.setAmountForPlatformInterest(platformInterest4);
                await savingsManager.collectAndStreamInterest(mUSD.address);
                const s17 = await snapshotData();
                assertBNClosePercent(s17.yieldStream.rate, platformInterest4.div(ONE_DAY), "0.01");
                assertBNClose(ts17, s17.lastCollection, 10);
            });
        });
        context("testing new mechanism", async () => {
            // Initial supply of 10m units
            const initialSupply = new BN(10000000);
            const initialSupplyExact = simpleToExactAmount(initialSupply, 18);
            beforeEach(async () => {
                await createNewSavingsManager(initialSupply);
            });
            it("should work when lastCollection time is 0 with low interest", async () => {
                const lastPeriodStart = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStart).bignumber.eq(new BN(0));
                const lastCollection = await savingsManager.lastCollection(mUSD.address);
                expect(lastCollection).bignumber.eq(new BN(0));
                const lastPeriodYield = await savingsManager.periodYield(mUSD.address);
                expect(lastPeriodYield).bignumber.eq(new BN(0));

                const newInterest = simpleToExactAmount(1000, 18);
                // e.g. (1e21*1e18)/1e25 = 1e14 (or 0.01%)
                const percentageIncrease = newInterest.mul(fullScale).div(initialSupplyExact);
                // e.g. (1e14 * 1e18) / 50e18 = 2e12
                const expectedAPY = percentageIncrease
                    .mul(fullScale)
                    .div(simpleToExactAmount(50, 18));
                expect(expectedAPY).bignumber.eq(simpleToExactAmount(2, 12));

                await mUSD.setAmountForCollectInterest(newInterest);

                const curTime = await time.latest();
                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);

                expectEvent(tx.receipt, "InterestCollected", {
                    mAsset: mUSD.address,
                    interest: newInterest,
                    newTotalSupply: initialSupplyExact.add(newInterest),
                });
                const interectCollectedEvent = tx.logs[0];
                assertBNClose(
                    interectCollectedEvent.args[3],
                    expectedAPY,
                    simpleToExactAmount(5, 11), // allow for a 0.000005% deviation in the percentage
                );
                const lastCollectionAfter = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollectionAfter, curTime, new BN(2));
                const lastPeriodStartAfter = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStartAfter).bignumber.eq(lastCollectionAfter);
                const lastPeriodYieldAfter = await savingsManager.periodYield(mUSD.address);
                expect(lastPeriodYieldAfter).bignumber.eq(new BN(0));
            });
            it("should always update the lastCollection time for future", async () => {
                const lastCollection = await savingsManager.lastCollection(mUSD.address);
                expect(lastCollection).bignumber.eq(new BN(0));

                const curTime = await time.latest();
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                const lastCollectionMiddle = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollectionMiddle, curTime, new BN(2));

                const newInterest = simpleToExactAmount(11000, 18);
                await mUSD.setAmountForCollectInterest(newInterest);

                await expectRevert(
                    savingsManager.collectAndDistributeInterest(mUSD.address),
                    "Interest protected from inflating past 10 Bps",
                );

                await time.increase(THIRTY_MINUTES.addn(1));

                await expectRevert(
                    savingsManager.collectAndDistributeInterest(mUSD.address),
                    "Interest protected from inflating past maxAPY",
                );

                await time.increase(THIRTY_MINUTES.addn(1));

                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);

                const endTime = await time.latest();
                const lastCollectionEnd = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollectionEnd, endTime, new BN(2));
                const lastPeriodStartEnd = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStartEnd).bignumber.eq(lastCollectionEnd);
                const lastPeriodYieldEnd = await savingsManager.periodYield(mUSD.address);
                expect(lastPeriodYieldEnd).bignumber.eq(new BN(0));

                const expectedAPY = simpleToExactAmount("9.636", 18);

                expectEvent(tx.receipt, "InterestCollected", {
                    mAsset: mUSD.address,
                    interest: newInterest,
                    newTotalSupply: initialSupplyExact.add(newInterest),
                });
                const interectCollectedEvent = tx.logs[0];
                assertBNClose(
                    interectCollectedEvent.args[3],
                    expectedAPY,
                    simpleToExactAmount(1, 17), // allow for a 10% deviation in the percentage
                );
            });
            it("should fail if under 30 minutes and greater than 10bps increase", async () => {
                // Pass 1st
                const curTime = await time.latest();
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                const lastCollectionMiddle = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollectionMiddle, curTime, new BN(2));

                // fail with 10bps
                const failingInterest = simpleToExactAmount(10100, 18);
                await mUSD.setAmountForCollectInterest(failingInterest);
                await expectRevert(
                    savingsManager.collectAndDistributeInterest(mUSD.address),
                    "Interest protected from inflating past 10 Bps",
                );
                // change to 9.99bps
                const passingInterest = simpleToExactAmount(9999, 18);
                await mUSD.setAmountForCollectInterest(passingInterest);

                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);

                const endTime = await time.latest();
                const lastCollectionEnd = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollectionEnd, endTime, new BN(2));
                const lastPeriodStartEnd = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStartEnd).bignumber.eq(lastCollectionMiddle);
                const lastPeriodYieldEnd = await savingsManager.periodYield(mUSD.address);
                expect(lastPeriodYieldEnd).bignumber.eq(passingInterest);

                expectEvent(tx.receipt, "InterestCollected", {
                    mAsset: mUSD.address,
                    interest: passingInterest,
                    newTotalSupply: initialSupplyExact.add(passingInterest),
                });
            });
            it("should pass if 1 block and 9.99bps increase", async () => {
                // Pass 1st
                const curTime = await time.latest();
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                const lastCollectionBefore = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollectionBefore, curTime, new BN(2));

                // update ONE SECOND
                const passingInterest = simpleToExactAmount(9999, 18);
                await mUSD.setAmountForCollectInterest(passingInterest);

                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);

                const lastCollectionAfter = await savingsManager.lastCollection(mUSD.address);

                const timeDifferential = lastCollectionAfter.sub(lastCollectionBefore);
                const expectedApy = new BN("31532846400760319992415").div(
                    timeDifferential.eqn(0) ? new BN(1) : timeDifferential,
                );

                expectEvent(tx.receipt, "InterestCollected", {
                    mAsset: mUSD.address,
                    interest: passingInterest,
                    newTotalSupply: initialSupplyExact.add(passingInterest),
                });

                const interectCollectedEvent = tx.logs[0];
                assertBNClose(
                    interectCollectedEvent.args[3],
                    expectedApy,
                    simpleToExactAmount(1, 14), // allow for minor deviation in calc
                );

                // it should fail if it goes over 9.99bps in the period

                const failingInterest = simpleToExactAmount(10, 18);
                await mUSD.setAmountForCollectInterest(failingInterest);

                await expectRevert(
                    savingsManager.collectAndDistributeInterest(mUSD.address),
                    "Interest protected from inflating past 10 Bps",
                );
            });
            it("should pass if over 30 minutes and less than 15e18", async () => {
                // Pass 1st
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                // update 30 mins
                await time.increase(THIRTY_MINUTES.addn(1));
                // fail on 16e18
                const failingInterest = simpleToExactAmount(8700, 18);
                await mUSD.setAmountForCollectInterest(failingInterest);
                await expectRevert(
                    savingsManager.collectAndDistributeInterest(mUSD.address),
                    "Interest protected from inflating past maxAPY",
                );
                // update 30 mins
                await time.increase(THIRTY_MINUTES.addn(1));
                // pass
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                // update 10 mins
                // add 5bps
                const passingInterest = simpleToExactAmount(5000, 18);
                await mUSD.setAmountForCollectInterest(passingInterest);

                // pass
                await savingsManager.collectAndDistributeInterest(mUSD.address);
            });

            it("should updated period information correctly across sequence", async () => {
                //   0        30        60        90        120
                //   | - - - - | - - - - | - - - - | - - - - |
                //   ^            ^   ^    ^    ^            ^
                //  start        40   50  65    80          120
                //  @time - Description (periodStart, lastCollection, periodYield)
                //  @40 - Should start new period (40, 40, 0)
                //  @50 - Should calc in period 40-70 (40, 50, X)
                //  @65 - Should calc in period 40-70 (40, 65, X+Y)
                //  @80 - Should start new period from last collection, 65-95 (65, 80, Z)
                //  @120 - Should start new period (120, 120, 0)

                // @0
                const lastCollection_0 = await savingsManager.lastCollection(mUSD.address);
                expect(lastCollection_0).bignumber.eq(new BN(0));
                const lastPeriodStart_0 = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStart_0).bignumber.eq(new BN(0));
                const periodYield_0 = await savingsManager.periodYield(mUSD.address);
                expect(periodYield_0).bignumber.eq(new BN(0));

                // @40
                await time.increase(ONE_MIN.muln(40));
                let curTime = await time.latest();
                const interest_40 = simpleToExactAmount(1000, 18);
                await mUSD.setAmountForCollectInterest(interest_40);
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                const lastCollection_40 = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollection_40, curTime, 3);
                const lastPeriodStart_40 = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStart_40).bignumber.eq(lastCollection_40);
                const periodYield_40 = await savingsManager.periodYield(mUSD.address);
                expect(periodYield_40).bignumber.eq(new BN(0));

                // @50
                await time.increase(ONE_MIN.muln(10));
                curTime = await time.latest();
                const interest_50 = simpleToExactAmount(900, 18);
                await mUSD.setAmountForCollectInterest(interest_50);
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                const lastCollection_50 = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollection_50, curTime, 3);
                const lastPeriodStart_50 = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStart_50).bignumber.eq(lastCollection_40);
                const periodYield_50 = await savingsManager.periodYield(mUSD.address);
                expect(periodYield_50).bignumber.eq(interest_50);

                // @65
                await time.increase(ONE_MIN.muln(15));
                curTime = await time.latest();
                const interest_65 = simpleToExactAmount(800, 18);
                await mUSD.setAmountForCollectInterest(interest_65);
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                const lastCollection_65 = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollection_65, curTime, 3);
                const lastPeriodStart_65 = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStart_65).bignumber.eq(lastCollection_40);
                const periodYield_65 = await savingsManager.periodYield(mUSD.address);
                expect(periodYield_65).bignumber.eq(interest_65.add(interest_50));

                // @80
                await time.increase(ONE_MIN.muln(15));
                curTime = await time.latest();
                const interest_80 = simpleToExactAmount(700, 18);
                await mUSD.setAmountForCollectInterest(interest_80);
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                const lastCollection_80 = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollection_80, curTime, 3);
                const lastPeriodStart_80 = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStart_80).bignumber.eq(lastCollection_65);
                const periodYield_80 = await savingsManager.periodYield(mUSD.address);
                expect(periodYield_80).bignumber.eq(interest_80);

                // @120
                await time.increase(ONE_MIN.muln(40));
                curTime = await time.latest();
                const interest_120 = simpleToExactAmount(600, 18);
                await mUSD.setAmountForCollectInterest(interest_120);
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                const lastCollection_120 = await savingsManager.lastCollection(mUSD.address);
                assertBNClose(lastCollection_120, curTime, 3);
                const lastPeriodStart_120 = await savingsManager.lastPeriodStart(mUSD.address);
                expect(lastPeriodStart_120).bignumber.eq(lastCollection_120);
                const periodYield_120 = await savingsManager.periodYield(mUSD.address);
                expect(periodYield_120).bignumber.eq(new BN(0));
            });
        });
        context("when there is some interest to collect", async () => {
            before(async () => {
                await createNewSavingsManager();
            });
            it("should collect the interest first time", async () => {
                // Refresh the collection timer
                await savingsManager.collectAndDistributeInterest(mUSD.address);

                // Total supply is 1.2 million
                // For 7.3% APY following is the calculation
                // 1.2million * 7.3% = 87600 Yearly
                // 87600 / 365 = 240 per day
                // 240 / 24 = 10 per hour
                // 10 / 2 = 5 per half hour
                const balanceBefore = await mUSD.balanceOf(savingsContract.address);
                expect(ZERO).to.bignumber.equal(balanceBefore);

                const newInterest = FIVE_TOKENS;
                await mUSD.setAmountForCollectInterest(newInterest);

                // should move 30 mins in future
                await time.increase(THIRTY_MINUTES);
                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);

                const expectedTotalSupply = INITIAL_MINT.mul(fullScale).add(FIVE_TOKENS);
                // expectedAPY = 7.3%
                const expectedAPY = simpleToExactAmount("7.3", 16);
                expectEvent(tx.receipt, "InterestCollected", {
                    mAsset: mUSD.address,
                    interest: FIVE_TOKENS,
                    newTotalSupply: expectedTotalSupply,
                });
                const interectCollectedEvent = tx.logs[0];
                assertBNClose(
                    interectCollectedEvent.args[3],
                    expectedAPY,
                    simpleToExactAmount(2, 14), // allow for a 0.02% deviation in the percentage
                );

                const balanceAfter = await mUSD.balanceOf(savingsContract.address);
                expect(newInterest).to.bignumber.equal(balanceAfter);
            });

            it("should throw if the APY is too high", async () => {
                // Refresh the collection timer
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                // >= 1500 APY with a 1.2m cap is equal to
                // 49315 tokens per day (~4)
                const balanceBefore = await mUSD.balanceOf(savingsContract.address);
                expect(ZERO).to.bignumber.equal(balanceBefore);
                const newInterest = new BN(49500).mul(fullScale);
                await mUSD.setAmountForCollectInterest(newInterest);
                // should move 1 day in future
                await time.increase(ONE_DAY);
                await expectRevert(
                    savingsManager.collectAndDistributeInterest(mUSD.address),
                    "Interest protected from inflating past maxAPY",
                );
                await time.increase(THIRTY_MINUTES.mul(new BN(10)));
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                const balanceAfter = await mUSD.balanceOf(savingsContract.address);
                expect(newInterest).to.bignumber.equal(balanceAfter);
            });

            it("should allow interest collection before 30 mins", async () => {
                await savingsManager.collectAndDistributeInterest(mUSD.address);
                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);
                expectEvent(tx.receipt, "InterestCollected", {
                    interest: new BN(0),
                    apy: new BN(0),
                });
            });

            it("should allow interest collection again after 30 mins", async () => {
                await time.increase(THIRTY_MINUTES);
                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);
                expectEvent(tx.receipt, "InterestCollected", {
                    mAsset: mUSD.address,
                    interest: new BN(0),
                    newTotalSupply: INITIAL_MINT.mul(fullScale),
                    apy: new BN(0),
                });
            });
        });
    });

    describe("distributing unallocated Interest", async () => {
        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsManager.distributeUnallocatedInterest(mUSD.address, {
                    from: sa.other,
                }),
                "Only governance can execute",
            );
        });
        it("should fail without a valid recipient", async () => {
            await expectRevert(
                savingsManager.distributeUnallocatedInterest(mUSD.address, {
                    from: sa.governor,
                }),
                "Must have valid recipient",
            );
        });

        it("calls the distribute function on a valid recipient", async () => {
            const balanceBefore = await mUSD.balanceOf(sa.other);
            expect(ZERO).to.bignumber.equal(balanceBefore);

            // Send some mUSD to SavingsManager
            const amount = new BN(1000);
            await mUSD.transfer(savingsManager.address, amount, { from: sa.default });

            const recipient = await MockRevenueRecipient.new();
            await savingsManager.setRevenueRecipient(mUSD.address, recipient.address, {
                from: sa.governor,
            });
            const tx = await savingsManager.distributeUnallocatedInterest(mUSD.address, {
                from: sa.governor,
            });

            const balanceAfter = await mUSD.balanceOf(recipient.address);
            expect(amount).to.bignumber.equal(balanceAfter);

            expectEvent(tx.receipt, "RevenueRedistributed", {
                mAsset: mUSD.address,
                recipient: recipient.address,
                amount,
            });
        });

        it("calculates the unallocated interest correctly and calls the recipient", async () => {
            const recipient = await MockRevenueRecipient.new();
            await savingsManager.setRevenueRecipient(mUSD.address, recipient.address, {
                from: sa.governor,
            });
            const liquidationAmount = simpleToExactAmount(1000, 18);
            const swapFeesAmount = simpleToExactAmount(50, 18);
            // Set rate to 80%
            await savingsManager.setSavingsRate(simpleToExactAmount(8, 17), { from: sa.governor });
            // Create a liquidation
            await mUSD.approve(savingsManager.address, liquidationAmount, { from: liquidator });
            await savingsManager.depositLiquidation(mUSD.address, liquidationAmount, {
                from: liquidator,
            });
            // Zoom forward 3 days
            await time.increase(ONE_DAY.muln(3));
            // Set interest for collection
            await mUSD.setAmountForCollectInterest(swapFeesAmount);
            // Deposit to SAVE
            await savingsManager.collectAndDistributeInterest(mUSD.address);
            // Redistribution should net (interest + 3/7 of liquidation) * 0.2
            const expectedRedistribution = liquidationAmount
                .muln(3)
                .divn(7)
                .add(swapFeesAmount)
                .muln(2)
                .divn(10);

            await savingsManager.distributeUnallocatedInterest(mUSD.address, {
                from: sa.governor,
            });
            const balance00 = await mUSD.balanceOf(recipient.address);
            assertBNClosePercent(expectedRedistribution, balance00, "0.01");
            // Zoom forward 1 days
            await time.increase(ONE_DAY);
            // Redistribution should net 0
            await savingsManager.distributeUnallocatedInterest(mUSD.address, {
                from: sa.governor,
            });
            const balance01 = await mUSD.balanceOf(recipient.address);
            expect(balance01).bignumber.eq(balance00);
        });
    });

    describe("extra tests:", async () => {
        let recipient;
        beforeEach(async () => {
            await createNewSavingsManager();

            recipient = await MockRevenueRecipient.new();
            await savingsManager.setRevenueRecipient(mUSD.address, recipient.address, {
                from: sa.governor,
            });
        });

        it("should collect when 0% unallocated interest", async () => {
            const newInterest = FIVE_TOKENS;
            await mUSD.setAmountForCollectInterest(newInterest);

            let savingsManagerBalance = await mUSD.balanceOf(savingsManager.address);
            expect(ZERO).to.bignumber.equal(savingsManagerBalance);

            await savingsManager.collectAndDistributeInterest(mUSD.address);

            const balanceAfter = await mUSD.balanceOf(savingsContract.address);
            expect(newInterest).to.bignumber.equal(balanceAfter);

            savingsManagerBalance = await mUSD.balanceOf(savingsManager.address);
            expect(ZERO).to.bignumber.equal(savingsManagerBalance);
        });

        it("should collect 10% unallocated interest when rate changed", async () => {
            // Set savings rate to 90%
            const NINTY_PERCENT = new BN(9).mul(new BN(10).pow(new BN(17))).add(new BN(1));
            // 5 * 90% = 4.5 tokens
            // const nintyPercentToken = new BN(45).mul(new BN(10).pow(new BN(16)));
            const nintyPercentToken = FIVE_TOKENS.mul(NINTY_PERCENT).div(fullScale);
            await savingsManager.setSavingsRate(NINTY_PERCENT, { from: sa.governor });

            await mUSD.setAmountForCollectInterest(FIVE_TOKENS);

            let savingsManagerBalance = await mUSD.balanceOf(savingsManager.address);
            expect(ZERO).to.bignumber.equal(savingsManagerBalance);

            await savingsManager.collectAndDistributeInterest(mUSD.address);

            const balanceAfter = await mUSD.balanceOf(savingsContract.address);
            expect(nintyPercentToken).to.bignumber.equal(balanceAfter);

            // expect 10% balance left at SavingsManager
            savingsManagerBalance = await mUSD.balanceOf(savingsManager.address);
            const expectedTenPercentTokens = FIVE_TOKENS.sub(nintyPercentToken);
            expect(expectedTenPercentTokens).to.bignumber.equal(savingsManagerBalance);

            await savingsManager.distributeUnallocatedInterest(mUSD.address, {
                from: sa.governor,
            });

            const balanceOfRecipient = await mUSD.balanceOf(recipient.address);
            expect(expectedTenPercentTokens).to.bignumber.equal(balanceOfRecipient);
        });

        it("should collect 5% unallocated interest when rate changed", async () => {
            // Set savings rate to 95%
            const NINTY_FIVE_PERCENT = new BN(95).mul(new BN(10).pow(new BN(16)));
            // 5 * 95% = 4.75 tokens
            const nintyFivePercentToken = FIVE_TOKENS.mul(NINTY_FIVE_PERCENT).div(fullScale);
            await savingsManager.setSavingsRate(NINTY_FIVE_PERCENT, { from: sa.governor });

            await mUSD.setAmountForCollectInterest(FIVE_TOKENS);

            let savingsManagerBalance = await mUSD.balanceOf(savingsManager.address);
            expect(ZERO).to.bignumber.equal(savingsManagerBalance);

            await savingsManager.collectAndDistributeInterest(mUSD.address);

            const balanceAfter = await mUSD.balanceOf(savingsContract.address);
            expect(nintyFivePercentToken).to.bignumber.equal(balanceAfter);

            // expect 5% balance left at SavingsManager
            savingsManagerBalance = await mUSD.balanceOf(savingsManager.address);
            const expectedFivePercentTokens = FIVE_TOKENS.sub(nintyFivePercentToken);
            expect(expectedFivePercentTokens).to.bignumber.equal(savingsManagerBalance);

            await savingsManager.distributeUnallocatedInterest(mUSD.address, {
                from: sa.governor,
            });

            const balanceOfRecipient = await mUSD.balanceOf(recipient.address);
            expect(expectedFivePercentTokens).to.bignumber.equal(balanceOfRecipient);
        });
    });
});
