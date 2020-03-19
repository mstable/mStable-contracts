import {
    MockInitializableModuleInstance,
    MockModuleInstance,
    MockNexusInstance,
} from "types/generated";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import envSetup from "@utils/env_setup";
import { ZERO_ADDRESS } from "@utils/constants";
import shouldBehaveLikeModule from "./behaviours/Module.behaviour";

const MockInitializableModule = artifacts.require("MockInitializableModule");
const MockNexus = artifacts.require("MockNexus");

const { expect, assert } = envSetup.configure();

contract("InitializableModule", async (accounts) => {
    const ctx: { module?: MockModuleInstance } = {};
    const sa = new StandardAccounts(accounts);
    let nexus: MockNexusInstance;
    const governanceAddr = sa.dummy1;
    const managerAddr = sa.dummy2;

    before("before all", async () => {
        // create New Nexus
        nexus = await MockNexus.new(sa.governor, governanceAddr, managerAddr);
    });
    beforeEach("before each", async () => {
        ctx.module = await MockInitializableModule.new(nexus.address);
    });

    shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

    describe("should succeed", async () => {
        it("and return governor address", async () => {
            const governor = await ctx.module.governor();
            expect(governor).to.not.equal(ZERO_ADDRESS);
            const nexusGovernor = await nexus.governor();
            expect(nexusGovernor).to.equal(governor);
        });

        it("and return governance address", async () => {
            const governance = await ctx.module.governance();
            expect(governance).to.not.equal(ZERO_ADDRESS);
            const nexusGovernance = await nexus.getModule(web3.utils.keccak256("Governance"));
            expect(nexusGovernance).to.equal(governance);
        });

        it("and return staking address", async () => {
            const staking = await ctx.module.staking();
            expect(staking).to.not.equal(ZERO_ADDRESS);
            const nexusStaking = await nexus.getModule(web3.utils.keccak256("Staking"));
            expect(nexusStaking).to.equal(staking);
        });

        it("and return metaToken address", async () => {
            const metaToken = await ctx.module.metaToken();
            expect(metaToken).to.not.equal(ZERO_ADDRESS);
            const nexusMetaToken = await nexus.getModule(web3.utils.keccak256("MetaToken"));
            expect(nexusMetaToken).to.equal(metaToken);
        });

        it("and return oracleHub address", async () => {
            const oracleHub = await ctx.module.oracleHub();
            expect(oracleHub).to.not.equal(ZERO_ADDRESS);
            const nexusOracleHub = await nexus.getModule(web3.utils.keccak256("OracleHub"));
            expect(nexusOracleHub).to.equal(oracleHub);
        });

        it("and return manager address", async () => {
            const manager = await ctx.module.manager();
            expect(manager).to.not.equal(ZERO_ADDRESS);
            const nexusManager = await nexus.getModule(web3.utils.keccak256("Manager"));
            expect(nexusManager).to.equal(manager);
        });

        it("and return SavingsManager address", async () => {
            const savingsManager = await ctx.module.savingsManager();
            expect(savingsManager).to.not.equal(ZERO_ADDRESS);
            const nexusSavingsManager = await nexus.getModule(
                web3.utils.keccak256("SavingsManager"),
            );
            expect(nexusSavingsManager).to.equal(savingsManager);
        });

        it("and return recollateraliser address", async () => {
            const recollateraliser = await ctx.module.recollateraliser();
            expect(recollateraliser).to.not.equal(ZERO_ADDRESS);
            const nexusRecollateraliser = await nexus.getModule(
                web3.utils.keccak256("Recollateraliser"),
            );
            expect(nexusRecollateraliser).to.equal(recollateraliser);
        });

        it("when shouldAllowOnlyGovernor() called by Governor", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await ctx.module.shouldAllowOnlyGovernor({ from: sa.governor });
            temp = await ctx.module.temp();
            expect(new BN(1)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyGovernance() called by Governor address", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await ctx.module.shouldAllowOnlyGovernance({ from: sa.governor });
            temp = await ctx.module.temp();
            expect(new BN(2)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyGovernance() called by Governance address", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await ctx.module.shouldAllowOnlyGovernance({ from: governanceAddr });
            temp = await ctx.module.temp();
            expect(new BN(2)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyManager() called by Manager", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await ctx.module.shouldAllowOnlyManager({ from: managerAddr });
            temp = await ctx.module.temp();
            expect(new BN(3)).to.bignumber.equal(temp);
        });
    });

    describe("should fail", async () => {
        it("when shouldAllowOnlyGovernor() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await shouldFail.reverting.withMessage(
                ctx.module.shouldAllowOnlyGovernor({ from: sa.other }),
                "Only governor can execute",
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyGovernance() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await shouldFail.reverting.withMessage(
                ctx.module.shouldAllowOnlyGovernance({ from: sa.other }),
                "Only governance can execute",
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyManager() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await shouldFail.reverting.withMessage(
                ctx.module.shouldAllowOnlyManager({ from: sa.other }),
                "Only manager can execute",
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });
    });
});
