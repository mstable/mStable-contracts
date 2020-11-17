import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { ZERO_ADDRESS } from "@utils/constants";
import { BN } from "@utils/tools";
import * as t from "types/generated";
import envSetup from "@utils/env_setup";

const { expect } = envSetup.configure();

export default function shouldBehaveLikeERC20Burnable(
    ctx: { burnableToken: t.ERC20BurnableInstance },
    owner,
    initialBalance,
    [burner],
): void {
    describe("burn", () => {
        describe("when the given amount is not greater than balance of the sender", () => {
            const shouldBurn = (amount) => {
                beforeEach(async () => {
                    ({ logs: this.logs } = await ctx.burnableToken.burn(amount, { from: owner }));
                });

                it("burns the requested amount", async () => {
                    expect(await ctx.burnableToken.balanceOf(owner)).to.be.bignumber.equal(
                        initialBalance.sub(amount),
                    );
                });

                it("emits a transfer event", async () => {
                    expectEvent.inLogs(this.logs, "Transfer", {
                        from: owner,
                        to: ZERO_ADDRESS,
                        value: amount,
                    });
                });
            };

            context("for a zero amount", () => {
                shouldBurn(new BN(0));
            });

            context("for a non-zero amount", () => {
                shouldBurn(new BN(100));
            });
        });

        describe("when the given amount is greater than the balance of the sender", () => {
            const amount = initialBalance.addn(1);

            it("reverts", async () => {
                await expectRevert(
                    ctx.burnableToken.burn(amount, { from: owner }),
                    "ERC20: burn amount exceeds balance",
                );
            });
        });
    });

    describe("burnFrom", () => {
        describe("on success", () => {
            const shouldBurnFrom = (amount) => {
                const originalAllowance = amount.muln(3);

                beforeEach(async () => {
                    await ctx.burnableToken.approve(burner, originalAllowance, { from: owner });
                    const { logs } = await ctx.burnableToken.burnFrom(owner, amount, {
                        from: burner,
                    });
                    this.logs = logs;
                });

                it("burns the requested amount", async () => {
                    expect(await ctx.burnableToken.balanceOf(owner)).to.be.bignumber.equal(
                        initialBalance.sub(amount),
                    );
                });

                it("decrements allowance", async () => {
                    expect(await ctx.burnableToken.allowance(owner, burner)).to.be.bignumber.equal(
                        originalAllowance.sub(amount),
                    );
                });

                it("emits a transfer event", async () => {
                    expectEvent.inLogs(this.logs, "Transfer", {
                        from: owner,
                        to: ZERO_ADDRESS,
                        value: amount,
                    });
                });
            };

            context("for a zero amount", () => {
                shouldBurnFrom(new BN(0));
            });

            context("for a non-zero amount", () => {
                shouldBurnFrom(new BN(100));
            });
        });

        describe("when the given amount is greater than the balance of the sender", () => {
            const amount = initialBalance.addn(1);

            it("reverts", async () => {
                await ctx.burnableToken.approve(burner, amount, { from: owner });
                await expectRevert(
                    ctx.burnableToken.burnFrom(owner, amount, { from: burner }),
                    "ERC20: burn amount exceeds balance",
                );
            });
        });

        describe("when the given amount is greater than the allowance", () => {
            const allowance = new BN(100);

            it("reverts", async () => {
                await ctx.burnableToken.approve(burner, allowance, { from: owner });
                await expectRevert(
                    ctx.burnableToken.burnFrom(owner, allowance.addn(1), { from: burner }),
                    "ERC20: burn amount exceeds allowance",
                );
            });
        });
    });
}
