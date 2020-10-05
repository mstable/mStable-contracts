import { StandardAccounts } from "@utils/machines";
import * as t from "types/generated";
import shouldBehaveLikeGovernable from "./Governable.behaviour";

const MockGovernable = artifacts.require("MockGovernable");

contract("Governable", async (accounts) => {
    const ctx: { governable?: t.GovernableInstance } = {};
    const sa = new StandardAccounts(accounts);

    beforeEach("Create Contract", async () => {
        ctx.governable = await MockGovernable.new({ from: sa.governor });
    });

    shouldBehaveLikeGovernable(ctx as Required<typeof ctx>, sa.governor, [sa.other]);
});
