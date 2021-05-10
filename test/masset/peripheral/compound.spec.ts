/* eslint-disable consistent-return */

import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions"
import { Account, StandardAccounts, MassetMachine } from "@utils/machines"
import { ZERO_ADDRESS, DEAD_ADDRESS, fullScale } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { MockCToken, MockCToken__factory, MockERC20, MockERC20__factory, MockNexus, MockNexus__factory } from "types/generated"
import { ethers } from "hardhat"
import { CompoundIntegration } from "types/generated/CompoundIntegration"
import { expect } from "chai"
import { CompoundIntegration__factory } from "types/generated/factories/CompoundIntegration__factory"
import { BassetIntegrationDetails } from "types"
import { shouldBehaveLikeModule, IModuleBehaviourContext } from "../../shared/Module.behaviour"

const convertUnderlyingToCToken = async (cToken: MockCToken, underlyingAmount: BN): Promise<BN> => {
    const exchangeRate = await cToken.exchangeRateStored()
    return underlyingAmount.add(1).mul(fullScale).div(exchangeRate)
}
const convertCTokenToUnderlying = async (cToken: MockCToken, cTokenAmount: BN): Promise<BN> => {
    const exchangeRate = await cToken.exchangeRateStored()
    return cTokenAmount.mul(exchangeRate).div(fullScale)
}

describe("CompoundIntegration", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine

    let nexus: MockNexus
    let mAsset: Account
    let bAssets: MockERC20[]
    let cTokens: MockCToken[]
    let compoundIntegration: CompoundIntegration

    let integrationDetails: BassetIntegrationDetails

    const ctx: Partial<IModuleBehaviourContext> = {}

    const runSetup = async (enableUSDTFee = false, simulateMint = false, skipInit = false) => {
        // SETUP
        // ======
        nexus = await new MockNexus__factory(sa.default.signer).deploy(
            sa.governor.address,
            sa.mockSavingsManager.address,
            sa.mockInterestValidator.address,
        )
        // Deploy the bAssets without the lending markets, which is Compound
        integrationDetails = await mAssetMachine.loadBassetsLocal(false, enableUSDTFee)
        bAssets = integrationDetails.bAssets

        // Deploy Compound Token contract linked to the bAssets
        const cTokensPromises = bAssets.map((bAsset) =>
            new MockCToken__factory(sa.default.signer).deploy("Compound Token", "cToken", bAsset.address),
        )
        cTokens = await Promise.all(cTokensPromises)

        // Deploy Compound Integration contract
        compoundIntegration = await new CompoundIntegration__factory(sa.default.signer).deploy(nexus.address, mAsset.address, DEAD_ADDRESS)

        if (!skipInit) {
            // set bAsset and cToken on the Compound Integration contract for the mAsset
            await Promise.all(
                cTokens.map((cToken, i) =>
                    compoundIntegration.connect(sa.governor.signer).setPTokenAddress(bAssets[i].address, cToken.address),
                ),
            )

            if (simulateMint) {
                await Promise.all(
                    bAssets.map(async (bAsset) => {
                        const decimals = BN.from(await bAsset.decimals())
                        const amount = BN.from(enableUSDTFee ? 101 : 100).mul(BN.from(10).pow(decimals.sub(BN.from(1))))
                        const amountD = BN.from(100).mul(BN.from(10).pow(decimals.sub(BN.from(1))))
                        // Step 1. xfer tokens to integration
                        await bAsset.transfer(compoundIntegration.address, amount)
                        // Step 2. call deposit
                        return compoundIntegration.connect(mAsset.signer).deposit(bAsset.address, amountD.toString(), true)
                    }),
                )
            }
        }
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        mAsset = sa.mockMasset
    })

    describe("Compound constructor", async () => {
        before(async () => {
            await runSetup()
            ctx.module = compoundIntegration
            ctx.sa = sa
        })
        describe("behave like a Module", async () => {
            shouldBehaveLikeModule(ctx as IModuleBehaviourContext)
        })
        it("should properly store deploy arguments", async () => {
            expect(await compoundIntegration.nexus(), "nexus address").eq(nexus.address)
            expect(await compoundIntegration.lpAddress(), "Liquidity provider (mAsset)").eq(mAsset.address)
        })
        it("should fail when empty liquidity provider", async () => {
            const tx = new CompoundIntegration__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS, DEAD_ADDRESS)
            await expect(tx).revertedWith("Invalid LP address")
        })
    })

    describe("calling initialize", async () => {
        beforeEach(async () => {
            await runSetup(false, false, true)
        })

        it("should properly store valid arguments", async () => {
            await compoundIntegration.initialize([bAssets[0].address], [cTokens[0].address])
            expect(cTokens[0].address).eq(await compoundIntegration.bAssetToPToken(bAssets[0].address))
        })

        it("should fail when called again", async () => {
            await compoundIntegration.initialize([bAssets[0].address], [cTokens[0].address])
            await expect(compoundIntegration.initialize([bAssets[0].address], [cTokens[0].address])).to.be.revertedWith(
                "Initializable: contract is already initialized",
            )
        })

        it("should fail if passed incorrect data", async () => {
            await expect(
                compoundIntegration.initialize([bAssets[0].address, sa.dummy1.address], [cTokens[0].address]),
                "bAsset and pToken array length are different",
            ).to.be.revertedWith("Invalid inputs")
            await expect(compoundIntegration.initialize([cTokens[0].address], [ZERO_ADDRESS]), "pToken address is zero").to.be.revertedWith(
                "Invalid addresses",
            )
            await expect(
                compoundIntegration.initialize([bAssets[0].address, bAssets[0].address], [cTokens[0].address, cTokens[0].address]),
                "duplicate pToken or bAsset",
            ).to.be.revertedWith("pToken already set")
            await expect(compoundIntegration.initialize([ZERO_ADDRESS], [cTokens[0].address]), "invalid bAsset addresses").to.be.reverted
        })
    })

    describe("setting P Token Address", async () => {
        let erc20Mock: MockERC20
        let anotherCToken: MockCToken
        beforeEach("init mocks", async () => {
            erc20Mock = await new MockERC20__factory(sa.default.signer).deploy("TMP", "TMP", 18, sa.default.address, "1000000")
            anotherCToken = await new MockCToken__factory(sa.default.signer).deploy("C2", "C Token 2", erc20Mock.address)
            await runSetup()
        })
        it("should pass only when function called by the Governor", async () => {
            await expect(compoundIntegration.setPTokenAddress(erc20Mock.address, anotherCToken.address)).to.be.revertedWith(
                "Only governor can execute",
            )
            await compoundIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, anotherCToken.address)
            expect(anotherCToken.address).eq(await compoundIntegration.bAssetToPToken(erc20Mock.address))
        })
        it("should fail when passed invalid args", async () => {
            await expect(
                compoundIntegration.connect(sa.governor.signer).setPTokenAddress(ZERO_ADDRESS, anotherCToken.address),
                "bAsset address is zero",
            ).to.be.revertedWith("Invalid addresses")
            await expect(
                compoundIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, ZERO_ADDRESS),
                "pToken address is zero",
            ).to.be.revertedWith("Invalid addresses")
            await compoundIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, anotherCToken.address)
            await expect(
                compoundIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, sa.default.address),
                "pToken address already assigned for a bAsset",
            ).to.be.revertedWith("pToken already set")
        })
    })

    describe("calling deposit", async () => {
        beforeEach("init mocks", async () => {
            await runSetup()
        })
        it("should deposit tokens to Compound", async () => {
            // Step 1: Choose the test tokens
            const bAsset = bAssets[0]
            const cToken = cTokens[0]

            // Step 2. mint amount = 1 with 18 decimal places
            const bAssetDecimals = await bAsset.decimals()
            const amount = simpleToExactAmount(1, bAssetDecimals)

            // Step 3. Get balances before
            const bAssetBalInCTokenContractBefore = await bAsset.balanceOf(cToken.address)
            const cTokenBalInIntegrationContractBefore = await cToken.balanceOf(compoundIntegration.address)
            // Cross that match with the `checkBalance` call
            expect(await compoundIntegration.callStatic.checkBalance(bAsset.address), "bAsset bal of integration before").eq(
                cTokenBalInIntegrationContractBefore,
            )

            // Step 4. Simulate mAsset calling deposit on the integration contract from a mint
            // Transfer the mAsset some bAsset tokens. This would normally happen in a mAsset mint.
            await bAsset.transfer(compoundIntegration.address, amount)
            // mAsset calls deposit on the Compound integration contract
            const tx = compoundIntegration.connect(mAsset.signer).deposit(bAsset.address, amount, false)

            // Step 5. Post deposit checks
            // 5.0 Check the Deposit event from the Compound Integration contract
            await expect(tx, "Deposit event").to.emit(compoundIntegration, "Deposit").withArgs(bAsset.address, cToken.address, amount)
            // 5.1 Check bAssets in the cToken contract
            expect(await bAsset.balanceOf(cToken.address), "bAsset bal in cToken after").eq(bAssetBalInCTokenContractBefore.add(amount))
            // 5.1 Check bAssets are no longer in integration contract
            expect(await bAsset.balanceOf(compoundIntegration.address), "no bAssets in integration after").eq(0)
            // 5.2 Check cTokens in the Compound integration
            // cToken amount is x100 the bAsset amount but to 8 decimals places
            expect(await cToken.balanceOf(compoundIntegration.address), "cToken bal in integration after").to.eq(
                cTokenBalInIntegrationContractBefore.add(await convertUnderlyingToCToken(cToken, amount)),
            )
            // Cross that match bAssets in cToken with the `checkBalance` call
            expect(await compoundIntegration.callStatic.checkBalance(bAsset.address), "checkBalance of bAsset in integration contract").eq(
                bAssetBalInCTokenContractBefore.add(amount),
            )
        })

        it("should handle the fee calculations", async () => {
            // Step 0. Choose tokens with transfer fee on 3rd and 4th bAsset (index 2 and 3)
            await runSetup(true)
            const bAsset = bAssets[3]
            const cToken = cTokens[3]

            // Step 1. mint amount = 1000 with 18 decimal places
            const bAssetDecimals = await bAsset.decimals()
            const amount = simpleToExactAmount(1000, bAssetDecimals)

            // Step 2 Get balance before
            const bAssetBalInCTokenContractBefore = await bAsset.balanceOf(cToken.address)
            const bAssetBalInIntegrationContractBefore = await bAsset.balanceOf(compoundIntegration.address)
            const cTokenBalInIntegrationContractBefore = await cToken.balanceOf(compoundIntegration.address)
            // Cross that match with the `checkBalance` call
            expect(await compoundIntegration.callStatic.checkBalance(bAsset.address), "bAsset bal of integration before").eq(
                cTokenBalInIntegrationContractBefore,
            )

            // Step 1. simulate mAsset transferring bAsset tokens to integration contract as part of a mint
            await bAsset.transfer(compoundIntegration.address, amount)

            // Step 2. Check balances and fees after first transfer from the mint
            const bAssetBalInIntegrationContractAfterFirstTransfer = await bAsset.balanceOf(compoundIntegration.address)
            const firstTransferReceivedAmount = bAssetBalInIntegrationContractAfterFirstTransfer.sub(bAssetBalInIntegrationContractBefore)

            const feeRate = simpleToExactAmount(1, 15)
            // Ensure fee is being deducted = amount * feeRate / base (1e18)
            // if fee is 0.1%, fee = amount / 1000 = amount * 1e15 / 1e18
            const firstTransferFeeExpected = amount.mul(feeRate).div(fullScale)
            const firstTransferAmountExpected = amount.sub(firstTransferFeeExpected)
            expect(firstTransferReceivedAmount, "Fee needs to be removed from bAsset").eq(firstTransferAmountExpected)

            // Step 3. simulate mAsset calling deposit on the Integration contract
            const tx = compoundIntegration.connect(mAsset.signer).deposit(bAsset.address, firstTransferReceivedAmount, true)

            const secondTransferFeeExpected = firstTransferAmountExpected.mul(feeRate).div(fullScale)
            const secondTransferAmountExpected = firstTransferAmountExpected.sub(secondTransferFeeExpected)

            // Step 5. Check emitted events
            // 5.1 Check the Deposit event on the integration contract
            await expect(tx, "Deposit event from Compound Integration")
                .to.emit(compoundIntegration, "Deposit")
                .withArgs(bAsset.address, cToken.address, secondTransferAmountExpected)

            // 5.2 Check the Transfer event on the cToken from the mint
            const newCTokens = await convertUnderlyingToCToken(cToken, secondTransferAmountExpected)
            await expect(tx, "Transfer event from cToken")
                .to.emit(cToken, "Transfer")
                .withArgs(ZERO_ADDRESS, compoundIntegration.address, newCTokens)

            // Step 6. Check token balances
            // 6.1 Check bAssets in cToken contract
            const bAssetBalInCTokenContractAfterDeposit = await bAsset.balanceOf(cToken.address)
            expect(bAssetBalInCTokenContractAfterDeposit, "bAssets in cToken after deposit").eq(
                bAssetBalInCTokenContractBefore.add(secondTransferAmountExpected),
            )
            // 6.2 Cross that match with the `checkBalance` call
            expect(await compoundIntegration.callStatic.checkBalance(bAsset.address), "checkBalance of bAssets in Integration").eq(
                bAssetBalInCTokenContractAfterDeposit,
            )

            // 6.3 Check the cTokens in the compound integration contract
            const cTokenBalInIntegrationContractAfterDeposit = await cToken.balanceOf(compoundIntegration.address)
            expect(cTokenBalInIntegrationContractAfterDeposit, "cTokens in Integration contract after deposit").to.eq(
                cTokenBalInIntegrationContractBefore.add(await convertUnderlyingToCToken(cToken, secondTransferAmountExpected)),
            )
            // 6.4 Check no bAssets are left in the Integration contract
            expect(await bAsset.balanceOf(compoundIntegration.address), "no bAssets in Integration after deposit").to.eq(0)
            // assertBNClose(cTokenBalInIntegrationContractAfter, cTokenBalInIntegrationContractBefore.add(firstTransferAmountExpected))
        })
        it("should only allow the liquidity provider to call function", async () => {
            await expect(
                compoundIntegration.connect(sa.dummy1.signer).deposit(bAssets[0].address, simpleToExactAmount(10), false),
            ).to.be.revertedWith("Only the LP can execute")
        })
        it("should fail if the bAsset is not supported", async () => {
            const bAssetInvalid = await new MockERC20__factory(sa.default.signer).deploy("MK1", "MK", 12, sa.default.address, 100000)
            await expect(
                compoundIntegration.connect(mAsset.signer).deposit(bAssetInvalid.address, simpleToExactAmount(10), false),
            ).to.be.revertedWith("cToken does not exist")
        })
        it("should fail if we do not first pass the required bAsset", async () => {
            // Step 0. Choose tokens
            // const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const amount = BN.from(10).pow(12)
            // const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken)

            // Step 2. call deposit
            await expect(compoundIntegration.connect(mAsset.signer).deposit(bAssets[0].address, amount, false)).to.be.revertedWith(
                "ERC20: transfer amount exceeds balance",
            )
        })
        it("should fail if we try to deposit too much", async () => {
            // Step 0. Choose tokens
            const bAsset = bAssets[0]
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).mul(BN.from(10).pow(bAssetDecimals))
            const amountHigh = BN.from(11).mul(BN.from(10).pow(bAssetDecimals))

            // Step 1. xfer low tokens to integration
            await bAsset.transfer(compoundIntegration.address, amount)
            expect(await bAsset.balanceOf(compoundIntegration.address)).lte(amount)
            // Step 2. call deposit with high tokens
            await expect(
                compoundIntegration.connect(mAsset.signer).deposit(bAsset.address, amountHigh.toString(), false),
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
        })
        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens with no transfer fee
            const bAsset = bAssets[0]
            const cToken = cTokens[0]
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).pow(bAssetDecimals)

            // Step 1. xfer low tokens to integration
            await bAsset.transfer(compoundIntegration.address, amount)

            // Fails with ZERO bAsset Address
            await expect(compoundIntegration.connect(mAsset.signer).deposit(ZERO_ADDRESS, amount, false)).to.be.revertedWith(
                "cToken does not exist",
            )
            // Fails with ZERO Amount
            await expect(compoundIntegration.connect(mAsset.signer).deposit(bAsset.address, 0, false)).to.be.revertedWith(
                "Must deposit something",
            )
            // Succeeds with Incorrect bool (defaults to false)
            const tx = compoundIntegration.connect(mAsset.signer).deposit(bAsset.address, amount, undefined)

            // Check the Deposit event
            await expect(tx).to.emit(compoundIntegration, "Deposit").withArgs(bAsset.address, cToken.address, amount)
        })
    })

    // describe("withdraw", () => {
    //     beforeEach("init mocks", async () => {
    //         await runSetup()
    //     })

    //     it("should withdraw tokens from Compound", async () => {
    //         // Step 0. Choose tokens
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const amount = new BN(10).pow(await bAsset.decimals())
    //         const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken)

    //         const user_bAsset_balanceBefore = await bAsset.balanceOf(sa.default.address)
    //         const bAssetRecipient_balBefore = await bAsset.balanceOf(cToken.address)

    //         // Step 1. xfer tokens to integration
    //         await bAsset.transfer(compoundIntegration.address, amount)

    //         expect(user_bAsset_balanceBefore.sub(amount)).to.bignumber.equal(await bAsset.balanceOf(sa.default.address))

    //         // Step 2. call deposit
    //         const tx = await compoundIntegration.deposit(bAsset.address, amount, false)

    //         // Step 3. Check for things:
    //         // 3.1 Check that cToken has bAssets
    //         expect(await bAsset.balanceOf(cToken.address)).bignumber.eq(bAssetRecipient_balBefore.add(amount))
    //         // 3.2 Check that compound integration has cTokens
    //         const cToken_balanceOfIntegration = await cToken.balanceOf(compoundIntegration.address)
    //         const exchangeRate = await cToken.exchangeRateStored()
    //         const expected_cTokens = amount.addn(1).mul(fullScale).div(exchangeRate)
    //         expect(expected_cTokens).to.bignumber.equal(cToken_balanceOfIntegration)

    //         expectEvent(tx.receipt, "Deposit", { _amount: amount })

    //         // 4. Call withdraw
    //         await compoundIntegration.methods["withdraw(address,address,uint256,bool)"](sa.default.address, bAsset.address, amount, false)
    //         const expected_cTokenWithdrawal = await convertUnderlyingToCToken(cToken, amount)

    //         // 5. Check stuff
    //         // 5.1 Check that bAsset has returned to the user
    //         const user_bAsset_balanceAfter = await bAsset.balanceOf(sa.default.address)
    //         expect(user_bAsset_balanceAfter).to.bignumber.equal(user_bAsset_balanceBefore)

    //         // 5.2 Check that bAsset has returned to the user
    //         const cToken_balanceOfIntegrationAfter = await cToken.balanceOf(compoundIntegration.address)
    //         expect(cToken_balanceOfIntegrationAfter).bignumber.eq(cToken_balanceOfIntegration.sub(expected_cTokenWithdrawal))
    //     })
    //     context("and specifying a minute amount of bAsset", () => {
    //         beforeEach(async () => {
    //             await runSetup(false, true)
    //         })
    //         it("should withdraw 0 if the cToken amount is 0", async () => {
    //             // Step 0. Choose tokens
    //             const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //             const amount = new BN(1)
    //             const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken)

    //             const recipientBassetBalBefore = await bAsset.balanceOf(sa.default.address)
    //             const integrationCTokenBalanceBefore = await cToken.balanceOf(compoundIntegration.address)

    //             const cTokenAmount = await convertUnderlyingToCToken(cToken, amount)
    //             expect(cTokenAmount).bignumber.eq(new BN(0), "cToken amount is not 0")

    //             const tx = await compoundIntegration.methods["withdraw(address,address,uint256,bool)"](
    //                 sa.default.address,
    //                 bAsset.address,
    //                 amount,
    //                 false,
    //             )

    //             expectEvent(tx.receipt, "SkippedWithdrawal", {
    //                 bAsset: bAsset.address,
    //                 amount,
    //             })

    //             // recipient bAsset bal is the same
    //             const recipientBassetBalAfter = await bAsset.balanceOf(sa.default.address)
    //             expect(recipientBassetBalBefore).bignumber.eq(recipientBassetBalAfter)
    //             // compoundIntegration cTokenBal is the same
    //             const integrationCTokenBalanceAfter = await cToken.balanceOf(compoundIntegration.address)
    //             expect(integrationCTokenBalanceBefore).bignumber.eq(integrationCTokenBalanceAfter)
    //         })
    //         it("should function normally if bAsset decimals are low", async () => {
    //             // Step 0. Choose tokens
    //             const bAsset = await c_ERC20.at(integrationDetails.cTokens[1].bAsset)
    //             const amount = new BN(1)
    //             const cToken = await c_CERC20.at(integrationDetails.cTokens[1].cToken)

    //             expect(await bAsset.decimals()).bignumber.eq(new BN(6))

    //             const recipientBassetBalBefore = await bAsset.balanceOf(sa.default.address)
    //             const integrationCTokenBalanceBefore = await cToken.balanceOf(compoundIntegration.address)

    //             const cTokenAmount = await convertUnderlyingToCToken(cToken, amount)
    //             expect(cTokenAmount).bignumber.gt(new BN(0) as any, "cToken amount is 0")

    //             const tx = await compoundIntegration.methods["withdraw(address,address,uint256,bool)"](
    //                 sa.default.address,
    //                 bAsset.address,
    //                 amount,
    //                 false,
    //             )

    //             expectEvent(tx.receipt, "PlatformWithdrawal", {
    //                 bAsset: bAsset.address,
    //                 pToken: cToken.address,
    //                 totalAmount: amount,
    //                 userAmount: amount,
    //             })

    //             // recipient bAsset bal is the same
    //             const recipientBassetBalAfter = await bAsset.balanceOf(sa.default.address)
    //             expect(recipientBassetBalAfter).bignumber.eq(recipientBassetBalBefore.add(amount))
    //             // compoundIntegration cTokenBal is the same
    //             const integrationCTokenBalanceAfter = await cToken.balanceOf(compoundIntegration.address)
    //             expect(integrationCTokenBalanceAfter).bignumber.eq(integrationCTokenBalanceBefore.sub(cTokenAmount))
    //         })
    //     })

    //     it("should handle the fee calculations", async () => {
    //         await runSetup(true, true)

    //         // should deduct the transfer fee from the return value
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[1].bAsset)
    //         const bAsset_decimals = await bAsset.decimals()
    //         const amount = new BN(10).pow(bAsset_decimals)
    //         const cToken = await c_CERC20.at(integrationDetails.cTokens[1].cToken)

    //         // 0.1 Get balance before
    //         const bAssetRecipient = sa.dummy1
    //         const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient)
    //         const compoundIntegration_balBefore = await cToken.balanceOf(compoundIntegration.address)

    //         // Step 1. call withdraw
    //         const tx = await compoundIntegration.methods["withdraw(address,address,uint256,bool)"](
    //             bAssetRecipient,
    //             bAsset.address,
    //             amount,
    //             true,
    //         )
    //         const bAssetRecipient_balAfter = await bAsset.balanceOf(bAssetRecipient)
    //         const compoundIntegration_balAfter = await cToken.balanceOf(compoundIntegration.address)

    //         // 99% of amt
    //         const scale = simpleToExactAmount("0.99", 18)
    //         const amountScaled = amount.mul(scale)
    //         const expectedAmount = amountScaled.div(fullScale)
    //         // Step 2. Validate recipient
    //         expect(bAssetRecipient_balAfter).bignumber.gte(bAssetRecipient_balBefore.add(expectedAmount) as any)
    //         expect(bAssetRecipient_balAfter).bignumber.lte(bAssetRecipient_balBefore.add(amount) as any)
    //         expect(compoundIntegration_balAfter).bignumber.eq(
    //             compoundIntegration_balBefore.sub(await convertUnderlyingToCToken(cToken, amount)) as any,
    //         )
    //         const expectedBalance = compoundIntegration_balBefore.sub(await convertUnderlyingToCToken(cToken, amount))
    //         assertBNSlightlyGTPercent(compoundIntegration_balAfter, expectedBalance, "0.1")
    //         const underlyingBalance = await convertCTokenToUnderlying(cToken, compoundIntegration_balAfter)
    //         // Cross that match with the `checkBalance` call
    //         const fetchedBalance = await compoundIntegration.checkBalance.call(bAsset.address)
    //         expect(fetchedBalance).bignumber.eq(underlyingBalance)
    //     })

    //     it("should only allow a whitelisted user to call function", async () => {
    //         // Step 0. Choose tokens
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const amount = new BN(10).pow(await bAsset.decimals())

    //         // Step 1. call deposit
    //         await expectRevert(
    //             compoundIntegration.methods["withdraw(address,address,uint256,bool)"](sa.dummy1, bAsset.address, amount, false, {
    //                 from: sa.dummy1,
    //             }),
    //             "Not a whitelisted address",
    //         )
    //     })

    //     it("should fail if there is insufficient balance", async () => {
    //         // Step 0. Choose tokens
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const bAsset_decimals = await bAsset.decimals()
    //         const amount = new BN(1000).mul(new BN(10).pow(bAsset_decimals))

    //         // Step 1. call deposit
    //         await expectRevert(
    //             compoundIntegration.methods["withdraw(address,address,uint256,bool)"](sa.default.address, bAsset.address, amount, false),
    //             "ERC20: burn amount exceeds balance",
    //         )
    //     })

    //     it("should fail with broken arguments", async () => {
    //         // Step 0. Choose tokens
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const bAsset_decimals = await bAsset.decimals()
    //         const amount = new BN(10).pow(bAsset_decimals)
    //         const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken)

    //         // 0.1 Get balance before
    //         const bAssetRecipient = sa.dummy1

    //         // Fails with ZERO bAsset Address
    //         await expectRevert(
    //             compoundIntegration.methods["withdraw(address,address,uint256,bool)"](sa.dummy1, ZERO_ADDRESS, amount, false),
    //             "cToken does not exist",
    //         )

    //         // Fails with ZERO recipient address
    //         await expectRevert(
    //             compoundIntegration.methods["withdraw(address,address,uint256,bool)"](ZERO_ADDRESS, bAsset.address, new BN(1), false),
    //             "Must specify recipient",
    //         )

    //         // Fails with ZERO Amount
    //         await expectRevert(
    //             compoundIntegration.methods["withdraw(address,address,uint256,bool)"](sa.dummy1, bAsset.address, "0", false),
    //             "Must withdraw something",
    //         )

    //         expect(ZERO).to.bignumber.equal(await bAsset.balanceOf(bAssetRecipient))

    //         expect(ZERO).to.bignumber.equal(await cToken.balanceOf(compoundIntegration.address))
    //     })

    //     it("should fail if the bAsset is not supported", async () => {
    //         // Step 0. Choose tokens
    //         const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset)
    //         const amount = new BN(10).pow(await bAsset.decimals())

    //         // Step 1. call withdraw
    //         await expectRevert(
    //             compoundIntegration.methods["withdraw(address,address,uint256,bool)"](sa.dummy1, bAsset.address, amount, false),
    //             "cToken does not exist",
    //         )
    //     })
    // })

    // describe("withdraw specific amount", async () => {
    //     describe("and the token does not have transfer fee", async () => {
    //         beforeEach("init mocks", async () => {
    //             await runSetup(false, true)
    //         })
    //         it("should allow withdrawal of X and give Y to the caller", async () => {
    //             // Step 0. Choose tokens
    //             const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //             const bAsset_decimals = await bAsset.decimals()
    //             const amount = simpleToExactAmount(5, bAsset_decimals)
    //             const totalAmount = amount.muln(2)
    //             const aToken = await c_MockCToken.at(integrationDetails.cTokens[0].cToken)
    //             // 0.1 Get balance before
    //             const bAssetRecipient = sa.dummy1
    //             const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient)
    //             const compoundIntegration_balBefore = await bAsset.balanceOf(compoundIntegration.address)
    //             const compoundBalanceBefore = await compoundIntegration.checkBalance.call(bAsset.address)

    //             // fail if called by non Bm or mAsset
    //             await expectRevert(
    //                 compoundIntegration.methods["withdraw(address,address,uint256,uint256,bool)"](
    //                     bAssetRecipient,
    //                     bAsset.address,
    //                     amount,
    //                     totalAmount,
    //                     false,
    //                     {
    //                         from: sa.dummy1,
    //                     },
    //                 ),
    //                 "Not a whitelisted address",
    //             )
    //             // send the amount
    //             const tx = await compoundIntegration.methods["withdraw(address,address,uint256,uint256,bool)"](
    //                 bAssetRecipient,
    //                 bAsset.address,
    //                 amount,
    //                 totalAmount,
    //                 false,
    //             )
    //             const bAssetRecipient_balAfter = await bAsset.balanceOf(bAssetRecipient)
    //             const compoundIntegration_balAfter = await bAsset.balanceOf(compoundIntegration.address)
    //             const compoundBalanceAfter = await compoundIntegration.checkBalance.call(bAsset.address)
    //             expect(bAssetRecipient_balAfter).bignumber.eq(bAssetRecipient_balBefore.add(amount))
    //             expect(compoundIntegration_balAfter).bignumber.eq(compoundIntegration_balBefore.add(totalAmount.sub(amount)))
    //             const dust = compoundBalanceBefore.muln(1).divn(1000)
    //             assertBNSlightlyGT(compoundBalanceAfter, compoundBalanceBefore.sub(totalAmount), dust, false)
    //             // emit the event
    //             expectEvent(tx.receipt, "PlatformWithdrawal", {
    //                 bAsset: bAsset.address,
    //                 pToken: aToken.address,
    //                 totalAmount: totalAmount,
    //                 userAmount: amount,
    //             })
    //         })
    //     })
    //     describe("and the token has transfer fees", async () => {
    //         beforeEach("init mocks", async () => {
    //             await runSetup(true, true)
    //         })
    //         it("should fail if totalAmount != userAmount", async () => {
    //             const bAsset = await c_ERC20.at(integrationDetails.cTokens[1].bAsset)
    //             const bAsset_decimals = await bAsset.decimals()
    //             const amount = simpleToExactAmount(5, bAsset_decimals)
    //             const totalAmount = amount.muln(2)
    //             await expectRevert(
    //                 compoundIntegration.methods["withdraw(address,address,uint256,uint256,bool)"](
    //                     sa.dummy1,
    //                     bAsset.address,
    //                     amount,
    //                     totalAmount,
    //                     true,
    //                 ),
    //                 "Cache inactive for assets with fee",
    //             )
    //         })
    //     })
    // })

    // describe("withdrawRaw", async () => {
    //     beforeEach("init mocks", async () => {
    //         await runSetup(false, true)
    //     })
    //     it("should fail if caller is not whitelisetd", async () => {
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         await expectRevert(
    //             compoundIntegration.withdrawRaw(sa.dummy3, bAsset.address, new BN(1), {
    //                 from: sa.dummy1,
    //             }),
    //             "Not a whitelisted address",
    //         )
    //     })
    //     it("should allow the mAsset or BM to withdraw a given bAsset", async () => {
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const bAsset_decimals = await bAsset.decimals()
    //         const amount = simpleToExactAmount(5, bAsset_decimals)

    //         await bAsset.transfer(compoundIntegration.address, amount)

    //         const bAssetRecipient = sa.dummy1
    //         const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient)
    //         const compoundIntegration_balBefore = await bAsset.balanceOf(compoundIntegration.address)
    //         const compoundBalanceBefore = await compoundIntegration.checkBalance.call(bAsset.address)

    //         const tx = await compoundIntegration.withdrawRaw(bAssetRecipient, bAsset.address, amount)

    //         const bAssetRecipient_balAfter = await bAsset.balanceOf(bAssetRecipient)
    //         const compoundIntegration_balAfter = await bAsset.balanceOf(compoundIntegration.address)
    //         const compoundBalanceAfter = await compoundIntegration.checkBalance.call(bAsset.address)

    //         // Balances remain the same
    //         expect(bAssetRecipient_balAfter).bignumber.eq(bAssetRecipient_balBefore.add(amount))
    //         expect(compoundIntegration_balAfter).bignumber.eq(compoundIntegration_balBefore.sub(amount))
    //         expect(compoundBalanceAfter).bignumber.eq(compoundBalanceBefore)

    //         // Emits expected event
    //         expectEvent(tx.receipt, "Withdrawal", {
    //             _bAsset: bAsset.address,
    //             _pToken: ZERO_ADDRESS,
    //             _amount: amount,
    //         })
    //     })
    //     it("should fail if there is no balance in a given asset", async () => {
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         await expectRevert(compoundIntegration.withdrawRaw(sa.dummy3, bAsset.address, new BN(1)), "SafeERC20: low-level call failed")
    //     })
    //     it("should fail if specified a 0 amount", async () => {
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         await expectRevert(compoundIntegration.withdrawRaw(sa.dummy3, bAsset.address, new BN(0)), "Must withdraw something")
    //     })
    // })

    // describe("checkBalance", async () => {
    //     beforeEach(async () => {
    //         await runSetup(false, true)
    //     })
    //     it("should return balance for any caller when supported token address passed", async () => {
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)

    //         const expectedBal = new BN(10).mul(new BN(10).pow(await bAsset.decimals()))

    //         const fetchedBalance = await compoundIntegration.checkBalance.call(bAsset.address)

    //         assertBNClose(fetchedBalance, expectedBal, new BN(100))
    //     })

    //     it("should increase our balance over time and activity", async () => {
    //         // Simulating activity on mainnet only, as our mocks are not capable
    //         if (!systemMachine.isGanacheFork) return

    //         // Load things up and do some mints
    //         await runSetup(false, true)

    //         // 1. Load up our target tokens and get the balances now
    //         const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const bAsset_decimals = await bAsset.decimals()
    //         const amount = new BN(10).pow(bAsset_decimals)
    //         const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken)

    //         const compoundIntegration_balBefore = await cToken.balanceOf(compoundIntegration.address)
    //         expect(compoundIntegration_balBefore).bignumber.gt(new BN(0) as any)
    //         const underlyingBalanceBefore = await convertCTokenToUnderlying(cToken, compoundIntegration_balBefore)
    //         // Cross that match with the `checkBalance` call
    //         const fetchedBalanceBefore = await compoundIntegration.checkBalance.call(bAsset.address)
    //         expect(fetchedBalanceBefore).bignumber.eq(underlyingBalanceBefore)

    //         // 2. Simulate some external activity by depositing or redeeming
    //         // DIRECTlY to the LendingPool.
    //         // Doing this activity should raise our aToken balances slightly
    //         // 2.1. Approve the LendingPool Core
    //         await bAsset.approve(cToken.address, amount)

    //         // 2.2. Call the deposit func
    //         await cToken.mint(amount)
    //         // 2.3. Fast forward some time
    //         await time.increase(ONE_WEEK)
    //         // 2.4. Do a redemption
    //         await cToken.redeemUnderlying(amount)

    //         // 3. Analyse our new balances
    //         const compoundIntegration_balAfter = await cToken.balanceOf(compoundIntegration.address)
    //         // Should not go up by more than 2% during this period
    //         const underlyingBalanceAfter = await convertCTokenToUnderlying(cToken, compoundIntegration_balAfter)
    //         assertBNSlightlyGTPercent(underlyingBalanceAfter, underlyingBalanceBefore, "2", true)
    //         // Cross that match with the `checkBalance` call
    //         const fetchedBalance = await compoundIntegration.checkBalance.call(bAsset.address)
    //         expect(fetchedBalance).bignumber.eq(underlyingBalanceAfter)
    //         expect(fetchedBalance).bignumber.gt(fetchedBalanceBefore as any)

    //         // 4. Withdraw our new interested - we worked hard for it!
    //         await compoundIntegration.methods["withdraw(address,address,uint256,bool)"](
    //             sa.default.address,
    //             bAsset.address,
    //             underlyingBalanceAfter,
    //             false,
    //         )
    //     })

    //     it("should fail if called with inactive token", async () => {
    //         const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset)

    //         await expectRevert(compoundIntegration.checkBalance(bAsset.address), "cToken does not exist")
    //     })
    // })

    // describe("reApproveAllTokens", async () => {
    //     before(async () => {
    //         await runSetup()
    //     })
    //     it("should re-approve ALL bAssets with aTokens", async () => {
    //         const bAsset1 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const cToken1 = await c_CERC20.at(integrationDetails.cTokens[0].cToken)
    //         let allowance = await bAsset1.allowance(compoundIntegration.address, cToken1.address)
    //         expect(MAX_UINT256).to.bignumber.equal(allowance)

    //         const bAsset2 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const cToken2 = await c_CERC20.at(integrationDetails.cTokens[0].cToken)
    //         allowance = await bAsset2.allowance(compoundIntegration.address, cToken2.address)
    //         expect(MAX_UINT256).to.bignumber.equal(allowance)

    //         await compoundIntegration.reApproveAllTokens({
    //             from: sa.governor,
    //         })

    //         allowance = await bAsset1.allowance(compoundIntegration.address, cToken1.address)
    //         expect(MAX_UINT256).to.bignumber.equal(allowance)

    //         allowance = await bAsset2.allowance(compoundIntegration.address, cToken2.address)
    //         expect(MAX_UINT256).to.bignumber.equal(allowance)
    //     })

    //     it("should only be callable by the Governor", async () => {
    //         // Fail when not called by the Governor
    //         await expectRevert(
    //             compoundIntegration.reApproveAllTokens({
    //                 from: sa.dummy1,
    //             }),
    //             "Only governor can execute",
    //         )

    //         // Succeed when called by the Governor
    //         compoundIntegration.reApproveAllTokens({
    //             from: sa.governor,
    //         })
    //     })

    //     it("should be able to be called multiple times", async () => {
    //         const bAsset1 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const cToken1 = await c_CERC20.at(integrationDetails.cTokens[0].cToken)
    //         const bAsset2 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset)
    //         const cToken2 = await c_CERC20.at(integrationDetails.cTokens[0].cToken)

    //         let allowance = await bAsset1.allowance(compoundIntegration.address, cToken1.address)
    //         expect(MAX_UINT256).to.bignumber.equal(allowance)
    //         allowance = await bAsset2.allowance(compoundIntegration.address, cToken2.address)
    //         expect(MAX_UINT256).to.bignumber.equal(allowance)

    //         compoundIntegration.reApproveAllTokens({
    //             from: sa.governor,
    //         })

    //         compoundIntegration.reApproveAllTokens({
    //             from: sa.governor,
    //         })

    //         allowance = await bAsset1.allowance(compoundIntegration.address, cToken1.address)
    //         expect(MAX_UINT256).to.bignumber.equal(allowance)
    //         allowance = await bAsset2.allowance(compoundIntegration.address, cToken2.address)
    //         expect(MAX_UINT256).to.bignumber.equal(allowance)
    //     })
    // })
})
