import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const Liquidator = artifacts.require("Liquidator");
const MockNexus = artifacts.require("MockNexus");

const { expect } = envSetup.configure();

contract("Liquidator", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const ctx: { module?: t.InitializableModuleInstance } = {};
    let systemMachine: SystemMachine;
    let liquidator: t.LiquidatorInstance;
    let nexus: t.MockNexusInstance;

    const redeployLiquidator = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.LiquidatorInstance> => {
        console.log(nexusAddress);
        return Liquidator.new(nexusAddress);
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
        await Liquidator.new(systemMachine.nexus.address);
    });

    describe("verifying Module initialization", async () => {
        before("reset contracts", async () => {
            liquidator = await redeployLiquidator();
            ctx.module = liquidator as t.ModuleInstance;
        });

        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

        it("should properly store valid arguments", async () => {
            expect(await liquidator.nexus()).eq(systemMachine.nexus.address);
        });
    });
});
