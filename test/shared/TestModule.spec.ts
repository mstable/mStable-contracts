import { MockModuleInstance, NexusInstance } from "types/generated";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import envSetup from "@utils/env_setup";
import shouldBehaveLikeModule from "./behaviours/Module.behaviour";

const MockModule = artifacts.require("MockModule");

const { expect, assert } = envSetup.configure();
const { ZERO_ADDRESS } = require("@utils/constants");

contract("Module", async (accounts) => {
    const ctx: { module?: MockModuleInstance } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let nexus: NexusInstance;

    before("before all", async () => {
        systemMachine = new SystemMachine(sa.all, sa.other);
        await systemMachine.initialiseMocks();
        nexus = systemMachine.nexus;
    });

    beforeEach("before each", async () => {
        // create New Nexus        
        ctx.module = await MockModule.new(nexus.address);
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

        it("and return recollateraliser address", async () => {
            const recollateraliser = await ctx.module.recollateraliser();
            expect(recollateraliser).to.not.equal(ZERO_ADDRESS);
            const nexusRecollateraliser = await nexus.getModule(web3.utils.keccak256("Recollateraliser"));
            expect(nexusRecollateraliser).to.equal(recollateraliser);
        });

        it("when shouldAllowOnlyGovernor() called by Governor", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await ctx.module.shouldAllowOnlyGovernor({from: sa.governor});
            temp = await ctx.module.temp();
            expect(new BN(1)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyGovernance() called by Governance", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await ctx.module.shouldAllowOnlyGovernance({from: sa.governor});
            temp = await ctx.module.temp();
            expect(new BN(2)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyManager() called by Manager", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await ctx.module.shouldAllowOnlyManager({from: sa.governor});
            temp = await ctx.module.temp();
            expect(new BN(3)).to.bignumber.equal(temp);
        });
    });
    
    describe("should fail", async () => {
        it("when shouldAllowOnlyGovernor() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await shouldFail.reverting.withMessage(
                ctx.module.shouldAllowOnlyGovernor({from: sa.other}),
                "Only governor can execute"
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyGovernance() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await shouldFail.reverting.withMessage(
                ctx.module.shouldAllowOnlyGovernance({from: sa.other}),
                ""
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyManager() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await shouldFail.reverting.withMessage(
                ctx.module.shouldAllowOnlyManager({from: sa.other}),
                ""
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });
    });
    

});