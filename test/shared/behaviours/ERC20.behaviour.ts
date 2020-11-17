import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { ZERO_ADDRESS } from "@utils/constants";
import { BN } from "@utils/tools";
import * as t from "types/generated";
import envSetup from "@utils/env_setup";

const { expect } = envSetup.configure();

export default function shouldBehaveLikeERC20(
    ctx: { token: t.ERC20Instance },
    errorPrefix,
    initialSupply,
    initialHolder,
    recipient,
    anotherAccount,
): void {
    describe("total supply", () => {
        it("returns the total amount of tokens", async () => {
            expect(await ctx.token.totalSupply()).to.be.bignumber.equal(initialSupply);
        });
    });

    describe("balanceOf", () => {
        describe("when the requested account has no tokens", () => {
            it("returns zero", async () => {
                expect(await ctx.token.balanceOf(anotherAccount)).to.be.bignumber.equal("0");
            });
        });

        describe("when the requested account has some tokens", () => {
            it("returns the total amount of tokens", async () => {
                expect(await ctx.token.balanceOf(initialHolder)).to.be.bignumber.equal(
                    initialSupply,
                );
            });
        });
    });

    describe("transfer", () => {
        shouldBehaveLikeERC20Transfer(
            ctx,
            errorPrefix,
            initialHolder,
            recipient,
            initialSupply,
            (from, to, value) => {
                return ctx.token.transfer(to, value, { from });
            },
        );
    });

    describe("transfer from", () => {
        const spender = recipient;

        describe("when the token owner is not the zero address", () => {
            const tokenOwner = initialHolder;

            describe("when the recipient is not the zero address", () => {
                const to = anotherAccount;

                describe("when the spender has enough approved balance", () => {
                    beforeEach(async () => {
                        await ctx.token.approve(spender, initialSupply, { from: initialHolder });
                    });

                    describe("when the token owner has enough balance", () => {
                        const amount = initialSupply;

                        it("transfers the requested amount", async () => {
                            await ctx.token.transferFrom(tokenOwner, to, amount, {
                                from: spender,
                            });

                            expect(await ctx.token.balanceOf(tokenOwner)).to.be.bignumber.equal(
                                "0",
                            );

                            expect(await ctx.token.balanceOf(to)).to.be.bignumber.equal(amount);
                        });

                        it("decreases the spender allowance", async () => {
                            await ctx.token.transferFrom(tokenOwner, to, amount, {
                                from: spender,
                            });

                            expect(
                                await ctx.token.allowance(tokenOwner, spender),
                            ).to.be.bignumber.equal("0");
                        });

                        it("emits a transfer event", async () => {
                            const { logs } = await ctx.token.transferFrom(tokenOwner, to, amount, {
                                from: spender,
                            });

                            expectEvent.inLogs(logs, "Transfer", {
                                from: tokenOwner,
                                to,
                                value: amount,
                            });
                        });

                        it("emits an approval event", async () => {
                            const { logs } = await ctx.token.transferFrom(tokenOwner, to, amount, {
                                from: spender,
                            });

                            expectEvent.inLogs(logs, "Approval", {
                                owner: tokenOwner,
                                spender,
                                value: await ctx.token.allowance(tokenOwner, spender),
                            });
                        });
                    });

                    describe("when the token owner does not have enough balance", () => {
                        const amount = initialSupply.addn(1);

                        it("reverts", async () => {
                            await expectRevert(
                                ctx.token.transferFrom(tokenOwner, to, amount, { from: spender }),
                                `${errorPrefix}: transfer amount exceeds balance`,
                            );
                        });
                    });
                });

                describe("when the spender does not have enough approved balance", () => {
                    beforeEach(async () => {
                        await ctx.token.approve(spender, initialSupply.subn(1), {
                            from: tokenOwner,
                        });
                    });

                    describe("when the token owner has enough balance", () => {
                        const amount = initialSupply;

                        it("reverts", async () => {
                            await expectRevert(
                                ctx.token.transferFrom(tokenOwner, to, amount, { from: spender }),
                                `${errorPrefix}: transfer amount exceeds allowance`,
                            );
                        });
                    });

                    describe("when the token owner does not have enough balance", () => {
                        const amount = initialSupply.addn(1);

                        it("reverts", async () => {
                            await expectRevert(
                                ctx.token.transferFrom(tokenOwner, to, amount, { from: spender }),
                                `${errorPrefix}: transfer amount exceeds balance`,
                            );
                        });
                    });
                });
            });

            describe("when the recipient is the zero address", () => {
                const amount = initialSupply;
                const to = ZERO_ADDRESS;

                beforeEach(async () => {
                    await ctx.token.approve(spender, amount, { from: tokenOwner });
                });

                it("reverts", async () => {
                    await expectRevert(
                        ctx.token.transferFrom(tokenOwner, to, amount, { from: spender }),
                        `${errorPrefix}: transfer to the zero address`,
                    );
                });
            });
        });

        describe("when the token owner is the zero address", () => {
            const amount = 0;
            const tokenOwner = ZERO_ADDRESS;
            const to = recipient;

            it("reverts", async () => {
                await expectRevert(
                    ctx.token.transferFrom(tokenOwner, to, amount, { from: spender }),
                    `${errorPrefix}: transfer from the zero address`,
                );
            });
        });
    });

    describe("approve", () => {
        shouldBehaveLikeERC20Approve(
            ctx,
            errorPrefix,
            initialHolder,
            recipient,
            initialSupply,
            (owner, spender, amount) => {
                return ctx.token.approve(spender, amount, { from: owner });
            },
        );
    });
}

const shouldBehaveLikeERC20Transfer = (
    ctx: { token: t.ERC20Instance },
    errorPrefix,
    from,
    to,
    balance,
    transfer,
): void => {
    describe("when the recipient is not the zero address", () => {
        describe("when the sender does not have enough balance", () => {
            const amount = balance.addn(1);

            it("reverts", async () => {
                await expectRevert(
                    transfer.call(this, from, to, amount),
                    `${errorPrefix}: transfer amount exceeds balance`,
                );
            });
        });

        describe("when the sender transfers all balance", () => {
            const amount = balance;

            it("transfers the requested amount", async () => {
                await transfer.call(this, from, to, amount);

                expect(await ctx.token.balanceOf(from)).to.be.bignumber.equal("0");

                expect(await ctx.token.balanceOf(to)).to.be.bignumber.equal(amount);
            });

            it("emits a transfer event", async () => {
                const { logs } = await transfer.call(this, from, to, amount);

                expectEvent.inLogs(logs, "Transfer", {
                    from,
                    to,
                    value: amount,
                });
            });
        });

        describe("when the sender transfers zero tokens", () => {
            const amount = new BN("0");

            it("transfers the requested amount", async () => {
                await transfer.call(this, from, to, amount);

                expect(await ctx.token.balanceOf(from)).to.be.bignumber.equal(balance);

                expect(await ctx.token.balanceOf(to)).to.be.bignumber.equal("0");
            });

            it("emits a transfer event", async () => {
                const { logs } = await transfer.call(this, from, to, amount);

                expectEvent.inLogs(logs, "Transfer", {
                    from,
                    to,
                    value: amount,
                });
            });
        });
    });

    describe("when the recipient is the zero address", () => {
        it("reverts", async () => {
            await expectRevert(
                transfer.call(this, from, ZERO_ADDRESS, balance),
                `${errorPrefix}: transfer to the zero address`,
            );
        });
    });
};

const shouldBehaveLikeERC20Approve = (
    ctx: { token: t.ERC20Instance },
    errorPrefix,
    owner,
    spender,
    supply,
    approve,
): void => {
    describe("when the spender is not the zero address", () => {
        describe("when the sender has enough balance", () => {
            const amount = supply;

            it("emits an approval event", async () => {
                const { logs } = await approve.call(this, owner, spender, amount);

                expectEvent.inLogs(logs, "Approval", {
                    owner,
                    spender,
                    value: amount,
                });
            });

            describe("when there was no approved amount before", () => {
                it("approves the requested amount", async () => {
                    await approve.call(this, owner, spender, amount);

                    expect(await ctx.token.allowance(owner, spender)).to.be.bignumber.equal(amount);
                });
            });

            describe("when the spender had an approved amount", () => {
                beforeEach(async () => {
                    await approve.call(this, owner, spender, new BN(1));
                });

                it("approves the requested amount and replaces the previous one", async () => {
                    await approve.call(this, owner, spender, amount);

                    expect(await ctx.token.allowance(owner, spender)).to.be.bignumber.equal(amount);
                });
            });
        });

        describe("when the sender does not have enough balance", () => {
            const amount = supply.addn(1);

            it("emits an approval event", async () => {
                const { logs } = await approve.call(this, owner, spender, amount);

                expectEvent.inLogs(logs, "Approval", {
                    owner,
                    spender,
                    value: amount,
                });
            });

            describe("when there was no approved amount before", () => {
                it("approves the requested amount", async () => {
                    await approve.call(this, owner, spender, amount);

                    expect(await ctx.token.allowance(owner, spender)).to.be.bignumber.equal(amount);
                });
            });

            describe("when the spender had an approved amount", () => {
                beforeEach(async () => {
                    await approve.call(this, owner, spender, new BN(1));
                });

                it("approves the requested amount and replaces the previous one", async () => {
                    await approve.call(this, owner, spender, amount);

                    expect(await ctx.token.allowance(owner, spender)).to.be.bignumber.equal(amount);
                });
            });
        });
    });

    describe("when the spender is the zero address", () => {
        it("reverts", async () => {
            await expectRevert(
                approve.call(this, owner, ZERO_ADDRESS, supply),
                `${errorPrefix}: approve to the zero address`,
            );
        });
    });
};
