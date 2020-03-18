
import { ModuleInstance, NexusInstance } from "types/generated";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import envSetup from "@utils/env_setup";
import shouldBehaveLikeModule from "./behaviours/Module.behaviour";

const MockPausableModule = artifacts.require("MockPausableModule");

const { expect, assert } = envSetup.configure();
const { ZERO_ADDRESS } = require("@utils/constants");

contract("PausableModule", async (accounts) => {
    const ctx: { module?: ModuleInstance } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let nexus: NexusInstance;

    before("before all", async () => {
        // create New Nexus 
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks();
        nexus = systemMachine.nexus;
    });

    beforeEach("before each", async () => {
        ctx.module = await MockPausableModule.new(nexus.address);
    });

    shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);


});