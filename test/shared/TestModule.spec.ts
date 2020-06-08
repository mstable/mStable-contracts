import { StandardAccounts } from "@utils/machines";
import { BN } from "@utils/tools";
import { expectRevert } from "@openzeppelin/test-helpers";
import envSetup from "@utils/env_setup";
import { ZERO_ADDRESS, KEY_SAVINGS_MANAGER, KEY_PROXY_ADMIN } from "@utils/constants";
import * as t from "types/generated";
import shouldBehaveLikeModule from "./behaviours/Module.behaviour";

const MockModule = artifacts.require("MockModule");
const MockNexus = artifacts.require("MockNexus");

const { expect } = envSetup.configure();

contract("Module", async (accounts) => {
    const ctx: { module?: t.MockModuleInstance } = {};
    const sa = new StandardAccounts(accounts);
    let nexus: t.MockNexusInstance;
    const proxyAdmin = sa.dummy1;
    const governanceAddr = sa.dummy2;
    const managerAddr = sa.dummy3;

    before("before all", async () => {
        // create New Nexus
        nexus = await MockNexus.new(sa.governor, governanceAddr, managerAddr);
        await nexus.setProxyAdmin(proxyAdmin);
    });
    beforeEach("before each", async () => {
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

        it("and return SavingsManager address", async () => {
            const savingsManager = await ctx.module.savingsManager();
            expect(savingsManager).to.not.equal(ZERO_ADDRESS);
            const nexusSavingsManager = await nexus.getModule(KEY_SAVINGS_MANAGER);
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

        it("and return proxyadmin address", async () => {
            const proxyAdminAddr = await ctx.module.proxyAdmin();
            expect(proxyAdminAddr).to.not.equal(ZERO_ADDRESS);
            const nexusProxyAdmin = await nexus.getModule(KEY_PROXY_ADMIN);
            expect(nexusProxyAdmin).to.equal(proxyAdminAddr);
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

        it("when shouldAllowOnlyProxyAdmin() called by proxyAdmin", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await ctx.module.shouldAllowOnlyProxyAdmin({ from: proxyAdmin });
            temp = await ctx.module.temp();
            expect(new BN(4)).to.bignumber.equal(temp);
        });
    });

    describe("should fail", async () => {
        it("when zero address for Nexus", async () => {
            await expectRevert(MockModule.new(ZERO_ADDRESS), "Nexus is zero address");
        });

        it("when shouldAllowOnlyGovernor() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await expectRevert(
                ctx.module.shouldAllowOnlyGovernor({ from: sa.other }),
                "Only governor can execute",
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyGovernance() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await expectRevert(
                ctx.module.shouldAllowOnlyGovernance({ from: sa.other }),
                "Only governance can execute",
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyManager() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await expectRevert(
                ctx.module.shouldAllowOnlyManager({ from: sa.other }),
                "Only manager can execute",
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });

        it("when shouldAllowOnlyProxyAdmin() called by other", async () => {
            let temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
            await expectRevert(
                ctx.module.shouldAllowOnlyProxyAdmin({ from: sa.other }),
                "Only ProxyAdmin can execute",
            );
            temp = await ctx.module.temp();
            expect(new BN(0)).to.bignumber.equal(temp);
        });
    });
});
