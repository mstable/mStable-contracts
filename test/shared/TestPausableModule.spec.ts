import { StandardAccounts } from "@utils/machines";
import * as t from "types/generated";

import shouldBehaveLikeModule from "./behaviours/Module.behaviour";
import shouldBehaveLikePausableModule from "./behaviours/PausableModule.behaviour";

const MockPausableModule = artifacts.require("MockPausableModule");
const MockNexus = artifacts.require("MockNexus");

contract("PausableModule", async (accounts) => {
    const ctx: { module?: t.PausableModuleInstance } = {};
    const sa = new StandardAccounts(accounts);
    let nexus: t.MockNexusInstance;
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
