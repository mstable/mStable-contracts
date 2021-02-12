import { ethers } from "hardhat"
import { expect } from "chai"
import { simpleToExactAmount, BN } from "@utils/math"
import { assertBNClose, assertBNClosePercent } from "@utils/assertions"
import { StandardAccounts, MassetDetails, MassetMachine, Account } from "@utils/machines"
import { fullScale, ZERO_ADDRESS, ZERO, MAX_UINT256, ONE_DAY, ONE_HOUR } from "@utils/constants"
import {
    SavingsContract,
    MockERC20__factory,
    MockConnector__factory,
    MockNexus__factory,
    MockNexus,
    MockMasset,
    MockMasset__factory,
    SavingsContract__factory,
    MockSavingsManager__factory,
    AssetProxy__factory,
    MockErroneousConnector1__factory,
    MockErroneousConnector2__factory,
    MockLendingConnector__factory,
    MockVaultConnector__factory,
    MockLendingConnector,
    MockVaultConnector,
} from "types/generated"
import { shouldBehaveLikeModule, IModuleBehaviourContext } from "../shared/Module.behaviour"

interface Balances {
    totalCredits: BN
    userCredits: BN
    user: BN
    contract: BN
}

interface ConnectorData {
    lastPoke: BN
    lastBalance: BN
    fraction: BN
    address: string
    balance: BN
}

interface Data {
    balances: Balances
    exchangeRate: BN
    connector: ConnectorData
}

interface ExpectedPoke {
    aboveMax: boolean
    type: "deposit" | "withdraw" | "none"
    amount: BN
    ideal: BN
}

const underlyingToCredits = (amount: BN | number, exchangeRate: BN): BN => BN.from(amount).mul(fullScale).div(exchangeRate).add(1)

const creditsToUnderlying = (amount: BN, exchangeRate: BN): BN => amount.mul(exchangeRate).div(fullScale)

const getData = async (contract: SavingsContract, user: Account): Promise<Data> => {
    const mAsset = await (await new MockERC20__factory(user.signer)).attach(await contract.underlying())
    const connectorAddress = await contract.connector()
    let connectorBalance = BN.from(0)
    if (connectorAddress !== ZERO_ADDRESS) {
        const connector = await (await new MockConnector__factory(user.signer)).attach(connectorAddress)
        connectorBalance = await connector.checkBalance()
    }
    return {
        balances: {
            totalCredits: await contract.totalSupply(),
            userCredits: await contract.balanceOf(user.address),
            user: await mAsset.balanceOf(user.address),
            contract: await mAsset.balanceOf(contract.address),
        },
        exchangeRate: await contract.exchangeRate(),
        connector: {
            lastPoke: await contract.lastPoke(),
            lastBalance: await contract.lastBalance(),
            fraction: await contract.fraction(),
            address: connectorAddress,
            balance: connectorBalance,
        },
    }
}

const getExpectedPoke = (data: Data, withdrawCredits: BN = BN.from(0)): ExpectedPoke => {
    const { balances, connector, exchangeRate } = data
    const totalCollat = creditsToUnderlying(balances.totalCredits.sub(withdrawCredits), exchangeRate)
    const connectorDerived = balances.contract.gt(totalCollat) ? BN.from(0) : totalCollat.sub(balances.contract)
    const max = totalCollat.mul(connector.fraction.add(simpleToExactAmount(2, 17))).div(fullScale)
    const ideal = totalCollat.mul(connector.fraction).div(fullScale)
    return {
        aboveMax: connectorDerived.gt(max),
        type: connector.balance.eq(ideal) ? "none" : connector.balance.gt(ideal) ? "withdraw" : "deposit",
        amount: connector.balance.gte(ideal) ? connector.balance.sub(ideal) : ideal.sub(connector.balance),
        ideal,
    }
}

const getTimestamp = async (): Promise<number> => (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

/**
 * @notice Returns bool to signify whether the total collateral held is redeemable
 */
const exchangeRateHolds = (data: Data): boolean => {
    const { balances, connector, exchangeRate } = data
    const collateral = balances.contract.add(connector.balance)
    return collateral.gte(creditsToUnderlying(balances.totalCredits, exchangeRate))
}

describe("SavingsContract", async () => {
    let sa: StandardAccounts
    let manager: Account
    let alice: Account
    let bob: Account
    const ctx: Partial<IModuleBehaviourContext> = {}
    const initialExchangeRate = simpleToExactAmount(1, 17)

    let mAssetMachine: MassetMachine

    let savingsContract: SavingsContract
    let savingsFactory: SavingsContract__factory
    let connectorFactory: MockConnector__factory
    let nexus: MockNexus
    let masset: MockMasset

    const createNewSavingsContract = async (): Promise<void> => {
        // Use a mock Nexus so we can dictate addresses
        nexus = await (await new MockNexus__factory(sa.default.signer)).deploy(sa.governor.address, manager.address)
        // Use a mock mAsset so we can dictate the interest generated
        masset = await (await new MockMasset__factory(sa.default.signer)).deploy("MOCK", "MOCK", 18, sa.default.address, 1000000000)

        savingsFactory = await new SavingsContract__factory(sa.default.signer)
        const impl = await savingsFactory.deploy(nexus.address, masset.address)
        const data = impl.interface.encodeFunctionData("initialize", [sa.default.address, "Savings Credit", "imUSD"])
        const proxy = await (await new AssetProxy__factory(sa.default.signer)).deploy(impl.address, sa.dummy4.address, data)
        savingsContract = await savingsFactory.attach(proxy.address)

        // Use a mock SavingsManager so we don't need to run integrations
        const mockSavingsManager = await (await new MockSavingsManager__factory(sa.default.signer)).deploy(savingsContract.address)
        await nexus.setSavingsManager(mockSavingsManager.address)
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        manager = sa.dummy2
        alice = sa.default
        bob = sa.dummy3
        connectorFactory = await new MockConnector__factory(sa.default.signer)
        await createNewSavingsContract()
    })

    describe("behaviors", async () => {
        describe("behave like a Module", async () => {
            beforeEach(async () => {
                await createNewSavingsContract()
                ctx.module = savingsContract
                ctx.sa = sa
            })
            shouldBehaveLikeModule(ctx as IModuleBehaviourContext)
        })
    })

    describe("constructor", async () => {
        it("should fail when masset address is zero", async () => {
            await expect(savingsFactory.deploy(nexus.address, ZERO_ADDRESS)).to.be.revertedWith("mAsset address is zero")

            savingsContract = await savingsFactory.deploy(nexus.address, masset.address)
            await expect(savingsContract.initialize(ZERO_ADDRESS, "Savings Credit", "imUSD")).to.be.revertedWith("Invalid poker address")
        })

        it("should succeed and set valid parameters", async () => {
            await createNewSavingsContract()
            const nexusAddr = await savingsContract.nexus()
            expect(nexus.address).to.equal(nexusAddr)
            const pokerAddr = await savingsContract.poker()
            expect(sa.default.address).to.equal(pokerAddr)
            const { balances, exchangeRate, connector } = await getData(savingsContract, sa.default)
            expect(simpleToExactAmount(2, 17)).to.equal(connector.fraction)
            const underlyingAddr = await savingsContract.underlying()
            expect(masset.address).to.equal(underlyingAddr)
            expect(ZERO).to.equal(balances.totalCredits)
            expect(ZERO).to.equal(balances.contract)
            expect(initialExchangeRate).to.equal(exchangeRate)
            const name = await savingsContract.name()
            expect("Savings Credit").to.equal(name)
        })
    })

    describe("setting automateInterestCollection Flag", async () => {
        it("should fail when not called by governor", async () => {
            await expect(savingsContract.connect(sa.default.signer).automateInterestCollectionFlag(true)).to.be.revertedWith(
                "Only governor can execute",
            )
        })
        it("should enable interest collection", async () => {
            const tx = savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(true)

            await expect(tx).to.emit(savingsContract, "AutomaticInterestCollectionSwitched").withArgs(true)
        })
        it("should disable interest collection", async () => {
            const tx = savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(false)
            await expect(tx).to.emit(savingsContract, "AutomaticInterestCollectionSwitched").withArgs(false)
        })
    })

    describe("depositing interest", async () => {
        let savingsManagerAccount: Account
        beforeEach(async () => {
            savingsManagerAccount = sa.dummy3
            await createNewSavingsContract()
            await nexus.setSavingsManager(savingsManagerAccount.address)
            await masset.transfer(savingsManagerAccount.address, simpleToExactAmount(20, 18))
            await masset.connect(savingsManagerAccount.signer).approve(savingsContract.address, simpleToExactAmount(20, 18))
        })
        afterEach(async () => {
            const data = await getData(savingsContract, alice)
            expect(exchangeRateHolds(data), "Exchange rate must hold")
        })
        it("should fail when not called by savings manager", async () => {
            await expect(savingsContract.connect(sa.other.signer).depositInterest(1)).to.be.revertedWith("Only savings manager can execute")
        })
        it("should fail when amount is zero", async () => {
            await expect(savingsContract.connect(savingsManagerAccount.signer).depositInterest(ZERO)).to.be.revertedWith(
                "Must deposit something",
            )
        })
        it("should deposit interest when no credits", async () => {
            const before = await getData(savingsContract, sa.default)
            const deposit = simpleToExactAmount(1, 18)
            await savingsContract.connect(savingsManagerAccount.signer).depositInterest(deposit)

            const after = await getData(savingsContract, sa.default)
            expect(deposit).to.equal(after.balances.contract)
            expect(before.balances.contract.add(deposit)).to.equal(after.balances.contract)
            // exchangeRate should not change
            expect(before.exchangeRate).to.equal(after.exchangeRate)
        })
        it("should deposit interest when some credits exist", async () => {
            const interest = simpleToExactAmount(20, 18)
            const deposit = simpleToExactAmount(10, 18)

            // Deposit to SavingsContract
            await masset.approve(savingsContract.address, deposit)
            await savingsContract.preDeposit(deposit, sa.default.address)

            const balanceBefore = await masset.balanceOf(savingsContract.address)

            // Deposit Interest
            const tx = savingsContract.connect(savingsManagerAccount.signer).depositInterest(interest)
            // Expected rate = 1e17 + (20e18 / (100e18+1))
            // Expected rate = 1e17 + 2e17-1
            const expectedExchangeRate = simpleToExactAmount(3, 17)
            await expect(tx).to.emit(savingsContract, "ExchangeRateUpdated").withArgs(expectedExchangeRate, interest)
            // await tx.wait()
            const dataAfter = await getData(savingsContract, sa.default)

            expect(balanceBefore.add(interest)).to.equal(dataAfter.balances.contract)
            expect(expectedExchangeRate).to.equal(dataAfter.exchangeRate)
        })
    })

    describe("depositing savings", async () => {
        context("using preDeposit", async () => {
            before(async () => {
                await createNewSavingsContract()
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                // This amount should not be collected
                await masset.setAmountForCollectInterest(simpleToExactAmount(100, 18))
            })
            afterEach(async () => {
                const data = await getData(savingsContract, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            it("should not collect interest or affect the exchangeRate", async () => {
                const dataBefore = await getData(savingsContract, sa.default)
                const deposit = simpleToExactAmount(10, 18)
                const tx = savingsContract.preDeposit(deposit, sa.default.address)
                await expect(tx)
                    .to.emit(savingsContract, "SavingsDeposited")
                    .withArgs(sa.default.address, deposit, underlyingToCredits(deposit, dataBefore.exchangeRate))
                const dataAfter = await getData(savingsContract, sa.default)
                expect(dataAfter.exchangeRate).eq(initialExchangeRate)
                expect(dataAfter.balances.totalCredits).eq(underlyingToCredits(deposit, dataBefore.exchangeRate))
                // Should only receive the deposited, and not collect from the manager
                expect(dataAfter.balances.contract).eq(deposit)
            })
            it("allows multiple preDeposits", async () => {
                await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default.address)
                await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default.address)
                await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default.address)
                await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default.address)
            })
            it("should fail after exchange rate updates", async () => {
                // 1. Now there is more collateral than credits
                await savingsContract["depositSavings(uint256)"](simpleToExactAmount(1, 18))
                await savingsContract.poke()
                const exchangeRate = await savingsContract.exchangeRate()
                expect(exchangeRate).gt(initialExchangeRate)
                // 2. preDeposit should no longer work
                await expect(savingsContract.preDeposit(BN.from(1), sa.default.address)).to.be.revertedWith(
                    "Can only use this method before streaming begins",
                )
            })
        })

        context("using depositSavings", async () => {
            before(async () => {
                await createNewSavingsContract()
            })
            afterEach(async () => {
                const data = await getData(savingsContract, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            it("should fail when amount is zero", async () => {
                await expect(savingsContract["depositSavings(uint256)"](ZERO)).to.be.revertedWith("Must deposit something")
            })
            it("should fail when beneficiary is 0", async () => {
                await expect(savingsContract["depositSavings(uint256,address)"](1, ZERO_ADDRESS)).to.be.revertedWith(
                    "Invalid beneficiary address",
                )
            })
            it("should fail if the user has no balance", async () => {
                // Approve first
                await masset.connect(sa.dummy1.signer).approve(savingsContract.address, simpleToExactAmount(1, 18))

                // Deposit
                await expect(
                    savingsContract.connect(sa.dummy1.signer)["depositSavings(uint256)"](simpleToExactAmount(1, 18)),
                ).to.be.revertedWith("VM Exception")
            })
            it("should deposit the mUSD and assign credits to the saver", async () => {
                const dataBefore = await getData(savingsContract, sa.default)
                const depositAmount = simpleToExactAmount(1, 18)

                // 1. Approve the savings contract to spend mUSD
                await masset.approve(savingsContract.address, depositAmount)
                // 2. Deposit the mUSD
                const tx = savingsContract["depositSavings(uint256)"](depositAmount)
                const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate)
                await expect(tx).to.emit(savingsContract, "SavingsDeposited").withArgs(sa.default.address, depositAmount, expectedCredits)

                const dataAfter = await getData(savingsContract, sa.default)
                expect(dataAfter.balances.userCredits).eq(expectedCredits, "Must receive some savings credits")
                expect(dataAfter.balances.totalCredits).eq(expectedCredits)
                expect(dataAfter.balances.user).eq(dataBefore.balances.user.sub(depositAmount))
                expect(dataAfter.balances.contract).eq(simpleToExactAmount(1, 18))
            })
            it("allows alice to deposit to beneficiary (bob.address)", async () => {
                const dataBefore = await getData(savingsContract, bob)
                const depositAmount = simpleToExactAmount(1, 18)

                await masset.approve(savingsContract.address, depositAmount)

                const tx = savingsContract.connect(alice.signer)["depositSavings(uint256,address)"](depositAmount, bob.address)
                const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate)
                await expect(tx).to.emit(savingsContract, "SavingsDeposited").withArgs(bob.address, depositAmount, expectedCredits)
                const dataAfter = await getData(savingsContract, bob)
                expect(dataAfter.balances.userCredits).eq(expectedCredits, "Must receive some savings credits")
                expect(dataAfter.balances.totalCredits).eq(expectedCredits.mul(2))
                expect(dataAfter.balances.user).eq(dataBefore.balances.user)
                expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.add(simpleToExactAmount(1, 18)))
            })

            context("when there is some interest to collect from the manager", async () => {
                const deposit = simpleToExactAmount(10, 18)
                const interest = simpleToExactAmount(10, 18)
                before(async () => {
                    await createNewSavingsContract()
                    await masset.approve(savingsContract.address, deposit)
                })
                afterEach(async () => {
                    const data = await getData(savingsContract, alice)
                    expect(exchangeRateHolds(data), "Exchange rate must hold")
                })
                it("should collect the interest and update the exchange rate before issuance", async () => {
                    // Get the total balances
                    const stateBefore = await getData(savingsContract, alice)
                    expect(stateBefore.exchangeRate).to.equal(initialExchangeRate)

                    // Deposit first to get some savings in the basket
                    await savingsContract["depositSavings(uint256)"](deposit)

                    const stateMiddle = await getData(savingsContract, alice)
                    expect(stateMiddle.exchangeRate).to.equal(initialExchangeRate)
                    expect(stateMiddle.balances.contract).to.equal(deposit)
                    expect(stateMiddle.balances.totalCredits).to.equal(underlyingToCredits(deposit, initialExchangeRate))

                    // Set up the mAsset with some interest
                    await masset.setAmountForCollectInterest(interest)

                    await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                    await ethers.provider.send("evm_mine", [])

                    // Bob deposits into the contract
                    await masset.transfer(bob.address, deposit)
                    await masset.connect(bob.signer).approve(savingsContract.address, deposit)
                    const tx = savingsContract.connect(bob.signer)["depositSavings(uint256)"](deposit)
                    // Bob collects interest, to the benefit of Alice
                    // Expected rate = 1e17 + 1e17-1
                    const expectedExchangeRate = simpleToExactAmount(2, 17)
                    await expect(tx).to.emit(savingsContract, "ExchangeRateUpdated").withArgs(expectedExchangeRate, interest)

                    // Alice gets the benefit of the new exchange rate
                    const stateEnd = await getData(savingsContract, alice)
                    expect(stateEnd.exchangeRate).eq(expectedExchangeRate)
                    expect(stateEnd.balances.contract).eq(deposit.mul(3))
                    const aliceBalance = await savingsContract.balanceOfUnderlying(alice.address)
                    expect(simpleToExactAmount(20, 18)).eq(aliceBalance)

                    // Bob gets credits at the NEW exchange rate
                    const bobData = await getData(savingsContract, bob)
                    expect(bobData.balances.userCredits).eq(underlyingToCredits(deposit, stateEnd.exchangeRate))
                    expect(stateEnd.balances.totalCredits).eq(bobData.balances.userCredits.add(stateEnd.balances.userCredits))
                    const bobBalance = await savingsContract.balanceOfUnderlying(bob.address)
                    expect(bobBalance).eq(deposit)
                    expect(bobBalance.add(aliceBalance)).eq(deposit.mul(3), "Individual balances cannot exceed total")

                    expect(exchangeRateHolds(stateEnd), "Exchange rate must hold")
                })
            })
        })
    })
    describe("checking the view methods", () => {
        const aliceCredits = simpleToExactAmount(100, 18).add(1)
        const aliceUnderlying = simpleToExactAmount(20, 18)
        const bobCredits = simpleToExactAmount(50, 18).add(1)
        const bobUnderlying = simpleToExactAmount(10, 18)
        let data: Data
        before(async () => {
            await createNewSavingsContract()
            await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
            await savingsContract.preDeposit(simpleToExactAmount(10, 18), alice.address)
            await masset.setAmountForCollectInterest(simpleToExactAmount(10, 18))
            await savingsContract["depositSavings(uint256,address)"](simpleToExactAmount(10, 18), bob.address)
            data = await getData(savingsContract, alice)
            const bobData = await getData(savingsContract, bob)
            expect(data.balances.userCredits).eq(aliceCredits)
            expect(creditsToUnderlying(aliceCredits, data.exchangeRate)).eq(aliceUnderlying)
            expect(bobData.balances.userCredits).eq(bobCredits)
            expect(creditsToUnderlying(bobCredits, bobData.exchangeRate)).eq(bobUnderlying)
        })
        it("should return correct balances as local checks", async () => {
            const aliceBoU = await savingsContract.balanceOfUnderlying(alice.address)
            expect(aliceBoU).eq(aliceUnderlying)
            const bobBoU = await savingsContract.balanceOfUnderlying(bob.address)
            expect(bobBoU).eq(bobUnderlying)
            const otherBoU = await savingsContract.balanceOfUnderlying(sa.other.address)
            expect(otherBoU).eq(BN.from(0))
        })
        it("should return same result in balanceOfUnderlying and creditsToUnderlying(balanceOf(user))", async () => {
            const aliceBoU = await savingsContract.balanceOfUnderlying(alice.address)
            const aliceC = await savingsContract.creditsToUnderlying(await savingsContract.balanceOf(alice.address))
            expect(aliceBoU).eq(aliceC)

            const bobBou = await savingsContract.balanceOfUnderlying(bob.address)
            const bobC = await savingsContract.creditsToUnderlying(await savingsContract.balanceOf(bob.address))
            expect(bobBou).eq(bobC)
        })
        it("should return same result in creditBalances and balanceOf", async () => {
            const aliceCB = await savingsContract.creditBalances(alice.address)
            const aliceB = await savingsContract.balanceOf(alice.address)
            expect(aliceCB).eq(aliceB)

            const bobCB = await savingsContract.creditBalances(bob.address)
            const bobB = await savingsContract.balanceOf(bob.address)
            expect(bobCB).eq(bobB)

            const otherCB = await savingsContract.creditBalances(sa.other.address)
            const otherB = await savingsContract.balanceOf(sa.other.address)
            expect(otherCB).eq(BN.from(0))
            expect(otherB).eq(BN.from(0))
        })
        it("should calculate back and forth correctly", async () => {
            // underlyingToCredits
            const uToC = await savingsContract.underlyingToCredits(simpleToExactAmount(1, 18))
            expect(uToC).eq(underlyingToCredits(simpleToExactAmount(1, 18), data.exchangeRate))
            expect(await savingsContract.creditsToUnderlying(uToC)).eq(simpleToExactAmount(1, 18))

            const uToC2 = await savingsContract.underlyingToCredits(1)
            expect(uToC2).eq(underlyingToCredits(1, data.exchangeRate))
            expect(await savingsContract.creditsToUnderlying(uToC2)).eq(BN.from(1))

            const uToC3 = await savingsContract.underlyingToCredits(0)
            expect(uToC3).eq(BN.from(1))
            expect(await savingsContract.creditsToUnderlying(uToC3)).eq(BN.from(0))

            const uToC4 = await savingsContract.underlyingToCredits(12986123876)
            expect(uToC4).eq(underlyingToCredits(12986123876, data.exchangeRate))
            expect(await savingsContract.creditsToUnderlying(uToC4)).eq(BN.from(12986123876))
        })
    })

    describe("redeeming", async () => {
        before(async () => {
            await createNewSavingsContract()
        })
        it("should fail when input is zero", async () => {
            await expect(savingsContract.redeem(ZERO)).to.be.revertedWith("Must withdraw something")
            await expect(savingsContract.redeemCredits(ZERO)).to.be.revertedWith("Must withdraw something")
            await expect(savingsContract.redeemUnderlying(ZERO)).to.be.revertedWith("Must withdraw something")
        })
        it("should fail when user doesn't have credits", async () => {
            const amt = BN.from(10)
            await expect(savingsContract.connect(sa.other.signer).redeem(amt)).to.be.revertedWith("VM Exception")
            await expect(savingsContract.connect(sa.other.signer).redeemCredits(amt)).to.be.revertedWith("VM Exception")
            await expect(savingsContract.connect(sa.other.signer).redeemUnderlying(amt)).to.be.revertedWith("VM Exception")
        })
        context("using redeemCredits", async () => {
            const deposit = simpleToExactAmount(10, 18)
            const credits = underlyingToCredits(deposit, initialExchangeRate)
            const interest = simpleToExactAmount(10, 18)
            beforeEach(async () => {
                await createNewSavingsContract()
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                await savingsContract.preDeposit(deposit, alice.address)
            })
            afterEach(async () => {
                const data = await getData(savingsContract, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            // test the balance calcs here.. credit to masset, and public calcs
            it("should redeem a specific amount of credits", async () => {
                // calculates underlying/credits
                const creditsToWithdraw = simpleToExactAmount(5, 18)
                const expectedWithdrawal = creditsToUnderlying(creditsToWithdraw, initialExchangeRate)
                const dataBefore = await getData(savingsContract, alice)
                const tx = savingsContract.redeemCredits(creditsToWithdraw)
                await expect(tx).to.emit(savingsContract, "CreditsRedeemed").withArgs(alice.address, creditsToWithdraw, expectedWithdrawal)
                // await tx.wait()
                const dataAfter = await getData(savingsContract, alice)
                // burns credits from sender
                expect(dataAfter.balances.userCredits).eq(dataBefore.balances.userCredits.sub(creditsToWithdraw))
                expect(dataAfter.balances.totalCredits).eq(dataBefore.balances.totalCredits.sub(creditsToWithdraw))
                // transfers tokens to sender
                expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(expectedWithdrawal))
                expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.sub(expectedWithdrawal))
            })
            it("collects interest and credits to saver before redemption", async () => {
                const expectedExchangeRate = simpleToExactAmount(2, 17)
                await masset.setAmountForCollectInterest(interest)
                const dataBefore = await getData(savingsContract, alice)
                await savingsContract.redeemCredits(credits)
                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.balances.totalCredits).eq(BN.from(0))
                // User receives their deposit back + interest
                assertBNClose(dataAfter.balances.user, dataBefore.balances.user.add(deposit).add(interest), 100)
                // Exchange rate updates
                expect(dataAfter.exchangeRate).eq(expectedExchangeRate)
            })
        })
        context("using redeemUnderlying", async () => {
            const deposit = simpleToExactAmount(10, 18)
            const interest = simpleToExactAmount(10, 18)
            beforeEach(async () => {
                await createNewSavingsContract()
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                await savingsContract.preDeposit(deposit, alice.address)
            })
            afterEach(async () => {
                const data = await getData(savingsContract, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            it("allows full redemption immediately after deposit", async () => {
                await savingsContract.redeemUnderlying(deposit)
                const data = await getData(savingsContract, alice)
                expect(data.balances.userCredits).eq(BN.from(0))
            })
            it("should redeem a specific amount of underlying", async () => {
                // calculates underlying/credits
                const underlying = simpleToExactAmount(5, 18)
                const expectedCredits = underlyingToCredits(underlying, initialExchangeRate)
                const dataBefore = await getData(savingsContract, alice)
                const tx = savingsContract.redeemUnderlying(underlying)
                await expect(tx).to.emit(savingsContract, "CreditsRedeemed").withArgs(alice.address, expectedCredits, underlying)
                const dataAfter = await getData(savingsContract, alice)
                // burns credits from sender
                expect(dataAfter.balances.userCredits).eq(dataBefore.balances.userCredits.sub(expectedCredits))
                expect(dataAfter.balances.totalCredits).eq(dataBefore.balances.totalCredits.sub(expectedCredits))
                // transfers tokens to sender
                expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(underlying))
                expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.sub(underlying))
            })
            it("collects interest and credits to saver before redemption", async () => {
                const expectedExchangeRate = simpleToExactAmount(2, 17)
                await masset.setAmountForCollectInterest(interest)

                const dataBefore = await getData(savingsContract, alice)
                await savingsContract.redeemUnderlying(deposit)
                const dataAfter = await getData(savingsContract, alice)

                expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(deposit))
                // User is left with resulting credits due to exchange rate going up
                assertBNClose(dataAfter.balances.userCredits, dataBefore.balances.userCredits.div(2), 1000)
                // Exchange rate updates
                expect(dataAfter.exchangeRate).eq(expectedExchangeRate)
            })
            it("skips interest collection if automate is turned off", async () => {
                await masset.setAmountForCollectInterest(interest)
                await savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(false)

                const dataBefore = await getData(savingsContract, alice)
                await savingsContract.redeemUnderlying(deposit)
                const dataAfter = await getData(savingsContract, alice)

                expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(deposit))
                expect(dataAfter.balances.userCredits).eq(BN.from(0))
                expect(dataAfter.exchangeRate).eq(dataBefore.exchangeRate)
            })
        })

        context("with a connector that surpasses limit", async () => {
            const deposit = simpleToExactAmount(100, 18)
            const redemption = underlyingToCredits(simpleToExactAmount(51, 18), initialExchangeRate)
            before(async () => {
                await createNewSavingsContract()
                const connector = await (await new MockConnector__factory(sa.default.signer)).deploy(
                    savingsContract.address,
                    masset.address,
                )

                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                await savingsContract.preDeposit(deposit, alice.address)

                await savingsContract.connect(sa.governor.signer).setConnector(connector.address)

                await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(4).add(1).toNumber()])
                await ethers.provider.send("evm_mine", [])

                const data = await getData(savingsContract, alice)
                expect(data.connector.balance).eq(deposit.mul(data.connector.fraction).div(fullScale))
                expect(data.balances.contract).eq(deposit.sub(data.connector.balance))
                expect(data.exchangeRate).eq(initialExchangeRate)
            })
            afterEach(async () => {
                const data = await getData(savingsContract, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            it("triggers poke and deposits to connector if the threshold is hit", async () => {
                // in order to reach 40%, must redeem > 51
                const dataBefore = await getData(savingsContract, alice)
                const poke = await getExpectedPoke(dataBefore, redemption)

                const tx = savingsContract.redeemCredits(redemption)
                await expect(tx)
                    .to.emit(savingsContract, "CreditsRedeemed")
                    .withArgs(alice.address, redemption, simpleToExactAmount(51, 18))
                // Remaining balance is 49, with 20 in the connector
                await expect(tx).to.emit(savingsContract, "Poked").withArgs(dataBefore.connector.balance, poke.ideal, BN.from(0))

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.balances.contract).eq(simpleToExactAmount("39.2", 18))
            })
            it("errors if triggered again within 4h", async () => {})
        })

        context("using redeem (depcrecated)", async () => {
            beforeEach(async () => {
                await createNewSavingsContract()
                await masset.approve(savingsContract.address, simpleToExactAmount(10, 18))
                await savingsContract["depositSavings(uint256)"](simpleToExactAmount(1, 18))
            })
            it("should redeem when user has balance", async () => {
                const redemptionAmount = simpleToExactAmount(5, 18)
                const balancesBefore = await getData(savingsContract, sa.default)

                const tx = savingsContract.redeem(redemptionAmount)
                const exchangeRate = initialExchangeRate
                const underlying = creditsToUnderlying(redemptionAmount, exchangeRate)
                await expect(tx).to.emit(savingsContract, "CreditsRedeemed").withArgs(sa.default.address, redemptionAmount, underlying)
                const dataAfter = await getData(savingsContract, sa.default)
                expect(balancesBefore.balances.contract.sub(underlying)).to.equal(dataAfter.balances.contract)

                expect(balancesBefore.balances.user.add(underlying)).to.equal(dataAfter.balances.user)
            })
            it("should withdraw the mUSD and burn the credits", async () => {
                const redemptionAmount = simpleToExactAmount(1, 18)
                const creditsBefore = await savingsContract.creditBalances(sa.default.address)
                const mUSDBefore = await masset.balanceOf(sa.default.address)
                // Redeem all the credits
                await savingsContract.redeem(creditsBefore)

                const creditsAfter = await savingsContract.creditBalances(sa.default.address)
                const mUSDAfter = await masset.balanceOf(sa.default.address)
                expect(creditsAfter, "Must burn all the credits").eq(BN.from(0))
                expect(mUSDAfter, "Must receive back mUSD").eq(mUSDBefore.add(redemptionAmount))
            })
        })
    })

    describe("setting poker", () => {
        before(async () => {
            await createNewSavingsContract()
        })
        it("fails if not called by governor", async () => {
            await expect(savingsContract.connect(sa.dummy1.signer).setPoker(sa.dummy1.address)).to.be.revertedWith(
                "Only governor can execute",
            )
        })
        it("fails if invalid poker address", async () => {
            await expect(savingsContract.connect(sa.governor.signer).setPoker(sa.default.address)).to.be.revertedWith("Invalid poker")
        })
        it("allows governance to set a new poker", async () => {
            const tx = savingsContract.connect(sa.governor.signer).setPoker(sa.dummy1.address)
            await expect(tx).to.emit(savingsContract, "PokerUpdated").withArgs(sa.dummy1.address)
            expect(await savingsContract.poker()).eq(sa.dummy1.address)
        })
    })

    describe("setting fraction", () => {
        before(async () => {
            await createNewSavingsContract()
            await masset.approve(savingsContract.address, simpleToExactAmount(1, 18))
            await savingsContract.preDeposit(simpleToExactAmount(1, 18), sa.default.address)
        })
        it("fails if not called by governor", async () => {
            await expect(savingsContract.connect(sa.dummy1.signer).setFraction(simpleToExactAmount(1, 17))).to.be.revertedWith(
                "Only governor can execute",
            )
        })
        it("fails if over the threshold", async () => {
            await expect(savingsContract.connect(sa.governor.signer).setFraction(simpleToExactAmount(55, 16))).to.be.revertedWith(
                "Fraction must be <= 50%",
            )
        })
        it("sets a new fraction and pokes", async () => {
            const tx = savingsContract.connect(sa.governor.signer).setFraction(simpleToExactAmount(1, 16))
            await expect(tx).to.emit(savingsContract, "FractionUpdated").withArgs(simpleToExactAmount(1, 16))
            await expect(tx).to.emit(savingsContract, "PokedRaw")
            expect(await savingsContract.fraction()).eq(simpleToExactAmount(1, 16))
        })
    })

    describe("setting connector", () => {
        const deposit = simpleToExactAmount(100, 18)

        beforeEach(async () => {
            await createNewSavingsContract()
            const connector = await connectorFactory.deploy(savingsContract.address, masset.address)

            await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
            await savingsContract.preDeposit(deposit, alice.address)

            await savingsContract.connect(sa.governor.signer).setConnector(connector.address)
        })
        afterEach(async () => {
            const data = await getData(savingsContract, alice)
            expect(exchangeRateHolds(data), "Exchange rate must hold")
        })
        it("fails if not called by governor", async () => {
            await expect(savingsContract.connect(sa.dummy1.signer).setConnector(sa.dummy1.address)).to.be.revertedWith(
                "Only governor can execute",
            )
        })
        it("updates the connector address, moving assets to new connector", async () => {
            const dataBefore = await getData(savingsContract, alice)

            expect(dataBefore.connector.balance).eq(deposit.mul(dataBefore.connector.fraction).div(fullScale))
            expect(dataBefore.balances.contract).eq(deposit.sub(dataBefore.connector.balance))
            expect(dataBefore.exchangeRate).eq(initialExchangeRate)

            const newConnector = await connectorFactory.deploy(savingsContract.address, masset.address)

            const tx = savingsContract.connect(sa.governor.signer).setConnector(newConnector.address)
            await expect(tx).to.emit(savingsContract, "ConnectorUpdated").withArgs(newConnector.address)

            const dataAfter = await getData(savingsContract, alice)
            expect(dataAfter.connector.address).eq(newConnector.address)
            expect(dataAfter.connector.balance).eq(dataBefore.connector.balance)
            const oldConnector = await connectorFactory.attach(dataBefore.connector.address)
            expect(await oldConnector.checkBalance()).eq(BN.from(0))
        })
        it("withdraws everything if connector is set to 0", async () => {
            const dataBefore = await getData(savingsContract, alice)
            const tx = savingsContract.connect(sa.governor.signer).setConnector(ZERO_ADDRESS)
            await expect(tx).to.emit(savingsContract, "ConnectorUpdated").withArgs(ZERO_ADDRESS)

            const dataAfter = await getData(savingsContract, alice)
            expect(dataAfter.connector.address).eq(ZERO_ADDRESS)
            expect(dataAfter.connector.balance).eq(BN.from(0))
            expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.add(dataBefore.connector.balance))
        })
    })

    describe("poking", () => {
        const deposit = simpleToExactAmount(1, 20)
        before(async () => {
            await createNewSavingsContract()
        })
        it("allows only poker to poke", async () => {
            await expect(savingsContract.connect(sa.governor.signer).poke()).to.be.revertedWith("Only poker can execute")
        })
        it("fails if there are no credits", async () => {
            const credits = await savingsContract.totalSupply()
            expect(credits).eq(BN.from(0))
            await expect(savingsContract.connect(sa.default.signer).poke()).to.be.revertedWith("Must have something to poke")
        })
        it("only allows pokes once every 4h", async () => {
            await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
            await savingsContract.preDeposit(deposit, alice.address)
            await savingsContract.poke()
            await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(3).toNumber()])
            await ethers.provider.send("evm_mine", [])
            await expect(savingsContract.connect(sa.default.signer).poke()).to.be.revertedWith("Not enough time elapsed")
        })
        context("with an erroneous connector", () => {
            beforeEach(async () => {
                await createNewSavingsContract()

                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                await savingsContract.preDeposit(deposit, alice.address)
            })
            afterEach(async () => {
                const data = await getData(savingsContract, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            it("should fail if the raw balance goes down somehow", async () => {
                const connector = await (await new MockErroneousConnector1__factory(sa.default.signer)).deploy(
                    savingsContract.address,
                    masset.address,
                )
                await savingsContract.connect(sa.governor.signer).setConnector(connector.address)
                // Total collat goes down
                await savingsContract.redeemUnderlying(deposit.div(2))
                // Withdrawal is made but nothing comes back
                await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(6).toNumber()])
                await ethers.provider.send("evm_mine", [])
                await savingsContract.poke()
                // Try that again
                await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(12).toNumber()])
                await ethers.provider.send("evm_mine", [])
                await expect(savingsContract.poke()).to.be.revertedWith("ExchangeRate must increase")
            })
            it("is protected by the system invariant", async () => {
                // connector returns invalid balance after withdrawal
                const connector = await (await new MockErroneousConnector2__factory(sa.default.signer)).deploy(
                    savingsContract.address,
                    masset.address,
                )
                await savingsContract.connect(sa.governor.signer).setConnector(connector.address)
                await savingsContract.redeemUnderlying(deposit.div(2))

                await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(4).toNumber()])
                await ethers.provider.send("evm_mine", [])
                await expect(savingsContract.poke()).to.be.revertedWith("Enforce system invariant")
            })
            it("should fail if the balance has gone down", async () => {
                const connector = await (await new MockErroneousConnector2__factory(sa.default.signer)).deploy(
                    savingsContract.address,
                    masset.address,
                )
                await savingsContract.connect(sa.governor.signer).setConnector(connector.address)

                await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(4).toNumber()])
                await ethers.provider.send("evm_mine", [])
                await connector.poke()
                await expect(savingsContract.poke()).to.be.revertedWith("Invalid yield")
            })
        })
        context("with a lending market connector", () => {
            let connector: MockLendingConnector
            before(async () => {
                await createNewSavingsContract()

                connector = await (await new MockLendingConnector__factory(sa.default.signer)).deploy(
                    savingsContract.address,
                    masset.address,
                )
                // Give mock some extra assets to allow inflation
                await masset.transfer(connector.address, simpleToExactAmount(100, 18))

                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                await savingsContract.preDeposit(deposit, alice.address)

                // Set up connector
                await savingsContract.connect(sa.governor.signer).setFraction(0)
                await savingsContract.connect(sa.governor.signer).setConnector(connector.address)
            })
            afterEach(async () => {
                const data = await getData(savingsContract, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            it("should do nothing if the fraction is 0", async () => {
                const data = await getData(savingsContract, alice)

                await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(4).toNumber()])
                await ethers.provider.send("evm_mine", [])
                const tx = savingsContract.poke()
                await expect(tx).to.emit(savingsContract, "Poked").withArgs(BN.from(0), BN.from(0), BN.from(0))
                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.balances.contract).eq(data.balances.contract)
                expect(dataAfter.exchangeRate).eq(data.exchangeRate)
            })
            it("should poke when fraction is set", async () => {
                const tx = savingsContract.connect(sa.governor.signer).setFraction(simpleToExactAmount(2, 17))

                await expect(tx).to.emit(savingsContract, "Poked").withArgs(BN.from(0), simpleToExactAmount(2, 19), BN.from(0))

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.balances.contract).eq(simpleToExactAmount(8, 19))
                expect(dataAfter.connector.balance).eq(simpleToExactAmount(2, 19))
            })
            it("should accrue interest and update exchange rate", async () => {
                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                const data = await getData(savingsContract, alice)

                const ts = await getTimestamp()
                await connector.poke()
                const tx = savingsContract.poke()
                await expect(tx).to.emit(savingsContract, "Poked")
                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.exchangeRate).gt(data.exchangeRate)
                assertBNClose(dataAfter.connector.lastPoke, BN.from(ts), 5)
                expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance)
            })
            it("should deposit to the connector if total supply increases", async () => {
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 20))
                await savingsContract["depositSavings(uint256)"](deposit)

                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                const data = await getData(savingsContract, alice)

                const ts = await getTimestamp()
                await savingsContract.poke()

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.exchangeRate).gt(data.exchangeRate)
                assertBNClose(dataAfter.connector.lastPoke, BN.from(ts), 5)
                expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance)
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(16, 19), "2")
            })
            it("should withdraw from the connector if total supply lowers", async () => {
                await savingsContract.redeemUnderlying(simpleToExactAmount(1, 20))

                await ethers.provider.send("evm_increaseTime", [ONE_DAY.mul(2).add(1).toNumber()])
                await ethers.provider.send("evm_mine", [])
                const data = await getData(savingsContract, alice)

                await savingsContract.poke()

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.exchangeRate).gte(data.exchangeRate)
                expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance)
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(8, 19), "2")
            })
            it("should continue to accrue interest", async () => {
                await ethers.provider.send("evm_increaseTime", [ONE_DAY.mul(3).toNumber()])
                await ethers.provider.send("evm_mine", [])
                const data = await getData(savingsContract, alice)

                await savingsContract.poke()

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.exchangeRate).gte(data.exchangeRate)
                expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance)
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(8, 19), "2")
            })
            it("should fail if the APY is too high", async () => {
                await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(4).toNumber()])
                await ethers.provider.send("evm_mine", [])
                await expect(savingsContract.poke()).to.be.revertedWith("Interest protected from inflating past maxAPY")
            })
        })
        context("with a vault connector", () => {
            let connector: MockVaultConnector
            before(async () => {
                await createNewSavingsContract()
                connector = await (await new MockVaultConnector__factory(sa.default.signer)).deploy(savingsContract.address, masset.address)
                await masset.transfer(connector.address, simpleToExactAmount(100, 18))
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                await savingsContract.preDeposit(deposit, alice.address)
            })
            afterEach(async () => {
                const data = await getData(savingsContract, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            it("should poke when fraction is set", async () => {
                const tx = savingsContract.connect(sa.governor.signer).setConnector(connector.address)

                await expect(tx).to.emit(savingsContract, "Poked").withArgs(BN.from(0), simpleToExactAmount(2, 19), BN.from(0))

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.balances.contract).eq(simpleToExactAmount(8, 19))
                expect(dataAfter.connector.balance).eq(simpleToExactAmount(2, 19))
            })

            // In this case, the slippage from the deposit has caused the connector
            // to be less than the original balance. Fortunately, the invariant for Connectors
            // protects against this case, and will return the deposited balance.
            it("should not accrue interest if there is still a deficit", async () => {
                await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(4).toNumber()])
                await ethers.provider.send("evm_mine", [])
                await savingsContract.poke()

                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                const data = await getData(savingsContract, alice)

                const ts = await getTimestamp()
                await connector.poke()
                const tx = savingsContract.poke()
                await expect(tx)
                    .to.emit(savingsContract, "Poked")
                    .withArgs(simpleToExactAmount(2, 19), simpleToExactAmount(2, 19), BN.from(0))

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.exchangeRate).eq(data.exchangeRate)
                assertBNClose(dataAfter.connector.lastPoke, BN.from(ts), 5)
                expect(dataAfter.connector.balance).eq(dataAfter.connector.lastBalance)
            })
            it("should accrue interest if the balance goes positive", async () => {
                await ethers.provider.send("evm_increaseTime", [ONE_DAY.mul(2).toNumber()])
                await ethers.provider.send("evm_mine", [])
                await connector.poke()

                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                const data = await getData(savingsContract, alice)

                const connectorBalance = await connector.checkBalance()
                expect(connectorBalance).gt(simpleToExactAmount(2, 19))

                await connector.poke()
                const tx = savingsContract.poke()
                await expect(tx).to.emit(savingsContract, "Poked")

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.exchangeRate).gt(data.exchangeRate)
                expect(connectorBalance).gt(dataAfter.connector.lastBalance)
            })
            it("should deposit to the connector if total supply increases", async () => {
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 20))
                await savingsContract["depositSavings(uint256)"](deposit)

                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                const data = await getData(savingsContract, alice)

                const ts = await getTimestamp()
                await savingsContract.poke()

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.exchangeRate, "Exchange rate must be the same").eq(data.exchangeRate)
                assertBNClose(dataAfter.connector.lastPoke, BN.from(ts), 5)
                expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance)
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(16, 19), "2")
            })
            it("should withdraw from the connector if total supply lowers", async () => {
                await savingsContract.redeemUnderlying(simpleToExactAmount(1, 20))

                await ethers.provider.send("evm_increaseTime", [ONE_DAY.mul(2).toNumber()])
                await ethers.provider.send("evm_mine", [])
                const data = await getData(savingsContract, alice)

                await savingsContract.poke()

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.exchangeRate).gte(data.exchangeRate)
                expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance)
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(8, 19), "2")
            })
            it("should continue to accrue interest", async () => {
                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                const data = await getData(savingsContract, alice)

                await savingsContract.poke()

                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.exchangeRate).gte(data.exchangeRate)
                expect(dataAfter.connector.balance).gte(dataAfter.connector.lastBalance)
                assertBNClosePercent(dataAfter.balances.contract, simpleToExactAmount(8, 19), "2")
            })
            it("allows the connector to be switched to a lending market", async () => {
                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                const newConnector = await (await new MockLendingConnector__factory(sa.default.signer)).deploy(
                    savingsContract.address,
                    masset.address,
                )
                const data = await getData(savingsContract, alice)
                await savingsContract.connect(sa.governor.signer).setConnector(newConnector.address)
                const dataAfter = await getData(savingsContract, alice)
                expect(dataAfter.connector.address).eq(newConnector.address)
                assertBNClosePercent(
                    dataAfter.connector.lastBalance,
                    creditsToUnderlying(dataAfter.balances.totalCredits, dataAfter.exchangeRate).div(5),
                    "0.0001",
                )
                expect(dataAfter.balances.contract).gte(data.balances.contract)
            })
        })
        context("with no connector", () => {
            const deposit2 = simpleToExactAmount(100, 18)
            const airdrop = simpleToExactAmount(1, 18)
            beforeEach(async () => {
                await createNewSavingsContract()
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                await savingsContract.preDeposit(deposit2, alice.address)
            })
            it("simply updates the exchangeRate using the raw balance", async () => {
                const dataBefore = await getData(savingsContract, alice)
                expect(dataBefore.balances.userCredits).eq(underlyingToCredits(deposit2, initialExchangeRate))

                await masset.transfer(savingsContract.address, airdrop)
                const tx = savingsContract.poke()
                await expect(tx)
                    .to.emit(savingsContract, "ExchangeRateUpdated")
                    .withArgs(deposit2.add(airdrop).mul(fullScale).div(dataBefore.balances.userCredits.sub(1)), airdrop)
                await expect(tx).to.emit(savingsContract, "PokedRaw")
                const balanceOfUnderlying = await savingsContract.balanceOfUnderlying(alice.address)
                expect(balanceOfUnderlying).eq(deposit2.add(airdrop))
            })
        })
    })

    describe("testing emergency stop", () => {
        const deposit = simpleToExactAmount(100, 18)
        let dataBefore: Data
        const expectedRateAfter = initialExchangeRate.div(10).mul(9)
        before(async () => {
            await createNewSavingsContract()
            const connector = await connectorFactory.deploy(savingsContract.address, masset.address)

            await masset.transfer(bob.address, simpleToExactAmount(100, 18))
            await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
            await savingsContract.preDeposit(deposit, alice.address)

            await savingsContract.connect(sa.governor.signer).setConnector(connector.address)
            dataBefore = await getData(savingsContract, alice)
        })
        afterEach(async () => {
            const data = await getData(savingsContract, alice)
            expect(exchangeRateHolds(data), "exchange rate must hold")
        })
        it("withdraws specific amount from the connector", async () => {
            expect(dataBefore.connector.balance).eq(deposit.div(5))

            const tx = savingsContract.connect(sa.governor.signer).emergencyWithdraw(simpleToExactAmount(10, 18))
            await expect(tx).to.emit(savingsContract, "ConnectorUpdated").withArgs(ZERO_ADDRESS)
            await expect(tx).to.emit(savingsContract, "FractionUpdated").withArgs(BN.from(0))
            await expect(tx).to.emit(savingsContract, "EmergencyUpdate")
            expect(tx).to.emit(savingsContract, "ExchangeRateUpdated").withArgs(expectedRateAfter, BN.from(0))

            const dataMiddle = await getData(savingsContract, alice)
            expect(dataMiddle.balances.contract).eq(simpleToExactAmount(90, 18))
            expect(dataMiddle.balances.totalCredits).eq(dataBefore.balances.totalCredits)
        })
        it("sets fraction and connector to 0", async () => {
            const fraction = await savingsContract.fraction()
            expect(fraction).eq(BN.from(0))
            const connector = await savingsContract.connector()
            expect(connector).eq(ZERO_ADDRESS)
        })
        it("should lowers exchange rate if necessary", async () => {
            const data = await getData(savingsContract, alice)
            expect(data.exchangeRate).eq(expectedRateAfter)

            const balanceOfUnderlying = await savingsContract.balanceOfUnderlying(alice.address)
            expect(balanceOfUnderlying).eq(simpleToExactAmount(90, 18))
        })
        it("should still allow deposits and withdrawals to work", async () => {
            await masset.connect(bob.signer).approve(savingsContract.address, simpleToExactAmount(1, 21))
            await savingsContract.connect(bob.signer)["depositSavings(uint256)"](deposit)
            const data = await getData(savingsContract, bob)
            expect(data.balances.userCredits).eq(underlyingToCredits(deposit, expectedRateAfter))

            const balanceOfUnderlying = await savingsContract.balanceOfUnderlying(bob.address)
            expect(balanceOfUnderlying).eq(deposit)

            await savingsContract.connect(bob.signer).redeemCredits(data.balances.userCredits)

            const dataEnd = await getData(savingsContract, bob)
            expect(dataEnd.balances.userCredits).eq(BN.from(0))
            expect(dataEnd.balances.user).eq(data.balances.user.add(deposit))
        })
    })

    context("performing multiple operations from multiple addresses in sequence", async () => {
        beforeEach(async () => {
            await createNewSavingsContract()
        })

        it("should give existing savers the benefit of the increased exchange rate", async () => {
            const saver1 = sa.default
            const saver2 = sa.dummy1
            const saver3 = sa.dummy2
            const saver4 = sa.dummy3

            // Set up amounts
            // Each savers deposit will trigger some interest to be deposited
            const saver1deposit = simpleToExactAmount(1000, 18)
            const interestToReceive1 = simpleToExactAmount(100, 18)
            const saver2deposit = simpleToExactAmount(1000, 18)
            const interestToReceive2 = simpleToExactAmount(350, 18)
            const saver3deposit = simpleToExactAmount(1000, 18)
            const interestToReceive3 = simpleToExactAmount(80, 18)
            const saver4deposit = simpleToExactAmount(1000, 18)
            const interestToReceive4 = simpleToExactAmount(160, 18)

            // Ensure saver2 has some balances and do approvals
            await masset.transfer(saver2.address, saver2deposit)
            await masset.transfer(saver3.address, saver3deposit)
            await masset.transfer(saver4.address, saver4deposit)
            await masset.connect(saver1.signer).approve(savingsContract.address, MAX_UINT256)
            await masset.connect(saver2.signer).approve(savingsContract.address, MAX_UINT256)
            await masset.connect(saver3.signer).approve(savingsContract.address, MAX_UINT256)
            await masset.connect(saver4.signer).approve(savingsContract.address, MAX_UINT256)

            // Should be a fresh balance sheet
            const stateBefore = await getData(savingsContract, sa.default)
            expect(stateBefore.exchangeRate).to.equal(initialExchangeRate)
            expect(stateBefore.balances.contract).to.equal(BN.from(0))

            // 1.0 user 1 deposits
            // interest remains unassigned and exchange rate unmoved
            await masset.setAmountForCollectInterest(interestToReceive1)

            await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
            await ethers.provider.send("evm_mine", [])
            await savingsContract.connect(saver1.signer)["depositSavings(uint256)"](saver1deposit)
            await savingsContract.poke()
            const state1 = await getData(savingsContract, saver1)
            // 2.0 user 2 deposits
            // interest rate benefits user 1 and issued user 2 less credits than desired
            await masset.setAmountForCollectInterest(interestToReceive2)

            await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
            await ethers.provider.send("evm_mine", [])
            await savingsContract.connect(saver2.signer)["depositSavings(uint256)"](saver2deposit)
            const state2 = await getData(savingsContract, saver2)
            // 3.0 user 3 deposits
            // interest rate benefits users 1 and 2
            await masset.setAmountForCollectInterest(interestToReceive3)

            await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
            await ethers.provider.send("evm_mine", [])
            await savingsContract.connect(saver3.signer)["depositSavings(uint256)"](saver3deposit)
            const state3 = await getData(savingsContract, saver3)
            // 4.0 user 1 withdraws all her credits
            await savingsContract.connect(saver1.signer).redeem(state1.balances.userCredits)
            const state4 = await getData(savingsContract, saver1)
            expect(state4.balances.userCredits).eq(BN.from(0))
            expect(state4.balances.totalCredits).eq(state3.balances.totalCredits.sub(state1.balances.userCredits))
            expect(state4.exchangeRate).eq(state3.exchangeRate)
            assertBNClose(state4.balances.contract, creditsToUnderlying(state4.balances.totalCredits, state4.exchangeRate), BN.from(100000))
            // 5.0 user 4 deposits
            // interest rate benefits users 2 and 3
            await masset.setAmountForCollectInterest(interestToReceive4)

            await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
            await ethers.provider.send("evm_mine", [])
            await savingsContract.connect(saver4.signer)["depositSavings(uint256)"](saver4deposit)
            const state5 = await getData(savingsContract, saver4)
            // 6.0 users 2, 3, and 4 withdraw all their tokens
            await savingsContract.connect(saver2.signer).redeemCredits(state2.balances.userCredits)
            await savingsContract.connect(saver3.signer).redeemCredits(state3.balances.userCredits)
            await savingsContract.connect(saver4.signer).redeemCredits(state5.balances.userCredits)
        })
    })
})
