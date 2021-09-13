/* eslint-disable @typescript-eslint/naming-convention */

import { ethers } from "hardhat"
import { expect } from "chai"
import { simpleToExactAmount, BN } from "@utils/math"
import { assertBNClose, assertBNClosePercent, assertBNSlightlyGTPercent } from "@utils/assertions"
import { StandardAccounts, MassetMachine } from "@utils/machines"
import { fullScale, ZERO_ADDRESS, ZERO, MAX_UINT256, TEN_MINS, ONE_DAY, DEAD_ADDRESS, ONE_WEEK, ONE_MIN } from "@utils/constants"
import { getTimestamp, increaseTime } from "@utils/time"
import {
    SavingsContract,
    MockNexus__factory,
    MockNexus,
    MockMasset,
    MockMasset__factory,
    SavingsContract__factory,
    SavingsManager,
    SavingsManager__factory,
    PausableModule,
    MockERC20,
    MockRevenueRecipient__factory,
} from "types/generated"
import { Account } from "types"
import { shouldBehaveLikePausableModule, IPausableModuleBehaviourContext } from "../shared/PausableModule.behaviour"

describe("SavingsManager", async () => {
    const TEN = BN.from(10)
    const TEN_TOKENS = TEN.mul(fullScale)
    const FIVE_TOKENS = TEN_TOKENS.div(BN.from(2))
    const THIRTY_MINUTES = TEN_MINS.mul(BN.from(3)).add(BN.from(1))
    // 1.2 million tokens
    const INITIAL_MINT = BN.from(1200000)
    let sa: StandardAccounts
    let manager: Account
    const ctx: Partial<IPausableModuleBehaviourContext> = {}

    let nexus: MockNexus
    let savingsContract: SavingsContract
    let savingsManager: SavingsManager
    let mUSD: MockMasset
    let liquidator: Account

    async function createNewSavingsManager(mintAmount: BN = INITIAL_MINT): Promise<void> {
        mUSD = await (await new MockMasset__factory(sa.default.signer)).deploy("MOCK", "MOCK", 18, sa.default.address, mintAmount)

        const savingsFactory = await new SavingsContract__factory(sa.default.signer)
        savingsContract = await savingsFactory.deploy(nexus.address, mUSD.address)
        await savingsContract.initialize(sa.default.address, "Savings Credit", "imUSD")

        savingsManager = await new SavingsManager__factory(sa.default.signer).deploy(
            nexus.address,
            mUSD.address,
            savingsContract.address,
            simpleToExactAmount(1),
            ONE_WEEK,
        )
        // Set new SavingsManager address in Nexus
        await nexus.setSavingsManager(savingsManager.address)
        await nexus.setLiquidator(liquidator.address)
        await mUSD.connect(sa.default.signer).transfer(liquidator.address, simpleToExactAmount(1, 23))
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        manager = sa.dummy2
        liquidator = sa.fundManager

        // Use a mock Nexus so we can dictate addresses
        nexus = await (await new MockNexus__factory(sa.default.signer)).deploy(sa.governor.address, manager.address, DEAD_ADDRESS)

        await createNewSavingsManager()
    })

    describe("behaviours", async () => {
        describe("should behave like a Module", async () => {
            beforeEach(async () => {
                await createNewSavingsManager()
                ctx.module = savingsManager as PausableModule
                ctx.sa = sa
            })
            shouldBehaveLikePausableModule(ctx as IPausableModuleBehaviourContext)
        })
    })

    describe("constructor", async () => {
        it("should fail when nexus address is zero", async () => {
            await expect(
                new SavingsManager__factory(sa.default.signer).deploy(
                    ZERO_ADDRESS,
                    mUSD.address,
                    savingsContract.address,
                    simpleToExactAmount(1),
                    ONE_WEEK,
                ),
            ).to.be.revertedWith("Nexus address is zero")
        })

        it("should fail when mAsset address is zero", async () => {
            await expect(
                new SavingsManager__factory(sa.default.signer).deploy(
                    nexus.address,
                    ZERO_ADDRESS,
                    savingsContract.address,
                    simpleToExactAmount(1),
                    ONE_WEEK,
                ),
            ).to.be.revertedWith("Must be valid address")
        })

        it("should fail when savingsContract address is zero", async () => {
            await expect(
                new SavingsManager__factory(sa.default.signer).deploy(
                    nexus.address,
                    mUSD.address,
                    ZERO_ADDRESS,
                    simpleToExactAmount(1),
                    ONE_WEEK,
                ),
            ).to.be.revertedWith("Must be valid address")
        })

        it("should have valid state after deployment", async () => {
            const savingsContractAddr = await savingsManager.savingsContracts(mUSD.address)
            expect(savingsContractAddr).to.equal(savingsContract.address)

            const allowance = await mUSD.allowance(savingsManager.address, savingsContract.address)
            expect(MAX_UINT256).to.equal(allowance)
        })
    })

    describe("adding a SavingsContract", async () => {
        let mockMasset: MockERC20
        let mockSavingsContract: Account

        before(async () => {
            mockSavingsContract = sa.dummy4
            mockMasset = await new MockMasset__factory(sa.default.signer).deploy("MOCK", "MOCK", 18, sa.default.address, BN.from(10000))
        })

        it("should fail when not called by governor", async () => {
            await expect(
                savingsManager.connect(sa.other.signer).addSavingsContract(mockMasset.address, mockSavingsContract.address),
            ).to.be.revertedWith("Only governor can execute")
        })

        it("should fail when mAsset address is zero", async () => {
            await expect(
                savingsManager.connect(sa.governor.signer).addSavingsContract(ZERO_ADDRESS, mockSavingsContract.address),
            ).to.be.revertedWith("Must be valid address")
        })

        it("should fail when savingsContract address is zero", async () => {
            await expect(
                savingsManager.connect(sa.governor.signer).addSavingsContract(mockMasset.address, ZERO_ADDRESS),
            ).to.be.revertedWith("Must be valid address")
        })

        it("should fail when mAsset entry already exist", async () => {
            await expect(
                savingsManager.connect(sa.governor.signer).addSavingsContract(mUSD.address, savingsContract.address),
            ).to.be.revertedWith("Savings contract already exists")
        })

        it("should succeed with valid parameter", async () => {
            let savingsContractAddr = await savingsManager.savingsContracts(mUSD.address)
            expect(savingsContractAddr).to.equal(savingsContract.address)
            savingsContractAddr = await savingsManager.savingsContracts(mockMasset.address)
            expect(ZERO_ADDRESS).to.equal(savingsContractAddr)
            const tx = savingsManager.connect(sa.governor.signer).addSavingsContract(mockMasset.address, mockSavingsContract.address)
            await expect(tx).to.emit(savingsManager, "SavingsContractAdded").withArgs(mockMasset.address, mockSavingsContract.address)

            savingsContractAddr = await savingsManager.savingsContracts(mUSD.address)
            expect(savingsContractAddr).to.equal(savingsContract.address)

            savingsContractAddr = await savingsManager.savingsContracts(mockMasset.address)
            expect(mockSavingsContract.address).to.equal(savingsContractAddr)
        })
    })

    describe("updating a SavingsContract", async () => {
        it("should fail when not called by governor", async () => {
            await expect(
                savingsManager.connect(sa.other.signer).updateSavingsContract(mUSD.address, savingsContract.address),
            ).to.be.revertedWith("Only governor can execute")
        })

        it("should fail when mAsset address is zero", async () => {
            await expect(
                savingsManager.connect(sa.governor.signer).updateSavingsContract(ZERO_ADDRESS, savingsContract.address),
            ).to.be.revertedWith("Savings contract does not exist")
        })

        it("should fail when savingsContract address is zero", async () => {
            await expect(savingsManager.connect(sa.governor.signer).updateSavingsContract(mUSD.address, ZERO_ADDRESS)).to.be.revertedWith(
                "Must be valid address",
            )
        })

        it("should fail when savingsContract not found", async () => {
            await expect(
                savingsManager.connect(sa.governor.signer).updateSavingsContract(sa.other.address, savingsContract.address),
            ).to.be.revertedWith("Savings contract does not exist")
        })

        it("should succeed with valid parameters", async () => {
            let savingsContractAddr = await savingsManager.savingsContracts(mUSD.address)
            expect(savingsContractAddr).to.equal(savingsContract.address)

            const tx = savingsManager.connect(sa.governor.signer).updateSavingsContract(mUSD.address, sa.other.address)

            await expect(tx).to.emit(savingsManager, "SavingsContractUpdated").withArgs(mUSD.address, sa.other.address)

            savingsContractAddr = await savingsManager.savingsContracts(mUSD.address)
            expect(sa.other.address).to.equal(savingsContractAddr)
        })
    })

    describe("freezing streams", async () => {
        it("should fail when not called by governor", async () => {
            await expect(savingsManager.connect(sa.other.signer).freezeStreams()).to.be.revertedWith("Only governor can execute")
        })
        it("should stop all streaming from being initialized", async () => {
            const tx = savingsManager.connect(sa.governor.signer).freezeStreams()
            await expect(tx).to.emit(savingsManager, "StreamsFrozen")

            await expect(savingsManager.collectAndStreamInterest(mUSD.address)).to.be.revertedWith("Streaming is currently frozen")
        })
    })

    describe("adding a revenue recipient", async () => {
        it("should fail when not called by governor", async () => {
            await expect(savingsManager.connect(sa.other.signer).setRevenueRecipient(mUSD.address, DEAD_ADDRESS)).to.be.revertedWith(
                "Only governor can execute",
            )
        })
        it("should simply update the recipient and emit an event", async () => {
            const tx = savingsManager.connect(sa.governor.signer).setRevenueRecipient(mUSD.address, sa.fundManager.address)
            await expect(tx).to.emit(savingsManager, "RevenueRecipientSet").withArgs(mUSD.address, sa.fundManager.address)
            const recipient = await savingsManager.revenueRecipients(mUSD.address)
            expect(recipient).eq(sa.fundManager.address)
        })
    })

    describe("modifying the savings rate", async () => {
        it("should fail when not called by governor", async () => {
            await expect(savingsManager.connect(sa.other.signer).setSavingsRate(fullScale)).to.be.revertedWith("Only governor can execute")
        })

        it("should fail when not in range (lower range)", async () => {
            await expect(savingsManager.connect(sa.governor.signer).setSavingsRate(simpleToExactAmount(1, 16))).to.be.revertedWith(
                "Must be a valid rate",
            )
        })

        it("should fail when not in range (higher range)", async () => {
            await expect(savingsManager.connect(sa.governor.signer).setSavingsRate(simpleToExactAmount(1, 20))).to.be.revertedWith(
                "Must be a valid rate",
            )
        })

        it("should succeed when in valid range (min value)", async () => {
            const newRate = simpleToExactAmount(6, 17)
            const tx = savingsManager.connect(sa.governor.signer).setSavingsRate(newRate)

            await expect(tx).to.emit(savingsManager, "SavingsRateChanged").withArgs(newRate)
        })

        it("should succeed when in valid range (max value)", async () => {
            const newRate = simpleToExactAmount(1, 18)
            const tx = savingsManager.connect(sa.governor.signer).setSavingsRate(newRate)

            await expect(tx).to.emit(savingsManager, "SavingsRateChanged").withArgs(newRate)
        })
    })

    describe("collecting and distributing Interest", async () => {
        beforeEach(async () => {
            await createNewSavingsManager()
        })
        context("with invalid arguments", async () => {
            it("should fail when mAsset not exist", async () => {
                await expect(savingsManager.collectAndDistributeInterest(sa.other.address)).to.be.revertedWith(
                    "Must have a valid savings contract",
                )
            })
        })
        context("when the contract is paused", async () => {
            it("should fail", async () => {
                // Pause contract
                await savingsManager.connect(sa.governor.signer).pause()

                await expect(savingsManager.collectAndDistributeInterest(mUSD.address)).to.be.revertedWith("Pausable: paused")
            })
        })
        context("when there is no interest to collect", async () => {
            before(async () => {
                await createNewSavingsManager()
            })

            it("should succeed when interest collected is zero", async () => {
                const tx = savingsManager.collectAndDistributeInterest(mUSD.address)
                await expect(tx)
                    .to.emit(savingsManager, "InterestCollected")
                    .withArgs(mUSD.address, BN.from(0), INITIAL_MINT.mul(BN.from(10).pow(BN.from(18))), BN.from(0))
            })
        })

        interface Stream {
            end: BN
            rate: BN
        }

        interface Data {
            lastPeriodStart: BN
            lastCollection: BN
            periodYield: BN
            liqStream: Stream
            yieldStream: Stream
            savingsManagerBal: BN
            savingsContractBal: BN
            lastBatchCollected: BN
        }
        const snapshotData = async (): Promise<Data> => {
            const liqStream = await savingsManager.liqStream(mUSD.address)
            const yieldStream = await savingsManager.yieldStream(mUSD.address)
            return {
                lastPeriodStart: await savingsManager.lastPeriodStart(mUSD.address),
                lastCollection: await savingsManager.lastCollection(mUSD.address),
                periodYield: await savingsManager.periodYield(mUSD.address),
                liqStream: { end: liqStream[0], rate: liqStream[1] },
                yieldStream: { end: yieldStream[0], rate: yieldStream[1] },
                savingsManagerBal: await mUSD.balanceOf(savingsManager.address),
                savingsContractBal: await mUSD.balanceOf(savingsContract.address),
                lastBatchCollected: await savingsManager.lastBatchCollected(mUSD.address),
            }
        }
        context("testing the boundaries of liquidated deposits", async () => {
            // Initial supply of 10m units
            const initialSupply = BN.from(10000000)
            const liquidated1 = simpleToExactAmount(100, 18)
            const liquidated2 = simpleToExactAmount(200, 18)
            const liquidated3 = simpleToExactAmount(300, 18)
            beforeEach(async () => {
                await createNewSavingsManager(initialSupply)
            })
            it("should fail if deposit not called by the liquidator", async () => {
                await expect(savingsManager.connect(sa.dummy2.signer).depositLiquidation(mUSD.address, liquidated1)).to.be.revertedWith(
                    "Only liquidator can execute",
                )
            })
            it("should fail if sender has no mUSD approved", async () => {
                await expect(savingsManager.connect(liquidator.signer).depositLiquidation(mUSD.address, liquidated1)).to.be.revertedWith(
                    "ERC20: transfer amount exceeds allowance",
                )
            })
            it("should set the streamRate and finish time correctly", async () => {
                const before = await snapshotData()
                await mUSD.connect(liquidator.signer).approve(savingsManager.address, liquidated1)

                const tx = savingsManager.connect(liquidator.signer).depositLiquidation(mUSD.address, liquidated1)
                await expect(tx).to.emit(savingsManager, "LiquidatorDeposited").withArgs(mUSD.address, liquidated1)
                const t0 = await getTimestamp()

                const after = await snapshotData()
                expect(after.savingsManagerBal).eq(before.savingsManagerBal.add(liquidated1))
                assertBNClose(after.lastCollection, t0, 2)
                expect(after.lastPeriodStart).eq(after.lastCollection)
                expect(after.periodYield).eq(BN.from(0))
                expect(after.liqStream.end).eq(after.lastCollection.add(ONE_WEEK))
                assertBNClosePercent(after.liqStream.rate, liquidated1.div(ONE_WEEK), "0.001")
            })
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
                const s = await snapshotData()
                expect(s.liqStream.rate).eq(BN.from(0))
                expect(s.savingsManagerBal).eq(BN.from(0))

                await mUSD.connect(liquidator.signer).approve(savingsManager.address, liquidated1)
                await savingsManager.connect(liquidator.signer).depositLiquidation(mUSD.address, liquidated1)

                const s0 = await snapshotData()
                assertBNClosePercent(s0.liqStream.rate, liquidated1.div(ONE_WEEK), "0.001")

                await increaseTime(ONE_DAY.mul(5))
                // @5

                let expectedInterest = ONE_DAY.mul(5).mul(s0.liqStream.rate)
                await mUSD.setAmountForCollectInterest(1)
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                const s5 = await snapshotData()

                assertBNClosePercent(s5.savingsManagerBal, s0.savingsManagerBal.sub(expectedInterest), "0.01")

                assertBNClosePercent(s5.savingsContractBal, s0.savingsContractBal.add(expectedInterest), "0.01")

                await increaseTime(ONE_DAY)
                // @6
                const leftOverRewards = ONE_DAY.mul(s0.liqStream.rate)
                const totalRewards = leftOverRewards.add(liquidated2)

                await mUSD.connect(liquidator.signer).approve(savingsManager.address, liquidated2)
                await savingsManager.connect(liquidator.signer).depositLiquidation(mUSD.address, liquidated2)

                const s6 = await snapshotData()

                assertBNClosePercent(s6.liqStream.rate, totalRewards.div(ONE_WEEK), "0.01")
                expect(s6.liqStream.end).eq(s6.lastCollection.add(ONE_WEEK))

                await increaseTime(ONE_DAY)
                // @7
                expectedInterest = ONE_DAY.mul(s6.liqStream.rate)
                await mUSD.setAmountForCollectInterest(1)
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                const s7 = await snapshotData()
                assertBNClosePercent(s7.savingsManagerBal, s6.savingsManagerBal.sub(expectedInterest), "0.01")

                await increaseTime(ONE_DAY.mul(8))
                // @15
                expectedInterest = ONE_DAY.mul(6).mul(s6.liqStream.rate)
                await mUSD.setAmountForCollectInterest(1)
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                const s15 = await snapshotData()
                assertBNClosePercent(s15.savingsManagerBal, s7.savingsManagerBal.sub(expectedInterest), "0.01")

                expect(s15.liqStream.end).lt(s15.lastCollection)
                expect(s15.liqStream.rate).eq(s7.liqStream.rate)
                assertBNClose(s15.savingsManagerBal, BN.from(0), simpleToExactAmount(1, 6))

                await increaseTime(ONE_DAY)
                // @16
                expectedInterest = BN.from(0)
                await mUSD.setAmountForCollectInterest(1)
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                const s16 = await snapshotData()
                expect(s16.savingsManagerBal).eq(s15.savingsManagerBal)

                await increaseTime(ONE_DAY.mul(2))
                // @18
                await mUSD.connect(liquidator.signer).approve(savingsManager.address, liquidated3)
                await savingsManager.connect(liquidator.signer).depositLiquidation(mUSD.address, liquidated3)
                const s18 = await snapshotData()
                assertBNClosePercent(s18.liqStream.rate, liquidated3.div(ONE_WEEK), "0.001")
            })
        })

        context("testing the collection and streaming of mAsset interest", async () => {
            // Initial supply of 10m units
            const initialSupply = BN.from(10000000)
            const liquidated1 = simpleToExactAmount(100, 18)
            const platformInterest1 = simpleToExactAmount(10, 18)
            const platformInterest2 = simpleToExactAmount(50, 18)
            const platformInterest3 = simpleToExactAmount(20, 18)
            const platformInterest4 = simpleToExactAmount(40, 18)
            // check lastBatchCollected
            beforeEach(async () => {
                await createNewSavingsManager(initialSupply)
            })
            it("should fail if streams are frozen", async () => {
                await savingsManager.connect(sa.governor.signer).freezeStreams()
                await expect(savingsManager.collectAndStreamInterest(mUSD.address)).to.be.revertedWith("Streaming is currently frozen")
            })
            it("should fail if there is no valid savings contract", async () => {
                await expect(savingsManager.connect(sa.dummy2.signer).collectAndStreamInterest(sa.dummy1.address)).to.be.revertedWith(
                    "Must have a valid savings contract",
                )
            })
            it("should fail if called twice within 6 hours", async () => {
                await mUSD.setAmountForPlatformInterest(BN.from(10000))
                await savingsManager.collectAndStreamInterest(mUSD.address)
                await expect(savingsManager.connect(sa.dummy2.signer).collectAndStreamInterest(mUSD.address)).to.be.revertedWith(
                    "Cannot deposit twice in 6 hours",
                )
            })
            it("should have no effect if there is no interest to collect", async () => {
                const before = await snapshotData()
                const bal = await mUSD.totalSupply()
                const tx = savingsManager.collectAndStreamInterest(mUSD.address)
                await expect(tx).to.emit(savingsManager, "InterestCollected").withArgs(mUSD.address, BN.from(0), bal, BN.from(0))
                const timeAfter = await getTimestamp()
                const after = await snapshotData()
                expect(before.yieldStream.rate).eq(after.yieldStream.rate)
                expect(before.yieldStream.end).eq(after.yieldStream.end)
                // It should first collect and distribute existing interest
                assertBNClose(after.lastCollection, timeAfter, 2)
                expect(before.lastCollection).eq(BN.from(0))
            })
            it("should fail if the APY is too high", async () => {
                await mUSD.setAmountForPlatformInterest(BN.from(10000))
                await savingsManager.collectAndStreamInterest(mUSD.address)

                await increaseTime(ONE_DAY.div(2).add(1))
                // max APY = 1500%
                // initial liq = 10m
                // 12h increase = ~~205k
                await mUSD.setAmountForPlatformInterest(simpleToExactAmount(210000, 18))
                await expect(savingsManager.connect(sa.dummy2.signer).collectAndStreamInterest(mUSD.address)).to.be.revertedWith(
                    "Interest protected from inflating past maxAPY",
                )
                await mUSD.setAmountForPlatformInterest(simpleToExactAmount(200000, 18))
                const tx = savingsManager.collectAndStreamInterest(mUSD.address)
                await expect(tx).to.emit(savingsManager, "InterestCollected")
            })
            it("should factor in new mUSD, initialise stream and emit an event", async () => {
                const before = await snapshotData()
                expect(before.lastBatchCollected).eq(BN.from(0))
                expect(before.lastCollection).eq(BN.from(0))
                expect(before.lastPeriodStart).eq(BN.from(0))
                expect(before.periodYield).eq(BN.from(0))
                expect(before.savingsContractBal).eq(BN.from(0))
                expect(before.savingsManagerBal).eq(BN.from(0))
                expect(before.yieldStream.rate).eq(BN.from(0))
                expect(before.yieldStream.end).eq(BN.from(0))

                const ts = await getTimestamp()
                const collectionAmount = simpleToExactAmount(100, 18)
                await mUSD.setAmountForPlatformInterest(collectionAmount)
                await savingsManager.collectAndStreamInterest(mUSD.address)

                const after = await snapshotData()
                assertBNClose(after.lastBatchCollected, ts, 5)
                expect(after.lastCollection).eq(after.lastBatchCollected)
                expect(after.lastPeriodStart).eq(after.lastBatchCollected)
                expect(after.periodYield).eq(BN.from(0))
                expect(after.savingsContractBal).eq(BN.from(0))
                expect(after.savingsManagerBal).eq(collectionAmount)
                assertBNClosePercent(after.yieldStream.rate, simpleToExactAmount("1.157", 15), "0.1")
                expect(after.yieldStream.end).eq(after.lastBatchCollected.add(ONE_DAY))
                assertBNSlightlyGTPercent(
                    collectionAmount,
                    after.yieldStream.rate.mul(after.yieldStream.end.sub(after.lastCollection)),
                    "0.1",
                    true,
                )
            })

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
                const s = await snapshotData()
                expect(s.liqStream.rate).eq(BN.from(0))
                expect(s.savingsManagerBal).eq(BN.from(0))
                await mUSD.connect(liquidator.signer).approve(savingsManager.address, liquidated1)
                await savingsManager.connect(liquidator.signer).depositLiquidation(mUSD.address, liquidated1)
                const s0 = await snapshotData()
                assertBNClosePercent(s0.liqStream.rate, liquidated1.div(ONE_WEEK), "0.001")
                await increaseTime(ONE_DAY.mul(1))
                // @1
                await mUSD.setAmountForPlatformInterest(platformInterest1)
                await savingsManager.collectAndStreamInterest(mUSD.address)
                const s1 = await snapshotData()
                assertBNClosePercent(s1.yieldStream.rate, platformInterest1.div(ONE_DAY), "0.001")
                expect(s1.liqStream.end).eq(s0.liqStream.end)
                expect(s1.liqStream.rate).eq(s0.liqStream.rate)
                expect(s1.yieldStream.end).eq(s1.lastCollection.add(ONE_DAY))
                expect(s1.lastBatchCollected).eq(s1.lastCollection)
                await increaseTime(ONE_DAY.mul(4))
                // @5
                let expectedInterest = ONE_DAY.mul(4).mul(s1.liqStream.rate)
                expectedInterest = expectedInterest.add(ONE_DAY.mul(s1.yieldStream.rate))
                await mUSD.setAmountForCollectInterest(1)
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                const s5 = await snapshotData()
                assertBNClosePercent(s5.savingsManagerBal, s1.savingsManagerBal.sub(expectedInterest), "0.01")
                assertBNClosePercent(s5.savingsContractBal, s1.savingsContractBal.add(expectedInterest), "0.01")
                await increaseTime(ONE_DAY.mul(6))
                // @t11
                expectedInterest = ONE_DAY.mul(2).mul(s0.liqStream.rate)
                await mUSD.setAmountForPlatformInterest(platformInterest2)
                await savingsManager.collectAndStreamInterest(mUSD.address)
                const s11 = await snapshotData()
                assertBNClosePercent(s11.yieldStream.rate, platformInterest2.div(ONE_DAY), "0.001")
                expect(s11.yieldStream.end).eq(s11.lastCollection.add(ONE_DAY))
                expect(s11.lastBatchCollected).eq(s11.lastCollection)
                assertBNClosePercent(s11.savingsManagerBal, s5.savingsManagerBal.sub(expectedInterest).add(platformInterest2), "0.01")
                assertBNClosePercent(s11.savingsContractBal, s5.savingsContractBal.add(expectedInterest), "0.01")
                await increaseTime(ONE_DAY.div(2))
                // @11.5
                const leftOverRewards = ONE_DAY.div(2).mul(s11.yieldStream.rate)
                const total = leftOverRewards.add(platformInterest3)
                await mUSD.setAmountForPlatformInterest(platformInterest3)
                await savingsManager.collectAndStreamInterest(mUSD.address)
                const s115 = await snapshotData()
                expect(s115.yieldStream.end).eq(s115.lastCollection.add(ONE_DAY))
                assertBNClosePercent(s115.yieldStream.rate, total.div(ONE_DAY), "0.01")
                await increaseTime(ONE_DAY.mul(9).div(2))
                // @16
                expectedInterest = s115.yieldStream.rate.mul(ONE_DAY)
                await mUSD.setAmountForCollectInterest(1)
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                const s16 = await snapshotData()
                assertBNClosePercent(s16.savingsManagerBal, s115.savingsManagerBal.sub(expectedInterest), "0.01")
                assertBNClosePercent(s16.savingsContractBal, s115.savingsContractBal.add(expectedInterest), "0.01")
                // all mUSD should be drained now
                expect(s16.savingsManagerBal).lt(simpleToExactAmount(1, 16))
                await increaseTime(ONE_DAY.div(2))
                // @16.5
                const ts17 = await getTimestamp()
                await mUSD.setAmountForPlatformInterest(platformInterest4)
                await savingsManager.collectAndStreamInterest(mUSD.address)
                const s17 = await snapshotData()
                assertBNClosePercent(s17.yieldStream.rate, platformInterest4.div(ONE_DAY), "0.01")
                assertBNClose(ts17, s17.lastCollection, 10)
            })
        })
        context("testing new mechanism", async () => {
            // Initial supply of 10m units
            const initialSupply = BN.from(10000000)
            const initialSupplyExact = simpleToExactAmount(initialSupply, 18)
            beforeEach(async () => {
                await createNewSavingsManager(initialSupply)
            })
            it("should work when lastCollection time is 0 with low interest", async () => {
                const lastPeriodStart = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStart).eq(BN.from(0))
                const lastCollection = await savingsManager.lastCollection(mUSD.address)
                expect(lastCollection).eq(BN.from(0))
                const lastPeriodYield = await savingsManager.periodYield(mUSD.address)
                expect(lastPeriodYield).eq(BN.from(0))

                const newInterest = simpleToExactAmount(1000, 18)
                // e.g. (1e21*1e18)/1e25 = 1e14 (or 0.01%)
                const percentageIncrease = newInterest.mul(fullScale).div(initialSupplyExact)
                // e.g. (1e14 * 1e18) / 50e18 = 2e12
                const expectedAPY = percentageIncrease.mul(fullScale).div(simpleToExactAmount(50, 18))
                expect(expectedAPY).eq(simpleToExactAmount(2, 12))

                await mUSD.setAmountForCollectInterest(newInterest)

                const curTime = await getTimestamp()
                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address)
                const receipt = await tx.wait()
                const interectCollectedEvent = receipt.events[1]
                assertBNClose(
                    BN.from(interectCollectedEvent.args.apy),
                    expectedAPY,
                    simpleToExactAmount(1, 12), // allow for a 0.00001 deviation in the percentage
                )
                const lastCollectionAfter = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollectionAfter, curTime, BN.from(2))
                const lastPeriodStartAfter = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStartAfter).eq(lastCollectionAfter)
                const lastPeriodYieldAfter = await savingsManager.periodYield(mUSD.address)
                expect(lastPeriodYieldAfter).eq(BN.from(0))
            })
            it("should always update the lastCollection time for future", async () => {
                const lastCollection = await savingsManager.lastCollection(mUSD.address)
                expect(lastCollection).eq(BN.from(0))

                const curTime = await getTimestamp()
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                const lastCollectionMiddle = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollectionMiddle, curTime, BN.from(2))

                const newInterest = simpleToExactAmount(11000, 18)
                await mUSD.setAmountForCollectInterest(newInterest)

                await expect(savingsManager.collectAndDistributeInterest(mUSD.address)).to.be.revertedWith(
                    "Interest protected from inflating past 10 Bps",
                )

                await increaseTime(THIRTY_MINUTES.add(1))

                await expect(savingsManager.collectAndDistributeInterest(mUSD.address)).to.be.revertedWith(
                    "Interest protected from inflating past maxAPY",
                )

                await increaseTime(THIRTY_MINUTES.add(1))

                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address)

                const endTime = await getTimestamp()
                const lastCollectionEnd = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollectionEnd, endTime, BN.from(2))
                const lastPeriodStartEnd = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStartEnd).eq(lastCollectionEnd)
                const lastPeriodYieldEnd = await savingsManager.periodYield(mUSD.address)
                expect(lastPeriodYieldEnd).eq(BN.from(0))

                const expectedAPY = simpleToExactAmount("9.636", 18)
                const receipt = await tx.wait()
                const interectCollectedEvent = receipt.events[1]
                assertBNClose(
                    BN.from(interectCollectedEvent.args.apy),
                    expectedAPY,
                    simpleToExactAmount(1, 17), // allow for a 10% deviation in the percentage
                )
            })
            it("should fail if under 30 minutes and greater than 10bps increase", async () => {
                // Pass 1st
                const curTime = await getTimestamp()
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                const lastCollectionMiddle = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollectionMiddle, curTime, BN.from(2))

                // fail with 10bps
                const failingInterest = simpleToExactAmount(10100, 18)
                await mUSD.setAmountForCollectInterest(failingInterest)
                await expect(savingsManager.collectAndDistributeInterest(mUSD.address)).to.be.revertedWith(
                    "Interest protected from inflating past 10 Bps",
                )
                // change to 9.99bps
                const passingInterest = simpleToExactAmount(9999, 18)
                await mUSD.setAmountForCollectInterest(passingInterest)

                await savingsManager.collectAndDistributeInterest(mUSD.address)

                const endTime = await getTimestamp()
                const lastCollectionEnd = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollectionEnd, endTime, BN.from(2))
                const lastPeriodStartEnd = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStartEnd).eq(lastCollectionMiddle)
                const lastPeriodYieldEnd = await savingsManager.periodYield(mUSD.address)
                expect(lastPeriodYieldEnd).eq(passingInterest)
            })
            it("should pass if 1 block and 9.99bps increase", async () => {
                // Pass 1st
                const curTime = await getTimestamp()
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                const lastCollectionBefore = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollectionBefore, curTime, BN.from(2))

                // update ONE SECOND
                const passingInterest = simpleToExactAmount(9999, 18)
                await mUSD.setAmountForCollectInterest(passingInterest)

                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address)

                const lastCollectionAfter = await savingsManager.lastCollection(mUSD.address)

                const timeDifferential = lastCollectionAfter.sub(lastCollectionBefore)
                const expectedApy = BN.from("31532846400760319992415").div(timeDifferential.eq(0) ? BN.from(1) : timeDifferential)
                const receipt = await tx.wait()
                const interectCollectedEvent = receipt.events[1]
                assertBNClose(
                    interectCollectedEvent.args.apy,
                    expectedApy,
                    simpleToExactAmount(1, 14), // allow for minor deviation in calc
                )

                // it should fail if it goes over 9.99bps in the period

                const failingInterest = simpleToExactAmount(10, 18)
                await mUSD.setAmountForCollectInterest(failingInterest)

                await expect(savingsManager.collectAndDistributeInterest(mUSD.address)).to.be.revertedWith(
                    "Interest protected from inflating past 10 Bps",
                )
            })
            it("should pass if over 30 minutes and less than 15e18", async () => {
                // Pass 1st
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                // update 30 mins
                await increaseTime(THIRTY_MINUTES.add(1))
                // fail on 16e18
                const failingInterest = simpleToExactAmount(8700, 18)
                await mUSD.setAmountForCollectInterest(failingInterest)
                await expect(savingsManager.collectAndDistributeInterest(mUSD.address)).to.be.revertedWith(
                    "Interest protected from inflating past maxAPY",
                )
                // update 30 mins
                await increaseTime(THIRTY_MINUTES.add(1))
                // pass
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                // update 10 mins
                // add 5bps
                const passingInterest = simpleToExactAmount(5000, 18)
                await mUSD.setAmountForCollectInterest(passingInterest)

                // pass
                await savingsManager.collectAndDistributeInterest(mUSD.address)
            })

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
                const lastCollection_0 = await savingsManager.lastCollection(mUSD.address)
                expect(lastCollection_0).eq(BN.from(0))
                const lastPeriodStart_0 = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStart_0).eq(BN.from(0))
                const periodYield_0 = await savingsManager.periodYield(mUSD.address)
                expect(periodYield_0).eq(BN.from(0))

                // @40
                await increaseTime(ONE_MIN.mul(40))
                let curTime = await getTimestamp()
                const interest_40 = simpleToExactAmount(1000, 18)
                await mUSD.setAmountForCollectInterest(interest_40)
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                const lastCollection_40 = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollection_40, curTime, 5)
                const lastPeriodStart_40 = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStart_40).eq(lastCollection_40)
                const periodYield_40 = await savingsManager.periodYield(mUSD.address)
                expect(periodYield_40).eq(BN.from(0))

                // @50
                await increaseTime(ONE_MIN.mul(10))
                curTime = await getTimestamp()
                const interest_50 = simpleToExactAmount(900, 18)
                await mUSD.setAmountForCollectInterest(interest_50)
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                const lastCollection_50 = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollection_50, curTime, 5)
                const lastPeriodStart_50 = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStart_50).eq(lastCollection_40)
                const periodYield_50 = await savingsManager.periodYield(mUSD.address)
                expect(periodYield_50).eq(interest_50)

                // @65
                await increaseTime(ONE_MIN.mul(15))
                curTime = await getTimestamp()
                const interest_65 = simpleToExactAmount(800, 18)
                await mUSD.setAmountForCollectInterest(interest_65)
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                const lastCollection_65 = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollection_65, curTime, 5)
                const lastPeriodStart_65 = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStart_65).eq(lastCollection_40)
                const periodYield_65 = await savingsManager.periodYield(mUSD.address)
                expect(periodYield_65).eq(interest_65.add(interest_50))

                // @80
                await increaseTime(ONE_MIN.mul(15))
                curTime = await getTimestamp()
                const interest_80 = simpleToExactAmount(700, 18)
                await mUSD.setAmountForCollectInterest(interest_80)
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                const lastCollection_80 = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollection_80, curTime, 5)
                const lastPeriodStart_80 = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStart_80).eq(lastCollection_65)
                const periodYield_80 = await savingsManager.periodYield(mUSD.address)
                expect(periodYield_80).eq(interest_80)

                // @120
                await increaseTime(ONE_MIN.mul(40))
                curTime = await getTimestamp()
                const interest_120 = simpleToExactAmount(600, 18)
                await mUSD.setAmountForCollectInterest(interest_120)
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                const lastCollection_120 = await savingsManager.lastCollection(mUSD.address)
                assertBNClose(lastCollection_120, curTime, 5)
                const lastPeriodStart_120 = await savingsManager.lastPeriodStart(mUSD.address)
                expect(lastPeriodStart_120).eq(lastCollection_120)
                const periodYield_120 = await savingsManager.periodYield(mUSD.address)
                expect(periodYield_120).eq(BN.from(0))
            })
        })
        context("when there is some interest to collect", async () => {
            before(async () => {
                await createNewSavingsManager()
            })
            it("should collect the interest first time", async () => {
                // Refresh the collection timer
                await savingsManager.collectAndDistributeInterest(mUSD.address)

                // Total supply is 1.2 million
                // For 7.3% APY following is the calculation
                // 1.2million * 7.3% = 87600 Yearly
                // 87600 / 365 = 240 per day
                // 240 / 24 = 10 per hour
                // 10 / 2 = 5 per half hour
                const balanceBefore = await mUSD.balanceOf(savingsContract.address)
                expect(ZERO).to.equal(balanceBefore)

                const newInterest = FIVE_TOKENS
                await mUSD.setAmountForCollectInterest(newInterest)

                // should move 30 mins in future
                await increaseTime(THIRTY_MINUTES)
                const tx = await savingsManager.collectAndDistributeInterest(mUSD.address)

                const expectedTotalSupply = INITIAL_MINT.mul(fullScale).add(FIVE_TOKENS)
                // expectedAPY = 7.3%
                const expectedAPY = simpleToExactAmount("7.3", 16)
                const receipt = await tx.wait()
                const eventArgs = receipt.events[1].args
                expect(eventArgs.mAsset).eq(mUSD.address)
                expect(eventArgs.interest).eq(FIVE_TOKENS)
                expect(eventArgs.newTotalSupply).eq(expectedTotalSupply)
                assertBNClose(
                    eventArgs.apy,
                    expectedAPY,
                    simpleToExactAmount(3, 14), // allow for a 0.03% deviation in the percentage
                )

                const balanceAfter = await mUSD.balanceOf(savingsContract.address)
                expect(newInterest).to.equal(balanceAfter)
            })

            it("should throw if the APY is too high", async () => {
                // Refresh the collection timer
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                // >= 1500 APY with a 1.2m cap is equal to
                // 49315 tokens per day (~4)
                const balanceBefore = await mUSD.balanceOf(savingsContract.address)
                expect(ZERO).to.equal(balanceBefore)
                const newInterest = BN.from(49500).mul(fullScale)
                await mUSD.setAmountForCollectInterest(newInterest)
                // should move 1 day in future
                await increaseTime(ONE_DAY)
                await expect(savingsManager.collectAndDistributeInterest(mUSD.address)).to.be.revertedWith(
                    "Interest protected from inflating past maxAPY",
                )
                await increaseTime(THIRTY_MINUTES.mul(BN.from(10)))
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                const balanceAfter = await mUSD.balanceOf(savingsContract.address)
                expect(newInterest).to.equal(balanceAfter)
            })

            it("should allow interest collection before 30 mins", async () => {
                await savingsManager.collectAndDistributeInterest(mUSD.address)
                await savingsManager.collectAndDistributeInterest(mUSD.address)
            })

            it("should allow interest collection again after 30 mins", async () => {
                await increaseTime(THIRTY_MINUTES)
                const tx = savingsManager.collectAndDistributeInterest(mUSD.address)
                await expect(tx)
                    .to.emit(savingsManager, "InterestCollected")
                    .withArgs(mUSD.address, BN.from(0), INITIAL_MINT.mul(fullScale), BN.from(0))
            })
        })
    })

    describe("distributing unallocated Interest", async () => {
        it("should fail without a valid recipient", async () => {
            await expect(savingsManager.connect(sa.governor.signer).distributeUnallocatedInterest(mUSD.address)).to.be.revertedWith(
                "Must have valid recipient",
            )
        })

        it("calls the distribute function on a valid recipient", async () => {
            const balanceBefore = await mUSD.balanceOf(sa.other.address)
            expect(ZERO).to.equal(balanceBefore)

            // Send some mUSD to SavingsManager
            const amount = BN.from(1000)
            await mUSD.connect(sa.default.signer).transfer(savingsManager.address, amount)

            const recipient = await new MockRevenueRecipient__factory(sa.default.signer).deploy()
            await savingsManager.connect(sa.governor.signer).setRevenueRecipient(mUSD.address, recipient.address)
            const tx = savingsManager.connect(sa.governor.signer).distributeUnallocatedInterest(mUSD.address)

            await expect(tx).to.emit(savingsManager, "RevenueRedistributed").withArgs(mUSD.address, recipient.address, amount)

            const balanceAfter = await mUSD.balanceOf(recipient.address)
            expect(amount).to.equal(balanceAfter)
        })

        it("calculates the unallocated interest correctly and calls the recipient", async () => {
            const recipient = await new MockRevenueRecipient__factory(sa.default.signer).deploy()
            await savingsManager.connect(sa.governor.signer).setRevenueRecipient(mUSD.address, recipient.address)
            const liquidationAmount = simpleToExactAmount(1000, 18)
            const swapFeesAmount = simpleToExactAmount(50, 18)
            // Set rate to 80%
            await savingsManager.connect(sa.governor.signer).setSavingsRate(simpleToExactAmount(8, 17))
            // Create a liquidation
            await mUSD.connect(liquidator.signer).approve(savingsManager.address, liquidationAmount)
            await savingsManager.connect(liquidator.signer).depositLiquidation(mUSD.address, liquidationAmount)
            // Zoom forward 3 days
            await increaseTime(ONE_DAY.mul(3))
            // Set interest for collection
            await mUSD.setAmountForCollectInterest(swapFeesAmount)
            // Deposit to SAVE
            await savingsManager.collectAndDistributeInterest(mUSD.address)
            // Redistribution should net (interest + 3/7 of liquidation) * 0.2
            const expectedRedistribution = liquidationAmount.mul(3).div(7).add(swapFeesAmount).mul(2).div(10)

            await savingsManager.connect(sa.governor.signer).distributeUnallocatedInterest(mUSD.address)
            const balance00 = await mUSD.balanceOf(recipient.address)
            assertBNClosePercent(expectedRedistribution, balance00, "0.01")
            // Zoom forward 1 days
            await increaseTime(ONE_DAY)
            // Redistribution should net 0
            await savingsManager.connect(sa.governor.signer).distributeUnallocatedInterest(mUSD.address)
            const balance01 = await mUSD.balanceOf(recipient.address)
            expect(balance01).eq(balance00)
        })
    })

    describe("extra tests:", async () => {
        let recipient
        beforeEach(async () => {
            await createNewSavingsManager()

            recipient = await new MockRevenueRecipient__factory(sa.default.signer).deploy()
            await savingsManager.connect(sa.governor.signer).setRevenueRecipient(mUSD.address, recipient.address)
        })

        it("should collect when 0% unallocated interest", async () => {
            const newInterest = FIVE_TOKENS
            await mUSD.setAmountForCollectInterest(newInterest)

            let savingsManagerBalance = await mUSD.balanceOf(savingsManager.address)
            expect(ZERO).to.equal(savingsManagerBalance)

            await savingsManager.collectAndDistributeInterest(mUSD.address)

            const balanceAfter = await mUSD.balanceOf(savingsContract.address)
            expect(newInterest).to.equal(balanceAfter)

            savingsManagerBalance = await mUSD.balanceOf(savingsManager.address)
            expect(ZERO).to.equal(savingsManagerBalance)
        })

        it("should collect 10% unallocated interest when rate changed", async () => {
            // Set savings rate to 90%
            const NINTY_PERCENT = BN.from(9)
                .mul(BN.from(10).pow(BN.from(17)))
                .add(BN.from(1))
            // 5 * 90% = 4.5 tokens
            // const nintyPercentToken = BN.from(45).mul(BN.from(10).pow(BN.from(16)));
            const nintyPercentToken = FIVE_TOKENS.mul(NINTY_PERCENT).div(fullScale)
            await savingsManager.connect(sa.governor.signer).setSavingsRate(NINTY_PERCENT)

            await mUSD.setAmountForCollectInterest(FIVE_TOKENS)

            let savingsManagerBalance = await mUSD.balanceOf(savingsManager.address)
            expect(ZERO).to.equal(savingsManagerBalance)

            await savingsManager.collectAndDistributeInterest(mUSD.address)

            const balanceAfter = await mUSD.balanceOf(savingsContract.address)
            expect(nintyPercentToken).to.equal(balanceAfter)

            // expect 10% balance left at SavingsManager
            savingsManagerBalance = await mUSD.balanceOf(savingsManager.address)
            const expectedTenPercentTokens = FIVE_TOKENS.sub(nintyPercentToken)
            expect(expectedTenPercentTokens).to.equal(savingsManagerBalance)

            await savingsManager.connect(sa.governor.signer).distributeUnallocatedInterest(mUSD.address)

            const balanceOfRecipient = await mUSD.balanceOf(recipient.address)
            expect(expectedTenPercentTokens).to.equal(balanceOfRecipient)
        })

        it("should collect 5% unallocated interest when rate changed", async () => {
            // Set savings rate to 95%
            const NINTY_FIVE_PERCENT = BN.from(95).mul(BN.from(10).pow(BN.from(16)))
            // 5 * 95% = 4.75 tokens
            const nintyFivePercentToken = FIVE_TOKENS.mul(NINTY_FIVE_PERCENT).div(fullScale)
            await savingsManager.connect(sa.governor.signer).setSavingsRate(NINTY_FIVE_PERCENT)

            await mUSD.setAmountForCollectInterest(FIVE_TOKENS)

            let savingsManagerBalance = await mUSD.balanceOf(savingsManager.address)
            expect(ZERO).to.equal(savingsManagerBalance)

            await savingsManager.collectAndDistributeInterest(mUSD.address)

            const balanceAfter = await mUSD.balanceOf(savingsContract.address)
            expect(nintyFivePercentToken).to.equal(balanceAfter)

            // expect 5% balance left at SavingsManager
            savingsManagerBalance = await mUSD.balanceOf(savingsManager.address)
            const expectedFivePercentTokens = FIVE_TOKENS.sub(nintyFivePercentToken)
            expect(expectedFivePercentTokens).to.equal(savingsManagerBalance)

            await savingsManager.connect(sa.governor.signer).distributeUnallocatedInterest(mUSD.address)

            const balanceOfRecipient = await mUSD.balanceOf(recipient.address)
            expect(expectedFivePercentTokens).to.equal(balanceOfRecipient)
        })
    })
})
