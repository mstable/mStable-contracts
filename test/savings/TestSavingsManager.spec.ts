/* eslint-disable @typescript-eslint/camelcase */

import { assertBNClose } from "@utils/assertions";
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

    async function createNewSavingsManager(
        mintAmount: BN = INITIAL_MINT,
    ): Promise<t.SavingsManagerInstance> {
        mUSD = await MockMasset.new("mUSD", "mUSD", 18, sa.default, mintAmount);
        savingsContract = await SavingsContract.new(nexus.address, mUSD.address);
        savingsManager = await SavingsManager.new(
            nexus.address,
            mUSD.address,
            savingsContract.address,
        );
        // Set new SavingsManager address in Nexus
        await nexus.setSavingsManager(savingsManager.address);
        return savingsManager;
    }

    before(async () => {
        nexus = await MockNexus.new(sa.governor, governance, manager);

        savingsManager = await createNewSavingsManager();
    });

    describe("behaviours", async () => {
        describe("should behave like a Module", async () => {
            beforeEach(async () => {
                savingsManager = await createNewSavingsManager();
                ctx.module = savingsManager as t.PausableModuleInstance;
            });
            shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
            // SavingsManager is PausableModule, but the extensions mean the
            // types don't match :-(
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
        let mockMasset: t.MockErc20Instance;
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

    describe("modifying the savings rate", async () => {
        it("should fail when not called by governor", async () => {
            expectRevert(
                savingsManager.setSavingsRate(fullScale, { from: sa.other }),
                "Only governor can execute",
            );
        });

        it("should fail when not in range (lower range)", async () => {
            expectRevert(
                savingsManager.setSavingsRate(new BN(10).pow(new BN(16)), { from: sa.governor }),
                "Must be a valid rate",
            );
        });

        it("should fail when not in range (higher range)", async () => {
            expectRevert(
                savingsManager.setSavingsRate(new BN(10).pow(new BN(19)), { from: sa.governor }),
                "Must be a valid rate",
            );
        });

        it("should succeed when in valid range (min value)", async () => {
            const newRate = new BN("9").mul(new BN(10).pow(new BN(17))).add(new BN(1));
            const tx = await savingsManager.setSavingsRate(newRate, {
                from: sa.governor,
            });

            expectEvent(tx.receipt, "SavingsRateChanged", { newSavingsRate: newRate });
        });

        it("should succeed when in valid range (max value)", async () => {
            const newRate = new BN(10).pow(new BN(18));
            const tx = await savingsManager.setSavingsRate(newRate, {
                from: sa.governor,
            });

            expectEvent(tx.receipt, "SavingsRateChanged", { newSavingsRate: newRate });
        });
    });

    describe("collecting and distributing Interest", async () => {
        beforeEach(async () => {
            savingsManager = await createNewSavingsManager();
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
                savingsManager = await createNewSavingsManager();
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
                mUSD = await MockMasset1.new("mUSD", "mUSD", 18, sa.default, INITIAL_MINT);
                savingsContract = await SavingsContract.new(nexus.address, mUSD.address);
                savingsManager = await SavingsManager.new(
                    nexus.address,
                    mUSD.address,
                    savingsContract.address,
                );
                // Set new SavingsManager address in Nexus
                nexus.setSavingsManager(savingsManager.address);

                const newInterest = new BN(10).mul(fullScale);
                await mUSD.setAmountForCollectInterest(newInterest);

                // should move 1 day in future
                await time.increase(THIRTY_MINUTES);
                await expectRevert(
                    savingsManager.collectAndDistributeInterest(mUSD.address),
                    "Must receive mUSD",
                );
            });
        });
        context("testing new mechanism", async () => {
            // Initial supply of 10m units
            const initialSupply = new BN(10000000);
            const initialSupplyExact = simpleToExactAmount(initialSupply, 18);
            beforeEach(async () => {
                savingsManager = await createNewSavingsManager(initialSupply);
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
                savingsManager = await createNewSavingsManager();
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

    describe("withdrawing unallocated Interest", async () => {
        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsManager.withdrawUnallocatedInterest(mUSD.address, sa.other, {
                    from: sa.other,
                }),
                "Only governance can execute",
            );
        });

        it("should transfer left funds to recipient", async () => {
            const balanceBefore = await mUSD.balanceOf(sa.other);
            expect(ZERO).to.bignumber.equal(balanceBefore);

            // Send some mUSD to SavingsManager
            const amount = new BN(1000);
            await mUSD.transfer(savingsManager.address, amount, { from: sa.default });

            await savingsManager.withdrawUnallocatedInterest(mUSD.address, sa.other, {
                from: sa.governor,
            });

            const balanceAfter = await mUSD.balanceOf(sa.other);
            expect(amount).to.bignumber.equal(balanceAfter);
        });
    });

    describe("extra tests:", async () => {
        beforeEach(async () => {
            savingsManager = await createNewSavingsManager();
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

            await savingsManager.withdrawUnallocatedInterest(mUSD.address, sa.governor, {
                from: sa.governor,
            });

            const balanceOfGovernor = await mUSD.balanceOf(sa.governor);
            expect(expectedTenPercentTokens).to.bignumber.equal(balanceOfGovernor);
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

            await savingsManager.withdrawUnallocatedInterest(mUSD.address, sa.governor, {
                from: sa.governor,
            });

            const balanceOfGovernor = await mUSD.balanceOf(sa.governor);
            expect(expectedFivePercentTokens).to.bignumber.equal(balanceOfGovernor);
        });
    });
});
