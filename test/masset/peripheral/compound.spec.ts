/* eslint-disable consistent-return */

import { StandardAccounts, MassetMachine } from "@utils/machines"
import { ZERO_ADDRESS, DEAD_ADDRESS, fullScale, MAX_UINT256 } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { MockCToken, MockCToken__factory, MockERC20, MockERC20__factory, MockNexus, MockNexus__factory } from "types/generated"
import { ethers } from "hardhat"
import { CompoundIntegration } from "types/generated/CompoundIntegration"
import { expect } from "chai"
import { CompoundIntegration__factory } from "types/generated/factories/CompoundIntegration__factory"
import { BassetIntegrationDetails, Account } from "types"
import { assertBNClose, assertBNSlightlyGT, assertBNSlightlyGTPercent } from "@utils/assertions"
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
        compoundIntegration = compoundIntegration.connect(sa.mockMasset.signer)

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
                        return compoundIntegration.deposit(bAsset.address, amountD.toString(), true)
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
            await runSetup(true)
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
            const tx = compoundIntegration.deposit(bAsset.address, amount, false)

            // Step 5. Check emitted events
            // 5.1 Check the Deposit event on the integration contract
            await expect(tx, "Deposit event from Compound Integration")
                .to.emit(compoundIntegration, "Deposit")
                .withArgs(bAsset.address, cToken.address, amount)

            // 5.2 Check the Transfer event on the cToken from the mint
            const newCTokens = await convertUnderlyingToCToken(cToken, amount)
            await expect(tx, "Transfer event from cToken")
                .to.emit(cToken, "Transfer")
                .withArgs(ZERO_ADDRESS, compoundIntegration.address, newCTokens)

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
            const tx = compoundIntegration.deposit(bAsset.address, firstTransferReceivedAmount, true)

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
            await expect(compoundIntegration.deposit(bAssetInvalid.address, simpleToExactAmount(10), false)).to.be.revertedWith(
                "cToken does not exist",
            )
        })
        it("should fail if we do not first pass the required bAsset", async () => {
            // Step 0. Choose tokens
            // const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const amount = BN.from(10).pow(12)
            // const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken)

            // Step 2. call deposit
            await expect(compoundIntegration.deposit(bAssets[0].address, amount, false)).to.be.revertedWith(
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
            await expect(compoundIntegration.deposit(bAsset.address, amountHigh.toString(), false)).to.be.revertedWith(
                "ERC20: transfer amount exceeds balance",
            )
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
            await expect(compoundIntegration.deposit(ZERO_ADDRESS, amount, false)).to.be.revertedWith("cToken does not exist")
            // Fails with ZERO Amount
            await expect(compoundIntegration.deposit(bAsset.address, 0, false)).to.be.revertedWith("Must deposit something")
            // Succeeds with Incorrect bool (defaults to false)
            const tx = compoundIntegration.deposit(bAsset.address, amount, undefined)

            // Check the Deposit event
            await expect(tx).to.emit(compoundIntegration, "Deposit").withArgs(bAsset.address, cToken.address, amount)
        })
    })
    describe("withdraw", () => {
        beforeEach("init mocks", async () => {
            await runSetup()
        })
        it("should withdraw tokens from Compound", async () => {
            // Step 1. Choose test tokens with no transfer fee
            const bAsset = bAssets[0]
            const cToken = cTokens[0]
            const bAssetDecimals = await bAsset.decimals()
            const depositAmount = simpleToExactAmount(10, bAssetDecimals)

            const bAssetsUserBalBefore = await bAsset.balanceOf(sa.default.address)
            const bAssetsBalInCTokenBefore = await bAsset.balanceOf(cToken.address)
            const cTokenBalInIntegrationBefore = await cToken.balanceOf(compoundIntegration.address)

            // Step 2. simulate transfer of bAssets to integration contract in mAsset mint
            await bAsset.transfer(compoundIntegration.address, depositAmount)
            expect(await bAsset.balanceOf(sa.default.address), "bAsset bal of user before").to.equal(
                bAssetsUserBalBefore.sub(depositAmount),
            )

            // Step 3. Simulate mAsset calling deposit
            const depositTx = compoundIntegration.deposit(bAsset.address, depositAmount, false)

            // 3.1 Check the Deposit event and balances after deposit
            await expect(depositTx, "Deposit event from Compound Integration")
                .to.emit(compoundIntegration, "Deposit")
                .withArgs(bAsset.address, cToken.address, depositAmount)

            // 3.2 Check bAssets in cToken contract
            expect(await bAsset.balanceOf(cToken.address), "bAsset bal in cToken after deposit").eq(
                bAssetsBalInCTokenBefore.add(depositAmount),
            )
            // 3.3 Check cTokens in compound integration contract
            const cTokensFromDepositExpected = await convertUnderlyingToCToken(cToken, depositAmount)
            expect(await cToken.balanceOf(compoundIntegration.address), "cTokens bal of integration after deposit").to.equal(
                cTokenBalInIntegrationBefore.add(cTokensFromDepositExpected),
            )

            // 4. Simulate mAsset calling withdraw on compound integration
            const withdrawalAmount = simpleToExactAmount(8, bAssetDecimals)
            const withdrawTx = compoundIntegration["withdraw(address,address,uint256,bool)"](
                sa.default.address,
                bAsset.address,
                withdrawalAmount,
                false,
            )
            const cTokenWithdrawalAmountExpected = await convertUnderlyingToCToken(cToken, withdrawalAmount)

            // 5.1 Check the PlatformWithdrawal event on the integration contract
            await expect(withdrawTx, "PlatformWithdrawal event from Compound Integration")
                .to.emit(compoundIntegration, "PlatformWithdrawal")
                .withArgs(bAsset.address, cToken.address, withdrawalAmount, withdrawalAmount)
            // 5.2 Check that bAsset has returned to the user
            const bAssetsUserBalAfter = await bAsset.balanceOf(sa.default.address)
            expect(bAssetsUserBalAfter, "bAsset bal of user after withdraw").to.equal(
                bAssetsUserBalBefore.sub(depositAmount).add(withdrawalAmount),
            )
            // 5.3 Check that bAsset has returned to the user
            const cTokenBalInIntegrationAfter = await cToken.balanceOf(compoundIntegration.address)
            expect(cTokenBalInIntegrationAfter, "cToken bal in cToken after withdraw").eq(
                cTokenBalInIntegrationBefore.add(cTokensFromDepositExpected).sub(cTokenWithdrawalAmountExpected),
            )
        })
        context("and specifying a minute amount of bAsset", () => {
            beforeEach(async () => {
                await runSetup(false, true)
            })
            it("should withdraw 0 if the cToken amount is 0", async () => {
                // Step 1. Choose test tokens with no transfer fee
                const bAsset = bAssets[0]
                const cToken = cTokens[0]
                const amount = BN.from(1)

                const recipientBassetBalBefore = await bAsset.balanceOf(sa.default.address)
                const integrationCTokenBalanceBefore = await cToken.balanceOf(compoundIntegration.address)

                const cTokenAmount = await convertUnderlyingToCToken(cToken, amount)
                expect(cTokenAmount, "cToken amount is not 0").eq(0)

                const tx = compoundIntegration["withdraw(address,address,uint256,bool)"](mAsset.address, bAsset.address, amount, false)

                await expect(tx).to.emit(compoundIntegration, "SkippedWithdrawal").withArgs(bAsset.address, amount)

                const recipientBassetBalAfter = await bAsset.balanceOf(sa.default.address)
                expect(recipientBassetBalBefore, "recipient bAsset bal is the same").eq(recipientBassetBalAfter)

                const integrationCTokenBalanceAfter = await cToken.balanceOf(compoundIntegration.address)
                expect(integrationCTokenBalanceBefore, "compoundIntegration cTokenBal is the same").eq(integrationCTokenBalanceAfter)
            })
            it("should function normally if bAsset decimals are low", async () => {
                // Step 1. Choose test tokens with no transfer fee
                const bAsset = bAssets[1]
                const cToken = cTokens[1]
                const amount = BN.from(1)

                expect(await bAsset.decimals(), "bAsset 6 decimals").eq(6)

                const recipientBassetBalBefore = await bAsset.balanceOf(sa.default.address)
                const integrationCTokenBalanceBefore = await cToken.balanceOf(compoundIntegration.address)

                const cTokenAmount = await convertUnderlyingToCToken(cToken, amount)
                expect(cTokenAmount, "cToken amount is 0").gt(0)

                const tx = compoundIntegration["withdraw(address,address,uint256,bool)"](mAsset.address, bAsset.address, amount, false)

                await expect(tx).to.emit(compoundIntegration, "PlatformWithdrawal").withArgs(bAsset.address, cToken.address, amount, amount)

                const recipientBassetBalAfter = await bAsset.balanceOf(sa.default.address)
                expect(recipientBassetBalAfter, "recipient bAsset bal is the same").eq(recipientBassetBalBefore)

                const integrationCTokenBalanceAfter = await cToken.balanceOf(compoundIntegration.address)
                expect(integrationCTokenBalanceAfter, "compoundIntegration cTokenBal is the same").eq(
                    integrationCTokenBalanceBefore.sub(cTokenAmount.div(2)),
                )
            })
        })
        it("should handle the tx fee calculations", async () => {
            await runSetup(true, true)
            // Step 0. Choose tokens with transfer fee on 3rd and 4th bAsset (index 2 and 3)
            const bAsset = bAssets[3]
            const cToken = cTokens[3]
            const amount = simpleToExactAmount(1)

            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1.address
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
            const compoundIntegrationBalBefore = await cToken.balanceOf(compoundIntegration.address)

            // Step 1. call withdraw
            await compoundIntegration["withdraw(address,address,uint256,bool)"](bAssetRecipient, bAsset.address, amount, true)
            const bAssetRecipientBalAfter = await bAsset.balanceOf(bAssetRecipient)
            const compoundIntegrationBalAfter = await cToken.balanceOf(compoundIntegration.address)

            // 99% of amt
            const scale = simpleToExactAmount("0.99", 18)
            const amountScaled = amount.mul(scale)
            const expectedAmount = amountScaled.div(fullScale)
            // Step 2. Validate recipient
            expect(bAssetRecipientBalAfter, "bAssetRecipientBalAfter >=").gte(bAssetRecipientBalBefore.add(expectedAmount))
            expect(bAssetRecipientBalAfter, "bAssetRecipientBalAfter <=").lte(bAssetRecipientBalBefore.add(amount))
            expect(compoundIntegrationBalAfter, "compoundIntegrationBalAfter").eq(
                compoundIntegrationBalBefore.sub(await convertUnderlyingToCToken(cToken, amount)),
            )
            const expectedBalance = compoundIntegrationBalBefore.sub(await convertUnderlyingToCToken(cToken, amount))
            assertBNSlightlyGTPercent(compoundIntegrationBalAfter, expectedBalance, "0.1")
            const underlyingBalanceExpected = await convertCTokenToUnderlying(cToken, compoundIntegrationBalAfter)
            // Cross that match with the `checkBalance` call
            const fetchedBalance = await compoundIntegration.callStatic.checkBalance(bAsset.address)
            expect(fetchedBalance, "checkBalance").eq(underlyingBalanceExpected)
        })
        it("should only allow the liquidity provider to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = bAssets[0]
            const amount = BN.from(10).pow(await bAsset.decimals())

            // Step 1. call deposit
            await expect(
                compoundIntegration
                    .connect(sa.dummy1.signer)
                    ["withdraw(address,address,uint256,bool)"](sa.dummy1.address, bAsset.address, amount, false),
            ).revertedWith("Only the LP can execute")
        })
        it("should fail if there is insufficient balance", async () => {
            // Step 0. Choose tokens
            const bAsset = bAssets[0]
            const bAssetDecimals = await bAsset.decimals()
            const amount = simpleToExactAmount(1000, bAssetDecimals)

            const tx = compoundIntegration["withdraw(address,address,uint256,bool)"](sa.default.address, bAsset.address, amount, false)
            // Step 1. call deposit
            await expect(tx).to.revertedWith("ERC20: burn amount exceeds balance")
        })

        it("should fail with broken arguments", async () => {
            // Step 1. Choose test tokens with no transfer fee
            const bAsset = bAssets[0]
            const cToken = cTokens[0]
            const bAssetDecimals = await bAsset.decimals()
            const amount = simpleToExactAmount(10, bAssetDecimals)

            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1.address

            // Fails with ZERO bAsset Address
            await expect(
                compoundIntegration["withdraw(address,address,uint256,bool)"](sa.dummy1.address, ZERO_ADDRESS, amount, false),
            ).revertedWith("cToken does not exist")

            // Fails with ZERO recipient address
            await expect(
                compoundIntegration["withdraw(address,address,uint256,bool)"](ZERO_ADDRESS, bAsset.address, BN.from(1), false),
            ).revertedWith("Must specify recipient")

            // Fails with ZERO Amount
            await expect(
                compoundIntegration["withdraw(address,address,uint256,bool)"](sa.dummy1.address, bAsset.address, "0", false),
            ).revertedWith("Must withdraw something")

            expect(await bAsset.balanceOf(bAssetRecipient), "recipient balance").to.eq(0)

            expect(await cToken.balanceOf(compoundIntegration.address), "integration balance").to.equal(0)
        })
    })
    describe("withdraw specific amount", async () => {
        describe("and the token does not have transfer fee", async () => {
            beforeEach("init mocks", async () => {
                await runSetup(false, true)
            })
            it("should allow withdrawal of X and give Y to the caller", async () => {
                // Step 0. Choose tokens
                const bAsset = bAssets[0]
                const aToken = cTokens[0]
                const amount = simpleToExactAmount(5)
                const totalAmount = amount.mul(2)
                // 0.1 Get balance before
                const bAssetRecipient = sa.dummy1.address
                const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
                const compoundIntegrationBalBefore = await bAsset.balanceOf(compoundIntegration.address)
                const compoundBalanceBefore = await compoundIntegration.callStatic.checkBalance(bAsset.address)

                // fail if called by non Bm or mAsset
                await expect(
                    compoundIntegration
                        .connect(sa.dummy1.signer)
                        ["withdraw(address,address,uint256,uint256,bool)"](bAssetRecipient, bAsset.address, amount, totalAmount, false),
                ).revertedWith("Only the LP can execute")

                // mAsset withdraws
                const tx = compoundIntegration["withdraw(address,address,uint256,uint256,bool)"](
                    bAssetRecipient,
                    bAsset.address,
                    amount,
                    totalAmount,
                    false,
                )

                // emit the event
                await expect(tx)
                    .to.emit(compoundIntegration, "PlatformWithdrawal")
                    .withArgs(bAsset.address, aToken.address, totalAmount, amount)

                const bAssetRecipientBalAfter = await bAsset.balanceOf(bAssetRecipient)
                const compoundIntegrationBalAfter = await bAsset.balanceOf(compoundIntegration.address)
                const compoundBalanceAfter = await compoundIntegration.callStatic.checkBalance(bAsset.address)
                expect(bAssetRecipientBalAfter).eq(bAssetRecipientBalBefore.add(amount))
                expect(compoundIntegrationBalAfter).eq(compoundIntegrationBalBefore.add(totalAmount.sub(amount)))
                const dust = compoundBalanceBefore.div(1000)
                assertBNSlightlyGT(compoundBalanceAfter, compoundBalanceBefore.sub(totalAmount), dust, false)
            })
        })
        describe("and the token has transfer fees", async () => {
            beforeEach("init mocks", async () => {
                await runSetup(true, true)
            })
            it("should fail if totalAmount != userAmount", async () => {
                const bAsset = bAssets[1]
                const amount = simpleToExactAmount(5, await bAsset.decimals())
                const totalAmount = amount.mul(2)
                await expect(
                    compoundIntegration["withdraw(address,address,uint256,uint256,bool)"](
                        sa.dummy1.address,
                        bAsset.address,
                        amount,
                        totalAmount,
                        true,
                    ),
                ).revertedWith("Cache inactive with tx fee")
            })
        })
    })
    describe("withdrawRaw", async () => {
        beforeEach("init mocks", async () => {
            await runSetup(false, true)
        })
        it("should fail if caller is not the liquidity provider", async () => {
            await expect(
                compoundIntegration.connect(sa.dummy1.signer).withdrawRaw(sa.dummy3.address, bAssets[0].address, BN.from(1)),
            ).revertedWith("Only the LP can execute")
        })
        it("should allow the mAsset or BM to withdraw a given bAsset", async () => {
            const bAsset = bAssets[0]
            const amount = simpleToExactAmount(5)

            await bAsset.transfer(compoundIntegration.address, amount)

            const bAssetRecipient = sa.dummy1.address
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
            const compoundIntegrationBalBefore = await bAsset.balanceOf(compoundIntegration.address)
            const compoundBalanceBefore = await compoundIntegration.callStatic.checkBalance(bAsset.address)

            const tx = compoundIntegration.withdrawRaw(bAssetRecipient, bAsset.address, amount)

            // Emits expected event
            await expect(tx).to.emit(compoundIntegration, "Withdrawal").withArgs(bAsset.address, ZERO_ADDRESS, amount)

            const bAssetRecipientBalAfter = await bAsset.balanceOf(bAssetRecipient)
            const compoundIntegrationBalAfter = await bAsset.balanceOf(compoundIntegration.address)
            const compoundBalanceAfter = await compoundIntegration.callStatic.checkBalance(bAsset.address)

            // Balances remain the same
            expect(bAssetRecipientBalAfter).eq(bAssetRecipientBalBefore.add(amount))
            expect(compoundIntegrationBalAfter).eq(compoundIntegrationBalBefore.sub(amount))
            expect(compoundBalanceAfter).eq(compoundBalanceBefore)
        })
        it("should fail if there is no balance in a given asset", async () => {
            await expect(compoundIntegration.withdrawRaw(sa.dummy3.address, bAssets[0].address, BN.from(1))).revertedWith(
                "ERC20: transfer amount exceeds balance",
            )
        })
        it("should fail if specified a 0 amount", async () => {
            await expect(compoundIntegration.withdrawRaw(sa.dummy3.address, bAssets[0].address, BN.from(0))).revertedWith(
                "Must withdraw something",
            )
        })
    })
    describe("checkBalance", async () => {
        beforeEach(async () => {
            await runSetup(false, true)
        })
        it("should return balance for any caller when supported token address passed", async () => {
            const bAsset = bAssets[0]

            const expectedBal = simpleToExactAmount(10)

            const fetchedBalance = await compoundIntegration.callStatic.checkBalance(bAsset.address)

            assertBNClose(fetchedBalance, expectedBal, BN.from(100))
        })
        it("should fail if called with inactive token", async () => {
            await expect(compoundIntegration.callStatic.checkBalance(sa.dummy1.address)).revertedWith("cToken does not exist")
        })
    })
    describe("reApproveAllTokens", async () => {
        before(async () => {
            await runSetup(true)
        })
        it("should re-approve ALL bAssets with aTokens", async () => {
            let allowance = await bAssets[0].allowance(compoundIntegration.address, cTokens[0].address)
            expect(MAX_UINT256).to.equal(allowance)

            allowance = await bAssets[1].allowance(compoundIntegration.address, cTokens[1].address)
            expect(MAX_UINT256).to.equal(allowance)

            await compoundIntegration.connect(sa.governor.signer).reApproveAllTokens()

            allowance = await bAssets[0].allowance(compoundIntegration.address, cTokens[0].address)
            expect(MAX_UINT256).to.equal(allowance)

            allowance = await bAssets[1].allowance(compoundIntegration.address, cTokens[1].address)
            expect(MAX_UINT256).to.equal(allowance)
        })
        it("should only be callable by the Governor", async () => {
            // Fail when not called by the Governor
            await expect(compoundIntegration.connect(sa.dummy1.signer).reApproveAllTokens()).revertedWith("Only governor can execute")

            // Succeed when called by the Governor
            compoundIntegration.connect(sa.governor.signer).reApproveAllTokens()
        })
        it("should be able to be called multiple times", async () => {
            let allowance = await bAssets[0].allowance(compoundIntegration.address, cTokens[0].address)
            expect(MAX_UINT256).to.equal(allowance)
            allowance = await bAssets[3].allowance(compoundIntegration.address, cTokens[3].address)
            expect(MAX_UINT256).to.equal(allowance)

            compoundIntegration.connect(sa.governor.signer).reApproveAllTokens()

            compoundIntegration.connect(sa.governor.signer).reApproveAllTokens()

            allowance = await bAssets[0].allowance(compoundIntegration.address, cTokens[0].address)
            expect(MAX_UINT256).to.equal(allowance)
            allowance = await bAssets[3].allowance(compoundIntegration.address, cTokens[3].address)
            expect(MAX_UINT256).to.equal(allowance)
        })
    })
})
