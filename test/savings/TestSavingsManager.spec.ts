import * as t from "types/generated";
import { expectEvent, time, expectRevert } from "@openzeppelin/test-helpers";
import { MassetMachine, StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { BN } from "@utils/tools";
import {
    ZERO_ADDRESS,
    MAX_UINT256,
    ZERO,
    ratioScale,
    fullScale,
    MIN_GRACE,
    MAX_GRACE,
} from "@utils/constants";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";
import shouldBehaveLikePausableModule from "../shared/behaviours/PausableModule.behaviour";

const { expect, assert } = envSetup.configure();

const SavingsManager: t.SavingsManagerContract = artifacts.require("SavingsManager");
const MockNexus: t.MockNexusContract = artifacts.require("MockNexus");
const MockMasset: t.MockMassetContract = artifacts.require("MockMasset");
const MockSavingsContract: t.MockSavingsContractContract = artifacts.require("MockSavingsContract");

contract("SavingsManager", async (accounts) => {
    const TEN = new BN(10);
    const TEN_TOKENS = TEN.mul(new BN(10).pow(new BN(18)));
    const FIVE_TOKENS = TEN_TOKENS.div(new BN(2));
    const ONE_MINUTE = new BN(60).mul(new BN(60));
    const THIRTY_MINUTES = ONE_MINUTE.mul(new BN(30));
    // 1.2 million tokens
    const INITIAL_MINT = new BN(1200000);
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const manager = sa.dummy2;
    const ctx: { module?: t.PausableModuleInstance } = {};

    let nexus: t.MockNexusInstance;
    let savingsContract: t.MockSavingsContractInstance;
    let savingsManager: t.SavingsManagerInstance;
    let mUSD: t.MockMassetInstance;

    before(async () => {
        nexus = await MockNexus.new(sa.governor, governance, manager);

        savingsManager = await createNewSavingsManager();
    });

    async function createNewSavingsManager(): Promise<t.SavingsManagerInstance> {
        mUSD = await MockMasset.new("mUSD", "mUSD", 18, sa.default, INITIAL_MINT);
        savingsContract = await MockSavingsContract.new(nexus.address, mUSD.address);
        savingsManager = await SavingsManager.new(
            nexus.address,
            mUSD.address,
            savingsContract.address,
        );
        // Set new SavingsManager address in Nexus
        nexus.setSavingsManager(savingsManager.address);
        return savingsManager;
    }

    describe("behaviors", async () => {
        describe("should behave like a Module", async () => {
            beforeEach(async () => {
                savingsManager = await createNewSavingsManager();
                ctx.module = savingsManager;
            });
            shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
            shouldBehaveLikePausableModule(ctx as Required<typeof ctx>, sa);
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

    describe("addSavingsContract()", async () => {
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
                "Savings contract exist",
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
            expectEvent.inLogs(tx.logs, "SavingsContractAdded", {
                mAsset: mockMasset.address,
                savingsContract: mockSavingsContract,
            });

            savingsContractAddr = await savingsManager.savingsContracts(mUSD.address);
            expect(savingsContractAddr).to.equal(savingsContract.address);

            savingsContractAddr = await savingsManager.savingsContracts(mockMasset.address);
            expect(mockSavingsContract).to.equal(savingsContractAddr);
        });
    });

    describe("updateSavingsContract()", async () => {
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
                "Savings contract not exist",
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
                "Savings contract not exist",
            );
        });

        it("should succeed with valid parameters", async () => {
            let savingsContractAddr = await savingsManager.savingsContracts(mUSD.address);
            expect(savingsContractAddr).to.equal(savingsContract.address);

            const tx = await savingsManager.updateSavingsContract(mUSD.address, sa.other, {
                from: sa.governor,
            });

            expectEvent.inLogs(tx.logs, "SavingsContractUpdated", {
                mAsset: mUSD.address,
                savingsContract: sa.other,
            });

            savingsContractAddr = await savingsManager.savingsContracts(mUSD.address);
            expect(sa.other).to.equal(savingsContractAddr);
        });
    });

    describe("setSavingsRate()", async () => {
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

            expectEvent.inLogs(tx.logs, "SavingsRateChanged", { newSavingsRate: newRate });
        });

        it("should succeed when in valid range (max value)", async () => {
            const newRate = new BN(10).pow(new BN(18));
            const tx = await savingsManager.setSavingsRate(newRate, {
                from: sa.governor,
            });

            expectEvent.inLogs(tx.logs, "SavingsRateChanged", { newSavingsRate: newRate });
        });
    });

    describe("collectAndDistributeInterest()", async () => {
        beforeEach(async () => {
            savingsManager = await createNewSavingsManager();
        });

        it("should fail when contract is paused", async () => {
            // Pause contract
            await savingsManager.pause({ from: sa.governor });

            await expectRevert(
                savingsManager.collectAndDistributeInterest(mUSD.address),
                "Pausable: paused",
            );
        });

        it("should fail when mAsset not exist", async () => {
            await expectRevert(
                savingsManager.collectAndDistributeInterest(sa.other),
                "Must have a valid savings contract",
            );
        });
    });

    describe("when there is some interest to collect", async () => {
        before(async () => {
            savingsManager = await createNewSavingsManager();
        });

        it("should succeed when interest collected is zero", async () => {
            const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);
            expectEvent.inLogs(tx.logs, "InterestCollected", {
                mAsset: mUSD.address,
                interest: new BN(0),
                newTotalSupply: INITIAL_MINT.mul(new BN(10).pow(new BN(18))),
                apy: new BN(0),
            });
        });

        it("should collect the interest first time", async () => {
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

            const expectedTotalSupply = INITIAL_MINT.mul(new BN(10).pow(new BN(18))).add(
                FIVE_TOKENS,
            );
            // expectedAPY = 7.3%
            const expectedAPY = new BN(73).mul(new BN(10).pow(new BN(15)));
            expectEvent.inLogs(tx.logs, "InterestCollected", {
                mAsset: mUSD.address,
                interest: FIVE_TOKENS,
                newTotalSupply: expectedTotalSupply,
                apy: expectedAPY,
            });

            const balanceAfter = await mUSD.balanceOf(savingsContract.address);
            expect(newInterest).to.bignumber.equal(balanceAfter);
        });

        it("should skip interest collection before 30 mins", async () => {
            const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);
            expectEvent.inLogs(tx.logs, "WaitFor");
            const timeRemaining: BN = tx.logs[0].args[0];
            assert.ok(timeRemaining.gt(ZERO));
        });

        it("should allow interest collection again after 30 mins", async () => {
            await time.increase(THIRTY_MINUTES);
            const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);
            expectEvent.inLogs(tx.logs, "InterestCollected", {
                mAsset: mUSD.address,
                interest: new BN(0),
                newTotalSupply: INITIAL_MINT.mul(new BN(10).pow(new BN(18))).add(FIVE_TOKENS),
                apy: new BN(0),
            });
        });
    });

    describe("withdrawUnallocatedInterest()", async () => {
        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsManager.withdrawUnallocatedInterest(mUSD.address, sa.other, {
                    from: sa.other,
                }),
                "Only governor can execute",
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
