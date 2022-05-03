import { ZERO, ZERO_ADDRESS } from "@utils/constants"
import { MassetDetails, MassetMachine, StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount, safeInfinity } from "@utils/math"
import { expect } from "chai"
import { Account } from "types"
import { ERC20, ERC205, IERC20Metadata, IERC4626Vault } from "types/generated"

export interface IERC4626BehaviourContext {
    vault: IERC4626Vault
    asset: ERC20
    sa: StandardAccounts
    mAssetMachine: MassetMachine
    details: MassetDetails
}

export function shouldBehaveLikeERC4626(ctx: IERC4626BehaviourContext): void {
    let assetsAmount: BN
    let sharesAmount: BN
    let alice: Account
    let bob: Account
    beforeEach("init", async () => {
        assetsAmount = simpleToExactAmount(1, await (ctx.asset as unknown as IERC20Metadata).decimals())
        sharesAmount = simpleToExactAmount(10, await (ctx.asset as unknown as IERC20Metadata).decimals())
        alice = ctx.sa.default
        bob = ctx.sa.dummy2
    })
    it("should properly store valid arguments", async () => {
        expect(await ctx.vault.asset(), "asset").to.eq(ctx.asset.address)
    })
    describe("deposit", async () => {
        it("should deposit assets to the vault", async () => {
            await ctx.asset.approve(ctx.vault.address, simpleToExactAmount(1, 21))
            const shares = await ctx.vault.previewDeposit(assetsAmount)

            expect(await ctx.vault.maxDeposit(alice.address), "max deposit").to.gte(assetsAmount)
            expect(await ctx.vault.maxMint(alice.address), "max mint").to.gte(shares)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
            expect(await ctx.vault.convertToShares(assetsAmount), "convertToShares").to.lte(shares)

            // Test
            const tx = await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Deposit").withArgs(alice.address, alice.address, assetsAmount, shares)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.lte(shares)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.lte(assetsAmount)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(assetsAmount)
        })
        it("fails if deposits zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["deposit(uint256,address)"](0, alice.address)).to.be.revertedWith(
                "Must deposit something",
            )
        })
        it("fails if receiver is zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["deposit(uint256,address)"](10, ZERO_ADDRESS)).to.be.revertedWith(
                "Invalid beneficiary address",
            )
        })
        it("fails if preview amount is zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer).previewDeposit(ZERO)).to.be.revertedWith(
                "Must deposit something",
            )
        })        
    })
    describe("mint", async () => {
        it("should mint shares to the vault", async () => {
            await ctx.asset.approve(ctx.vault.address, simpleToExactAmount(1, 21))
            // const shares = sharesAmount
            const assets = await ctx.vault.previewMint(sharesAmount)
            const shares = await ctx.vault.previewDeposit(assetsAmount)

            expect(await ctx.vault.maxDeposit(alice.address), "max deposit").to.gte(assets)
            expect(await ctx.vault.maxMint(alice.address), "max mint").to.gte(shares)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            expect(await ctx.vault.convertToShares(assets), "convertToShares").to.lte(shares)
            expect(await ctx.vault.convertToAssets(shares), "convertToShares").to.lte(assets)

            const tx = await ctx.vault.connect(alice.signer)["mint(uint256,address)"](shares, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Deposit").withArgs(alice.address, alice.address, assets, shares)

            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.lte(shares)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.lte(assets)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(assets)
        })
        it("fails if mint zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["mint(uint256,address)"](0, alice.address)).to.be.revertedWith(
                "Must deposit something",
            )
        })
        it("fails if receiver is zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer)["mint(uint256,address)"](10, ZERO_ADDRESS)).to.be.revertedWith(
                "Invalid beneficiary address",
            )
        })
    })
    describe("withdraw", async () => {
        it("from the vault, same caller, receiver and owner", async () => {
            await ctx.asset.approve(ctx.vault.address, simpleToExactAmount(1, 21))

            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(0)
            const shares = await ctx.vault.previewWithdraw(assetsAmount)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(shares)

            // Test
            const tx = await ctx.vault.connect(alice.signer).withdraw(assetsAmount, alice.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Withdraw").withArgs(alice.address, alice.address, alice.address, assetsAmount, shares)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
        })
        it("from the vault, caller != receiver and caller = owner", async () => {
            // Alice deposits assets (owner), Alice withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, simpleToExactAmount(1, 21))

            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(0)
            const shares = await ctx.vault.previewWithdraw(assetsAmount)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(shares)

            // Test
            const tx = await ctx.vault.connect(alice.signer).withdraw(assetsAmount, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Withdraw").withArgs(alice.address, bob.address, alice.address, assetsAmount, shares)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
        })
        it("from the vault caller != owner, infinite approval", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, simpleToExactAmount(1, 21))
            await (ctx.vault.connect(alice.signer) as unknown as ERC205).approve(bob.address, safeInfinity)

            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(0)
            const shares = await ctx.vault.previewWithdraw(assetsAmount)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(shares)

            // Test
            const tx = await ctx.vault.connect(bob.signer).withdraw(assetsAmount, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Withdraw").withArgs(bob.address, bob.address, alice.address, assetsAmount, shares)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
        })
        it("from the vault, caller != receiver and caller != owner", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, simpleToExactAmount(1, 21))
            await (ctx.vault.connect(alice.signer) as unknown as ERC205).approve(bob.address, simpleToExactAmount(1, 21))

            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(0)
            const shares = await ctx.vault.previewWithdraw(assetsAmount)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(shares)

            // Test
            const tx = await ctx.vault.connect(bob.signer).withdraw(assetsAmount, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Withdraw").withArgs(bob.address, bob.address, alice.address, assetsAmount, shares)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
        })
        it("fails if deposits zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer).withdraw(0, alice.address, alice.address)).to.be.revertedWith(
                "Must withdraw something",
            )
        })
        it("fails if receiver is zero", async () => {
            await expect(ctx.vault.connect(ctx.sa.default.signer).withdraw(10, ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(
                "Invalid beneficiary address",
            )
        })
        it("fail if caller != owner and it has not allowance", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, simpleToExactAmount(1, 21))

            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(0)
            const shares = await ctx.vault.previewWithdraw(assetsAmount)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(shares)

            // Test
            const tx = ctx.vault.connect(bob.signer).withdraw(assetsAmount, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.be.revertedWith("Amount exceeds allowance")
        })
    })
    describe("redeem", async () => {
        it("from the vault, same caller, receiver and owner", async () => {
            await ctx.asset.approve(ctx.vault.address, simpleToExactAmount(1, 21))

            const assets = await ctx.vault.previewRedeem(sharesAmount)
            expect(await ctx.vault.maxRedeem(alice.address), "max maxRedeem").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)
            expect(await ctx.vault.maxRedeem(alice.address), "max maxRedeem").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(0)
            const shares = await ctx.vault.maxRedeem(alice.address)

            // Test
            const tx = await ctx.vault.connect(alice.signer)["redeem(uint256,address,address)"](shares, alice.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Withdraw").withArgs(alice.address, alice.address, alice.address, assets, shares)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
        })
        it("from the vault, caller != receiver and caller = owner", async () => {
            // Alice deposits assets (owner), Alice withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, simpleToExactAmount(1, 21))
            const assets = await ctx.vault.previewRedeem(sharesAmount)

            expect(await ctx.vault.maxRedeem(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assetsAmount, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(assets)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(0)
            const shares = await ctx.vault.maxRedeem(alice.address)

            // Test
            const tx = await ctx.vault.connect(alice.signer)["redeem(uint256,address,address)"](shares, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Withdraw").withArgs(alice.address, bob.address, alice.address, assets, shares)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
        })
        it("from the vault caller != owner, infinite approval", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, simpleToExactAmount(1, 21))
            await (ctx.vault.connect(alice.signer) as unknown as ERC205).approve(bob.address, safeInfinity)
            const assets = await ctx.vault.previewRedeem(sharesAmount)

            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(0)
            const shares = await ctx.vault.maxRedeem(alice.address)

            // Test
            const tx = await ctx.vault.connect(bob.signer)["redeem(uint256,address,address)"](shares, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Withdraw").withArgs(bob.address, bob.address, alice.address, assets, shares)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
        })
        it("from the vault, caller != receiver and caller != owner", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, simpleToExactAmount(1, 21))
            await (ctx.vault.connect(alice.signer) as unknown as ERC205).approve(bob.address, simpleToExactAmount(1, 21))

            const assets = await ctx.vault.previewRedeem(sharesAmount)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.gt(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.gt(0)
            const shares = await ctx.vault.maxRedeem(alice.address)

            // Test
            const tx = await ctx.vault.connect(bob.signer)["redeem(uint256,address,address)"](shares, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(ctx.vault, "Withdraw").withArgs(bob.address, bob.address, alice.address, assets, shares)
            expect(await ctx.vault.maxRedeem(alice.address), "max redeem").to.eq(0)
            expect(await ctx.vault.maxWithdraw(alice.address), "max withdraw").to.eq(0)
            expect(await ctx.vault.totalAssets(), "totalAssets").to.eq(0)
        })
        it("fails if deposits zero", async () => {
            await expect(
                ctx.vault.connect(ctx.sa.default.signer)["redeem(uint256,address,address)"](0, alice.address, alice.address),
            ).to.be.revertedWith("Must withdraw something")
        })
        it("fails if receiver is zero", async () => {
            await expect(
                ctx.vault.connect(ctx.sa.default.signer)["redeem(uint256,address,address)"](10, ZERO_ADDRESS, ZERO_ADDRESS),
            ).to.be.revertedWith("Invalid beneficiary address")
        })
        it("fail if caller != owner and it has not allowance", async () => {
            // Alice deposits assets (owner), Bob withdraws assets (caller), Bob receives assets (receiver)
            await ctx.asset.connect(alice.signer).approve(ctx.vault.address, simpleToExactAmount(1, 21))
            const assets = await ctx.vault.previewRedeem(sharesAmount)

            await ctx.vault.connect(alice.signer)["deposit(uint256,address)"](assets, alice.address)

            // Test
            const tx = ctx.vault.connect(bob.signer)["redeem(uint256,address,address)"](sharesAmount, bob.address, alice.address)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.be.revertedWith("Amount exceeds allowance")
        })
    })
}

export default shouldBehaveLikeERC4626
