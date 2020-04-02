import { StandardAccounts } from "@utils/machines";
import { PausableModuleInstance } from "types/generated";
import { constants, expectEvent, expectRevert } from "@openzeppelin/test-helpers";

import { ZERO_ADDRESS } from "@utils/constants";

export default function shouldBehaveLikePausableModule(
    ctx: { module: PausableModuleInstance },
    sa: StandardAccounts,
) {
    describe("constructor", async () => {
        it("should be in unpaused by default", async () => {
            await this.shouldBePaused(ctx.module, false);
        });

        it("should have Nexus address set", async () => {
            const nexus = await ctx.module.nexus();
            expect(nexus).to.not.equal(ZERO_ADDRESS);
        });
    });

    describe("pause()", async () => {
        describe("should succeed", async () => {
            it("when called by the Governor", async () => {
                const tx = await ctx.module.pause({ from: sa.governor });
                expectEvent(tx.receipt, "Paused", { account: sa.governor });
                await this.shouldBePaused(ctx.module, true);
            });

            it("when called by the Governor and not paused", async () => {
                await this.shouldBePaused(ctx.module, false);
                const tx = await ctx.module.pause({ from: sa.governor });
                expectEvent(tx.receipt, "Paused", { account: sa.governor });
                await this.shouldBePaused(ctx.module, true);
            });
        });

        describe("should fail", async () => {
            it("when called by the non-Governor", async () => {
                await this.shouldBePaused(ctx.module, false);
                await expectRevert(
                    ctx.module.pause({ from: sa.other }),
                    "Only governor can execute",
                );
                await this.shouldBePaused(ctx.module, false);
            });

            it("when called by the Governor, but already paused", async () => {
                await this.shouldBePaused(ctx.module, false);
                const tx = await ctx.module.pause({ from: sa.governor });
                expectEvent(tx.receipt, "Paused", { account: sa.governor });
                await this.shouldBePaused(ctx.module, true);
                await expectRevert(
                    ctx.module.pause({ from: sa.governor }),
                    "Pausable: paused",
                );
                await this.shouldBePaused(ctx.module, true);
            });
        });
    });

    describe("unpause()", async () => {
        describe("should succeed", async () => {
            it("when called by the Governor", async () => {
                let tx = await ctx.module.pause({ from: sa.governor });
                expectEvent(tx.receipt, "Paused", { account: sa.governor });
                await this.shouldBePaused(ctx.module, true);
                tx = await ctx.module.unpause({ from: sa.governor });
                expectEvent(tx.receipt, "Unpaused", { account: sa.governor });
                await this.shouldBePaused(ctx.module, false);
            });

            it("when called by the Governor and paused", async () => {
                await this.shouldBePaused(ctx.module, false);
                let tx = await ctx.module.pause({ from: sa.governor });
                expectEvent(tx.receipt, "Paused", { account: sa.governor });
                await this.shouldBePaused(ctx.module, true);
                tx = await ctx.module.unpause({ from: sa.governor });
                expectEvent(tx.receipt, "Unpaused", { account: sa.governor });
                await this.shouldBePaused(ctx.module, false);
            });
        });

        describe("should fail", async () => {
            it("when called by the non-Governor", async () => {
                await this.shouldBePaused(ctx.module, false);
                const tx = await ctx.module.pause({ from: sa.governor });
                expectEvent(tx.receipt, "Paused", { account: sa.governor });
                await this.shouldBePaused(ctx.module, true);

                await expectRevert(
                    ctx.module.unpause({ from: sa.other }),
                    "Only governor can execute",
                );
                await this.shouldBePaused(ctx.module, true);
            });

            it("when called by the Governor, but already unpaused", async () => {
                await this.shouldBePaused(ctx.module, false);
                await expectRevert(
                    ctx.module.unpause({ from: sa.governor }),
                    "Pausable: not paused",
                );
                await this.shouldBePaused(ctx.module, false);
            });
        });
    });

    describe("paused()", async () => {
        it("should return true when paused", async () => {
            await this.shouldBePaused(ctx.module, false);
            const tx = await ctx.module.pause({ from: sa.governor });
            expectEvent(tx.receipt, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);
        });

        it("should return false when unpaused", async () => {
            let tx = await ctx.module.pause({ from: sa.governor });
            expectEvent(tx.receipt, "Paused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, true);
            tx = await ctx.module.unpause({ from: sa.governor });
            expectEvent(tx.receipt, "Unpaused", { account: sa.governor });
            await this.shouldBePaused(ctx.module, false);
        });
    });
}

export async function shouldBePaused(module: PausableModuleInstance, flag: boolean) {
    const paused = await module.paused();
    expect(flag, "Expected paused status not matched").to.equal(paused);
}
