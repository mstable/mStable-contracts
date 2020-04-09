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
const MockERC20: t.MockERC20Contract = artifacts.require("MockERC20");
const MockSavingsContract: t.MockSavingsContractContract = artifacts.require("MockSavingsContract");

contract("SavingsManager", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const manager = sa.dummy2;

    const ctx: { module?: t.PausableModuleInstance } = {};
    let nexus: t.MockNexusInstance;
    let savingsContract: t.MockSavingsContractInstance;
    let savingsManager: t.SavingsManagerInstance;
    let mUSD: t.MockERC20Instance;

    before(async () => {
        nexus = await MockNexus.new(sa.governor, governance, manager);
        mUSD = await MockERC20.new("mUSD", "mUSD", 18, sa.default, new BN(10000));
        savingsContract = await MockSavingsContract.new(nexus.address, mUSD.address);
        savingsManager = await createNewSavingsManager();
    });

    async function createNewSavingsManager(): Promise<t.SavingsManagerInstance> {
        return SavingsManager.new(nexus.address, mUSD.address, savingsContract.address);
    }

    describe("behaviours", async () => {
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
        let mockERC20: t.MockERC20Instance;
        const mockSavingsContract = sa.dummy4;

        before(async () => {
            mockERC20 = await MockERC20.new("MOCK", "MOCK", 18, sa.default, new BN(10000));
        });

        it("should fail when not called by governor", async () => {
            await expectRevert(
                savingsManager.addSavingsContract(mockERC20.address, mockSavingsContract, {
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
                savingsManager.addSavingsContract(mockERC20.address, ZERO_ADDRESS, {
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

            savingsContractAddr = await savingsManager.savingsContracts(mockERC20.address);
            expect(ZERO_ADDRESS).to.equal(savingsContractAddr);

            await savingsManager.addSavingsContract(mockERC20.address, mockSavingsContract, {
                from: sa.governor,
            });

            savingsContractAddr = await savingsManager.savingsContracts(mUSD.address);
            expect(savingsContractAddr).to.equal(savingsContract.address);

            savingsContractAddr = await savingsManager.savingsContracts(mockERC20.address);
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

            await savingsManager.updateSavingsContract(mUSD.address, sa.other, {
                from: sa.governor,
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
            savingsManager.setSavingsRate(new BN(10).pow(new BN(17).add(new BN(1))), {
                from: sa.governor,
            });
        });

        it("should succeed when in valid range (max value)", async () => {
            savingsManager.setSavingsRate(new BN(10).pow(new BN(18)), { from: sa.governor });
        });
    });

    describe("collectAndDistributeInterest()", async () => {
        it("should fail when contract is paused", async () => {
            // Pause contract
            await savingsManager.pause({ from: sa.governor });

            await expectRevert(
                savingsManager.collectAndDistributeInterest(mUSD.address),
                "Pausable: paused",
            );
        });

        it("should fail when mAsset not exist");

        it("should fail when function called again before 30 minutes");

        it("should succeed when interest collected is zero");

        it("should succeed when interest is collected");
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
