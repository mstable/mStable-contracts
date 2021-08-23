import { expect } from "chai"

import { BN } from "@utils/math"
import { ZERO_ADDRESS } from "@utils/constants"
import { ERC20Burnable } from "types/generated"
import { Account } from "types"
import { ContractTransaction } from "ethers"

export interface IERC20BurnableBehaviourContext {
    burnableToken: ERC20Burnable
    owner: Account
    burner: Account
}

export function shouldBehaveLikeERC20Burnable(ctx: IERC20BurnableBehaviourContext, errorPrefix: string, balance: BN): void {
    describe("burn", () => {
        describe("when the given amount is not greater than balance of the sender", () => {
            let tx: ContractTransaction

            const shouldBurn = (amount) => {
                beforeEach(async () => {
                    tx = await ctx.burnableToken.connect(ctx.owner.signer).burn(amount)
                })

                it("burns the requested amount", async () => {
                    expect(await ctx.burnableToken.balanceOf(ctx.owner.address)).eq(balance.sub(amount))
                })

                it("emits a transfer event", async () => {
                    await expect(tx).to.emit(ctx.burnableToken, "Transfer").withArgs(ctx.owner.address, ZERO_ADDRESS, amount)
                })
            }

            context("for a zero amount", () => {
                shouldBurn(BN.from(0))
            })

            context("for a non-zero amount", () => {
                shouldBurn(BN.from(100))
            })
        })

        describe("when the given amount is greater than the balance of the sender", () => {
            const amount = balance.add(1)

            it("reverts", async () => {
                await expect(ctx.burnableToken.connect(ctx.owner.signer).burn(amount)).to.be.revertedWith(
                    `${errorPrefix}: burn amount exceeds balance`,
                )
            })
        })
    })

    describe("burnFrom", () => {
        describe("on success", () => {
            const shouldBurnFrom = (amount) => {
                const originalAllowance = amount.mul(3)
                let tx: ContractTransaction

                beforeEach(async () => {
                    await ctx.burnableToken.connect(ctx.owner.signer).approve(ctx.burner.address, originalAllowance)
                    tx = await ctx.burnableToken.connect(ctx.burner.signer).burnFrom(ctx.owner.address, amount)
                })

                it("burns the requested amount", async () => {
                    expect(await ctx.burnableToken.balanceOf(ctx.owner.address)).eq(balance.sub(amount))
                })

                it("decrements allowance", async () => {
                    expect(await ctx.burnableToken.allowance(ctx.owner.address, ctx.burner.address)).eq(originalAllowance.sub(amount))
                })

                it("emits a transfer event", async () => {
                    await expect(tx).to.emit(ctx.burnableToken, "Transfer").withArgs(ctx.owner.address, ZERO_ADDRESS, amount)
                })
            }

            context("for a zero amount", () => {
                shouldBurnFrom(BN.from(0))
            })

            context("for a non-zero amount", () => {
                shouldBurnFrom(BN.from(100))
            })
        })

        describe("when the given amount is greater than the balance of the sender", () => {
            const amount = balance.add(1)

            it("reverts", async () => {
                await ctx.burnableToken.connect(ctx.owner.signer).approve(ctx.burner.address, amount)
                await expect(ctx.burnableToken.connect(ctx.burner.signer).burnFrom(ctx.owner.address, amount)).to.be.revertedWith(
                    `${errorPrefix}: burn amount exceeds balance`,
                )
            })
        })

        describe("when the given amount is greater than the allowance", () => {
            const allowance = BN.from(100)

            it("reverts", async () => {
                await ctx.burnableToken.connect(ctx.owner.signer).approve(ctx.burner.address, allowance)
                await expect(ctx.burnableToken.connect(ctx.burner.signer).burnFrom(ctx.owner.address, allowance.add(1))).to.be.revertedWith(
                    `${errorPrefix}: burn amount exceeds allowance`,
                )
            })
        })
    })
}
