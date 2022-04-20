import { assertBNClose, assertBNClosePercent } from "@utils/assertions"
import { DEAD_ADDRESS, fullScale, MAX_UINT256, ONE_DAY, ONE_HOUR, ZERO, ZERO_ADDRESS } from "@utils/constants"
import { MassetDetails, MassetMachine, StandardAccounts, FeederMachine, FeederDetails } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { Account } from "types"
import {
    FeederPool,
    Masset,
    AssetProxy__factory,
    ExposedMasset,
    IERC4626Vault,
    MockConnector__factory,
    MockERC20,
    MockERC20__factory,
    MockErroneousConnector1__factory,
    MockErroneousConnector2__factory,
    MockLendingConnector,
    MockLendingConnector__factory,
    MockMasset,
    MockMasset__factory,
    MockNexus,
    MockNexus__factory,
    MockSavingsManager,
    MockSavingsManager__factory,
    MockVaultConnector,
    MockVaultConnector__factory,
    SavingsContract,
    SavingsContract__factory,
    Unwrapper,
    Unwrapper__factory,
} from "types/generated"
import { getTimestamp } from "@utils/time"
import { IModuleBehaviourContext, shouldBehaveLikeModule } from "../shared/Module.behaviour"
import { IERC4626BehaviourContext, shouldBehaveLikeERC4626 } from "../shared/ERC4626.behaviour"

interface Balances {
    totalCredits: BN
    userCredits: BN
    userUnderlying: BN
    user: BN
    contract: BN
    userOutput?: BN
    contractOutput?: BN
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

interface ConfigRedeemAndUnwrap {
    amount: BN
    isCreditAmt: boolean
    isBassetOut: boolean
    beneficiary: Account
    output: MockERC20 // Asset to unwrap from underlying
    router: ExposedMasset | FeederPool | MockERC20 // Router address = mAsset || feederPool
}

enum ContractFns {
    // deposits
    DEPOSIT_SAVINGS,
    DEPOSIT,
    // mints
    MINT,
    // redeems
    REDEEM_CREDITS,
    REDEEM,
    // withdraws
    REDEEM_UNDERLYING,
    WITHDRAW,
}
interface ContractFnType {
    type: ContractFns
    name: string
    fn: string
    fnReceiver?: string
    fnReferrer?: string
    event: string
}

const depositSavingsFn: ContractFnType = {
    type: ContractFns.DEPOSIT_SAVINGS,
    name: "depositSavings",
    fn: "depositSavings(uint256)",
    fnReceiver: "depositSavings(uint256,address)",
    fnReferrer: "depositSavings(uint256,address,address)",
    event: "SavingsDeposited",
}

const deposit4626Fn: ContractFnType = {
    type: ContractFns.DEPOSIT,
    name: "deposit 4626",
    fn: "deposit(uint256,address)",
    fnReceiver: "deposit(uint256,address)",
    fnReferrer: "deposit(uint256,address,address)",
    event: "Deposit",
}
const mint4626Fn: ContractFnType = {
    type: ContractFns.MINT,
    name: "mint 4626",
    fn: "mint(uint256,address)",
    fnReceiver: "mint(uint256,address)",
    fnReferrer: "mint(uint256,address,address)",
    event: "Deposit",
}
const redeemCreditsFn: ContractFnType = {
    type: ContractFns.REDEEM_CREDITS,
    name: "redeemCredits",
    fn: "redeemCredits(uint256)",
    event: "CreditsRedeemed",
}
const redeem4626Fn: ContractFnType = {
    type: ContractFns.REDEEM,
    name: "redeem 4626",
    fn: "redeem(uint256,address,address)",
    event: "Withdraw",
}
const redeemUnderlyingFn: ContractFnType = {
    type: ContractFns.REDEEM_UNDERLYING,
    name: "redeemUnderlying",
    fn: "redeemUnderlying(uint256)",
    event: "CreditsRedeemed",
}
const withdraw4626Fn: ContractFnType = {
    type: ContractFns.WITHDRAW,
    name: "withdraw 4626",
    fn: "withdraw(uint256,address,address)",
    event: "Withdraw",
}

// MockERC20 & Masset
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
            userUnderlying: await contract.balanceOfUnderlying(user.address),
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
const getOutputData = async (contract: SavingsContract, user: Account, output: MockERC20): Promise<Data> => {
    const data = await getData(contract, user)
    return {
        ...data,
        balances: {
            ...data.balances,
            userOutput: await output.balanceOf(user.address),
            contractOutput: await output.balanceOf(contract.address),
        },
    }
}

const getExpectedPoke = (data: Data, withdrawCredits: BN = BN.from(0)): ExpectedPoke => {
    const { balances, connector, exchangeRate } = data
    const totalCollat = creditsToUnderlying(balances.totalCredits.sub(withdrawCredits), exchangeRate)
    const connectorDerived = balances.contract.gt(totalCollat) ? BN.from(0) : totalCollat.sub(balances.contract)
    const max = totalCollat.mul(connector.fraction.add(simpleToExactAmount(2, 17))).div(fullScale)
    const ideal = totalCollat.mul(connector.fraction).div(fullScale)
    const pokeType = connector.balance.gt(ideal) ? "withdraw" : "deposit"
    return {
        aboveMax: connectorDerived.gt(max),
        type: connector.balance.eq(ideal) ? "none" : pokeType,
        amount: connector.balance.gte(ideal) ? connector.balance.sub(ideal) : ideal.sub(connector.balance),
        ideal,
    }
}

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
    let charlie: Account
    const ctx: Partial<IModuleBehaviourContext> = {}
    const ctxVault: Partial<IERC4626BehaviourContext> = {}
    const initialExchangeRate = simpleToExactAmount(1, 17)

    let mAssetMachine: MassetMachine

    let savingsContract: SavingsContract
    let savingsFactory: SavingsContract__factory
    let connectorFactory: MockConnector__factory
    let unwrapperFactory: Unwrapper__factory
    let unwrapperContract: Unwrapper
    let nexus: MockNexus
    let masset: MockMasset

    const createNewSavingsContract = async (): Promise<void> => {
        // Use a mock Nexus so we can dictate addresses
        nexus = await (await new MockNexus__factory(sa.default.signer)).deploy(sa.governor.address, manager.address, DEAD_ADDRESS)
        // Use a mock mAsset so we can dictate the interest generated
        masset = await (await new MockMasset__factory(sa.default.signer)).deploy("MOCK", "MOCK", 18, sa.default.address, 1000000000)

        unwrapperFactory = await new Unwrapper__factory(sa.default.signer)
        unwrapperContract = await unwrapperFactory.deploy(nexus.address)

        savingsFactory = await new SavingsContract__factory(sa.default.signer)
        const impl = await savingsFactory.deploy(nexus.address, masset.address, unwrapperContract.address)
        const data = impl.interface.encodeFunctionData("initialize", [sa.default.address, "Savings Credit", "imUSD"])
        const proxy = await (await new AssetProxy__factory(sa.default.signer)).deploy(impl.address, sa.dummy4.address, data)
        savingsContract = await savingsFactory.attach(proxy.address)

        // Use a mock SavingsManager so we don't need to run integrations
        const mockSavingsManager = await (await new MockSavingsManager__factory(sa.default.signer)).deploy(savingsContract.address)
        await nexus.setSavingsManager(mockSavingsManager.address)
    }
    const depositToSenderFn =
        (contractFn) =>
        (contract: SavingsContract) =>
        (...args) => {
            if (contractFn.type === ContractFns.DEPOSIT_SAVINGS) {
                return contract[contractFn.fn](...args)
            }
            return contract[contractFn.fn](...args, contract.signer.getAddress())
        }
    const redeemToSenderFn =
        (contractFn) =>
        (contract: SavingsContract) =>
        (...args) => {
            if (contractFn.type === ContractFns.REDEEM_CREDITS) {
                return contract[contractFn.fn](...args)
            }
            return contract[contractFn.fn](...args, contract.signer.getAddress(), contract.signer.getAddress())
        }

    const withdrawToSenderFn =
        (contractFn) =>
        (contract: SavingsContract) =>
        (...args) => {
            if (contractFn.type === ContractFns.REDEEM_UNDERLYING) {
                return contract[contractFn.fn](...args)
            }
            return contract[contractFn.fn](...args, contract.signer.getAddress(), contract.signer.getAddress())
        }

    before(async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        manager = sa.dummy2
        alice = sa.default
        bob = sa.dummy3
        charlie = sa.dummy4
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
        describe("behave like a Vault ERC4626", async () => {
            beforeEach(async () => {
                await createNewSavingsContract()
                await savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(false)

                ctxVault.vault = savingsContract as unknown as IERC4626Vault
                ctxVault.asset = masset
                ctxVault.sa = sa
            })
            shouldBehaveLikeERC4626(ctxVault as IERC4626BehaviourContext)
        })
    })

    describe("constructor", async () => {
        it("should fail when masset address is zero", async () => {
            await expect(savingsFactory.deploy(nexus.address, ZERO_ADDRESS, unwrapperContract.address)).to.be.revertedWith(
                "mAsset address is zero",
            )

            savingsContract = await savingsFactory.deploy(nexus.address, masset.address, unwrapperContract.address)
            await expect(savingsContract.initialize(ZERO_ADDRESS, "Savings Credit", "imUSD")).to.be.revertedWith("Invalid poker address")
        })
        it("should fail when unwrapper address is zero", async () => {
            await expect(savingsFactory.deploy(nexus.address, masset.address, ZERO_ADDRESS)).to.be.revertedWith("Unwrapper address is zero")
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

        async function validateDeposits(contractFn: ContractFnType) {
            const depositToSender = depositToSenderFn(contractFn)
            async function expectToEmitDepositEvent(tx, sender: string, receiver: string, depositAmount: BN, expectedCredits: BN) {
                switch (contractFn.type) {
                    case ContractFns.DEPOSIT_SAVINGS:
                        await expect(tx).to.emit(savingsContract, contractFn.event).withArgs(receiver, depositAmount, expectedCredits)
                        break
                    case ContractFns.DEPOSIT:
                    default:
                        await expect(tx)
                            .to.emit(savingsContract, contractFn.event)
                            .withArgs(sender, receiver, depositAmount, expectedCredits)
                        break
                }
            }
            describe(`using ${contractFn.name}`, async () => {
                before(async () => {
                    await createNewSavingsContract()
                })
                afterEach(async () => {
                    const data = await getData(savingsContract, alice)
                    expect(exchangeRateHolds(data), "Exchange rate must hold")
                })
                it("should fail when amount is zero", async () => {
                    await expect(depositToSender(savingsContract)(ZERO)).to.be.revertedWith("Must deposit something")
                })
                it("should fail when beneficiary is 0", async () => {
                    await expect(savingsContract[contractFn.fnReceiver](1, ZERO_ADDRESS)).to.be.revertedWith("Invalid beneficiary address")
                })
                it("should fail if the user has no balance", async () => {
                    // Approve first
                    await masset.connect(sa.dummy1.signer).approve(savingsContract.address, simpleToExactAmount(1, 18))

                    // Deposit
                    await expect(depositToSender(savingsContract.connect(sa.dummy1.signer))(simpleToExactAmount(1, 18))).to.be.revertedWith(
                        "VM Exception",
                    )
                })
                it("should deposit the mUSD and assign credits to the saver", async () => {
                    const dataBefore = await getData(savingsContract, sa.default)
                    const depositAmount = simpleToExactAmount(1, 18)

                    // 1. Approve the savings contract to spend mUSD
                    await masset.approve(savingsContract.address, depositAmount)
                    // 2. Deposit the mUSD
                    const tx = depositToSender(savingsContract)(depositAmount)
                    const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate)

                    await expectToEmitDepositEvent(tx, sa.default.address, sa.default.address, depositAmount, expectedCredits)
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

                    const tx = savingsContract.connect(alice.signer)[contractFn.fnReceiver](depositAmount, bob.address)
                    const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate)
                    await expectToEmitDepositEvent(tx, alice.address, bob.address, depositAmount, expectedCredits)
                    const dataAfter = await getData(savingsContract, bob)
                    expect(dataAfter.balances.userCredits).eq(expectedCredits, "Must receive some savings credits")
                    expect(dataAfter.balances.totalCredits).eq(expectedCredits.mul(2))
                    expect(dataAfter.balances.user).eq(dataBefore.balances.user)
                    expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.add(simpleToExactAmount(1, 18)))
                })
                it("allows alice to deposit to beneficiary (bob.address) with a referral (charlie.address)", async () => {
                    const dataBefore = await getData(savingsContract, bob)
                    const depositAmount = simpleToExactAmount(1, 18)

                    await masset.approve(savingsContract.address, depositAmount)

                    const tx = savingsContract.connect(alice.signer)[contractFn.fnReferrer](depositAmount, bob.address, charlie.address)
                    await expect(tx).to.emit(savingsContract, "Referral").withArgs(charlie.address, bob.address, depositAmount)

                    const expectedCredits = underlyingToCredits(depositAmount, initialExchangeRate)
                    await expectToEmitDepositEvent(tx, alice.address, bob.address, depositAmount, expectedCredits)
                    const dataAfter = await getData(savingsContract, bob)
                    expect(dataAfter.balances.userCredits, "Must receive some savings credits").eq(
                        dataBefore.balances.userCredits.add(expectedCredits),
                    )
                    expect(dataAfter.balances.totalCredits, "Total credits").eq(dataBefore.balances.totalCredits.add(expectedCredits))
                    expect(dataAfter.balances.user).eq(dataBefore.balances.user)
                    expect(dataAfter.balances.contract, "Contract balance").eq(dataBefore.balances.contract.add(simpleToExactAmount(1, 18)))
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
                        await depositToSender(savingsContract)(deposit)

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
                        const tx = depositToSender(savingsContract.connect(bob.signer))(deposit)
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
        }

        context("deposits", async () => {
            // V1,V2,V3
            await validateDeposits(depositSavingsFn)
            // ERC4626
            await validateDeposits(deposit4626Fn)
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
    describe("minting", async () => {
        const contractFn = mint4626Fn
        const mintToSender =
            (contract: SavingsContract) =>
            (...args) =>
                contract[contractFn.fn](...args, contract.signer.getAddress())

        async function expectToEmitDepositEvent(tx, sender: string, receiver: string, shares: BN, credits: BN) {
            await expect(tx).to.emit(savingsContract, contractFn.event).withArgs(sender, receiver, shares, credits)
        }
        before(async () => {
            await createNewSavingsContract()
        })
        afterEach(async () => {
            const data = await getData(savingsContract, alice)
            expect(exchangeRateHolds(data), "Exchange rate must hold")
        })
        it("should fail when amount is zero", async () => {
            await expect(mintToSender(savingsContract)(ZERO)).to.be.revertedWith("Must deposit something")
        })
        it("should fail when beneficiary is 0", async () => {
            await expect(savingsContract[contractFn.fnReceiver](10, ZERO_ADDRESS)).to.be.revertedWith("Invalid beneficiary address")
        })
        it("should fail if the user has no balance", async () => {
            // Approve first
            await masset.connect(sa.dummy1.signer).approve(savingsContract.address, simpleToExactAmount(1, 18))

            // Deposit
            await expect(mintToSender(savingsContract.connect(sa.dummy1.signer))(simpleToExactAmount(1, 18))).to.be.revertedWith(
                "VM Exception",
            )
        })
        it("should mint the imUSD and assign credits to the saver", async () => {
            const dataBefore = await getData(savingsContract, sa.default)
            let shares = simpleToExactAmount(10, 18)
            const assets = creditsToUnderlying(shares, initialExchangeRate)
            // emulate decimals in the smart contract
            shares = underlyingToCredits(assets, initialExchangeRate)

            // 1. Approve the savings contract to spend mUSD
            await masset.approve(savingsContract.address, assets)
            // 2. Deposit the mUSD
            const tx = mintToSender(savingsContract)(shares)
            await expectToEmitDepositEvent(tx, sa.default.address, sa.default.address, assets, shares)
            const dataAfter = await getData(savingsContract, sa.default)
            expect(dataAfter.balances.userCredits).eq(shares, "Must receive some savings credits")
            expect(dataAfter.balances.totalCredits).eq(shares)
            expect(dataAfter.balances.user).eq(dataBefore.balances.user.sub(assets))
            expect(dataAfter.balances.contract).eq(assets)
        })
        it("allows alice to mint to beneficiary (bob.address)", async () => {
            const dataBefore = await getData(savingsContract, bob)
            let shares = simpleToExactAmount(10, 18)
            const assets = creditsToUnderlying(shares, initialExchangeRate)
            // emulate decimals in the smart contract
            shares = underlyingToCredits(assets, initialExchangeRate)

            await masset.approve(savingsContract.address, assets)

            const tx = savingsContract.connect(alice.signer)[contractFn.fnReceiver](shares, bob.address)
            await expectToEmitDepositEvent(tx, alice.address, bob.address, assets, shares)
            const dataAfter = await getData(savingsContract, bob)
            expect(dataAfter.balances.userCredits).eq(shares, "Must receive some savings credits")
            expect(dataAfter.balances.totalCredits).eq(shares.mul(2))
            expect(dataAfter.balances.user).eq(dataBefore.balances.user)
            expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.add(assets))
        })
        it("allows alice to mint to beneficiary (bob.address) with a referral (charlie.address)", async () => {
            const dataBefore = await getData(savingsContract, bob)
            let shares = simpleToExactAmount(10, 18)
            const assets = creditsToUnderlying(shares, initialExchangeRate)
            // emulate decimals in the smart contract
            shares = underlyingToCredits(assets, initialExchangeRate)
            // emulate decimals in the smart contract
            await masset.approve(savingsContract.address, assets)

            const tx = savingsContract.connect(alice.signer)[contractFn.fnReferrer](shares, bob.address, charlie.address)
            await expect(tx).to.emit(savingsContract, "Referral").withArgs(charlie.address, bob.address, assets)
            await expectToEmitDepositEvent(tx, alice.address, bob.address, assets, shares)
            const dataAfter = await getData(savingsContract, bob)
            expect(dataAfter.balances.userCredits, "Must receive some savings credits").eq(dataBefore.balances.userCredits.add(shares))
            expect(dataAfter.balances.totalCredits).eq(dataBefore.balances.totalCredits.add(shares))
            expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.add(assets))
        })
    })
    describe("redeeming", async () => {
        async function validateRedeems(contractFn: ContractFnType) {
            const redeemToSender = redeemToSenderFn(contractFn)
            async function expectToEmitRedeemEvent(tx, sender: string, receiver: string, assets: BN, shares: BN) {
                switch (contractFn.type) {
                    case ContractFns.REDEEM:
                        await expect(tx).to.emit(savingsContract, contractFn.event).withArgs(sender, receiver, receiver, assets, shares)
                        break
                    case ContractFns.REDEEM_CREDITS:
                    default:
                        await expect(tx).to.emit(savingsContract, contractFn.event).withArgs(sender, shares, assets)
                        break
                }
            }
            describe(`scenario ${contractFn.name}`, async () => {
                before(async () => {
                    await createNewSavingsContract()
                })
                it("should fail when input is zero", async () => {
                    await expect(redeemToSender(savingsContract)(ZERO)).to.be.revertedWith("Must withdraw something")
                })
                it("should fail when user doesn't have credits", async () => {
                    const amt = BN.from(10)
                    await expect(redeemToSender(savingsContract.connect(sa.other.signer))(amt)).to.be.revertedWith("VM Exception")
                })
                describe(`using ${contractFn.name}`, async () => {
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
                        const tx = redeemToSender(savingsContract)(creditsToWithdraw)
                        await expectToEmitRedeemEvent(tx, alice.address, alice.address, expectedWithdrawal, creditsToWithdraw)
                        // await tx.wait()
                        const dataAfter = await getData(savingsContract, alice)
                        // burns credits from sender
                        expect(dataAfter.balances.userCredits).eq(dataBefore.balances.userCredits.sub(creditsToWithdraw))
                        expect(dataAfter.balances.totalCredits).eq(dataBefore.balances.totalCredits.sub(creditsToWithdraw))
                        // transfers tokens to sender
                        expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(expectedWithdrawal))
                        expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.sub(expectedWithdrawal))
                    })
                    it("should redeem a specific amount of credits and collect interest", async () => {
                        // calculates underlying/credits automateInterestCollection
                        const creditsToWithdraw = simpleToExactAmount(5, 18)
                        const expectedWithdrawal = creditsToUnderlying(creditsToWithdraw, initialExchangeRate)
                        const dataBefore = await getData(savingsContract, alice)
                        // Enable automateInterestCollection
                        await savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(true)

                        const tx = redeemToSender(savingsContract)(creditsToWithdraw)
                        await expectToEmitRedeemEvent(tx, alice.address, alice.address, expectedWithdrawal, creditsToWithdraw)
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
                        await redeemToSender(savingsContract)(credits)
                        const dataAfter = await getData(savingsContract, alice)
                        expect(dataAfter.balances.totalCredits).eq(BN.from(0))
                        // User receives their deposit back + interest
                        assertBNClose(dataAfter.balances.user, dataBefore.balances.user.add(deposit).add(interest), 100)
                        // Exchange rate updates
                        expect(dataAfter.exchangeRate).eq(expectedExchangeRate)
                    })
                })
                context("with a connector that surpasses limit", async () => {
                    const deposit = simpleToExactAmount(100, 18)
                    const redemption = underlyingToCredits(simpleToExactAmount(51, 18), initialExchangeRate)
                    before(async () => {
                        await createNewSavingsContract()
                        const connector = await (
                            await new MockConnector__factory(sa.default.signer)
                        ).deploy(savingsContract.address, masset.address)

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

                        const tx = redeemToSender(savingsContract)(redemption)
                        await expectToEmitRedeemEvent(tx, alice.address, alice.address, simpleToExactAmount(51, 18), redemption)
                        // Remaining balance is 49, with 20 in the connector
                        await expect(tx).to.emit(savingsContract, "Poked").withArgs(dataBefore.connector.balance, poke.ideal, BN.from(0))

                        const dataAfter = await getData(savingsContract, alice)
                        expect(dataAfter.balances.contract).eq(simpleToExactAmount("39.2", 18))
                    })
                    it("errors if triggered again within 4h", async () => {})
                })
            })
        }
        context("using redeem(uint256) (deprecated)", async () => {
            beforeEach(async () => {
                await createNewSavingsContract()
                await masset.approve(savingsContract.address, simpleToExactAmount(10, 18))
                await savingsContract["depositSavings(uint256)"](simpleToExactAmount(1, 18))
            })
            it("should fail when input is zero", async () => {
                await expect(savingsContract["redeem(uint256)"](ZERO)).to.be.revertedWith("Must withdraw something")
            })
            it("should fail when user doesn't have credits", async () => {
                const amt = BN.from(10)
                await expect(savingsContract.connect(sa.other.signer)["redeem(uint256)"](amt)).to.be.revertedWith("VM Exception")
            })
            it("should redeem when user has balance", async () => {
                const redemptionAmount = simpleToExactAmount(5, 18)
                const balancesBefore = await getData(savingsContract, sa.default)

                const tx = savingsContract["redeem(uint256)"](redemptionAmount)
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
                await savingsContract["redeem(uint256)"](creditsBefore)

                const creditsAfter = await savingsContract.creditBalances(sa.default.address)
                const mUSDAfter = await masset.balanceOf(sa.default.address)
                expect(creditsAfter, "Must burn all the credits").eq(BN.from(0))
                expect(mUSDAfter, "Must receive back mUSD").eq(mUSDBefore.add(redemptionAmount))
            })
        })
        describe("redeems", async () => {
            // V1,V2,V3
            await validateRedeems(redeemCreditsFn)
            // ERC4626
            await validateRedeems(redeem4626Fn)
        })
    })
    describe("withdrawing", async () => {
        async function validateWithdraws(contractFn: ContractFnType) {
            const withdrawToSender = withdrawToSenderFn(contractFn)
            async function expectToEmitWithdrawEvent(tx, sender: string, receiver: string, assets: BN, shares: BN) {
                switch (contractFn.type) {
                    case ContractFns.REDEEM_UNDERLYING:
                        await expect(tx).to.emit(savingsContract, contractFn.event).withArgs(sender, shares, assets)
                        break
                    case ContractFns.WITHDRAW:
                    default:
                        await expect(tx).to.emit(savingsContract, contractFn.event).withArgs(sender, receiver, sender, assets, shares)
                        break
                }
            }
            describe(`using ${contractFn.name}`, async () => {
                const assets = simpleToExactAmount(10, 18)
                const interest = simpleToExactAmount(10, 18)
                beforeEach(async () => {
                    await createNewSavingsContract()
                    await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                    await savingsContract.preDeposit(assets, alice.address)
                })
                afterEach(async () => {
                    const data = await getData(savingsContract, alice)
                    expect(exchangeRateHolds(data), "Exchange rate must hold")
                })
                it("should fail when input is zero", async () => {
                    await expect(withdrawToSender(savingsContract)(ZERO)).to.be.revertedWith("Must withdraw something")
                })
                it("should fail when user doesn't have credits", async () => {
                    const amt = BN.from(10)
                    await expect(withdrawToSender(savingsContract.connect(sa.other.signer))(amt)).to.be.revertedWith("VM Exception")
                })
                it("allows full redemption immediately after deposit", async () => {
                    await withdrawToSender(savingsContract)(assets)
                    const data = await getData(savingsContract, alice)
                    expect(data.balances.userCredits).eq(BN.from(0))
                })
                it("should redeem a specific amount of underlying", async () => {
                    // calculates underlying/credits
                    const underlying = simpleToExactAmount(5, 18)
                    const expectedCredits = underlyingToCredits(underlying, initialExchangeRate)
                    const dataBefore = await getData(savingsContract, alice)
                    const tx = withdrawToSender(savingsContract)(underlying)
                    await expectToEmitWithdrawEvent(tx, alice.address, alice.address, underlying, expectedCredits)
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
                    const expectedCredits = underlyingToCredits(assets, expectedExchangeRate)
                    const tx = await withdrawToSender(savingsContract)(assets)
                    await expectToEmitWithdrawEvent(tx, alice.address, alice.address, assets, expectedCredits)
                    const dataAfter = await getData(savingsContract, alice)

                    expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(assets))
                    // User is left with resulting credits due to exchange rate going up
                    assertBNClose(dataAfter.balances.userCredits, dataBefore.balances.userCredits.div(2), 1000)
                    // Exchange rate updates
                    expect(dataAfter.exchangeRate).eq(expectedExchangeRate)
                })
                it("skips interest collection if automate is turned off", async () => {
                    await masset.setAmountForCollectInterest(interest)
                    await savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(false)

                    const dataBefore = await getData(savingsContract, alice)
                    const tx = await withdrawToSender(savingsContract)(assets)
                    const expectedCredits = underlyingToCredits(assets, initialExchangeRate)
                    await expectToEmitWithdrawEvent(tx, alice.address, alice.address, assets, expectedCredits)
                    const dataAfter = await getData(savingsContract, alice)

                    expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(assets))
                    expect(dataAfter.balances.userCredits).eq(BN.from(0))
                    expect(dataAfter.exchangeRate).eq(dataBefore.exchangeRate)
                })
            })
        }
        describe("withdraws", async () => {
            // V1,V2,V3
            await validateWithdraws(redeemUnderlyingFn)
            // ERC4626
            await validateWithdraws(withdraw4626Fn)
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
            ;[redeemUnderlyingFn, withdraw4626Fn].forEach((fn) => {
                const withdrawToSender = withdrawToSenderFn(fn)
                it(`${fn.name} should fail if the raw balance goes down somehow`, async () => {
                    const connector = await (
                        await new MockErroneousConnector1__factory(sa.default.signer)
                    ).deploy(savingsContract.address, masset.address)
                    await savingsContract.connect(sa.governor.signer).setConnector(connector.address)
                    // Total collat goes down
                    await withdrawToSender(savingsContract)(deposit.div(2))
                    // Withdrawal is made but nothing comes back
                    await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(6).toNumber()])
                    await ethers.provider.send("evm_mine", [])
                    await savingsContract.poke()
                    // Try that again
                    await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(12).toNumber()])
                    await ethers.provider.send("evm_mine", [])
                    await expect(savingsContract.poke()).to.be.revertedWith("ExchangeRate must increase")
                })
                it(`${fn.name} is protected by the system invariant`, async () => {
                    // connector returns invalid balance after withdrawal
                    const connector = await (
                        await new MockErroneousConnector2__factory(sa.default.signer)
                    ).deploy(savingsContract.address, masset.address)
                    await savingsContract.connect(sa.governor.signer).setConnector(connector.address)
                    await withdrawToSender(savingsContract)(deposit.div(2))

                    await ethers.provider.send("evm_increaseTime", [ONE_HOUR.mul(4).toNumber()])
                    await ethers.provider.send("evm_mine", [])
                    await expect(savingsContract.poke()).to.be.revertedWith("Enforce system invariant")
                })
            })
            it("should fail if the balance has gone down", async () => {
                const connector = await (
                    await new MockErroneousConnector2__factory(sa.default.signer)
                ).deploy(savingsContract.address, masset.address)
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

                connector = await (
                    await new MockLendingConnector__factory(sa.default.signer)
                ).deploy(savingsContract.address, masset.address)
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
                const newConnector = await (
                    await new MockLendingConnector__factory(sa.default.signer)
                ).deploy(savingsContract.address, masset.address)
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
    ;[
        { deposit: depositSavingsFn, redeem: redeemCreditsFn },
        { deposit: deposit4626Fn, redeem: redeem4626Fn },
    ].forEach((fn, index) => {
        const depositToSender = depositToSenderFn(fn.deposit)
        const redeemToSender = redeemToSenderFn(fn.redeem)
        context(`performing multiple operations from multiple addresses in sequence - ${index}`, async () => {
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
                await depositToSender(savingsContract.connect(saver1.signer))(saver1deposit)
                await savingsContract.poke()
                const state1 = await getData(savingsContract, saver1)
                // 2.0 user 2 deposits
                // interest rate benefits user 1 and issued user 2 less credits than desired
                await masset.setAmountForCollectInterest(interestToReceive2)

                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                await depositToSender(savingsContract.connect(saver2.signer))(saver2deposit)
                const state2 = await getData(savingsContract, saver2)
                // 3.0 user 3 deposits
                // interest rate benefits users 1 and 2
                await masset.setAmountForCollectInterest(interestToReceive3)

                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                await depositToSender(savingsContract.connect(saver3.signer))(saver3deposit)
                const state3 = await getData(savingsContract, saver3)
                // 4.0 user 1 withdraws all her credits
                await redeemToSender(savingsContract.connect(saver1.signer))(state1.balances.userCredits)
                const state4 = await getData(savingsContract, saver1)
                expect(state4.balances.userCredits).eq(BN.from(0))
                expect(state4.balances.totalCredits).eq(state3.balances.totalCredits.sub(state1.balances.userCredits))
                expect(state4.exchangeRate).eq(state3.exchangeRate)
                assertBNClose(
                    state4.balances.contract,
                    creditsToUnderlying(state4.balances.totalCredits, state4.exchangeRate),
                    BN.from(100000),
                )
                // 5.0 user 4 deposits
                // interest rate benefits users 2 and 3
                await masset.setAmountForCollectInterest(interestToReceive4)

                await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()])
                await ethers.provider.send("evm_mine", [])
                await depositToSender(savingsContract.connect(saver4.signer))(saver4deposit)
                const state5 = await getData(savingsContract, saver4)
                // 6.0 users 2, 3, and 4 withdraw all their tokens
                await redeemToSender(savingsContract.connect(saver2.signer))(state2.balances.userCredits)
                await redeemToSender(savingsContract.connect(saver3.signer))(state3.balances.userCredits)
                await redeemToSender(savingsContract.connect(saver4.signer))(state5.balances.userCredits)
            })
        })
    })
})

/**
 * @dev (Re)Sets the local variables for this test file
 * @param {MassetMachine} mAssetMachine mints 25 tokens for each bAsset
 * @param {boolean} [seedBasket=true] mints 25 tokens for each bAsset
 * @param {boolean} [useTransferFees=false] enables transfer fees on bAssets [2,3]
 * @param {boolean} [useLendingMarkets=false]
 * @param {number[]} [weights=[25, 25, 25, 25]]
 * @return {*}  {Promise<MassetDetails>}
 */
const deployMassets = async (
    mAssetMachine: MassetMachine,
    seedBasket = true,
    useTransferFees = false,
    useLendingMarkets = false,
    weights: number[] = [25, 25, 25, 25],
): Promise<MassetDetails> => {
    const details = await mAssetMachine.deployMasset(useLendingMarkets, useTransferFees)
    if (seedBasket) {
        await mAssetMachine.seedWithWeightings(details, weights)
    }
    return details
}
const deployFeeder = async (
    feederMachine: FeederMachine,
    useLendingMarkets = false,
    useInterestValidator = false,
    feederWeights?: Array<BN | number>,
    mAssetWeights?: Array<BN | number>,
): Promise<FeederDetails> => feederMachine.deployFeeder(feederWeights, mAssetWeights, useLendingMarkets, useInterestValidator)

const createNewSavingsContract = async (
    mAssetMachine: MassetMachine,
    details: MassetDetails,
): Promise<{
    savingsContract: SavingsContract
    unwrapperContract: Unwrapper
    mockSavingsManager: MockSavingsManager
}> => {
    // Deploy Exposed Massets Mocks
    const sa = mAssetMachine.sa
    const nexus = details.nexus
    const masset = details.mAsset

    const unwrapperFactory = await new Unwrapper__factory(sa.default.signer)
    const unwrapperContract = await unwrapperFactory.deploy(nexus.address)

    const savingsFactory = await new SavingsContract__factory(sa.default.signer)
    const impl = await savingsFactory.deploy(nexus.address, masset.address, unwrapperContract.address)
    const data = impl.interface.encodeFunctionData("initialize", [sa.default.address, "Savings Credit", "imUSD"])
    const proxy = await (await new AssetProxy__factory(sa.default.signer)).deploy(impl.address, sa.dummy4.address, data)
    const savingsContract = await savingsFactory.attach(proxy.address)

    // Use a mock SavingsManager so we don't need to run integrations
    const mockSavingsManager = await (await new MockSavingsManager__factory(sa.default.signer)).deploy(savingsContract.address)
    await nexus.setSavingsManager(mockSavingsManager.address)

    return {
        savingsContract,
        unwrapperContract,
        mockSavingsManager,
    }
}

const runSetup = async (
    mAssetMachine: MassetMachine,
    feederMachine: FeederMachine,
): Promise<{
    masset: MockERC20 & Masset
    mDetails: MassetDetails
    fDetails: FeederDetails
    savingsContract: SavingsContract
}> => {
    // Deploy Exposed Massets Mocks
    let mDetails: MassetDetails
    let fDetails: FeederDetails
    const sa = mAssetMachine.sa

    if (feederMachine === null) {
        // Deploy Masset +
        mDetails = await deployMassets(mAssetMachine)
    } else {
        // Deploy Masset + Feeder pool
        fDetails = await deployFeeder(feederMachine)
        mDetails = fDetails.mAssetDetails
    }
    const masset = mDetails.mAsset

    const { savingsContract, unwrapperContract, mockSavingsManager } = await createNewSavingsContract(mAssetMachine, mDetails)

    if (feederMachine) {
        // approve tokens for router
        const routers = [fDetails.pool.address, fDetails.pool.address]
        const tokens = [masset.address, fDetails.fAsset.address]
        await unwrapperContract.connect(sa.governor.signer).approve(routers, tokens)
    }

    //  Approve masset
    const savingsManagerAccountAddress = mockSavingsManager.address
    const savingsManagerAccountSigner = mockSavingsManager.signer

    await masset.transfer(savingsManagerAccountAddress, simpleToExactAmount(20, 18))
    await masset.connect(savingsManagerAccountSigner).approve(savingsContract.address, simpleToExactAmount(20, 18))
    await masset.connect(sa.default.signer).approve(savingsContract.address, simpleToExactAmount(20, 18))

    await savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(false)
    await savingsContract.preDeposit(simpleToExactAmount(20, 18), sa.default.address)

    return {
        masset,
        mDetails,
        fDetails,
        savingsContract,
    }
}

describe("SavingsContract with Unwrapper", async () => {
    let sa: StandardAccounts
    let alice: Account
    const initialExchangeRate = simpleToExactAmount(1, 17)
    const deposit = simpleToExactAmount(1, 18)
    const credits = underlyingToCredits(deposit, initialExchangeRate)

    let mAssetMachine: MassetMachine
    let feederMachine: FeederMachine

    let savingsContract: SavingsContract
    let masset: MockERC20 & Masset
    let mDetails: MassetDetails
    let fDetails: FeederDetails

    const validateAssetRedemption = async (config: ConfigRedeemAndUnwrap) => {
        const dataBefore = await getOutputData(savingsContract, config.beneficiary, config.output)

        let creditsToWithdraw
        let expectedWithdrawal

        // If it is credit, calculate underlying/bAsset/fPool amount
        if (config.isCreditAmt) {
            creditsToWithdraw = config.amount
            expectedWithdrawal = creditsToUnderlying(creditsToWithdraw, initialExchangeRate)
        } else {
            // If it is not credit, calculate credits amount
            creditsToWithdraw = underlyingToCredits(config.amount, initialExchangeRate)
            expectedWithdrawal = creditsToUnderlying(creditsToWithdraw, initialExchangeRate)
        }
        const minAmountOut = expectedWithdrawal.mul(98).div(1e2)

        const tx = savingsContract.redeemAndUnwrap(
            config.amount,
            config.isCreditAmt,
            minAmountOut,
            config.output.address,
            config.beneficiary.address,
            config.router.address,
            config.isBassetOut,
        )
        // creditsRedeemed , savingsCredited
        await expect(tx)
            .to.emit(savingsContract, "CreditsRedeemed")
            .withArgs(config.beneficiary.address, creditsToWithdraw, expectedWithdrawal)
        const dataAfter = await getOutputData(savingsContract, config.beneficiary, config.output)

        // burns credits from sender
        expect(dataAfter.balances.userCredits, "user credits balance reduced").eq(dataBefore.balances.userCredits.sub(creditsToWithdraw))
        expect(dataAfter.balances.totalCredits, "contract credits balance reduced").eq(
            dataBefore.balances.totalCredits.sub(creditsToWithdraw),
        )
        // transfers tokens to sender
        expect(dataAfter.balances.user, "user mAsset balance unchanged").eq(dataBefore.balances.user)
        expect(dataAfter.balances.contract, "contract mAsset balance reduced").eq(dataBefore.balances.contract.sub(expectedWithdrawal))
        // transfer output tokens to beneficiary
        expect(dataAfter.balances.contractOutput, "contract output balance unchanged").eq(dataBefore.balances.contractOutput)
        assertBNClosePercent(
            dataAfter.balances.userOutput,
            dataBefore.balances.userOutput.add(expectedWithdrawal),
            "2",
            "user output balance increased",
        )
    }

    context("redeemAndUnwrap", async () => {
        let config: ConfigRedeemAndUnwrap

        context("masset/imAsset to bAsset", async () => {
            // Deploy saving contract and mock savings manager.
            before("Init contract", async () => {
                const accounts = await ethers.getSigners()
                mAssetMachine = await new MassetMachine().initAccounts(accounts)
                // set up accounts
                sa = mAssetMachine.sa
                alice = sa.default
                ;({ mDetails, fDetails, savingsContract, masset } = await runSetup(mAssetMachine, null))

                config = {
                    amount: deposit,
                    isCreditAmt: false,
                    isBassetOut: true,
                    beneficiary: alice,
                    output: mDetails.bAssets[0], // bAsset,
                    router: masset, // mAsset,
                }
            })
            afterEach(async () => {
                const data = await getData(savingsContract, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })

            it("should redeem mAsset to bAsset", async () => {
                // Given a N amount of mAsset (isCreditAmt = false)
                // When it redeems and unwraps to a bAsset
                await validateAssetRedemption(config)
                // Then N bAsset must be redeem to the beneficiary
            })
            it("should redeem imAsset to bAsset", async () => {
                // Given a N amount of imAsset (isCreditAmt = true)
                config = {
                    ...config,
                    isCreditAmt: true,
                    amount: credits,
                    output: mDetails.bAssets[0],
                }
                // When it redeems and unwraps to a bAsset
                await validateAssetRedemption(config)
                // Then N * exchange rate  bAsset must be redeem to the beneficiary
            })
            context("fails", async () => {
                it("when arguments are zero", async () => {
                    await expect(
                        savingsContract.redeemAndUnwrap(
                            ZERO,
                            config.isCreditAmt,
                            ZERO,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            config.isBassetOut,
                        ),
                    ).to.be.revertedWith("Must withdraw something")
                    await expect(
                        savingsContract.redeemAndUnwrap(
                            config.amount,
                            config.isCreditAmt,
                            ZERO,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            config.isBassetOut,
                        ),
                    ).to.be.revertedWith("Output address is zero")
                    await expect(
                        savingsContract.redeemAndUnwrap(
                            config.amount,
                            config.isCreditAmt,
                            ZERO,
                            config.output.address,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            config.isBassetOut,
                        ),
                    ).to.be.revertedWith("Beneficiary address is zero")
                    await expect(
                        savingsContract.redeemAndUnwrap(
                            config.amount,
                            config.isCreditAmt,
                            ZERO,
                            config.output.address,
                            config.beneficiary.address,
                            ZERO_ADDRESS,
                            config.isBassetOut,
                        ),
                    ).to.be.revertedWith("Router address is zero")
                })
                it("to redeem mAsset to mAsset as it is an 'Invalid asset'", async () => {
                    // Given n amount of mAsset
                    config = {
                        ...config,
                        amount: deposit,
                        isCreditAmt: false,
                        output: masset,
                        router: masset,
                    }

                    // When it redeems and unwraps to a mAsset
                    // Then it fails as it is an invalid asset
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("Invalid asset")
                })
                it("to redeem mAsset to bAsset with wrong isBassetOut argument", async () => {
                    // Given a N amount of mAsset (isCreditAmt = false)
                    config = {
                        ...config,
                        amount: deposit,
                        isCreditAmt: false,
                        isBassetOut: false,
                        output: mDetails.bAssets[0],
                        router: masset, // mAsset,
                    }

                    // When it redeems and unwraps to a bAsset
                    // Then it fails as it is an invalid asset
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("Invalid asset")
                })
                it("to redeem imAsset to bAsset with wrong isBassetOut argument", async () => {
                    // Given a N amount of mAsset (isCreditAmt = true)
                    config = {
                        ...config,
                        isCreditAmt: true,
                        amount: credits,
                        isBassetOut: false,
                        output: mDetails.bAssets[0],
                        router: masset,
                    }

                    // When it redeems and unwraps to a bAsset
                    // Then it fails as it is an invalid asset
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("Invalid asset")
                })
                it("to redeem imAsset to mAsset with wrong isBassetOut argument", async () => {
                    // Given a N amount of mAsset (isCreditAmt = true)
                    config = {
                        ...config,
                        amount: credits,
                        isCreditAmt: true,
                        isBassetOut: false,
                        output: masset,
                        router: masset,
                    }

                    // When it redeems and unwraps to a bAsset
                    // Then it fails as it is an invalid pair
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("Invalid pair")
                })
                it("to redeem imAsset that exceeds balance", async () => {
                    // Given a N amount of imAsset (isCreditAmt = true)
                    const dataBefore = await getOutputData(savingsContract, config.beneficiary, config.output)

                    config = {
                        ...config,
                        isCreditAmt: true,
                        amount: dataBefore.balances.userCredits.add(1),
                        output: mDetails.bAssets[0],
                    }
                    // When it redeems more credits that its balance
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("ERC20: burn amount exceeds balance")
                })
                it("to redeem mAsset that exceeds balance", async () => {
                    // Given a N amount of imAsset (isCreditAmt = false)
                    const dataBefore = await getOutputData(savingsContract, config.beneficiary, config.output)
                    config = {
                        ...config,
                        isCreditAmt: false,
                        amount: dataBefore.balances.user.add(1),
                        output: mDetails.bAssets[0],
                    }
                    // When it redeems more mAsset that its balance
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("ERC20: burn amount exceeds balance")
                })
            })
        })
        context("masset/imAsset to fAsset", async () => {
            // Deploy saving contract and mock savings manager.
            before("init contract", async () => {
                const accounts = await ethers.getSigners()
                mAssetMachine = await new MassetMachine().initAccounts(accounts)
                // set up accounts
                sa = mAssetMachine.sa
                alice = sa.default
                feederMachine = await new FeederMachine(mAssetMachine)
                ;({ mDetails, fDetails, savingsContract, masset } = await runSetup(mAssetMachine, feederMachine))

                config = {
                    amount: deposit,
                    isCreditAmt: false,
                    isBassetOut: true,
                    beneficiary: alice,
                    output: fDetails.fAsset, // fAsset,
                    router: fDetails.pool, // fPool,
                }
            })
            it("should redeem mAsset to fAsset", async () => {
                // Given a N amount of mAsset (isCreditAmt = false)
                config = {
                    ...config,
                    isCreditAmt: false,
                    isBassetOut: false,
                    amount: deposit,
                    output: fDetails.fAsset, // fAsset,
                    router: fDetails.pool, // fPool,
                }
                // When it redeems and unwraps to a fAsset
                await validateAssetRedemption(config)
            })
            it("should redeem imAsset to fAsset", async () => {
                // Given a N amount of imAsset (isCreditAmt = true)
                config = {
                    ...config,
                    isCreditAmt: true,
                    isBassetOut: false,
                    amount: credits,
                    output: fDetails.fAsset, // fAsset,
                    router: fDetails.pool, // fPool,
                }
                // When it redeems and unwraps to a bAsset
                await validateAssetRedemption(config)
                // Then N * exchange rate  bAsset must be redeem to the beneficiary
            })
            context("fails", async () => {
                it("to redeem mAsset to fAsset with wrong isBassetOut argument", async () => {
                    // Given a N amount of fAsset (isCreditAmt = false)
                    config = {
                        ...config,
                        amount: deposit,
                        isCreditAmt: false,
                        isBassetOut: true,
                        output: fDetails.fAsset, // fAsset,
                        router: fDetails.pool, // fPool,
                    }

                    // When it redeems and unwraps to a fAsset
                    // Then it fails as it is an invalid asset
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("ERC20: burn amount exceeds balance")
                })
                it("to redeem imAsset to fAsset with wrong isBassetOut argument", async () => {
                    // Given a N amount of mAsset (isCreditAmt = true)
                    config = {
                        ...config,
                        isCreditAmt: true,
                        amount: credits,
                        isBassetOut: true,
                        output: fDetails.fAsset, // fAsset,
                        router: fDetails.pool, // fPool,
                    }

                    // When it redeems and unwraps to a fAsset
                    // Then it fails as it is an invalid asset
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("ERC20: burn amount exceeds balance")
                })
                it("to redeem imAsset that exceeds balance", async () => {
                    // Given a N amount of imAsset (isCreditAmt = true)
                    const dataBefore = await getOutputData(savingsContract, config.beneficiary, config.output)

                    config = {
                        ...config,
                        isCreditAmt: true,
                        isBassetOut: false,
                        amount: dataBefore.balances.userCredits.add(1),
                        output: fDetails.fAsset, // fAsset,
                        router: fDetails.pool, // fPool,
                    }
                    // When it redeems more credits that its balance
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("ERC20: burn amount exceeds balance")
                })
                it("to redeem fAsset that exceeds balance", async () => {
                    // Given a N amount of imAsset (isCreditAmt = false)
                    const dataBefore = await getOutputData(savingsContract, config.beneficiary, config.output)
                    config = {
                        ...config,
                        isCreditAmt: false,
                        isBassetOut: false,
                        amount: dataBefore.balances.user.add(1),
                        output: fDetails.fAsset, // fAsset,
                        router: fDetails.pool, // fPool,
                    }
                    // When it redeems more mAsset that its balance
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("ERC20: burn amount exceeds balance")
                })
                it("to redeem mAsset with wrong router", async () => {
                    // Given a N amount of imAsset (isCreditAmt = false)
                    config = {
                        ...config,
                        isCreditAmt: false,
                        isBassetOut: false,
                        amount: deposit,
                        output: fDetails.pool, // fAsset,
                        router: fDetails.mAsset, // fPool,
                    }
                    // When it redeems more mAsset that its balance
                    // await validateAssetRedemption(config)
                    await expect(validateAssetRedemption(config)).to.be.revertedWith("Invalid asset")
                })
            })
        })
    })
})
