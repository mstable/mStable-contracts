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
    const ONE_MINUTE = new BN(60).mul(new BN(60));
    const THIRTY_MINUTES = ONE_MINUTE.mul(new BN(30));
    const INITIAL_MINT = new BN(1000);
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
        mUSD = await MockMasset.new("mUSD", "mUSD", 18, sa.default, INITIAL_MINT);
        savingsContract = await MockSavingsContract.new(nexus.address, mUSD.address);
        savingsManager = await createNewSavingsManager();
    });

    async function createNewSavingsManager(): Promise<t.SavingsManagerInstance> {
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
            // const balanceBefore = await mUSD.balanceOf(savingsContract.address);
            // expect(ZERO).to.bignumber.equal(balanceBefore);
            // const newInterest = TEN.mul(new BN(10).pow(new BN(18)));
            // await mUSD.setAmountForCollectInterest(newInterest);
            // // should move 30 mins in future
            // await time.increase(THIRTY_MINUTES);
            // const tx = await savingsManager.collectAndDistributeInterest(mUSD.address);
            // console.log(tx.logs[0].args);
            // console.log(tx.logs[0].args[1].toString());
            // console.log(tx.logs[0].args[2].toString());
            // console.log(tx.logs[0].args[3].toString());
            // // expectEvent.inLogs(tx.logs, "InterestCollected", {
            // //     mAsset: mUSD.address,
            // //     interest: new BN(0),
            // //     newTotalSupply: INITIAL_MINT.mul(new BN(10).pow(new BN(18))),
            // //     apy: new BN(0),
            // // });
            // const balanceAfter = await mUSD.balanceOf(savingsContract.address);
            // expect(newInterest).to.bignumber.equal(balanceAfter);
        });

        it("should skip interest collection before 30 mins");

        it("should allow interest collection again after 30 mins");
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
        it("should collect 100% interest");

        it("should collect 90% interest when rate changed");

        it("should collect 95% interest when rate changed");
    });
});
