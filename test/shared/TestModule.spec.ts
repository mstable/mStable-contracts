
import { ModuleInstance } from "types/generated";
import { StandardAccounts } from "@utils/machines";
import envSetup from "@utils/env_setup";
import shouldBehaveLikeModule from "./behaviours/Module.behaviour";


const { expect, assert } = envSetup.configure();

contract("Module", async (accounts) => {
    const ctx: { module?: ModuleInstance } = {};
    const sa = new StandardAccounts(accounts);

    beforeEach("Create Contract", async () => {
        // create New Nexus
    });

    shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
});