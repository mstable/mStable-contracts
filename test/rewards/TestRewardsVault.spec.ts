/* eslint-disable no-nested-ternary */

import * as t from "types/generated";
import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { ONE_WEEK, ONE_DAY, FIVE_DAYS, fullScale } from "@utils/constants";
import envSetup from "@utils/env_setup";

import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const MockERC20 = artifacts.require("MockERC20");
const RewardsVault = artifacts.require("RewardsVault");

const { expect } = envSetup.configure();

contract("RewardsVault", async (accounts) => {
    const ctx: {
        module?: t.ModuleInstance;
    } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;

    const rewardsDistributor = sa.fundManager;
    let rewardToken: t.MockErc20Instance;
    let rewardsVault: t.RewardsVaultInstance;

    const redeployVault = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.RewardsVaultInstance> => {
        rewardToken = await MockERC20.new("Reward", "RWD", 18, rewardsDistributor, 1000000);
        return RewardsVault.new(nexusAddress, rewardToken.address);
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
        rewardsVault = await redeployVault();
        ctx.module = rewardsVault as t.ModuleInstance;
    });

    describe("implementing Module", async () => {
        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
    });

    describe("constructor & settings", async () => {
        it("should set the vesting token and start time", async () => {
            // const actualToken = await rewardsVault.vesting;
            // vestingToken = _vestingToken;
            // vaultStartTime = now;
        });
    });
});
