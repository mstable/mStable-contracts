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
        liquidator = await Liquidator.new();
        liquidator.initialize(systemMachine.nexus.address);
        return liquidator;
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
    });

    describe("verifying Module initialization", async () => {
        before("reset contracts", async () => {
            liquidator = await redeployLiquidator();
            ctx.module = liquidator as t.InitializableModuleInstance;
        });

        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

        it("should properly store valid arguments", async () => {
            expect(await liquidator.nexus()).eq(systemMachine.nexus.address);
        });
    });
});
