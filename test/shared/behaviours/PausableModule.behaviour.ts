import { StandardAccounts } from "@utils/machines";
import { PausableModuleInstance } from "types/generated";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";

import { ZERO_ADDRESS } from "@utils/constants";

export default function shouldBehaveLikePausableModule(
    ctx: { module: PausableModuleInstance },
    sa: StandardAccounts,
) {
    describe("pausableModule constructor", async () => {
        it("should be in unpaused by default", async () => {
            await this.shouldBePaused(ctx.module, false);
        });

        it("should have Nexus address set", async () => {
            const nexus = await ctx.module.nexus();
            expect(nexus).to.not.equal(ZERO_ADDRESS);
        });
    });

    describe("pausing", async () => {
        it("should succeed when called by the Governor", async () => {
            const tx = await ctx.module.pause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);
        });

        it("should reject call by the non-Governor", async () => {
            await this.shouldBePaused(ctx.module, false);
            await shouldFail.reverting.withMessage(
                ctx.module.pause({ from: sa.other }),
                "Only governor can execute",
            );
            await this.shouldBePaused(ctx.module, false);
        });

        it("call should execute when not paused", async () => {
            await this.shouldBePaused(ctx.module, false);
            const tx = await ctx.module.pause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);
        });

        it("reject call if already paused", async () => {
            await this.shouldBePaused(ctx.module, false);
            const tx = await ctx.module.pause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);
            await shouldFail.reverting.withMessage(
                ctx.module.pause({ from: sa.governor }),
                "Pausable: paused",
            );
            await this.shouldBePaused(ctx.module, true);
        });
    });

    describe("un-pausing", async () => {
        it("should succeed when called by the Governor", async () => {
            let tx = await ctx.module.pause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);
            tx = await ctx.module.unpause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Unpaused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, false);
        });
        it("should fail when called by the non-Governor", async () => {
            await this.shouldBePaused(ctx.module, false);
            const tx = await ctx.module.pause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);

            await shouldFail.reverting.withMessage(
                ctx.module.unpause({ from: sa.other }),
                "Only governor can execute",
            );
            await this.shouldBePaused(ctx.module, true);
        });

        it("should execute only when paused", async () => {
            await this.shouldBePaused(ctx.module, false);
            let tx = await ctx.module.pause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);
            tx = await ctx.module.unpause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Unpaused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, false);
        });

        it("should reject if already unpaused", async () => {
            await this.shouldBePaused(ctx.module, false);
            await shouldFail.reverting.withMessage(
                ctx.module.unpause({ from: sa.governor }),
                "Pausable: not paused",
            );
            await this.shouldBePaused(ctx.module, false);
        });
    });

    describe("getting paused status", async () => {
        it("should return true when paused", async () => {
            await this.shouldBePaused(ctx.module, false);
            const tx = await ctx.module.pause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);
        });

        it("should return false when unpaused", async () => {
            let tx = await ctx.module.pause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);
            tx = await ctx.module.unpause({ from: sa.governor });
            expectEvent.inLogs(tx.logs, "Unpaused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, false);
        });
    });
}

export async function shouldBePaused(module: PausableModuleInstance, flag: boolean) {
    const paused = await module.paused();
    expect(flag, "Expected paused status not matched").to.equal(paused);
}
