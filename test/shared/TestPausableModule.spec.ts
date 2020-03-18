
import { ModuleInstance, MockNexusInstance, PausableModuleInstance } from "types/generated";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import envSetup from "@utils/env_setup";
import shouldBehaveLikeModule from "./behaviours/Module.behaviour";
import shouldBehaveLikePausableModule from "./behaviours/PausableModule.behaviour";

const MockPausableModule = artifacts.require("MockPausableModule");
const MockNexus = artifacts.require("MockNexus");

const { expect, assert } = envSetup.configure();
const { ZERO_ADDRESS } = require("@utils/constants");

contract("PausableModule", async (accounts) => {
    const ctx: { module?: PausableModuleInstance } = {};
    const sa = new StandardAccounts(accounts);
    let nexus: MockNexusInstance;
    const governanceAddr = sa.dummy1;
    const managerAddr = sa.dummy2;

    before("before all", async () => {
        // create New Nexus 
        nexus = await MockNexus.new(sa.governor, governanceAddr, managerAddr);
    });

    beforeEach("before each", async () => {
        ctx.module = await MockPausableModule.new(nexus.address);
    });

    shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
    shouldBehaveLikePausableModule(ctx as Required<typeof ctx>, sa);


});