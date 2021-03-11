import { expect } from "chai"

import { BN } from "@utils/math"
import { Account, MassetMachine, MassetDetails } from "@utils/machines"

import { ZERO_ADDRESS } from "@utils/constants"
import { Address } from "types/common"
import { ERC20 } from "types/generated/ERC20"

export interface IERC20BehaviourContext {
    token: ERC20
    mAssetMachine: MassetMachine
    initialHolder: Account
    recipient: Account
    anotherAccount: Account
    details: MassetDetails
}

const shouldBehaveLikeERC20Transfer = (
    ctx: IERC20BehaviourContext,
    errorPrefix: string,
    balance: BN,
    transfer: (token: ERC20, from: Account, to: Address, value: BN) => void,
): void => {
    describe("when the ctx.recipient is not the zero address", () => {
        describe("when the sender does not have enough balance", () => {
            const amount = balance.add(1)

            it("reverts", async () => {
                await expect(transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount)).to.be.revertedWith(
                    "ERC20: transfer amount exceeds balance",
                )
            })
        })

        describe("when the sender transfers all balance", () => {
            const amount = balance

            it("transfers the requested amount", async () => {
                await transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount)

                expect(await ctx.token.balanceOf(ctx.initialHolder.address)).to.be.equal("0")

                expect(await ctx.token.balanceOf(ctx.recipient.address)).to.be.equal(amount)
            })

            it("emits a transfer event", async () => {
                const tx = transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount)
                await expect(tx)
                    .to.emit(ctx.token, "Transfer")
                    .withArgs(ctx.initialHolder.address, ctx.recipient.address, amount)
            })
        })

        describe("when the sender transfers zero tokens", () => {
            const amount = BN.from("0")

            it("transfers the requested amount", async () => {
                await transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount)

                expect(await ctx.token.balanceOf(ctx.initialHolder.address)).to.be.equal(balance)

                expect(await ctx.token.balanceOf(ctx.recipient.address)).to.be.equal("0")
            })

            it("emits a transfer event", async () => {
                const tx = transfer(ctx.token, ctx.initialHolder, ctx.recipient.address, amount)

                await expect(tx)
                    .to.emit(ctx.token, "Transfer")
                    .withArgs(ctx.initialHolder.address, ctx.recipient.address, amount)
            })
        })
    })

    describe("when the ctx.recipient is the zero address", () => {
        it("reverts", async () => {
            await expect(transfer(ctx.token, ctx.initialHolder, ZERO_ADDRESS, balance)).to.be.revertedWith(
                `${errorPrefix}: transfer to the zero address`,
            )
        })
    })
}

const shouldBehaveLikeERC20Approve = (
    ctx: IERC20BehaviourContext,
    errorPrefix: string,
    supply: BN,
    approve: (owner: Account, spender: Address, amount: BN) => void,
): void => {
    let owner: Account
    let spender: Account
    before(() => {
        owner = ctx.initialHolder
        spender = ctx.recipient
    })
    describe("when the spender is not the zero address", () => {
        describe("when the sender has enough balance", () => {
            const amount = supply

            it("emits an approval event", async () => {
                const tx = approve(owner, spender.address, amount)

                await expect(tx)
                    .to.emit(ctx.token, "Approval")
                    .withArgs(owner.address, spender.address, amount)
            })

            describe("when there was no approved amount before", () => {
                it("approves the requested amount", async () => {
                    await approve(owner, spender.address, amount)

                    expect(await ctx.token.allowance(owner.address, spender.address)).to.be.equal(amount)
                })
            })

            describe("when the spender had an approved amount", () => {
                beforeEach(async () => {
                    await approve(owner, spender.address, BN.from(1))
                })

                it("approves the requested amount and replaces the previous one", async () => {
                    await approve(owner, spender.address, amount)

                    expect(await ctx.token.allowance(owner.address, spender.address)).to.be.equal(amount)
                })
            })
        })

        describe("when the sender does not have enough balance", () => {
            const amount = supply.add(1)

            it("emits an approval event", async () => {
                const tx = approve(owner, spender.address, amount)

                await expect(tx)
                    .to.emit(ctx.token, "Approval")
                    .withArgs(owner.address, spender.address, amount)
            })

            describe("when there was no approved amount before", () => {
                it("approves the requested amount", async () => {
                    await approve(owner, spender.address, amount)

                    expect(await ctx.token.allowance(owner.address, spender.address)).to.be.equal(amount)
                })
            })

            describe("when the spender had an approved amount", () => {
                beforeEach(async () => {
                    await approve(owner, spender.address, BN.from(1))
                })

                it("approves the requested amount and replaces the previous one", async () => {
                    await approve(owner, spender.address, amount)

                    expect(await ctx.token.allowance(owner.address, spender.address)).to.be.equal(amount)
                })
            })
        })
    })

    describe("when the spender is the zero address", () => {
        it("reverts", async () => {
            await expect(approve(owner, ZERO_ADDRESS, supply)).to.be.revertedWith(`${errorPrefix}: approve to the zero address`)
        })
    })
}

/**
 *
 * @param ctx is only resolved after the callers before and beforeAll functions are run.
 * So initially ctx will be an empty object. The before and beforeAll will add the properties
 * @param errorPrefix
 * @param initialSupply
 */
export function shouldBehaveLikeERC20(ctx: IERC20BehaviourContext, errorPrefix: string, initialSupply: BN): void {
    describe("total supply", () => {
        it("returns the total amount of tokens", async () => {
            expect(await ctx.token.totalSupply()).to.be.equal(initialSupply)
        })
    })

    describe("balanceOf", () => {
        describe("when the requested account has no tokens", () => {
            it("returns zero", async () => {
                expect(await ctx.token.balanceOf(ctx.anotherAccount.address)).to.be.equal("0")
            })
        })

        describe("when the requested account has some tokens", () => {
            it("returns the total amount of tokens", async () => {
                expect(await ctx.token.balanceOf(ctx.initialHolder.address)).to.be.equal(initialSupply)
            })
        })
    })

    describe("transfer", () => {
        shouldBehaveLikeERC20Transfer(ctx, errorPrefix, initialSupply, (token: ERC20, from: Account, to: Address, value: BN) =>
            token.connect(from.signer).transfer(to, value),
        )
    })

    describe("transfer from", () => {
        let spender: Account
        before(() => {
            spender = ctx.recipient
        })

        describe("when the token owner is not the zero address", () => {
            let tokenOwner: Account
            before(() => {
                tokenOwner = ctx.initialHolder
            })

            describe("when the ctx.recipient is not the zero address", () => {
                let to: Account
                before(() => {
                    to = ctx.anotherAccount
                })

                describe("when the spender has enough approved balance", () => {
                    beforeEach(async () => {
                        await ctx.token.connect(ctx.initialHolder.signer).approve(spender.address, initialSupply)
                    })

                    describe("when the token owner has enough balance", () => {
                        const amount = initialSupply

                        it("transfers the requested amount", async () => {
                            await ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount)

                            expect(await ctx.token.balanceOf(tokenOwner.address)).to.be.equal("0")

                            expect(await ctx.token.balanceOf(to.address)).to.be.equal(amount)
                        })

                        it("decreases the spender allowance", async () => {
                            await ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount)

                            expect(await ctx.token.allowance(tokenOwner.address, spender.address)).to.be.equal("0")
                        })

                        it("emits a transfer event", async () => {
                            const tx = ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount)
                            await expect(tx)
                                .to.emit(ctx.token, "Transfer")
                                .withArgs(tokenOwner.address, to.address, amount)
                        })

                        it("emits an approval event", async () => {
                            const tx = ctx.token.connect(spender.signer).approve(to.address, amount)
                            await expect(tx)
                                .to.emit(ctx.token, "Approval")
                                .withArgs(spender.address, to.address, await ctx.token.allowance(spender.address, to.address))
                        })
                    })

                    describe("when the token owner does not have enough balance", () => {
                        it("reverts", async () => {
                            const amount = initialSupply.add(1)
                            await expect(
                                ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount),
                            ).to.be.revertedWith(`ERC20: transfer amount exceeds balance`)
                        })
                    })
                })

                describe("when the spender does not have enough approved balance", () => {
                    beforeEach(async () => {
                        await ctx.token.connect(tokenOwner.signer).approve(spender.address, initialSupply.sub(1))
                    })

                    describe("when the token owner has enough balance", () => {
                        const amount = initialSupply

                        it("reverts", async () => {
                            await expect(
                                ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount),
                            ).to.be.revertedWith("ERC20: transfer amount exceeds allowance")
                        })
                    })

                    describe("when the token owner does not have enough balance", () => {
                        const amount = initialSupply.add(1)

                        it("reverts", async () => {
                            await expect(
                                ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to.address, amount),
                            ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
                        })
                    })
                })
            })

            describe("when the ctx.recipient is the zero address", () => {
                const amount = initialSupply
                const to = ZERO_ADDRESS

                beforeEach(async () => {
                    await ctx.token.connect(tokenOwner.signer).approve(spender.address, amount)
                })

                it("reverts", async () => {
                    await expect(ctx.token.connect(spender.signer).transferFrom(tokenOwner.address, to, amount)).to.be.revertedWith(
                        `${errorPrefix}: transfer to the zero address`,
                    )
                })
            })
        })

        describe("when the token owner is the zero address", () => {
            const amount = 0
            const tokenOwner = ZERO_ADDRESS

            it("reverts", async () => {
                await expect(ctx.token.connect(spender.signer).transferFrom(tokenOwner, ctx.recipient.address, amount)).to.be.revertedWith(
                    `${errorPrefix}: transfer from the zero address`,
                )
            })
        })
    })

    describe("approve", () => {
        shouldBehaveLikeERC20Approve(ctx, errorPrefix, initialSupply, (owner: Account, spender: Address, amount) =>
            ctx.token.connect(owner.signer).approve(spender, amount),
        )
    })
}

export default shouldBehaveLikeERC20
