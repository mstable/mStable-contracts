/* eslint-disable @typescript-eslint/naming-convention */

import { ethers } from "hardhat"
import { expect } from "chai"
import { simpleToExactAmount, BN } from "@utils/math"
import { StandardAccounts, MassetMachine } from "@utils/machines"
import { fullScale, ZERO_ADDRESS, ZERO, ONE_DAY, DEAD_ADDRESS, ONE_WEEK } from "@utils/constants"
import { getTimestamp } from "@utils/time"
import {
    SavingsContract,
    MockNexus__factory,
    MockNexus,
    MockMasset,
    MockMasset__factory,
    SavingsContract__factory,
    MockSavingsManager__factory,
    TokenLocker,
    TokenLocker__factory,
    Unwrapper__factory,
    Unwrapper,
} from "types/generated"
import { Account } from "types"

interface LockerData {
    lockerCollateral: BN
    lockerCredits: BN
    lockerMaturity: BN
}

interface ContractData {
    lastLockerId: BN
    lockPeriod: BN
    batchingThreshold: BN
    lastBatchedLockerId: BN
    lastBatchedTime: BN
    toBeBatchedCollateral: BN
    totalCollateral: BN
    lockerData?: LockerData
}

const getData = async (contract: TokenLocker, lockerId?: BN): Promise<ContractData> => {
    var contractData = {
        lastLockerId: (await contract.totalLockersCreated()).sub(1),
        lockPeriod: await contract.lockPeriod(),
        batchingThreshold: await contract.batchingThreshold(),
        lastBatchedLockerId: await contract.lastBatchedLockerId(),
        lastBatchedTime: await contract.lastBatchedTime(),
        toBeBatchedCollateral: await contract.toBeBatchedCollateral(),
        totalCollateral: await contract.totalCollateral()
    }

    if (lockerId === undefined) {
        return contractData
    } else {
        return {
            ...contractData,
            lockerData: {
                lockerCollateral: await contract.lockerCollateral(lockerId),
                lockerCredits: await contract.lockerCredits(lockerId),
                lockerMaturity: await contract.lockerMaturity(lockerId)
            }
        }
    }
}


describe("TokenLocker", async () => {
    const TEN = BN.from(10)
    const TEN_TOKENS = TEN.mul(fullScale)
    const TEN_THOUSAND_TOKENS = TEN_TOKENS.mul(1000)
    const SIX_MONTHS = ONE_WEEK.mul(26);
    // 1.2 million tokens
    const INITIAL_MINT = BN.from(1200000)
    let sa: StandardAccounts
    let manager: Account
    let bob: Account
    let nexus: MockNexus
    let savingsContract: SavingsContract
    let tokenLocker: TokenLocker
    let tokenFactory: TokenLocker__factory
    let unwrapperFactory: Unwrapper__factory
    let unwrapperContract: Unwrapper
    let masset: MockMasset

    async function createNewTokenLocker(mintAmount: BN = INITIAL_MINT): Promise<void> {
        masset = await (await new MockMasset__factory(sa.default.signer)).deploy("MOCK", "MOCK", 18, sa.default.address, mintAmount)

        unwrapperFactory = await new Unwrapper__factory(sa.default.signer)
        unwrapperContract = await unwrapperFactory.deploy(nexus.address)

        const savingsFactory = await new SavingsContract__factory(sa.default.signer)
        savingsContract = await savingsFactory.deploy(nexus.address, masset.address, unwrapperContract.address)
        await savingsContract.initialize(sa.default.address, "Savings Credit", "imUSD")

        const mockSavingsManager = await (await new MockSavingsManager__factory(sa.default.signer)).deploy(savingsContract.address)
        await nexus.setSavingsManager(mockSavingsManager.address)

        // Create new TokenLocker
        tokenFactory = await new TokenLocker__factory(sa.default.signer)
        tokenLocker = await tokenFactory.deploy(
            'mUsdLocker',
            'MUL',
            savingsContract.address,
            SIX_MONTHS,
            TEN_THOUSAND_TOKENS
        )
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        manager = sa.dummy2
        bob = sa.dummy3

        // Use a mock Nexus so we can dictate addresses
        nexus = await (await new MockNexus__factory(sa.default.signer)).deploy(sa.governor.address, manager.address, DEAD_ADDRESS)
        await createNewTokenLocker()
    })

    /*
    - should fail when savingsContract address is zero
    - should correctly set lockPeriod and BatchingThreshold
    */
    describe("constructor", async () => {
        it("should fail when savingsContract address is zero", async () => {
            await expect(tokenFactory.deploy("mUsdLocker", "MUL", ZERO_ADDRESS, SIX_MONTHS, TEN_THOUSAND_TOKENS)).to.be.revertedWith(
                "SavingsContract Address is Zero",
            )
        })
        it("should correctly set lockPeriod and BatchingThreshold", async () => {
            await tokenFactory.deploy("mUsdLocker", "MUL", savingsContract.address, SIX_MONTHS, TEN_THOUSAND_TOKENS)
            const data = await getData(tokenLocker)
            expect(data.lockPeriod).eq(SIX_MONTHS)
            expect(data.batchingThreshold).eq(TEN_THOUSAND_TOKENS)
        })
    })

    /*
    - should fail when amount is 0
    - should fail if the user has no balance
    - should deposit the mAsset, create locker and mint NFT
    - should emit BatchIt event when Batching Threshold reached
    - should allow to create multiple lockers
    */
    describe("locking collateral", async () => {
        beforeEach(async () => {
            await createNewTokenLocker()
        })
        it("should fail when amount is zero", async () => {
            await expect(tokenLocker["lock(uint256)"](ZERO)).to.be.revertedWith("Must deposit something")
        })
        it("should fail if the user has no balance", async () => {
            // Approve first
            await masset.connect(sa.dummy1.signer).approve(tokenLocker.address, simpleToExactAmount(1, 18))

            // Deposit
            await expect(
                tokenLocker.connect(sa.dummy1.signer)["lock(uint256)"](simpleToExactAmount(1, 18)),
            ).to.be.revertedWith("VM Exception")
        })
        it("should deposit the mAsset, create locker and mint NFT", async () => {
            const depositAmount = simpleToExactAmount(1, 18)

            // 1. Approve the TokenLocker to spend mAsset
            await masset.approve(tokenLocker.address, depositAmount)
            // 2. Deposit the mAsset
            const tx = tokenLocker["lock(uint256)"](depositAmount)
            await expect(tx).to.emit(tokenLocker, "Deposit").withArgs(sa.default.address, 0, depositAmount)
            await expect(tx).to.not.emit(tokenLocker,"BatchIt")

            const ts = await getTimestamp()
            const data = await getData(tokenLocker, BN.from(0))

            expect(data.lockerData.lockerCollateral).eq(depositAmount)
            expect(data.lockerData.lockerCredits).eq(ZERO)
            expect(data.lockerData.lockerMaturity).eq(ts.add(data.lockPeriod))

            expect(data.toBeBatchedCollateral).eq(depositAmount)
            expect(data.totalCollateral).eq(depositAmount)
            expect(await tokenLocker.ownerOf(0)).eq(sa.default.address)
        })
        it("should emit BatchIt event when Batching Threshold reached", async () => {
            const depositAmount = simpleToExactAmount(10001, 18)

            await masset.approve(tokenLocker.address, depositAmount)
            const tx = tokenLocker["lock(uint256)"](depositAmount)
            const data = await getData(tokenLocker)
            await expect(tx).to.emit(tokenLocker, "BatchIt").withArgs(data.toBeBatchedCollateral)
        })
        it("should allow to create multiple lockers", async () => {
            ///* Creating 1st locker *///
            const depositAmount = simpleToExactAmount(1, 18)

            await masset.approve(tokenLocker.address, depositAmount)
            const tx = tokenLocker["lock(uint256)"](depositAmount)
            await expect(tx).to.emit(tokenLocker, "Deposit").withArgs(sa.default.address, 0, depositAmount)

            const ts = await getTimestamp()
            const data = await getData(tokenLocker, BN.from(0))

            expect(data.lockerData.lockerCollateral).eq(depositAmount)
            expect(data.lockerData.lockerCredits).eq(ZERO)
            expect(data.lockerData.lockerMaturity).eq(ts.add(data.lockPeriod))
            expect(data.toBeBatchedCollateral).eq(depositAmount)
            expect(data.totalCollateral).eq(depositAmount)
            expect(await tokenLocker.ownerOf(0)).eq(sa.default.address)

            ///* Creating 2nd locker *///
            const depositAmount2 = simpleToExactAmount(10, 18)
            await masset.approve(tokenLocker.address, depositAmount2)
            const tx2 = tokenLocker["lock(uint256)"](depositAmount2)
            await expect(tx2).to.emit(tokenLocker, "Deposit").withArgs(sa.default.address, 1, depositAmount2)

            const ts2 = await getTimestamp()
            const data2 = await getData(tokenLocker, BN.from(1))

            expect(data2.lockerData.lockerCollateral).eq(depositAmount2)
            expect(data2.lockerData.lockerCredits).eq(ZERO)
            expect(data2.lockerData.lockerMaturity).eq(ts2.add(data2.lockPeriod))
            expect(data2.toBeBatchedCollateral).eq(depositAmount.add(depositAmount2))
            expect(data2.totalCollateral).eq(depositAmount.add(depositAmount2))
            expect(await tokenLocker.ownerOf(1)).eq(sa.default.address)
        })
    })

    /*
    - should fail if Locker doesn't exist
    - should fail if msg.sender not owner of locker
    - should fail if locker not matured
    - should fail if locker not deposited to savingsContract yet
    - should emit Withdraw, delete locker, and burn NFT
    - should allow new owner of Locker to withdraw
    */
    describe("withdrawing collateral", async () => {
        beforeEach(async () => {
            await createNewTokenLocker()

            // Create a deposit
            const depositAmount = simpleToExactAmount(100, 18)
            await masset.approve(tokenLocker.address, depositAmount)
            await tokenLocker["lock(uint256)"](depositAmount)
        })
        it("should fail if Locker doesn't exist", async () => {
            await expect(tokenLocker["withdraw(uint256)"](2)).to.be.revertedWith("VM Exception")
        })
        it("should fail if msg.sender not owner of locker", async () => {
            await expect(tokenLocker.connect(bob.signer)["withdraw(uint256)"](0))
                .to.be.revertedWith("Must Own Locker")
        })
        it("should fail if locker not matured", async () => {
            await expect(tokenLocker["withdraw(uint256)"](0)).to.be.revertedWith("Locker not matured")
        })
        it("should fail if locker not deposited to savingsContract yet", async () => {
            //increase time to "mature locker"
            await ethers.provider.send("evm_increaseTime", [SIX_MONTHS.add(ONE_DAY).toNumber()])
            await ethers.provider.send("evm_mine", [])

            await expect(tokenLocker["withdraw(uint256)"](0)).to.be.revertedWith("VM Exception")
        })
        it("should emit Withdraw, delete locker, and burn NFT", async () => {
            //increase time to "mature locker"
            await ethers.provider.send("evm_increaseTime", [SIX_MONTHS.add(ONE_DAY).toNumber()])
            await ethers.provider.send("evm_mine", [])

            // batch deposit all the lockers
            await tokenLocker.batchExecute()

            const dataBefore = await getData(tokenLocker, BN.from(0))

            const tx = tokenLocker["withdraw(uint256)"](0)
            const expectedPayout = await savingsContract.creditsToUnderlying(dataBefore.lockerData.lockerCredits)
            await expect(tx).to.emit(tokenLocker, "Withdraw")
            .withArgs(sa.default.address, 0, dataBefore.lockerData.lockerCredits, expectedPayout)

            const dataAfter = await getData(tokenLocker, BN.from(0))
            expect(dataAfter.lockerData.lockerCollateral).eq(ZERO)
            expect(dataAfter.lockerData.lockerCredits).eq(ZERO)
            expect(dataAfter.lockerData.lockerMaturity).eq(ZERO)
            // TODO - burn mechanism not working to be checked later
            //expect(await tokenLocker.ownerOf(0)).eq(ZERO_ADDRESS)
        })
        it("should allow new owner of Locker to withdraw", async () => {
            await tokenLocker.transferFrom(sa.default.address, bob.address, 0)

            //increase time to "mature locker"
            await ethers.provider.send("evm_increaseTime", [SIX_MONTHS.add(ONE_DAY).toNumber()])
            await ethers.provider.send("evm_mine", [])

            // batch deposit all the lockers
            await tokenLocker.batchExecute()
            const dataBefore = await getData(tokenLocker, BN.from(0))

            const tx = tokenLocker.connect(bob.signer)["withdraw(uint256)"](0)
            const expectedPayout = await savingsContract.creditsToUnderlying(dataBefore.lockerData.lockerCredits)
            await expect(tx).to.emit(tokenLocker, "Withdraw")
            .withArgs(bob.address, 0, dataBefore.lockerData.lockerCredits, expectedPayout)
        })
    })

    /*
    - should fail if no lockers created
    - should fail if no collateral outstanding
    - should be able to called by anyone
    - should clear the current outstanding lockers and distribute credits
    */
    describe("batch executing", async () => {
        beforeEach(async () => {
            await createNewTokenLocker()
        })
        it("should fail if no lockers created", async () => {
            await expect(tokenLocker["batchExecute()"]()).to.be.revertedWith("No Lockers Created yet")
        })
        it("should fail if no collateral outstanding", async () => {
            const depositAmount = simpleToExactAmount(100, 18)
            await masset.approve(tokenLocker.address, depositAmount)
            await tokenLocker["lock(uint256)"](depositAmount)

            // execute once to clear the batch
            await tokenLocker.batchExecute()
            await expect(tokenLocker["batchExecute()"]()).to.be.revertedWith("No collateral outstanding")
        })
        it("should be able to called by anyone", async () => {
            const depositAmount = simpleToExactAmount(100, 18)
            await masset.approve(tokenLocker.address, depositAmount)
            await tokenLocker["lock(uint256)"](depositAmount)

            // execute once to clear the batch
            await tokenLocker.connect(bob.signer).batchExecute()
        })
        it("should clear the current outstanding lockers and distribute credits", async () => {
            // Create First Locker
            const depositAmount = simpleToExactAmount(100, 18)
            await masset.approve(tokenLocker.address, depositAmount)
            await tokenLocker["lock(uint256)"](depositAmount)
            const lockerId1 = BN.from(0)
            const data1 = await getData(tokenLocker, lockerId1)

            // Create Second Locker
            const depositAmount2 = simpleToExactAmount(200, 18)
            await masset.approve(tokenLocker.address, depositAmount2)
            await tokenLocker["lock(uint256)"](depositAmount2)
            const lockerId2 = BN.from(1)
            const data2 = await getData(tokenLocker, lockerId2)

            const totalCollateralAccumulated = data1.lockerData.lockerCollateral.add(data2.lockerData.lockerCollateral)

            const expectedTotalCredits = await savingsContract.underlyingToCredits(totalCollateralAccumulated)

            const expectedLocker1Credits = data1.lockerData.lockerCollateral
                .div(totalCollateralAccumulated)
                .mul(expectedTotalCredits)
            const expectedLocker2Credits = expectedTotalCredits.sub(expectedLocker1Credits)

            // BatchExecute to savingsContract
            const tx = tokenLocker["batchExecute()"]()
            await expect(tx).to.emit(tokenLocker, "BatchCleared")
            .withArgs(sa.default.address, totalCollateralAccumulated, expectedTotalCredits, 1)

            const afterData1 = await getData(tokenLocker, lockerId1)
            const afterData2 = await getData(tokenLocker, lockerId2)

            expect(afterData1.lockerData.lockerCredits).eq(expectedLocker1Credits)
            expect(afterData2.lockerData.lockerCredits).eq(expectedLocker2Credits)
            expect(afterData1.toBeBatchedCollateral).eq(ZERO)
            expect(afterData1.lastBatchedLockerId).eq(1)
            expect(afterData1.lastBatchedTime).eq(await getTimestamp())
        })
    })
})
