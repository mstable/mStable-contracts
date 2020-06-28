import * as t from "types/generated";
import { StandardAccounts } from "@utils/machines";
import { constants, expectRevert, expectEvent } from "@openzeppelin/test-helpers";
import { BN } from "@utils/tools";
import { simpleToExactAmount } from "@utils/math";
import envSetup from "@utils/env_setup";
import shouldBehaveLikeRewardsDistributionRecipient from "./RewardsDistributionRecipient.behaviour";

const { ZERO_ADDRESS } = constants;
const { expect, assert } = envSetup.configure();

const MockERC20 = artifacts.require("MockERC20");

function behaveLikeARecipient(
    ctx: {
        recipient: t.RewardsDistributionRecipientInstance;
    },
    moduleCtx: {
        module: t.ModuleInstance;
    },
    sa: StandardAccounts,
): void {
    return shouldBehaveLikeRewardsDistributionRecipient(ctx, moduleCtx, sa);
}

export default function shouldBehaveLikeLockedUpRewards(
    ctx: {
        lockup: t.LockedUpRewardsInstance;
    },
    recipientCtx: {
        recipient: t.RewardsDistributionRecipientInstance;
    },
    moduleCtx: {
        module: t.ModuleInstance;
    },
    sa: StandardAccounts,
): void {
    behaveLikeARecipient(recipientCtx, moduleCtx, sa);

    it("should have a valid rewardToken", async () => {
        const rewardToken = await ctx.lockup.rewardsToken();
        assert.isTrue(rewardToken !== ZERO_ADDRESS);
        const erc20 = await MockERC20.at(rewardToken);
        expect(await erc20.totalSupply()).bignumber.gt(new BN(0) as any);
    });

    it("should have a valid rewardVault", async () => {
        const rewardVault = await ctx.lockup.rewardsVault();
        assert.isTrue(rewardVault !== ZERO_ADDRESS);
    });

    it("should give rewardVault permission to spend token", async () => {
        const rewardVault = await ctx.lockup.rewardsVault();
        const rewardToken = await ctx.lockup.rewardsToken();
        const erc20 = await MockERC20.at(rewardToken);
        const allowance = await erc20.allowance(ctx.lockup.address, rewardVault);
        expect(allowance).bignumber.gte(simpleToExactAmount(1, 30) as any);
    });

    it("should allow governor to change rewardsVault", async () => {
        const tokenAddress = await ctx.lockup.rewardsToken();
        const rewardsToken = await MockERC20.at(tokenAddress);

        const newVault = sa.other;
        const oldVault = await ctx.lockup.rewardsVault();
        const tx = await ctx.lockup.changeRewardsVault(newVault, { from: sa.governor });
        // Expect the event to go through and the new vault to be set
        expectEvent(tx.receipt, "RewardsVaultSet", {
            newVault: sa.other,
        });
        // Changes vault location
        expect(await ctx.lockup.rewardsVault()).eq(newVault);
        // Sets old rewardsToken approval to 0
        expect(await rewardsToken.allowance(ctx.lockup.address, oldVault)).bignumber.eq(new BN(0));
        // Sets new rewardsToken approval
        expect(await rewardsToken.allowance(ctx.lockup.address, newVault)).bignumber.gte(
            simpleToExactAmount(1, 30) as any,
        );
    });

    it("should not change vault if address is 0 or existing", async () => {
        await expectRevert(
            ctx.lockup.changeRewardsVault(ZERO_ADDRESS, { from: sa.governor }),
            "Null vault address supplied",
        );
        await expectRevert(
            ctx.lockup.changeRewardsVault(await ctx.lockup.rewardsVault(), { from: sa.governor }),
            "Vault update not required",
        );
    });

    it("should fail if change proposed by non governor", async () => {
        await expectRevert(
            ctx.lockup.setRewardsDistribution(sa.dummy2, { from: sa.default }),
            "Only governor can execute",
        );
    });

    it("reApproveRewardsToken approves spending to vault", async () => {
        const rewardVault = await ctx.lockup.rewardsVault();
        const rewardToken = await ctx.lockup.rewardsToken();
        const erc20 = await MockERC20.at(rewardToken);
        const allowance = await erc20.allowance(ctx.lockup.address, rewardVault);
        await ctx.lockup.reApproveRewardsToken({ from: sa.governor });

        expect(allowance).bignumber.gte(simpleToExactAmount(1, 30) as any);

        // Only called by governor
        await expectRevert(
            ctx.lockup.reApproveRewardsToken({ from: sa.default }),
            "Only governor can execute",
        );
    });
}
