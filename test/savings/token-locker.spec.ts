/* eslint-disable @typescript-eslint/naming-convention */

import { ethers } from "hardhat"
import { expect } from "chai"
import { simpleToExactAmount, BN } from "@utils/math"
import { assertBNClose, assertBNClosePercent, assertBNSlightlyGTPercent } from "@utils/assertions"
import { StandardAccounts, MassetMachine } from "@utils/machines"
import { fullScale, ZERO_ADDRESS, ZERO, MAX_UINT256, TEN_MINS, ONE_DAY, DEAD_ADDRESS, ONE_WEEK, ONE_MIN } from "@utils/constants"
import { getTimestamp, increaseTime } from "@utils/time"
import {
    SavingsContract,
    MockNexus__factory,
    MockNexus,
    MockMasset,
    MockMasset__factory,
    SavingsContract__factory,
    SavingsManager,
    MockSavingsManager__factory,
    TokenLocker,
    TokenLocker__factory,
    PausableModule,
    MockERC20,
    MockRevenueRecipient__factory,
    Unwrapper__factory,
    Unwrapper,
} from "types/generated"
import { Account } from "types"
import { shouldBehaveLikePausableModule, IPausableModuleBehaviourContext } from "../shared/PausableModule.behaviour"

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
        lastLockerId: (await contract.totalSupply()).sub(1),
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
    const FIVE_TOKENS = TEN_TOKENS.div(BN.from(2))
    const THIRTY_MINUTES = TEN_MINS.mul(BN.from(3)).add(BN.from(1))
    const SIX_MONTHS = ONE_WEEK.mul(26);
    // 1.2 million tokens
    const INITIAL_MINT = BN.from(1200000)
    let sa: StandardAccounts
    let manager: Account
    let alice: Account
    let bob: Account
    let charlie: Account
    const ctx: Partial<IPausableModuleBehaviourContext> = {}

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
        charlie = sa.dummy4

        // Use a mock Nexus so we can dictate addresses
        nexus = await (await new MockNexus__factory(sa.default.signer)).deploy(sa.governor.address, manager.address, DEAD_ADDRESS)

        await createNewTokenLocker()
    })

    /*
    - should fail when amount is 0
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
    - should fail when user has no mAssets
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
})
