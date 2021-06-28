"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldBehaveLikeERC20 = void 0;
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const constants_1 = require("@utils/constants");
const shouldBehaveLikeERC20Transfer = (ctx, errorPrefix, balance, transfer) => {
    describe("when the ctx.recipient is not the zero address", () => {
        describe("when the sender does not have enough balance", () => {
            const amount = balance.add(1);
            it("reverts", async () => {
                await chai_1.expect(transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount)).to.be.revertedWith("ERC20: transfer amount exceeds balance");
            });
        });
        describe("when the sender transfers all balance", () => {
            const amount = balance;
            it("transfers the requested amount", async () => {
                await transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount);
                chai_1.expect(await ctx.token.balanceOf(ctx.initialHolder.address)).to.be.equal("0");
                chai_1.expect(await ctx.token.balanceOf(ctx.recipient.address)).to.be.equal(amount);
            });
            it("emits a transfer event", async () => {
                const tx = transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount);
                await chai_1.expect(tx).to.emit(ctx.token, "Transfer").withArgs(ctx.initialHolder.address, ctx.recipient.address, amount);
            });
        });
        describe("when the sender transfers zero tokens", () => {
            const amount = math_1.BN.from("0");
            it("transfers the requested amount", async () => {
                await transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount);
                chai_1.expect(await ctx.token.balanceOf(ctx.initialHolder.address)).to.be.equal(balance);
                chai_1.expect(await ctx.token.balanceOf(ctx.recipient.address)).to.be.equal("0");
            });
            it("emits a transfer event", async () => {
                const tx = transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount);
                await chai_1.expect(tx).to.emit(ctx.token, "Transfer").withArgs(ctx.initialHolder.address, ctx.recipient.address, amount);
            });
        });
    });
    describe("when the ctx.recipient is the zero address", () => {
        it("reverts", async () => {
            await chai_1.expect(transfer(ctx.token, ctx.initialHolder, constants_1.ZERO_ADDRESS, balance)).to.be.revertedWith(`${errorPrefix}: transfer to the zero address`);
        });
    });
};
const shouldBehaveLikeERC20Approve = (ctx, errorPrefix, supply, approve) => {
    let owner;
    let spender;
    before(() => {
        owner = ctx.initialHolder;
        spender = ctx.recipient;
    });
    describe("when the spender is not the zero address", () => {
        describe("when the sender has enough balance", () => {
            const amount = supply;
            it("emits an approval event", async () => {
                const tx = approve(owner, spender.address, amount);
                await chai_1.expect(tx).to.emit(ctx.token, "Approval").withArgs(owner.address, spender.address, amount);
            });
            describe("when there was no approved amount before", () => {
                it("approves the requested amount", async () => {
                    await approve(owner, spender.address, amount);
                    chai_1.expect(await ctx.token.allowance(owner.address, spender.address)).to.be.equal(amount);
                });
            });
            describe("when the spender had an approved amount", () => {
                beforeEach(async () => {
                    await approve(owner, spender.address, math_1.BN.from(1));
                });
                it("approves the requested amount and replaces the previous one", async () => {
                    await approve(owner, spender.address, amount);
                    chai_1.expect(await ctx.token.allowance(owner.address, spender.address)).to.be.equal(amount);
                });
            });
        });
        describe("when the sender does not have enough balance", () => {
            const amount = supply.add(1);
            it("emits an approval event", async () => {
                const tx = approve(owner, spender.address, amount);
                await chai_1.expect(tx).to.emit(ctx.token, "Approval").withArgs(owner.address, spender.address, amount);
            });
            describe("when there was no approved amount before", () => {
                it("approves the requested amount", async () => {
                    await approve(owner, spender.address, amount);
                    chai_1.expect(await ctx.token.allowance(owner.address, spender.address)).to.be.equal(amount);
                });
            });
            describe("when the spender had an approved amount", () => {
                beforeEach(async () => {
                    await approve(owner, spender.address, math_1.BN.from(1));
                });
                it("approves the requested amount and replaces the previous one", async () => {
                    await approve(owner, spender.address, amount);
                    chai_1.expect(await ctx.token.allowance(owner.address, spender.address)).to.be.equal(amount);
                });
            });
        });
    });
    describe("when the spender is the zero address", () => {
        it("reverts", async () => {
            await chai_1.expect(approve(owner, constants_1.ZERO_ADDRESS, supply)).to.be.revertedWith(`${errorPrefix}: approve to the zero address`);
        });
    });
};
/**
 *
 * @param ctx is only resolved after the callers before and beforeAll functions are run.
 * So initially ctx will be an empty object. The before and beforeAll will add the properties
 * @param errorPrefix
 * @param initialSupply
 */
function shouldBehaveLikeERC20(ctx, errorPrefix, initialSupply) {
    describe("total supply", () => {
        it("returns the total amount of tokens", async () => {
            chai_1.expect(await ctx.token.totalSupply()).to.be.equal(initialSupply);
        });
    });
    describe("balanceOf", () => {
        describe("when the requested account has no tokens", () => {
            it("returns zero", async () => {
                chai_1.expect(await ctx.token.balanceOf(ctx.anotherAccount.address)).to.be.equal("0");
            });
        });
        describe("when the requested account has some tokens", () => {
            it("returns the total amount of tokens", async () => {
                chai_1.expect(await ctx.token.balanceOf(ctx.initialHolder.address)).to.be.equal(initialSupply);
            });
        });
    });
    describe("transfer", () => {
        shouldBehaveLikeERC20Transfer(ctx, errorPrefix, initialSupply, (token, from, to, value) => token.connect(from.signer).transfer(to, value));
    });
    describe("transfer from", () => {
        let spender;
        before(() => {
            spender = ctx.recipient;
        });
        describe("when the token owner is not the zero address", () => {
            let tokenOwner;
            before(() => {
                tokenOwner = ctx.initialHolder;
            });
            describe("when the ctx.recipient is not the zero address", () => {
                let to;
                before(() => {
                    to = ctx.anotherAccount;
                });
                describe("when the spender has enough approved balance", () => {
                    beforeEach(async () => {
                        await ctx.token.connect(ctx.initialHolder.signer).approve(spender.address, initialSupply);
                    });
                    describe("when the token owner has enough balance", () => {
                        const amount = initialSupply;
                        it("transfers the requested amount", async () => {
                            await ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount);
                            chai_1.expect(await ctx.token.balanceOf(tokenOwner.address)).to.be.equal("0");
                            chai_1.expect(await ctx.token.balanceOf(to.address)).to.be.equal(amount);
                        });
                        it("decreases the spender allowance", async () => {
                            await ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount);
                            chai_1.expect(await ctx.token.allowance(tokenOwner.address, spender.address)).to.be.equal("0");
                        });
                        it("emits a transfer event", async () => {
                            const tx = ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount);
                            await chai_1.expect(tx).to.emit(ctx.token, "Transfer").withArgs(tokenOwner.address, to.address, amount);
                        });
                        it("emits an approval event", async () => {
                            const beforeAllowance = await ctx.token.allowance(spender.address, to.address);
                            const tx = ctx.token.connect(spender.signer).approve(to.address, amount);
                            await chai_1.expect(tx)
                                .to.emit(ctx.token, "Approval")
                                .withArgs(spender.address, to.address, beforeAllowance.add(amount));
                        });
                    });
                    describe("when the token owner does not have enough balance", () => {
                        it("reverts", async () => {
                            const amount = initialSupply.add(1);
                            await chai_1.expect(ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount)).to.be.revertedWith(`ERC20: transfer amount exceeds balance`);
                        });
                    });
                });
                describe("when the spender does not have enough approved balance", () => {
                    beforeEach(async () => {
                        await ctx.token.connect(tokenOwner.signer).approve(spender.address, initialSupply.sub(1));
                    });
                    describe("when the token owner has enough balance", () => {
                        const amount = initialSupply;
                        it("reverts", async () => {
                            await chai_1.expect(ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount)).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
                        });
                    });
                    describe("when the token owner does not have enough balance", () => {
                        const amount = initialSupply.add(1);
                        it("reverts", async () => {
                            await chai_1.expect(ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount)).to.be.revertedWith("ERC20: transfer amount exceeds balance");
                        });
                    });
                });
            });
            describe("when the ctx.recipient is the zero address", () => {
                const amount = initialSupply;
                const to = constants_1.ZERO_ADDRESS;
                beforeEach(async () => {
                    await ctx.token.connect(tokenOwner.signer).approve(spender.address, amount);
                });
                it("reverts", async () => {
                    await chai_1.expect(ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to, amount)).to.be.revertedWith(`${errorPrefix}: transfer to the zero address`);
                });
            });
        });
        describe("when the token owner is the zero address", () => {
            const amount = 0;
            const tokenOwner = constants_1.ZERO_ADDRESS;
            it("reverts", async () => {
                await chai_1.expect(ctx.token.connect(spender.signer).transferFrom(tokenOwner, ctx.recipient.address, amount)).to.be.revertedWith(`${errorPrefix}: transfer from the zero address`);
            });
        });
    });
    describe("approve", () => {
        shouldBehaveLikeERC20Approve(ctx, errorPrefix, initialSupply, (owner, spender, amount) => ctx.token.connect(owner.signer).approve(spender, amount));
    });
}
exports.shouldBehaveLikeERC20 = shouldBehaveLikeERC20;
exports.default = shouldBehaveLikeERC20;
//# sourceMappingURL=ERC20.behaviour.js.map