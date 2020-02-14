import { shouldBehaveLikeGovernable } from "./Governable.behaviour";
import { StandardAccounts } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { GovernableInstance } from "../../types/generated";

const MockGovernable = artifacts.require("MockGovernable");
envSetup.configure();

contract("Governable", async (accounts) => {
    const ctx: { governable?: GovernableInstance } = {};
    const sa = new StandardAccounts(accounts);

    beforeEach("Create Contract", async () => {
        ctx.governable = await MockGovernable.new({ from: sa.governor });
    });

    shouldBehaveLikeGovernable(ctx as Required<typeof ctx>, sa.governor, [sa.other]);
});
