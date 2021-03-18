import { ethers } from "hardhat"
import { expect } from "chai"

import { assertBNSlightlyGT, assertBNSlightlyGTPercent, assertBNClose } from "@utils/assertions"
import { simpleToExactAmount, BN } from "@utils/math"
import { increaseTime } from "@utils/time"
import { MassetMachine, StandardAccounts, Account } from "@utils/machines"

import { MAX_UINT256, ZERO_ADDRESS, TEN_MINS } from "@utils/constants"
import {
    MockNexus__factory,
    MockNexus,
    MockAaveV2__factory,
    AaveV2Integration,
    AaveV2Integration__factory,
    MockERC20__factory,
    MockATokenV2__factory,
    ILendingPoolAddressesProviderV2__factory,
    MockERC20,
    MockATokenV2,
} from "types/generated"
import { BassetIntegrationDetails } from "types"
import { shouldBehaveLikeModule, IModuleBehaviourContext } from "../../shared/Module.behaviour"

describe("AaveIntegration", async () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine

    let nexus: MockNexus
    let mAsset: Account

    let integrationDetails: BassetIntegrationDetails
    let aaveIntegration: AaveV2Integration

    const ctx: Partial<IModuleBehaviourContext> = {}

    const runSetup = async (enableUSDTFee = false, simulateMint = false) => {
        // SETUP
        // ======
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, sa.mockSavingsManager.address)
        // Load network specific integration data
        integrationDetails = await mAssetMachine.loadBassetsLocal(true, enableUSDTFee, mAsset.address)
        // Initialize the proxy
        aaveIntegration = await new AaveV2Integration__factory(sa.default.signer).deploy(
            nexus.address,
            mAsset.address,
            integrationDetails.aavePlatformAddress,
        )
        await Promise.all(
            integrationDetails.aTokens.map((a) => aaveIntegration.connect(sa.governor.signer).setPTokenAddress(a.bAsset, a.aToken)),
        )

        if (simulateMint) {
            await Promise.all(
                integrationDetails.aTokens.map(async ({ bAsset }) => {
                    // Step 0. Choose tokens
                    const b1 = await new MockERC20__factory(mAsset.signer).attach(bAsset)
                    const decimals = BN.from(await b1.decimals())
                    const amount = BN.from(enableUSDTFee ? 101 : 100).mul(BN.from(10).pow(decimals.sub(BN.from(1))))
                    const amountD = BN.from(100).mul(BN.from(10).pow(decimals.sub(BN.from(1))))
                    // Step 1. xfer tokens to integration
                    await b1.transfer(aaveIntegration.address, amount.toString())
                    // Step 2. call deposit
                    return aaveIntegration.connect(mAsset.signer).deposit(bAsset, amountD.toString(), true)
                }),
            )
        }
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        mAsset = sa.default

        await runSetup()
    })

    describe("AaveIntegration constructor", async () => {
        describe("behave like a Module", async () => {
            beforeEach(async () => {
                await runSetup()
                ctx.module = aaveIntegration
                ctx.sa = sa
            })
            shouldBehaveLikeModule(ctx as IModuleBehaviourContext)
        })

        it("should properly store valid arguments", async () => {
            // Check for nexus addr
            expect(await aaveIntegration.nexus()).eq(nexus.address)
            expect(await aaveIntegration.mAssetAddress()).eq(mAsset.address)
            // check for platform addr
            expect(await aaveIntegration.platformAddress()).eq(integrationDetails.aavePlatformAddress) // check for pTokens added & events
            expect(integrationDetails.aTokens[0].aToken).eq(await aaveIntegration.bAssetToPToken(integrationDetails.aTokens[0].bAsset))
            expect(integrationDetails.aTokens[1].aToken).eq(await aaveIntegration.bAssetToPToken(integrationDetails.aTokens[1].bAsset))
        })

        it("should fail when mAsset address invalid", async () => {
            await expect(
                new AaveV2Integration__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS, sa.other.address),
            ).to.be.revertedWith("Invalid mAsset address")
        })

        it("should approve spending of the passed bAssets", async () => {
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const addressProvider = await ILendingPoolAddressesProviderV2__factory.connect(
                integrationDetails.aavePlatformAddress,
                sa.default.signer,
            )
            const approvedAddress = await addressProvider.getLendingPool()
            const balance = await bAsset.allowance(aaveIntegration.address, approvedAddress)
            expect(balance).eq(MAX_UINT256)
        })

        it("should fail if passed incorrect data", async () => {
            await expect(
                new AaveV2Integration__factory(sa.default.signer).deploy(nexus.address, mAsset.address, ZERO_ADDRESS),
            ).to.be.revertedWith("Invalid platform address")
        })
    })

    describe("setting P Token Address", async () => {
        let erc20Mock: MockERC20
        let aTokenMock: MockATokenV2
        beforeEach("init mocks", async () => {
            erc20Mock = await new MockERC20__factory(sa.default.signer).deploy("TMP", "TMP", 18, sa.default.address, "1000000")
            aTokenMock = await new MockATokenV2__factory(sa.default.signer).deploy(sa.other.address, erc20Mock.address)
            await runSetup()
        })
        it("should pass only when function called by the Governor", async () => {
            await expect(aaveIntegration.setPTokenAddress(erc20Mock.address, aTokenMock.address)).to.be.revertedWith(
                "Only governor can execute",
            )
            await aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, aTokenMock.address)
            expect(aTokenMock.address).eq(await aaveIntegration.bAssetToPToken(erc20Mock.address))
        })
        it("should approve the spending of the bAsset correctly and emit event", async () => {
            await aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, aTokenMock.address)
            expect(aTokenMock.address).eq(await aaveIntegration.bAssetToPToken(erc20Mock.address))
            const addressProvider = await ILendingPoolAddressesProviderV2__factory.connect(
                integrationDetails.aavePlatformAddress,
                sa.default.signer,
            )
            const approvedAddress = await addressProvider.getLendingPool()
            const balance = await erc20Mock.allowance(aaveIntegration.address, approvedAddress)
            expect(balance).eq(MAX_UINT256)
        })
        it("should fail when passed invalid args", async () => {
            // bAsset address is zero
            await expect(aaveIntegration.connect(sa.governor.signer).setPTokenAddress(ZERO_ADDRESS, aTokenMock.address)).to.be.revertedWith(
                "Invalid addresses",
            )
            // pToken address is zero
            await expect(aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, ZERO_ADDRESS)).to.be.revertedWith(
                "Invalid addresses",
            )
            // pToken address already assigned for a bAsset
            await aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, aTokenMock.address)
            await expect(
                aaveIntegration.connect(sa.governor.signer).setPTokenAddress(erc20Mock.address, sa.default.address),
            ).to.be.revertedWith("pToken already set")
        })
    })

    describe("calling deposit", async () => {
        beforeEach("init mocks", async () => {
            await runSetup()
        })
        it("should deposit tokens to Aave", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).pow(bAssetDecimals)
            const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken)
            // 0.1 Get balance before
            const addressProvider = await ILendingPoolAddressesProviderV2__factory.connect(
                integrationDetails.aavePlatformAddress,
                sa.default.signer,
            )
            const bAssetRecipient = await addressProvider.getLendingPool()
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address)
            // Cross that match with the `checkBalance` call
            let directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            expect(directBalance).eq(aaveIntegrationBalBefore)

            // Step 1. xfer tokens to integration
            await bAsset.transfer(aaveIntegration.address, amount.toString())

            // Step 2. call deposit
            const tx = aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amount.toString(), false)

            // Step 3. Check for things:
            // 3.0 Check that return value is cool (via event)
            await expect(tx)
                .to.emit(aaveIntegration, "Deposit")
                .withArgs(bAsset.address, aToken.address, amount)
            await (await tx).wait()
            // 3.1 Check that lending pool has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(amount))
            // 3.2 Check that aave integration has aTokens
            const expectedBalance = aaveIntegrationBalBefore.add(amount)
            const actualBalance = await aToken.balanceOf(aaveIntegration.address)
            assertBNSlightlyGTPercent(actualBalance, expectedBalance)
            // Cross that match with the `checkBalance` call
            directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            expect(directBalance).eq(actualBalance)
            // Assert that Balance goes up over time
            await increaseTime(TEN_MINS)
            const newBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            assertBNSlightlyGTPercent(newBalance, directBalance, "0.0001", false)
        })

        it("should handle the fee calculations", async () => {
            // Step 0. Choose tokens and set up env
            await runSetup(true)

            const addressProvider = await ILendingPoolAddressesProviderV2__factory.connect(
                integrationDetails.aavePlatformAddress,
                sa.default.signer,
            )
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[2].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).pow(bAssetDecimals)
            const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[2].aToken)

            // 0.1 Get balance before
            const bAssetRecipient = await addressProvider.getLendingPool()
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address)
            // Cross that match with the `checkBalance` call
            let directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            expect(directBalance).eq(aaveIntegrationBalBefore)

            // Step 1. xfer tokens to integration
            const bal1 = await bAsset.balanceOf(aaveIntegration.address)
            await bAsset.transfer(aaveIntegration.address, amount.toString())

            const bal2 = await bAsset.balanceOf(aaveIntegration.address)
            const receivedAmount = bal2.sub(bal1)
            // Ensure fee is being deducted
            expect(receivedAmount).lt(amount as any)
            // fee = initialAmount - receivedAmount
            const fee = amount.sub(receivedAmount)
            // feeRate = fee/amount (base 1e18)
            const feeRate = fee.mul(simpleToExactAmount(1)).div(amount)
            // expectedDepoit = receivedAmount - (receivedAmount*feeRate)
            const expectedDeposit = receivedAmount.sub(receivedAmount.mul(feeRate).div(simpleToExactAmount(1)))

            // Step 2. call deposit
            const tx = await aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, receivedAmount.toString(), true)

            // Step 3. Check for things:
            const aaveIntegrationBalAfter = await aToken.balanceOf(aaveIntegration.address)
            // 3.1 Check that lending pool has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(expectedDeposit))
            // 3.2 Check that aave integration has aTokens
            assertBNClose(aaveIntegrationBalAfter, aaveIntegrationBalBefore.add(expectedDeposit), fee)
            // Cross that match with the `checkBalance` call
            directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            expect(directBalance).eq(aaveIntegrationBalAfter)
        })
        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset)
            const amount = BN.from(10).pow(BN.from(12))

            // Step 1. call deposit
            await expect(aaveIntegration.connect(sa.dummy1.signer).deposit(bAsset.address, amount.toString(), false)).to.be.revertedWith(
                "Only the mAsset can execute",
            )
        })
        it("should fail if the bAsset is not supported", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).deploy("MK1", "MK", 12, sa.default.address, 100000)
            const amount = BN.from(10).pow(BN.from(12))

            // Step 1. call deposit
            await expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amount.toString(), false)).to.be.revertedWith(
                "aToken does not exist",
            )
        })
        it("should fail if we do not first pass the required bAsset", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const amount = BN.from(10).pow(BN.from(12))
            const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken)

            // Step 2. call deposit
            await expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amount.toString(), false)).to.be.revertedWith(
                "ERC20: transfer amount exceeds balance",
            )
        })
        it("should fail if we try to deposit too much", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).mul(BN.from(10).pow(bAssetDecimals))
            const amountHigh = BN.from(11).mul(BN.from(10).pow(bAssetDecimals))
            const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[1].aToken)

            // Step 1. xfer low tokens to integration
            await bAsset.transfer(aaveIntegration.address, amount.toString())
            expect(await bAsset.balanceOf(aaveIntegration.address)).lte(amount as any)
            // Step 2. call deposit with high tokens
            await expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amountHigh.toString(), false)).to.be.revertedWith(
                "ERC20: transfer amount exceeds balance",
            )
        })
        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).pow(bAssetDecimals)
            const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken)

            // 0.1 Get balance before
            const addressProvider = await ILendingPoolAddressesProviderV2__factory.connect(
                integrationDetails.aavePlatformAddress,
                sa.default.signer,
            )
            const bAssetRecipient = await addressProvider.getLendingPool()
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address)

            // Step 1. xfer low tokens to integration
            await bAsset.transfer(aaveIntegration.address, amount.toString())

            // Fails with ZERO bAsset Address
            await expect(aaveIntegration.connect(mAsset.signer).deposit(ZERO_ADDRESS, amount.toString(), false)).to.be.revertedWith(
                "aToken does not exist",
            )
            // Fails with ZERO Amount
            await expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, "0", false)).to.be.revertedWith(
                "Must deposit something",
            )
            // Succeeds with Incorrect bool (defaults to false)
            const tx = await aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, amount.toString(), undefined)

            // Step 3. Check for things:
            // 3.1 Check that lending pool has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(amount))
            // 3.2 Check that aave integration has aTokens
            const newBal = await aToken.balanceOf(aaveIntegration.address)
            assertBNSlightlyGT(newBal, aaveIntegrationBalBefore.add(amount), BN.from("1000"))
            // Cross that match with the `checkBalance` call
            const directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            expect(directBalance).eq(newBal)

            // 3.3 Check that return value is cool (via event)
            // expectEvent(tx.receipt, "Deposit", { _amount: amount })
        })
        it("should fail if lending pool does not exist", async () => {
            // Can only run on local, due to constraints from Aave
            const mockAave = await new MockAaveV2__factory(sa.default.signer).attach(integrationDetails.aavePlatformAddress)
            await mockAave.breakLendingPools()
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset)
            await bAsset.transfer(aaveIntegration.address, "1")
            // Fails with ZERO Amount
            await expect(aaveIntegration.connect(mAsset.signer).deposit(bAsset.address, "1", false)).to.be.revertedWith(
                "Lending pool does not exist",
            )
        })
    })

    describe("withdraw", async () => {
        beforeEach("init mocks", async () => {
            await runSetup(false, true)
        })
        it("should withdraw tokens from Aave", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).pow(bAssetDecimals)
            const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken)
            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1.address
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address)

            // Step 1. call withdraw
            const tx = await aaveIntegration["withdraw(address,address,uint256,bool)"](
                bAssetRecipient,
                bAsset.address,
                amount.toString(),
                false,
            )

            // Step 2. Check for things:
            // 2.1 Check that the recipient receives the tokens
            expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(amount))
            // 2.2 Check that integration aToken balance has gone down
            const actualBalance = await aToken.balanceOf(aaveIntegration.address)
            const expectedBalance = aaveIntegrationBalBefore.sub(amount)
            assertBNSlightlyGTPercent(actualBalance, expectedBalance, "0.001", false)
            // Cross that match with the `checkBalance` call
            const directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            expect(directBalance).eq(actualBalance)
            // Assert that Balance goes up over time
            await increaseTime(TEN_MINS)
            const newBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            assertBNSlightlyGTPercent(newBalance, directBalance, "0.001", false)
            // 2.3 Should give accurate return value
            // expectEvent(tx.receipt, "PlatformWithdrawal", {
            //     bAsset: bAsset.address,
            //     totalAmount: amount,
            //     userAmount: amount,
            // })
        })

        it("should handle the fee calculations", async () => {
            await runSetup(true, true)
            // should deduct the transfer fee from the return value
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).pow(bAssetDecimals)
            const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[1].aToken)

            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1.address
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address)

            // Step 1. call withdraw
            const tx = await aaveIntegration["withdraw(address,address,uint256,bool)"](
                bAssetRecipient,
                bAsset.address,
                amount.toString(),
                true,
            )
            const bAssetRecipientBalAfter = await bAsset.balanceOf(bAssetRecipient)
            const aaveIntegrationBalAfter = await aToken.balanceOf(aaveIntegration.address)

            // 99% of amt
            const scale = simpleToExactAmount("0.99", 18)
            const amountScaled = amount.mul(scale)
            const expectedAmount = amountScaled.div(simpleToExactAmount(1))
            // Step 2. Validate recipient
            expect(bAssetRecipientBalAfter).gte(bAssetRecipientBalBefore.add(expectedAmount) as any)
            expect(bAssetRecipientBalAfter).lte(bAssetRecipientBalBefore.add(amount) as any)
            expect(aaveIntegrationBalAfter).eq(aaveIntegrationBalBefore.sub(amount) as any)
            const expectedBalance = aaveIntegrationBalBefore.sub(amount)
            assertBNSlightlyGT(aaveIntegrationBalAfter, expectedBalance, BN.from("100"))
            // Cross that match with the `checkBalance` call
            const directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            expect(directBalance).eq(expectedBalance)
        })

        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).pow(bAssetDecimals)

            // Step 1. call deposit
            await expect(
                aaveIntegration
                    .connect(sa.dummy1.signer)
                    ["withdraw(address,address,uint256,bool)"](sa.dummy1.address, bAsset.address, amount.toString(), false),
            ).to.be.revertedWith("Only the mAsset can execute")
        })
        it("should fail if there is insufficient balance", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(1000).mul(BN.from(10).pow(bAssetDecimals))

            // Step 1. call deposit
            await expect(
                aaveIntegration["withdraw(address,address,uint256,bool)"](sa.default.address, bAsset.address, amount.toString(), false),
            ).to.be.revertedWith("ERC20: burn amount exceeds balance")
        })
        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = BN.from(10).pow(bAssetDecimals)
            const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken)

            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1.address
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
            const aaveIntegrationBalBefore = await aToken.balanceOf(aaveIntegration.address)

            // Fails with ZERO bAsset Address
            await expect(
                aaveIntegration["withdraw(address,address,uint256,bool)"](sa.dummy1.address, ZERO_ADDRESS, amount.toString(), false),
            ).to.be.revertedWith("aToken does not exist")
            // Fails with ZERO recipient address
            await expect(aaveIntegration["withdraw(address,address,uint256,bool)"](ZERO_ADDRESS, bAsset.address, BN.from(1), false)).to.be
                .reverted

            // Fails with ZERO Amount
            await expect(
                aaveIntegration["withdraw(address,address,uint256,bool)"](sa.dummy1.address, bAsset.address, "0", false),
            ).to.be.revertedWith("Must withdraw something")
            // Succeeds with Incorrect bool (defaults to false)
            const tx = await aaveIntegration["withdraw(address,address,uint256,bool)"](
                sa.dummy1.address,
                bAsset.address,
                amount.toString(),
                undefined,
            )

            // 2.1 Check that the recipient receives the tokens
            expect(await bAsset.balanceOf(bAssetRecipient)).eq(bAssetRecipientBalBefore.add(amount))
            // 2.2 Check that integration aToken balance has gone down
            const currentBalance = await aToken.balanceOf(aaveIntegration.address)
            assertBNSlightlyGTPercent(currentBalance, aaveIntegrationBalBefore.sub(amount), "0.0001", false)
            // 2.3 Should give accurate return value
            // expectEvent(tx.receipt, "PlatformWithdrawal", {
            //     bAsset: bAsset.address,
            //     totalAmount: amount,
            //     userAmount: amount,
            // })
        })
        it("should fail if the bAsset is not supported", async () => {
            // Step 0. Choose tokens
            const bAsset = await mAssetMachine.loadBassetProxy("MK", "MK", 12)
            const amount = BN.from(10).pow(BN.from(12))

            // Step 1. call withdraw
            await expect(
                aaveIntegration["withdraw(address,address,uint256,bool)"](sa.dummy1.address, bAsset.address, amount.toString(), false),
            ).to.be.revertedWith("aToken does not exist")
        })
    })

    describe("withdraw specific amount", async () => {
        describe("and the token does not have transfer fee", async () => {
            beforeEach("init mocks", async () => {
                await runSetup(false, true)
            })
            it("should allow withdrawal of X and give Y to the caller", async () => {
                // Step 0. Choose tokens
                const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
                const bAssetDecimals = await bAsset.decimals()
                const amount = simpleToExactAmount(5, bAssetDecimals)
                const totalAmount = amount.mul(2)
                const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken)
                // 0.1 Get balance before
                const bAssetRecipient = sa.dummy1.address
                const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
                const aaveIntegrationBalBefore = await bAsset.balanceOf(aaveIntegration.address)
                const aaveBalanceBefore = await aaveIntegration.callStatic.checkBalance(bAsset.address)

                // fail if called by non Bm or mAsset
                await expect(
                    aaveIntegration
                        .connect(sa.dummy1.signer)
                        ["withdraw(address,address,uint256,uint256,bool)"](bAssetRecipient, bAsset.address, amount, totalAmount, false),
                ).to.be.revertedWith("Only the mAsset can execute")
                // send the amount
                const tx = await aaveIntegration["withdraw(address,address,uint256,uint256,bool)"](
                    bAssetRecipient,
                    bAsset.address,
                    amount,
                    totalAmount,
                    false,
                )
                const bAssetRecipientBalAfter = await bAsset.balanceOf(bAssetRecipient)
                const aaveIntegrationBalAfter = await bAsset.balanceOf(aaveIntegration.address)
                const aaveBalanceAfter = await aaveIntegration.callStatic.checkBalance(bAsset.address)
                expect(bAssetRecipientBalAfter).eq(bAssetRecipientBalBefore.add(amount))
                expect(aaveIntegrationBalAfter).eq(aaveIntegrationBalBefore.add(totalAmount.sub(amount)))
                expect(aaveBalanceAfter).eq(aaveBalanceBefore.sub(totalAmount))
                // emit the event
                // expectEvent(tx.receipt, "PlatformWithdrawal", {
                //     bAsset: bAsset.address,
                //     pToken: aToken.address,
                //     totalAmount: totalAmount,
                //     userAmount: amount,
                // })
            })
        })
        describe("and the token has transfer fees", async () => {
            beforeEach("init mocks", async () => {
                await runSetup(true, true)
            })
            it("should fail if totalAmount != userAmount", async () => {
                const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[1].bAsset)
                const bAssetDecimals = await bAsset.decimals()
                const amount = simpleToExactAmount(5, bAssetDecimals)
                const totalAmount = amount.mul(2)
                await expect(
                    aaveIntegration["withdraw(address,address,uint256,uint256,bool)"](
                        sa.dummy1.address,
                        bAsset.address,
                        amount,
                        totalAmount,
                        true,
                    ),
                ).to.be.revertedWith("Cache inactive for assets with fee")
            })
        })
    })

    describe("withdrawRaw", async () => {
        beforeEach("init mocks", async () => {
            await runSetup(false, true)
        })
        it("should fail if caller is not whitelisetd", async () => {
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            await expect(
                aaveIntegration.connect(sa.dummy1.signer).withdrawRaw(sa.dummy3.address, bAsset.address, BN.from(1)),
            ).to.be.revertedWith("Only the mAsset can execute")
        })
        it("should allow the mAsset or BM to withdraw a given bAsset", async () => {
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const bAssetDecimals = await bAsset.decimals()
            const amount = simpleToExactAmount(5, bAssetDecimals)

            await bAsset.transfer(aaveIntegration.address, amount)

            const bAssetRecipient = sa.dummy1.address
            const bAssetRecipientBalBefore = await bAsset.balanceOf(bAssetRecipient)
            const aaveIntegrationBalBefore = await bAsset.balanceOf(aaveIntegration.address)
            const aaveBalanceBefore = await aaveIntegration.callStatic.checkBalance(bAsset.address)

            const tx = await aaveIntegration.connect(mAsset.signer).withdrawRaw(bAssetRecipient, bAsset.address, amount)

            const bAssetRecipientBalAfter = await bAsset.balanceOf(bAssetRecipient)
            const aaveIntegrationBalAfter = await bAsset.balanceOf(aaveIntegration.address)
            const aaveBalanceAfter = await aaveIntegration.callStatic.checkBalance(bAsset.address)

            // Balances remain the same
            expect(bAssetRecipientBalAfter).eq(bAssetRecipientBalBefore.add(amount))
            expect(aaveIntegrationBalAfter).eq(aaveIntegrationBalBefore.sub(amount))
            expect(aaveBalanceAfter).eq(aaveBalanceBefore)

            // Emits expected event
            // expectEvent(tx.receipt, "Withdrawal", {
            //     _bAsset: bAsset.address,
            //     _pToken: ZERO_ADDRESS,
            //     _amount: amount,
            // })
        })
        it("should fail if there is no balance in a given asset", async () => {
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            await expect(
                aaveIntegration.connect(mAsset.signer).withdrawRaw(sa.dummy3.address, bAsset.address, BN.from(1)),
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
        })
        it("should fail if specified a 0 amount", async () => {
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            await expect(
                aaveIntegration.connect(mAsset.signer).withdrawRaw(sa.dummy3.address, bAsset.address, BN.from(0)),
            ).to.be.revertedWith("Must withdraw something")
        })
    })

    // See deposit and withdraw tests for basic balance checking
    describe("checkBalance", async () => {
        it("should return balance for any caller when supported token address passed", async () => {
            const bAsset = await new MockERC20__factory(sa.default.signer).attach(integrationDetails.aTokens[0].bAsset)
            const aToken = await new MockATokenV2__factory(sa.default.signer).attach(integrationDetails.aTokens[0].aToken)

            const aaveIntegrationBal = await aToken.balanceOf(aaveIntegration.address)
            // Cross that match with the `checkBalance` call
            const directBalance = await aaveIntegration.callStatic.checkBalance(bAsset.address)
            expect(directBalance).eq(aaveIntegrationBal)
        })

        it("should fail if called with inactive token", async () => {
            const bAsset = await mAssetMachine.loadBassetProxy("MK", "MK1", 12)

            await expect(aaveIntegration.checkBalance(bAsset.address)).to.be.revertedWith("aToken does not exist")
        })
    })
})
