import { MassetDetails } from "@utils/machines/massetMachine";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import {
    EcosystemRewardsMUSDInstance,
    ERC20MockInstance,
    GovernableInstance,
    MassetInstance,
    MassetRewardsInstance,
} from "types/generated";
import shouldBehaveLikeMassetRewards from "./MassetRewards.behaviour";

const Masset = artifacts.require("Masset");
const EcosystemRewardsMUSD = artifacts.require("EcosystemRewardsMUSD");

const { expect, assert } = envSetup.configure();

contract("EcosystemRewardsMUSD", async (accounts) => {
    const ctx: { governable?: GovernableInstance; massetRewards?: MassetRewardsInstance } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let rewardsContract: EcosystemRewardsMUSDInstance;

    beforeEach("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all, sa.other);
        await systemMachine.initialiseMocks();
        massetMachine = new MassetMachine(systemMachine);
        const masset: MassetDetails = await massetMachine.createBasicMasset();
        rewardsContract = await EcosystemRewardsMUSD.new(
            masset.mAsset.address,
            systemMachine.metaToken.address,
            sa.governor,
            { from: sa.governor },
        );
        // console.log("rewards", rewardsContract);
        ctx.governable = (rewardsContract as unknown) as GovernableInstance;
        ctx.massetRewards = (rewardsContract as unknown) as MassetRewardsInstance;
    });

    shouldBehaveLikeMassetRewards(ctx as Required<typeof ctx>, sa);
});
