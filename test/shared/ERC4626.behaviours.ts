
import hre, { ethers } from "hardhat";
import { expect } from "chai"
import { Signer } from "ethers"
import { simpleToExactAmount, BN } from "@utils/math"
import { IERC4626Vault, IERC4626Vault__factory, AbstractVault, AbstractVault__factory, MockNexus, ERC20 } from "types/generated"
import { Account } from "types"
import { MassetMachine, MassetDetails, StandardAccounts } from "@utils/machines"
import { ZERO_ADDRESS } from "@utils/constants"



export interface IERC4626BehaviourContext {
    vault: IERC4626Vault
    asset: ERC20
    sa: StandardAccounts
    mAssetMachine: MassetMachine
    owner: Account
    receiver: Account
    anotherAccount: Account
    details: MassetDetails
}

export async function shouldBehaveLikeERC4626(ctx: IERC4626BehaviourContext, errorPrefix: string, initialSupply: BN): Promise<void> {

    const assetsAmount = simpleToExactAmount(1, await ctx.asset.decimals())
    const sharesAmount = simpleToExactAmount(10, await ctx.asset.decimals())
    describe('ERC4626', () => {

        before("init contract", async () => {
        })
        beforeEach(async () => { /* before each context */ })

        describe("constructor", async () => {
            it("should properly store valid arguments", async () => {
                expect(await ctx.vault.asset(), "asset").to.eq(ctx.asset.address);
            })
        })

        // 
        describe("deposit", async () => {
            beforeEach(async () => { /* before each context */ })

            it('deposit should ...', async () => {
                await ctx.asset.approve(ctx.vault.address, simpleToExactAmount(1, 21))

                const tx = await ctx.vault.connect(ctx.owner.signer).deposit(assetsAmount, ctx.receiver.address)
                // Verify events, storage change, balance, etc.
                // await expect(tx).to.emit(abstractVault, "EVENT-NAME").withArgs("ARGUMENT 1", "ARGUMENT 2");

            });
            it('fails if ...', async () => {
                await expect(ctx.vault.connect(ctx.owner.signer).deposit(assetsAmount, ctx.receiver.address), "fails due to ").to.be.revertedWith("EXPECTED ERROR");
            });
        });


        // 
        describe("mint", async () => {
            beforeEach(async () => { /* before each context */ })

            it('mint should ...', async () => {
                const tx = await ctx.vault.connect(ctx.owner.signer).mint(sharesAmount, ctx.receiver.address)
                // Verify events, storage change, balance, etc.
                // await expect(tx).to.emit(abstractVault, "EVENT-NAME").withArgs("ARGUMENT 1", "ARGUMENT 2");

            });
            it('fails if ...', async () => {
                await expect(ctx.vault.connect(ctx.owner.signer).mint(sharesAmount, ctx.receiver.address), "fails due to ").to.be.revertedWith("EXPECTED ERROR");
            });
        });


        // 
        describe("withdraw", async () => {
            beforeEach(async () => { /* before each context */ })

            it('withdraw should ...', async () => {
                const tx = await ctx.vault.connect(ctx.owner.signer).withdraw(assetsAmount, ctx.receiver.address, ctx.owner.address)
                // Verify events, storage change, balance, etc.
                // await expect(tx).to.emit(abstractVault, "EVENT-NAME").withArgs("ARGUMENT 1", "ARGUMENT 2");

            });
            it('fails if ...', async () => {
                await expect(ctx.vault.connect(ctx.owner.signer).withdraw(assetsAmount, ctx.receiver.address, ctx.owner.address), "fails due to ").to.be.revertedWith("EXPECTED ERROR");
            });
        });


        // 
        describe("redeem", async () => {
            beforeEach(async () => { /* before each context */ })

            it('redeem should ...', async () => {
                const tx = await ctx.vault.connect(ctx.owner.signer).redeem(sharesAmount, ctx.receiver.address, ctx.owner.address)
                // Verify events, storage change, balance, etc.
                // await expect(tx).to.emit(abstractVault, "EVENT-NAME").withArgs("ARGUMENT 1", "ARGUMENT 2");

            });
            it('fails if ...', async () => {
                await expect(ctx.vault.connect(ctx.owner.signer).redeem(sharesAmount, ctx.receiver.address, ctx.owner.address), "fails due to ").to.be.revertedWith("EXPECTED ERROR");
            });
        });


        describe("read only functions", async () => {
            beforeEach(async () => { /* before each context */ })

            it('previewDeposit should ...', async () => {
                const response = await ctx.vault.previewDeposit(assetsAmount);
                expect(response, "previewDeposit").to.eq("expected value");
            });

            it('maxDeposit should ...', async () => {
                const response = await ctx.vault.maxDeposit(ctx.owner.address);
                expect(response, "maxDeposit").to.eq("expected value");
            });

            it('previewMint should ...', async () => {
                const response = await ctx.vault.previewMint(sharesAmount);
                expect(response, "previewMint").to.eq("expected value");
            });

            it('maxMint should ...', async () => {
                const response = await ctx.vault.maxMint(ctx.owner.address);
                expect(response, "maxMint").to.eq("expected value");
            });


            it('previewWithdraw should ...', async () => {
                const response = await ctx.vault.previewWithdraw(assetsAmount);
                expect(response, "previewWithdraw").to.eq("expected value");
            });


            it('maxWithdraw should ...', async () => {
                const response = await ctx.vault.maxWithdraw(ctx.owner.address);
                expect(response, "maxWithdraw").to.eq("expected value");
            });

            it('previewRedeem should ...', async () => {
                const response = await ctx.vault.previewRedeem(sharesAmount);
                expect(response, "previewRedeem").to.eq("expected value");
            });

            it('maxRedeem should ...', async () => {
                const response = await ctx.vault.maxRedeem(ctx.owner.address);
                expect(response, "maxRedeem").to.eq("expected value");
            });

            it('totalAssets should ...', async () => {
                const response = await ctx.vault.totalAssets();
                expect(response, "totalAssets").to.eq("expected value");
            });


            it('convertToAssets should ...', async () => {
                const response = await ctx.vault.convertToAssets(sharesAmount);
                expect(response, "convertToAssets").to.eq("expected value");
            });


            it('convertToShares should ...', async () => {
                const response = await ctx.vault.convertToShares(assetsAmount);
                expect(response, "convertToShares").to.eq("expected value");
            });

        });

    });
}

export default shouldBehaveLikeERC4626;
