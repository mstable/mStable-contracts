import { shouldBehaveLikeClaimable } from "./ClaimableGovernor.behaviour";
import { StandardAccounts } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { ClaimableGovernorInstance } from "../../types/generated";

const ClaimableGovernor = artifacts.require("ClaimableGovernor");
envSetup.configure();

contract("Governable", async (accounts) => {
    const ctx: { claimable?: ClaimableGovernorInstance } = {};
    const sa = new StandardAccounts(accounts);

    beforeEach("Create Contract", async () => {
        ctx.claimable = await ClaimableGovernor.new(accounts[0]);
    });

    shouldBehaveLikeClaimable(ctx as Required<typeof ctx>, accounts);
});
