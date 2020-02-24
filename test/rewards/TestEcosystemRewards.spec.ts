import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BN } from "@utils/tools";

import { shouldBehaveLikeMassetRewards } from "./MassetRewards.behaviour";
import envSetup from "@utils/env_setup";
import {
    EcosystemRewardsMUSDInstance,
    ERC20MockInstance,
    GovernableInstance,
    MassetInstance,
    MassetRewardsInstance,
} from "types/generated";

const Masset = artifacts.require("Masset");
const EcosystemRewardsMUSD = artifacts.require("EcosystemRewardsMUSD");

const { expect, assert } = envSetup.configure();

contract("EcosystemRewardsMUSD", async (accounts) => {
    const ctx: { governable?: GovernableInstance; massetRewards?: MassetRewardsInstance } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let rewardsContract: EcosystemRewardsMUSDInstance;

    beforeEach("Init contract", async () => {
        systemMachine = new SystemMachine(accounts, sa.other);
        await systemMachine.initialiseMocks();
        const masset: MassetInstance = await systemMachine.createMassetViaManager();
        rewardsContract = await EcosystemRewardsMUSD.new(
            masset.address,
            systemMachine.systok.address,
            sa.governor,
            { from: sa.governor },
        );
        // console.log("rewards", rewardsContract);
        ctx.governable = (rewardsContract as unknown) as GovernableInstance;
        ctx.massetRewards = (rewardsContract as unknown) as MassetRewardsInstance;
    });

    shouldBehaveLikeMassetRewards(ctx as Required<typeof ctx>, sa);
});
