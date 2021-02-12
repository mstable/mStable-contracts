/* eslint-disable no-await-in-loop */

import { ethers } from "hardhat"
import { expect } from "chai"
import { utils } from "ethers"
import { simpleToExactAmount, BN } from "@utils/math"
import { assertBNClose, assertBNClosePercent, assertBNSlightlyGT } from "@utils/assertions"
import { StandardAccounts, MassetMachine, Account } from "@utils/machines"
import { fullScale, ZERO_ADDRESS, ONE_DAY, FIVE_DAYS, ONE_WEEK, DEAD_ADDRESS } from "@utils/constants"
import { getTimestamp, increaseTime } from "@utils/time"
import {
    MockERC20,
    MockERC20__factory,
    ImmutableModule,
    MockStakingContract,
    MockStakingContract__factory,
    InitializableRewardsDistributionRecipient,
    BoostedSavingsVault,
    BoostedSavingsVault__factory,
    MockNexus,
    MockNexus__factory,
    AssetProxy__factory,
} from "types/generated"
import {
    shouldBehaveLikeDistributionRecipient,
    IRewardsDistributionRecipientContext,
} from "../shared/RewardsDistributionRecipient.behaviour"

interface StakingBalance {
    raw: BN
    balance: BN
    totalSupply: BN
}

interface TokenBalance {
    sender: BN
    contract: BN
}

interface UserData {
    rewardPerTokenPaid: BN
    rewards: BN
    lastAction: BN
    rewardCount: number
    userClaim: BN
}
interface ContractData {
    rewardPerTokenStored: BN
    rewardRate: BN
    lastUpdateTime: BN
    lastTimeRewardApplicable: BN
    periodFinishTime: BN
}
interface Reward {
    start: BN
    finish: BN
    rate: BN
}

interface StakingData {
    boostBalance: StakingBalance
    tokenBalance: TokenBalance
    vMTABalance: BN
    userData: UserData
    userRewards: Reward[]
    contractData: ContractData
}

describe("SavingsVault", async () => {
    const ctx: Partial<IRewardsDistributionRecipientContext> = {}

    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let rewardsDistributor: Account

    let rewardToken: MockERC20
    let iMasset: MockERC20
    let nexus: MockNexus
    let savingsVault: BoostedSavingsVault
    let stakingContract: MockStakingContract

    const minBoost = simpleToExactAmount(5, 17)
    const maxBoost = simpleToExactAmount(15, 17)
    const coeff = 60
    const priceCoeff = simpleToExactAmount(1, 17)
    const lockupPeriod = ONE_WEEK.mul(26)

    const boost = (raw: BN, boostAmt: BN): BN => raw.mul(boostAmt).div(fullScale)

    const calcBoost = (raw: BN, vMTA: BN, priceCoefficient = priceCoeff): BN => {
        // min(d + c * vMTA^a / imUSD^b, m)
        const scaledBalance = raw.mul(priceCoefficient).div(simpleToExactAmount(1, 18))

        if (scaledBalance.lt(simpleToExactAmount(1, 18))) return minBoost

        let denom = parseFloat(utils.formatUnits(scaledBalance))
        denom **= 0.875
        const lhs = minBoost.add(vMTA.mul(coeff).div(10).mul(fullScale).div(simpleToExactAmount(denom)))
        return lhs.gt(maxBoost) ? maxBoost : lhs
    }

    const unlockedRewards = (total: BN): BN => total.div(5)

    const lockedRewards = (total: BN): BN => total.div(5).mul(4)

    const redeployRewards = async (priceCoefficient = priceCoeff): Promise<BoostedSavingsVault> => {
        nexus = await (await new MockNexus__factory(sa.default.signer)).deploy(sa.governor.address, DEAD_ADDRESS)
        rewardToken = await (await new MockERC20__factory(sa.default.signer)).deploy(
            "Reward",
            "RWD",
            18,
            rewardsDistributor.address,
            10000000,
        )
        iMasset = await (await new MockERC20__factory(sa.default.signer)).deploy(
            "Interest bearing mUSD",
            "imUSD",
            18,
            sa.default.address,
            1000000,
        )
        stakingContract = await (await new MockStakingContract__factory(sa.default.signer)).deploy()

        const vaultFactory = await new BoostedSavingsVault__factory(sa.default.signer)
        const impl = await vaultFactory.deploy(
            nexus.address,
            iMasset.address,
            stakingContract.address,
            priceCoefficient,
            rewardToken.address,
        )
        const data = impl.interface.encodeFunctionData("initialize", [rewardsDistributor.address])
        const proxy = await (await new AssetProxy__factory(sa.default.signer)).deploy(impl.address, sa.dummy4.address, data)
        return vaultFactory.attach(proxy.address)
    }

    const snapshotStakingData = async (sender = sa.default, beneficiary = sa.default): Promise<StakingData> => {
        const userData = await savingsVault.userData(beneficiary.address)
        const userRewards = []
        for (let i = 0; i < userData[3].toNumber(); i += 1) {
            const e = await savingsVault.userRewards(beneficiary.address, i)
            userRewards.push({
                start: e[0],
                finish: e[1],
                rate: e[2],
            })
        }
        return {
            boostBalance: {
                raw: await savingsVault.rawBalanceOf(beneficiary.address),
                balance: await savingsVault.balanceOf(beneficiary.address),
                totalSupply: await savingsVault.totalSupply(),
            },
            tokenBalance: {
                sender: await iMasset.balanceOf(sender.address),
                contract: await iMasset.balanceOf(savingsVault.address),
            },
            vMTABalance: await stakingContract.balanceOf(beneficiary.address),
            userData: {
                rewardPerTokenPaid: userData[0],
                rewards: userData[1],
                lastAction: userData[2],
                rewardCount: userData[3].toNumber(),
                userClaim: await savingsVault.userClaim(beneficiary.address),
            },
            userRewards,
            contractData: {
                rewardPerTokenStored: await savingsVault.rewardPerTokenStored(),
                rewardRate: await savingsVault.rewardRate(),
                lastUpdateTime: await savingsVault.lastUpdateTime(),
                lastTimeRewardApplicable: await savingsVault.lastTimeRewardApplicable(),
                periodFinishTime: await savingsVault.periodFinish(),
            },
        }
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        rewardsDistributor = sa.fundManager

        savingsVault = await redeployRewards()

        ctx.recipient = (savingsVault as unknown) as InitializableRewardsDistributionRecipient
        ctx.module = savingsVault as ImmutableModule
        ctx.sa = sa
    })

    describe("constructor & settings", async () => {
        beforeEach(async () => {
            savingsVault = await redeployRewards()
        })
        it("should set all initial state", async () => {
            // Set in constructor
            expect(await savingsVault.nexus()).to.eq(nexus.address)
            expect(await savingsVault.stakingToken()).to.eq(iMasset.address)
            expect(await savingsVault.stakingContract()).to.eq(stakingContract.address)
            expect(await savingsVault.rewardsToken()).to.eq(rewardToken.address)
            expect(await savingsVault.rewardsDistributor()).to.eq(rewardsDistributor.address)

            // Basic storage
            expect(await savingsVault.totalSupply()).to.be.eq(BN.from(0))
            expect(await savingsVault.periodFinish()).to.be.eq(BN.from(0))
            expect(await savingsVault.rewardRate()).to.be.eq(BN.from(0))
            expect(await savingsVault.lastUpdateTime()).to.be.eq(BN.from(0))
            expect(await savingsVault.rewardPerTokenStored()).to.be.eq(BN.from(0))
            expect(await savingsVault.lastTimeRewardApplicable()).to.be.eq(BN.from(0))
            expect(await savingsVault.rewardPerToken()).to.be.eq(BN.from(0))
        })

        shouldBehaveLikeDistributionRecipient(ctx as IRewardsDistributionRecipientContext)
    })

    /**
     * @dev Ensures the reward units are assigned correctly, based on the last update time, etc
     * @param beforeData Snapshot after the tx
     * @param afterData Snapshot after the tx
     * @param isExistingStaker Expect the staker to be existing?
     */
    const assertRewardsAssigned = async (
        beforeData: StakingData,
        afterData: StakingData,
        isExistingStaker: boolean,
        shouldResetRewards = false,
    ): Promise<void> => {
        const timeAfter = await getTimestamp()
        const periodIsFinished = BN.from(timeAfter).gt(beforeData.contractData.periodFinishTime)
        //    LastUpdateTime
        expect(
            periodIsFinished
                ? beforeData.contractData.periodFinishTime
                : beforeData.contractData.rewardPerTokenStored.eq(0) && beforeData.boostBalance.totalSupply.eq(0)
                ? beforeData.contractData.lastUpdateTime
                : timeAfter,
        ).to.be.eq(afterData.contractData.lastUpdateTime)
        //    RewardRate doesnt change
        expect(beforeData.contractData.rewardRate).to.be.eq(afterData.contractData.rewardRate)
        //    RewardPerTokenStored goes up
        expect(afterData.contractData.rewardPerTokenStored).to.be.gte(beforeData.contractData.rewardPerTokenStored)
        //      Calculate exact expected 'rewardPerToken' increase since last update
        const timeApplicableToRewards = periodIsFinished
            ? beforeData.contractData.periodFinishTime.sub(beforeData.contractData.lastUpdateTime)
            : timeAfter.sub(beforeData.contractData.lastUpdateTime)
        const increaseInRewardPerToken = beforeData.boostBalance.totalSupply.eq(BN.from(0))
            ? BN.from(0)
            : beforeData.contractData.rewardRate.mul(timeApplicableToRewards).mul(fullScale).div(beforeData.boostBalance.totalSupply)
        expect(beforeData.contractData.rewardPerTokenStored.add(increaseInRewardPerToken)).to.be.eq(
            afterData.contractData.rewardPerTokenStored,
        )
        // Expect updated personal state
        //    userRewardPerTokenPaid(beneficiary) should update
        expect(afterData.userData.rewardPerTokenPaid).to.be.eq(afterData.userData.rewardPerTokenPaid)

        const increaseInUserRewardPerToken = afterData.contractData.rewardPerTokenStored.sub(beforeData.userData.rewardPerTokenPaid)
        const assignment = beforeData.boostBalance.balance.mul(increaseInUserRewardPerToken).div(fullScale)
        //    If existing staker, then rewards Should increase
        if (shouldResetRewards) {
            expect(afterData.userData.rewards).to.be.eq(BN.from(0))
        } else if (isExistingStaker) {
            // rewards(beneficiary) should update with previously accrued tokens
            expect(beforeData.userData.rewards.add(unlockedRewards(assignment))).to.be.eq(afterData.userData.rewards)
        } else {
            // else `rewards` should stay the same
            expect(beforeData.userData.rewards).to.be.eq(afterData.userData.rewards)
        }

        // If existing staker, then a new entry should be appended
        const newRewards = afterData.contractData.rewardPerTokenStored.gt(beforeData.userData.rewardPerTokenPaid)
        if (isExistingStaker && newRewards) {
            const newLockEntry = afterData.userRewards[afterData.userData.rewardCount - 1]
            expect(newLockEntry.start).to.be.eq(beforeData.userData.lastAction.add(lockupPeriod))
            expect(newLockEntry.finish).to.be.eq(afterData.userData.lastAction.add(lockupPeriod))
            const elapsed = afterData.userData.lastAction.sub(beforeData.userData.lastAction)
            expect(newLockEntry.rate).to.be.eq(lockedRewards(assignment).div(elapsed))
            expect(afterData.userData.lastAction).to.be.eq(timeAfter)
        } else {
            expect(beforeData.userRewards.length).eq(afterData.userRewards.length)
            expect(beforeData.userData.rewardCount).eq(afterData.userData.rewardCount)
            expect(afterData.userData.lastAction).to.be.eq(timeAfter)
            expect(beforeData.userData.userClaim).to.be.eq(afterData.userData.userClaim)
        }
    }

    /**
     * @dev Ensures a stake is successful, updates the rewards for the beneficiary and
     * collects the stake
     * @param stakeAmount Exact units to stake
     * @param sender Sender of the tx
     * @param beneficiary Beneficiary of the stake
     * @param confirmExistingStaker Expect the staker to be existing?
     */
    const expectSuccessfulStake = async (
        stakeAmount: BN,
        sender = sa.default,
        beneficiary = sa.default,
        confirmExistingStaker = false,
    ): Promise<void> => {
        // 1. Get data from the contract
        const senderIsBeneficiary = sender === beneficiary
        const beforeData = await snapshotStakingData(sender, beneficiary)

        const isExistingStaker = beforeData.boostBalance.raw.gt(BN.from(0))
        if (confirmExistingStaker) {
            expect(isExistingStaker).eq(true)
        }
        // 2. Approve staking token spending and send the TX
        await iMasset.connect(sender.signer).approve(savingsVault.address, stakeAmount)
        const tx = senderIsBeneficiary
            ? savingsVault.connect(sender.signer)["stake(uint256)"](stakeAmount)
            : savingsVault.connect(sender.signer)["stake(address,uint256)"](beneficiary.address, stakeAmount)
        await expect(tx).to.emit(savingsVault, "Staked").withArgs(beneficiary.address, stakeAmount, sender.address)

        // 3. Ensure rewards are accrued to the beneficiary
        const afterData = await snapshotStakingData(sender, beneficiary)
        const expectedBoost = boost(afterData.boostBalance.raw, calcBoost(afterData.boostBalance.raw, afterData.vMTABalance))
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker)

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.tokenBalance.sender.sub(stakeAmount)).to.be.eq(afterData.tokenBalance.sender)
        //    StakingToken balance of StakingRewards
        expect(beforeData.tokenBalance.contract.add(stakeAmount)).to.be.eq(afterData.tokenBalance.contract)
        //    TotalSupply of StakingRewards
        expect(
            beforeData.boostBalance.totalSupply.sub(beforeData.boostBalance.balance).add(expectedBoost),
            "Boost should affect total supply",
        ).to.be.eq(afterData.boostBalance.totalSupply)
    }

    /**
     * @dev Ensures a funding is successful, checking that it updates the rewardRate etc
     * @param rewardUnits Number of units to stake
     */
    const expectSuccesfulFunding = async (rewardUnits: BN): Promise<void> => {
        const beforeData = await snapshotStakingData()
        const tx = savingsVault.connect(rewardsDistributor.signer).notifyRewardAmount(rewardUnits)
        await expect(tx).to.emit(savingsVault, "RewardAdded").withArgs(rewardUnits)

        const cur = BN.from(await getTimestamp())
        const leftOverRewards = beforeData.contractData.rewardRate.mul(
            beforeData.contractData.periodFinishTime.sub(beforeData.contractData.lastTimeRewardApplicable),
        )
        const afterData = await snapshotStakingData()

        // Sets lastTimeRewardApplicable to latest
        expect(cur).to.be.eq(afterData.contractData.lastTimeRewardApplicable)
        // Sets lastUpdateTime to latest
        expect(cur).to.be.eq(afterData.contractData.lastUpdateTime)
        // Sets periodFinish to 1 week from now
        expect(cur.add(ONE_WEEK)).to.be.eq(afterData.contractData.periodFinishTime)
        // Sets rewardRate to rewardUnits / ONE_WEEK
        if (leftOverRewards.gt(0)) {
            const total = rewardUnits.add(leftOverRewards)
            assertBNClose(
                total.div(ONE_WEEK),
                afterData.contractData.rewardRate,
                beforeData.contractData.rewardRate.div(ONE_WEEK).mul(5), // the effect of 1 second on the future scale
            )
        } else {
            expect(rewardUnits.div(ONE_WEEK)).to.be.eq(afterData.contractData.rewardRate)
        }
    }

    /**
     * @dev Makes a withdrawal from the contract, and ensures that resulting state is correct
     * and the rewards have been applied
     * @param withdrawAmount Exact amount to withdraw
     * @param sender User to execute the tx
     */
    const expectStakingWithdrawal = async (withdrawAmount: BN, sender = sa.default): Promise<void> => {
        // 1. Get data from the contract
        const beforeData = await snapshotStakingData(sender)
        const isExistingStaker = beforeData.boostBalance.raw.gt(BN.from(0))
        expect(isExistingStaker).eq(true)
        expect(withdrawAmount).to.be.gte(beforeData.boostBalance.raw)

        // 2. Send withdrawal tx
        const tx = savingsVault.connect(sender.signer).withdraw(withdrawAmount)
        await expect(tx).to.emit(savingsVault, "Withdrawn").withArgs(sender.address, withdrawAmount)

        // 3. Expect Rewards to accrue to the beneficiary
        //    StakingToken balance of sender
        const afterData = await snapshotStakingData(sender)
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker)

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.tokenBalance.sender.add(withdrawAmount)).to.be.eq(afterData.tokenBalance.sender)
        //    Withdraws from the actual rewards wrapper token
        expect(beforeData.boostBalance.raw.sub(withdrawAmount)).to.be.eq(afterData.boostBalance.raw)
        //    Updates total supply
        expect(beforeData.boostBalance.totalSupply.sub(beforeData.boostBalance.balance).add(afterData.boostBalance.balance)).to.be.eq(
            afterData.boostBalance.totalSupply,
        )
    }

    context("initialising and staking in a new pool", () => {
        describe("notifying the pool of reward", () => {
            it("should begin a new period through", async () => {
                const rewardUnits = simpleToExactAmount(1, 18)
                await expectSuccesfulFunding(rewardUnits)
            })
        })
        describe("staking in the new period", () => {
            it("should assign rewards to the staker", async () => {
                // Do the stake
                const rewardRate = await savingsVault.rewardRate()
                const stakeAmount = simpleToExactAmount(100, 18)
                const boosted = boost(stakeAmount, minBoost)
                await expectSuccessfulStake(stakeAmount)
                expect(boosted).to.be.eq(await savingsVault.balanceOf(sa.default.address))

                await increaseTime(ONE_DAY)

                // This is the total reward per staked token, since the last update
                const rewardPerToken = await savingsVault.rewardPerToken()
                const rewardPerSecond = rewardRate.mul(fullScale).div(boosted)
                assertBNClose(rewardPerToken, ONE_DAY.mul(rewardPerSecond), rewardPerSecond.mul(10))

                // Calc estimated unclaimed reward for the user
                // earned == balance * (rewardPerToken-userExistingReward)
                const earned = await savingsVault.earned(sa.default.address)
                expect(unlockedRewards(boosted.mul(rewardPerToken).div(fullScale))).to.be.eq(earned)

                await stakingContract.setBalanceOf(sa.default.address, simpleToExactAmount(1, 21))
                await savingsVault.pokeBoost(sa.default.address)
            })
            it("should update stakers rewards after consequent stake", async () => {
                const stakeAmount = simpleToExactAmount(100, 18)
                // This checks resulting state after second stake
                await expectSuccessfulStake(stakeAmount, sa.default, sa.default, true)
            })

            it("should fail if stake amount is 0", async () => {
                await expect(savingsVault["stake(uint256)"](0)).to.be.revertedWith("Cannot stake 0")
            })
            it("should fail if beneficiary is empty", async () => {
                await expect(savingsVault.connect(sa.default.signer)["stake(address,uint256)"](ZERO_ADDRESS, 1)).to.be.revertedWith(
                    "Invalid beneficiary address",
                )
            })

            it("should fail if staker has insufficient balance", async () => {
                await iMasset.connect(sa.dummy2.signer).approve(savingsVault.address, 1)
                await expect(savingsVault.connect(sa.dummy2.signer)["stake(uint256)"](1)).to.be.revertedWith("VM Exception")
            })
        })
    })
    context("funding with too much rewards", () => {
        before(async () => {
            savingsVault = await redeployRewards()
        })
        it("should fail", async () => {
            await expect(savingsVault.connect(sa.fundManager.signer).notifyRewardAmount(simpleToExactAmount(1, 25))).to.be.revertedWith(
                "Cannot notify with more than a million units",
            )
        })
    })
    context("staking before rewards are added", () => {
        before(async () => {
            savingsVault = await redeployRewards()
        })
        it("should assign no rewards", async () => {
            // Get data before
            const stakeAmount = simpleToExactAmount(100, 18)
            const beforeData = await snapshotStakingData()
            expect(beforeData.contractData.rewardRate).to.be.eq(BN.from(0))
            expect(beforeData.contractData.rewardPerTokenStored).to.be.eq(BN.from(0))
            expect(beforeData.userData.rewards).to.be.eq(BN.from(0))
            expect(beforeData.boostBalance.totalSupply).to.be.eq(BN.from(0))
            expect(beforeData.contractData.lastTimeRewardApplicable).to.be.eq(BN.from(0))

            // Do the stake
            await expectSuccessfulStake(stakeAmount)

            // Wait a day
            await increaseTime(ONE_DAY)

            // Do another stake
            await expectSuccessfulStake(stakeAmount)

            // Get end results
            const afterData = await snapshotStakingData()
            expect(afterData.contractData.rewardRate).to.be.eq(BN.from(0))
            expect(afterData.contractData.rewardPerTokenStored).to.be.eq(BN.from(0))
            expect(afterData.userData.rewards).to.be.eq(BN.from(0))
            expect(afterData.boostBalance.totalSupply).to.be.eq(stakeAmount)
            expect(afterData.contractData.lastTimeRewardApplicable).to.be.eq(BN.from(0))
        })
    })

    context("calculating a users boost", async () => {
        context("with a price coefficient of 30000 bucks", () => {
            // 1 mBTC = 30k, 1 imBTC = 3k
            const priceCoeffOverride = simpleToExactAmount(3000, 18)
            beforeEach(async () => {
                savingsVault = await redeployRewards(priceCoeffOverride)
            })
            // 10k imUSD = 1k $ = 0.33 imBTC
            it("should calculate boost for 10k imUSD stake and 250 vMTA", async () => {
                const deposit = simpleToExactAmount(3333, 14)
                const stake = simpleToExactAmount(250, 18)
                const expectedBoost = simpleToExactAmount(49995, 13)

                await expectSuccessfulStake(deposit)
                await stakingContract.setBalanceOf(sa.default.address, stake)
                await savingsVault.pokeBoost(sa.default.address)

                const balance = await savingsVault.balanceOf(sa.default.address)
                expect(balance).to.be.eq(expectedBoost)
                expect(boost(deposit, calcBoost(deposit, stake, priceCoeffOverride))).to.be.eq(expectedBoost)

                const ratio = await savingsVault.getBoost(sa.default.address)
                expect(ratio).to.be.eq(maxBoost)
            })
            // 10k imUSD = 1k $ = 0.33 imBTC
            it("should calculate boost for 10k imUSD stake and 50 vMTA", async () => {
                const deposit = simpleToExactAmount(3333, 14)
                const stake = simpleToExactAmount(50, 18)
                const expectedBoost = simpleToExactAmount("4036.263", 14)

                await expectSuccessfulStake(deposit)
                await stakingContract.setBalanceOf(sa.default.address, stake)
                await savingsVault.pokeBoost(sa.default.address)

                const balance = await savingsVault.balanceOf(sa.default.address)
                assertBNClosePercent(balance, expectedBoost, "1")
                assertBNClosePercent(boost(deposit, calcBoost(deposit, stake, priceCoeffOverride)), expectedBoost, "0.1")

                const ratio = await savingsVault.getBoost(sa.default.address)
                assertBNClosePercent(ratio, simpleToExactAmount(1.211, 18), "0.1")
            })
            // 100k imUSD = 10k $ = 3.33 imBTC
            it("should calculate boost for 100k imUSD stake and 500 vMTA", async () => {
                const deposit = simpleToExactAmount(3333, 15)
                const stake = simpleToExactAmount(500, 18)
                const expectedBoost = simpleToExactAmount("4829.517", 15)

                await expectSuccessfulStake(deposit)
                await stakingContract.setBalanceOf(sa.default.address, stake)
                await savingsVault.pokeBoost(sa.default.address)

                const balance = await savingsVault.balanceOf(sa.default.address)
                assertBNClosePercent(balance, expectedBoost, "1")
                assertBNClosePercent(boost(deposit, calcBoost(deposit, stake, priceCoeffOverride)), expectedBoost, "0.1")

                const ratio = await savingsVault.getBoost(sa.default.address)
                assertBNClosePercent(ratio, simpleToExactAmount(1.449, 18), "0.1")
            })
        })

        context("with a price coefficient of 10 cents", () => {
            beforeEach(async () => {
                savingsVault = await redeployRewards()
            })
            describe("when saving and with staking balance", () => {
                it("should calculate boost for 10k imUSD stake and 250 vMTA", async () => {
                    const deposit = simpleToExactAmount(10000)
                    const stake = simpleToExactAmount(250, 18)
                    const expectedBoost = simpleToExactAmount(15000)

                    await expectSuccessfulStake(deposit)
                    await stakingContract.setBalanceOf(sa.default.address, stake)
                    await savingsVault.pokeBoost(sa.default.address)

                    const balance = await savingsVault.balanceOf(sa.default.address)
                    expect(balance).to.be.eq(expectedBoost)
                    expect(boost(deposit, calcBoost(deposit, stake))).to.be.eq(expectedBoost)

                    const ratio = await savingsVault.getBoost(sa.default.address)
                    expect(ratio).to.be.eq(maxBoost)
                })
                it("should calculate boost for 10k imUSD stake and 50 vMTA", async () => {
                    const deposit = simpleToExactAmount(10000, 18)
                    const stake = simpleToExactAmount(50, 18)
                    const expectedBoost = simpleToExactAmount(12110, 18)

                    await expectSuccessfulStake(deposit)
                    await stakingContract.setBalanceOf(sa.default.address, stake)
                    await savingsVault.pokeBoost(sa.default.address)

                    const balance = await savingsVault.balanceOf(sa.default.address)
                    assertBNClosePercent(balance, expectedBoost, "1")
                    assertBNClosePercent(boost(deposit, calcBoost(deposit, stake)), expectedBoost, "0.1")
                    const ratio = await savingsVault.getBoost(sa.default.address)
                    assertBNClosePercent(ratio, simpleToExactAmount(1.211, 18), "0.1")
                })
                it("should calculate boost for 100k imUSD stake and 500 vMTA", async () => {
                    const deposit = simpleToExactAmount(100000, 18)
                    const stake = simpleToExactAmount(500, 18)
                    const expectedBoost = simpleToExactAmount(144900, 18)

                    await expectSuccessfulStake(deposit)
                    await stakingContract.setBalanceOf(sa.default.address, stake)
                    await savingsVault.pokeBoost(sa.default.address)

                    const balance = await savingsVault.balanceOf(sa.default.address)
                    assertBNClosePercent(balance, expectedBoost, "1")
                    assertBNClosePercent(boost(deposit, calcBoost(deposit, stake)), expectedBoost, "0.1")

                    const ratio = await savingsVault.getBoost(sa.default.address)
                    assertBNClosePercent(ratio, simpleToExactAmount(1.449, 18), "0.1")
                })
            })
            describe("when saving with low staking balance and high vMTA", () => {
                it("should give no boost due to below min threshold", async () => {
                    const deposit = simpleToExactAmount(5, 17)
                    const stake = simpleToExactAmount(800, 18)
                    const expectedBoost = simpleToExactAmount(25, 16)

                    await expectSuccessfulStake(deposit)
                    await stakingContract.setBalanceOf(sa.default.address, stake)
                    await savingsVault.pokeBoost(sa.default.address)

                    const balance = await savingsVault.balanceOf(sa.default.address)
                    assertBNClosePercent(balance, expectedBoost, "1")
                    assertBNClosePercent(boost(deposit, calcBoost(deposit, stake)), expectedBoost, "0.1")

                    const ratio = await savingsVault.getBoost(sa.default.address)
                    assertBNClosePercent(ratio, minBoost, "0.1")
                })
            })
            describe("when saving and with staking balance = 0", () => {
                it("should give no boost", async () => {
                    const deposit = simpleToExactAmount(100, 18)
                    const expectedBoost = simpleToExactAmount(50, 18)

                    await expectSuccessfulStake(deposit)

                    const balance = await savingsVault.balanceOf(sa.default.address)
                    assertBNClosePercent(balance, expectedBoost, "1")
                    assertBNClosePercent(boost(deposit, minBoost), expectedBoost, "0.1")

                    const ratio = await savingsVault.getBoost(sa.default.address)
                    assertBNClosePercent(ratio, minBoost, "0.1")
                })
            })
            describe("when withdrawing and with staking balance", () => {
                it("should set boost to 0 and update total supply", async () => {
                    const deposit = simpleToExactAmount(100, 18)
                    const stake = simpleToExactAmount(800, 18)

                    await expectSuccessfulStake(deposit)
                    await stakingContract.setBalanceOf(sa.default.address, stake)
                    await savingsVault.pokeBoost(sa.default.address)

                    await increaseTime(ONE_WEEK)
                    await savingsVault["exit()"]()

                    const balance = await savingsVault.balanceOf(sa.default.address)
                    const raw = await savingsVault.rawBalanceOf(sa.default.address)
                    const supply = await savingsVault.totalSupply()

                    expect(balance).to.be.eq(BN.from(0))
                    expect(raw).to.be.eq(BN.from(0))
                    expect(supply).to.be.eq(BN.from(0))
                })
            })
            describe("when staking and then updating vMTA balance", () => {
                it("should start accruing more rewards", async () => {
                    // Alice vs Bob
                    // 1. Pools are funded
                    // 2. Alice and Bob both deposit 100 and have no MTA
                    // 3. wait half a week
                    // 4. Alice increases MTA stake to get max boost
                    // 5. Both users are poked
                    // 6. Wait half a week
                    // 7. Both users are poked
                    // 8. Alice accrued 3x the rewards in the second entry
                    const alice = sa.default
                    const bob = sa.dummy1
                    // 1.
                    const hunnit = simpleToExactAmount(100, 18)
                    await rewardToken.connect(rewardsDistributor.signer).transfer(savingsVault.address, hunnit)
                    await expectSuccesfulFunding(hunnit)

                    // 2.
                    await expectSuccessfulStake(hunnit)
                    await expectSuccessfulStake(hunnit, sa.default, bob)

                    // 3.
                    await increaseTime(ONE_WEEK.div(2))

                    // 4.
                    await stakingContract.setBalanceOf(alice.address, hunnit)

                    // 5.
                    await savingsVault.pokeBoost(alice.address)
                    await savingsVault.pokeBoost(bob.address)

                    // 6.
                    await increaseTime(ONE_WEEK.div(2))

                    // 7.
                    await savingsVault.pokeBoost(alice.address)
                    await savingsVault.pokeBoost(bob.address)

                    // 8.
                    const aliceData = await snapshotStakingData(alice, alice)
                    const bobData = await snapshotStakingData(bob, bob)

                    assertBNClosePercent(aliceData.userRewards[1].rate, bobData.userRewards[1].rate.mul(3), "0.1")
                })
            })
        })
    })
    context("adding first stake days after funding", () => {
        before(async () => {
            savingsVault = await redeployRewards()
        })
        it("should retrospectively assign rewards to the first staker", async () => {
            await expectSuccesfulFunding(simpleToExactAmount(100, 18))
            // Do the stake
            const rewardRate = await savingsVault.rewardRate()

            await increaseTime(FIVE_DAYS)

            const stakeAmount = simpleToExactAmount(100, 18)
            const boosted = boost(stakeAmount, minBoost)
            await expectSuccessfulStake(stakeAmount)
            // await increaseTime(ONE_DAY);

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await savingsVault.rewardPerToken()

            // e.g. 1e15 * 1e18 / 50e18 = 2e13
            const rewardPerSecond = rewardRate.mul(fullScale).div(boosted)
            assertBNClosePercent(rewardPerToken, FIVE_DAYS.mul(rewardPerSecond), "0.01")
            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await savingsVault.earned(sa.default.address)
            expect(unlockedRewards(boosted.mul(rewardPerToken).div(fullScale))).to.be.eq(earnedAfterConsequentStake)
            await stakingContract.setBalanceOf(sa.default.address, simpleToExactAmount(1, 21))
            await savingsVault.pokeBoost(sa.default.address)
        })
    })
    context("staking over multiple funded periods", () => {
        context("with a single staker", () => {
            before(async () => {
                savingsVault = await redeployRewards()
            })
            it("should assign all the rewards from the periods", async () => {
                const fundAmount1 = simpleToExactAmount(100, 18)
                const fundAmount2 = simpleToExactAmount(200, 18)
                await expectSuccesfulFunding(fundAmount1)

                const stakeAmount = simpleToExactAmount(1, 18)
                await expectSuccessfulStake(stakeAmount)

                await increaseTime(ONE_WEEK.mul(2))

                await expectSuccesfulFunding(fundAmount2)

                await increaseTime(ONE_WEEK.mul(2))

                const earned = await savingsVault.earned(sa.default.address)
                assertBNSlightlyGT(unlockedRewards(fundAmount1.add(fundAmount2)), earned, BN.from(1000000), false)

                await stakingContract.setBalanceOf(sa.default.address, simpleToExactAmount(1, 21))
                await savingsVault.pokeBoost(sa.default.address)
            })
        })
        context("with multiple stakers coming in and out", () => {
            const fundAmount1 = simpleToExactAmount(100, 21)
            const fundAmount2 = simpleToExactAmount(200, 21)
            let staker2: Account
            let staker3: Account
            const staker1Stake1 = simpleToExactAmount(100, 18)
            const staker1Stake2 = simpleToExactAmount(200, 18)
            const staker2Stake = simpleToExactAmount(100, 18)
            const staker3Stake = simpleToExactAmount(100, 18)

            before(async () => {
                savingsVault = await redeployRewards()
                staker2 = sa.dummy1
                staker3 = sa.dummy2
                await iMasset.transfer(staker2.address, staker2Stake)
                await iMasset.transfer(staker3.address, staker3Stake)
            })
            it("should accrue rewards on a pro rata basis", async () => {
                /*
                 *  0               1               2   <-- Weeks
                 *   [ - - - - - - ] [ - - - - - - ]
                 * 100k            200k                 <-- Funding
                 * +100            +200                 <-- Staker 1
                 *        +100                          <-- Staker 2
                 * +100            -100                 <-- Staker 3
                 *
                 * Staker 1 gets 25k + 16.66k from week 1 + 150k from week 2 = 191.66k
                 * Staker 2 gets 16.66k from week 1 + 50k from week 2 = 66.66k
                 * Staker 3 gets 25k + 16.66k from week 1 + 0 from week 2 = 41.66k
                 */

                // WEEK 0-1 START
                await expectSuccessfulStake(staker1Stake1)
                await expectSuccessfulStake(staker3Stake, staker3, staker3)

                await expectSuccesfulFunding(fundAmount1)

                await increaseTime(ONE_WEEK.div(2).add(1))

                await expectSuccessfulStake(staker2Stake, staker2, staker2)

                await increaseTime(ONE_WEEK.div(2).add(1))

                // WEEK 1-2 START
                await expectSuccesfulFunding(fundAmount2)

                await savingsVault.connect(staker3.signer).withdraw(staker3Stake)
                await expectSuccessfulStake(staker1Stake2, sa.default, sa.default, true)

                await increaseTime(ONE_WEEK)

                // WEEK 2 FINISH
                const earned1 = await savingsVault.earned(sa.default.address)
                assertBNClose(earned1, unlockedRewards(simpleToExactAmount("191.66", 21)), simpleToExactAmount(1, 19))
                const earned2 = await savingsVault.earned(staker2.address)
                assertBNClose(earned2, unlockedRewards(simpleToExactAmount("66.66", 21)), simpleToExactAmount(1, 19))
                const earned3 = await savingsVault.earned(staker3.address)
                assertBNClose(earned3, unlockedRewards(simpleToExactAmount("41.66", 21)), simpleToExactAmount(1, 19))
                // Ensure that sum of earned rewards does not exceed funding amount
                expect(fundAmount1.add(fundAmount2)).to.be.gte(earned1.add(earned2).add(earned3))
            })
        })
    })
    context("staking after period finish", () => {
        const fundAmount1 = simpleToExactAmount(100, 21)

        before(async () => {
            savingsVault = await redeployRewards()
        })
        it("should stop accruing rewards after the period is over", async () => {
            await expectSuccessfulStake(simpleToExactAmount(1, 18))
            await expectSuccesfulFunding(fundAmount1)

            await increaseTime(ONE_WEEK.add(1))

            const earnedAfterWeek = await savingsVault.earned(sa.default.address)

            await increaseTime(ONE_WEEK.add(1))
            const now = await getTimestamp()

            const earnedAfterTwoWeeks = await savingsVault.earned(sa.default.address)

            expect(earnedAfterWeek).to.be.eq(earnedAfterTwoWeeks)

            const lastTimeRewardApplicable = await savingsVault.lastTimeRewardApplicable()
            assertBNClose(lastTimeRewardApplicable, now.sub(ONE_WEEK).sub(2), BN.from(2))
        })
    })
    context("staking on behalf of a beneficiary", () => {
        const fundAmount = simpleToExactAmount(100, 21)
        let beneficiary: Account
        const stakeAmount = simpleToExactAmount(100, 18)

        before(async () => {
            savingsVault = await redeployRewards()
            beneficiary = sa.dummy1
            await expectSuccesfulFunding(fundAmount)
            await expectSuccessfulStake(stakeAmount, sa.default, beneficiary)
            await increaseTime(10)
        })
        it("should update the beneficiaries reward details", async () => {
            const earned = await savingsVault.earned(beneficiary.address)
            expect(earned).to.be.gt(BN.from(0))

            const rawBalance = await savingsVault.rawBalanceOf(beneficiary.address)
            expect(rawBalance).to.be.eq(stakeAmount)

            const balance = await savingsVault.balanceOf(beneficiary.address)
            expect(balance).to.be.eq(boost(stakeAmount, minBoost))
        })
        it("should not update the senders details", async () => {
            const earned = await savingsVault.earned(sa.default.address)
            expect(earned).to.be.eq(BN.from(0))

            const balance = await savingsVault.balanceOf(sa.default.address)
            expect(balance).to.be.eq(BN.from(0))
        })
    })

    context("using staking / reward tokens with diff decimals", () => {
        before(async () => {
            rewardToken = await (await new MockERC20__factory(sa.default.signer)).deploy(
                "Reward",
                "RWD",
                12,
                rewardsDistributor.address,
                10000000,
            )
            iMasset = await (await new MockERC20__factory(sa.default.signer)).deploy(
                "Interest bearing mUSD",
                "imUSD",
                16,
                sa.default.address,
                1000000,
            )
            stakingContract = await (await new MockStakingContract__factory(sa.default.signer)).deploy()

            const vaultFactory = await new BoostedSavingsVault__factory(sa.default.signer)
            const impl = await vaultFactory.deploy(nexus.address, iMasset.address, stakingContract.address, priceCoeff, rewardToken.address)
            const data = impl.interface.encodeFunctionData("initialize", [rewardsDistributor.address])
            const proxy = await (await new AssetProxy__factory(sa.default.signer)).deploy(impl.address, sa.dummy4.address, data)
            savingsVault = vaultFactory.attach(proxy.address)
        })
        it("should not affect the pro rata payouts", async () => {
            // Add 100 reward tokens
            await expectSuccesfulFunding(simpleToExactAmount(100, 12))
            const rewardRate = await savingsVault.rewardRate()

            // Do the stake
            const stakeAmount = simpleToExactAmount(100, 16)
            const boosted = boost(stakeAmount, minBoost)
            await expectSuccessfulStake(stakeAmount)

            await increaseTime(ONE_WEEK.add(1))

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await savingsVault.rewardPerToken()
            assertBNClose(
                rewardPerToken,
                ONE_WEEK.mul(rewardRate).mul(fullScale).div(boosted),
                BN.from(1).mul(rewardRate).mul(fullScale).div(boosted),
            )

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await savingsVault.earned(sa.default.address)
            assertBNSlightlyGT(unlockedRewards(simpleToExactAmount(100, 12)), earnedAfterConsequentStake, simpleToExactAmount(1, 9))
        })
    })

    context("claiming rewards", async () => {
        const fundAmount = simpleToExactAmount(100, 21)
        const stakeAmount = simpleToExactAmount(100, 18)
        const unlocked = unlockedRewards(fundAmount)

        before(async () => {
            savingsVault = await redeployRewards()
            await expectSuccesfulFunding(fundAmount)
            await rewardToken.connect(rewardsDistributor.signer).transfer(savingsVault.address, fundAmount)
            await expectSuccessfulStake(stakeAmount, sa.default, sa.dummy2)
            await increaseTime(ONE_WEEK.add(1))
        })
        it("should do nothing for a non-staker", async () => {
            const beforeData = await snapshotStakingData(sa.dummy1, sa.dummy1)
            await savingsVault.connect(sa.dummy1.signer).claimReward()

            const afterData = await snapshotStakingData(sa.dummy1, sa.dummy1)
            expect(beforeData.userData.rewards).to.be.eq(BN.from(0))
            expect(afterData.userData.rewards).to.be.eq(BN.from(0))
            expect(afterData.tokenBalance.sender).to.be.eq(BN.from(0))
            expect(afterData.userData.rewardPerTokenPaid).to.be.eq(afterData.contractData.rewardPerTokenStored)
        })
        it("should send all UNLOCKED rewards to the rewardee", async () => {
            const beforeData = await snapshotStakingData(sa.dummy2, sa.dummy2)
            const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.dummy2.address)
            expect(rewardeeBalanceBefore).to.be.eq(BN.from(0))
            const tx = savingsVault.connect(sa.dummy2.signer).claimReward()
            await expect(tx).to.emit(savingsVault, "RewardPaid")
            const afterData = await snapshotStakingData(sa.dummy2, sa.dummy2)
            await assertRewardsAssigned(beforeData, afterData, true, true)
            // Balance transferred to the rewardee
            const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.dummy2.address)
            assertBNClose(rewardeeBalanceAfter, unlocked, simpleToExactAmount(1, 16))

            // 'rewards' reset to 0
            expect(afterData.userData.rewards).to.be.eq(BN.from(0))
            // Paid up until the last block
            expect(afterData.userData.rewardPerTokenPaid).to.be.eq(afterData.contractData.rewardPerTokenStored)
            // Token balances dont change
            expect(afterData.tokenBalance.sender).to.be.eq(beforeData.tokenBalance.sender)
            expect(beforeData.boostBalance.balance).to.be.eq(afterData.boostBalance.balance)
        })
    })
    context("claiming locked rewards", () => {
        /*
         *  0    1    2    3   .. 26  27   28   29  <-- Weeks
         * 100k 100k 200k 100k                      <-- Funding
         *                        [ 1 ][ 1.5  ][.5]
         *  ^    ^      ^  ^                        <-- Staker
         * stake p1    p2  withdraw
         */

        const hunnit = simpleToExactAmount(100, 21)
        const sum = hunnit.mul(4)
        const unlocked = unlockedRewards(sum)

        beforeEach(async () => {
            savingsVault = await redeployRewards()
            await rewardToken.connect(rewardsDistributor.signer).transfer(savingsVault.address, hunnit.mul(5))
            // t0
            await expectSuccesfulFunding(hunnit)
            await expectSuccessfulStake(hunnit)
            await increaseTime(ONE_WEEK.add(1))
            // t1
            await expectSuccesfulFunding(hunnit)
            await savingsVault.pokeBoost(sa.default.address)
            await increaseTime(ONE_WEEK.add(1))
            // t2
            await expectSuccesfulFunding(hunnit.mul(2))
            await increaseTime(ONE_WEEK.div(2))
            // t2x5
            await savingsVault.pokeBoost(sa.default.address)
            await increaseTime(ONE_WEEK.div(2))
            // t3
            await expectSuccesfulFunding(hunnit)
        })
        it("should fetch the unclaimed tranche data", async () => {
            await expectStakingWithdrawal(hunnit)
            await increaseTime(ONE_WEEK.mul(23))
            // t = 26
            let [amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            assertBNClosePercent(amount, unlocked, "0.01")
            expect(first).to.be.eq(BN.from(0))
            expect(last).to.be.eq(BN.from(0))

            await increaseTime(ONE_WEEK.mul(3).div(2))

            // t = 27.5
            ;[amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(0))
            expect(last).to.be.eq(BN.from(1))
            assertBNClosePercent(amount, unlocked.add(lockedRewards(simpleToExactAmount(166.666, 21))), "0.01")

            await increaseTime(ONE_WEEK.mul(5).div(2))

            // t = 30
            ;[amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(0))
            expect(last).to.be.eq(BN.from(2))
            assertBNClosePercent(amount, unlocked.add(lockedRewards(simpleToExactAmount(400, 21))), "0.01")
        })
        it("should claim all unlocked rewards over the tranches, and any immediate unlocks", async () => {
            await expectStakingWithdrawal(hunnit)
            await increaseTime(ONE_WEEK.mul(23))
            await increaseTime(ONE_WEEK.mul(3).div(2))

            // t=27.5
            const expected = lockedRewards(simpleToExactAmount(166.666, 21))
            const allRewards = unlocked.add(expected)
            let [amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(0))
            expect(last).to.be.eq(BN.from(1))
            assertBNClosePercent(amount, allRewards, "0.01")

            // claims all immediate unlocks
            const dataBefore = await snapshotStakingData()
            const t27x5 = await getTimestamp()
            const tx = savingsVault["claimRewards(uint256,uint256)"](first, last)
            await expect(tx).to.emit(savingsVault, "RewardPaid")

            // Gets now unclaimed rewards (0, since no time has passed)
            ;[amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(1))
            expect(last).to.be.eq(BN.from(1))
            expect(amount).to.be.eq(BN.from(0))

            const dataAfter = await snapshotStakingData()

            // Checks that data has been updated correctly
            expect(dataAfter.boostBalance.totalSupply).to.be.eq(BN.from(0))
            expect(dataAfter.tokenBalance.sender).to.be.eq(dataBefore.tokenBalance.sender.add(amount))
            expect(dataAfter.userData.lastAction).to.be.eq(dataAfter.userData.userClaim)
            assertBNClose(t27x5, dataAfter.userData.lastAction, 5)
            expect(dataAfter.userData.rewards).to.be.eq(BN.from(0))

            await expect(savingsVault["claimRewards(uint256,uint256)"](0, 0)).to.be.revertedWith("Invalid epoch")

            await increaseTime(100)
            ;[amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(1))
            expect(last).to.be.eq(BN.from(1))
            assertBNClose(amount, dataAfter.userRewards[1].rate.mul(100), dataAfter.userRewards[1].rate.mul(3))

            await savingsVault["claimRewards(uint256,uint256)"](1, 1)

            await increaseTime(ONE_DAY.mul(10))

            await savingsVault["claimRewards(uint256,uint256)"](1, 1)

            const d3 = await snapshotStakingData()
            expect(d3.userData.userClaim).to.be.eq(d3.userRewards[1].finish)

            await savingsVault["claimRewards(uint256,uint256)"](1, 1)

            const d4 = await snapshotStakingData()
            expect(d4.userData.userClaim).to.be.eq(d4.userRewards[1].finish)
            expect(d4.tokenBalance.sender).to.be.eq(d3.tokenBalance.sender)
        })
        it("should claim rewards without being passed the params", async () => {
            await expectStakingWithdrawal(hunnit)
            await increaseTime(ONE_WEEK.mul(23))
            await increaseTime(ONE_WEEK.mul(3).div(2))

            // t=27.5
            const expected = lockedRewards(simpleToExactAmount(166.666, 21))
            const allRewards = unlocked.add(expected)
            let [amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(0))
            expect(last).to.be.eq(BN.from(1))
            assertBNClosePercent(amount, allRewards, "0.01")

            // claims all immediate unlocks
            const dataBefore = await snapshotStakingData()
            const t27x5 = await getTimestamp()
            const tx = savingsVault["claimRewards()"]()
            await expect(tx).to.emit(savingsVault, "RewardPaid")

            // Gets now unclaimed rewards (0, since no time has passed)
            ;[amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(1))
            expect(last).to.be.eq(BN.from(1))
            expect(amount).to.be.eq(BN.from(0))

            const dataAfter = await snapshotStakingData()

            // Checks that data has been updated correctly
            expect(dataAfter.boostBalance.totalSupply).to.be.eq(BN.from(0))
            expect(dataAfter.tokenBalance.sender).to.be.eq(dataBefore.tokenBalance.sender.add(amount))
            expect(dataAfter.userData.lastAction).to.be.eq(dataAfter.userData.userClaim)
            assertBNClose(t27x5, dataAfter.userData.lastAction, 5)
            expect(dataAfter.userData.rewards).to.be.eq(BN.from(0))
        })
        it("should unlock all rewards after sufficient time has elapsed", async () => {
            await expectStakingWithdrawal(hunnit)
            await increaseTime(ONE_WEEK.mul(27))

            // t=30
            const expected = lockedRewards(simpleToExactAmount(400, 21))
            const allRewards = unlocked.add(expected)
            let [amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(0))
            expect(last).to.be.eq(BN.from(2))
            assertBNClosePercent(amount, allRewards, "0.01")

            // claims all immediate unlocks
            const dataBefore = await snapshotStakingData()
            const t30 = await getTimestamp()
            const tx = savingsVault["claimRewards()"]()
            await expect(tx).to.emit(savingsVault, "RewardPaid")

            // Gets now unclaimed rewards (0, since no time has passed)
            ;[amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(2))
            expect(last).to.be.eq(BN.from(2))
            expect(amount).to.be.eq(BN.from(0))

            const dataAfter = await snapshotStakingData()

            // Checks that data has been updated correctly
            expect(dataAfter.boostBalance.totalSupply).to.be.eq(BN.from(0))
            expect(dataAfter.tokenBalance.sender).to.be.eq(dataBefore.tokenBalance.sender.add(amount))
            expect(dataAfter.userData.userClaim).to.be.eq(dataAfter.userRewards[2].finish)
            assertBNClose(t30, dataAfter.userData.lastAction, 5)
            expect(dataAfter.userData.rewards).to.be.eq(BN.from(0))
        })
        it("should break if we leave rewards unclaimed at the start or end", async () => {
            await expectStakingWithdrawal(hunnit)
            await increaseTime(ONE_WEEK.mul(25))

            // t=28
            let [, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(0))
            expect(last).to.be.eq(BN.from(1))

            await expect(savingsVault["claimRewards(uint256,uint256)"](1, 1)).to.be.revertedWith(
                "Invalid _first arg: Must claim earlier entries",
            )

            await increaseTime(ONE_WEEK.mul(3))
            // t=31
            ;[, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
            expect(first).to.be.eq(BN.from(0))
            expect(last).to.be.eq(BN.from(2))

            await savingsVault["claimRewards(uint256,uint256)"](0, 1)

            await savingsVault["claimRewards(uint256,uint256)"](1, 2)

            // then try to claim 0-2 again, and it should give nothing
            const unclaimed = await savingsVault.unclaimedRewards(sa.default.address)
            expect(unclaimed[0]).to.be.eq(BN.from(0))
            expect(unclaimed[1]).to.be.eq(BN.from(2))
            expect(unclaimed[2]).to.be.eq(BN.from(2))

            const dataBefore = await snapshotStakingData()
            await expect(savingsVault["claimRewards(uint256,uint256)"](0, 2)).to.be.revertedWith("Invalid epoch")
            const dataAfter = await snapshotStakingData()

            expect(dataAfter.tokenBalance.sender).to.be.eq(dataBefore.tokenBalance.sender)
            expect(dataAfter.userData.userClaim).to.be.eq(dataBefore.userData.userClaim)
        })
        describe("with many array entries", () => {
            it("should allow them all to be searched and claimed", async () => {
                await rewardToken.connect(rewardsDistributor.signer).transfer(savingsVault.address, hunnit.mul(6))
                await increaseTime(ONE_WEEK)
                // t4
                await savingsVault.pokeBoost(sa.default.address)
                await expectSuccesfulFunding(hunnit)
                await increaseTime(ONE_WEEK.div(2))
                // t4.5
                await savingsVault.pokeBoost(sa.default.address)
                await increaseTime(ONE_WEEK.div(2))
                // t5
                await savingsVault.pokeBoost(sa.default.address)
                await expectSuccesfulFunding(hunnit)
                await increaseTime(ONE_WEEK.div(2))
                // t5.5
                await savingsVault.pokeBoost(sa.default.address)
                await increaseTime(ONE_WEEK.div(2))
                // t6
                await savingsVault.pokeBoost(sa.default.address)
                await expectSuccesfulFunding(hunnit)
                await increaseTime(ONE_WEEK.div(2))
                // t6.5
                await savingsVault.pokeBoost(sa.default.address)
                await increaseTime(ONE_WEEK.div(2))
                // t7
                await savingsVault.pokeBoost(sa.default.address)
                await expectSuccesfulFunding(hunnit)
                await increaseTime(ONE_WEEK.div(2))
                // t7.5
                await savingsVault.pokeBoost(sa.default.address)
                await increaseTime(ONE_WEEK.div(2))
                // t8
                await savingsVault.pokeBoost(sa.default.address)
                await expectSuccesfulFunding(hunnit)
                await increaseTime(ONE_WEEK.div(2))
                // t8.5
                await savingsVault.pokeBoost(sa.default.address)
                await increaseTime(ONE_WEEK.div(2))
                // t9
                await savingsVault.pokeBoost(sa.default.address)
                await expectSuccesfulFunding(hunnit)
                await increaseTime(ONE_WEEK.div(2))
                // t9.5
                await savingsVault.pokeBoost(sa.default.address)
                await increaseTime(ONE_WEEK.div(2))
                // t10
                await savingsVault.pokeBoost(sa.default.address)

                // count = 1
                // t=28
                await increaseTime(ONE_WEEK.mul(18))
                let [amt, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
                expect(first).to.be.eq(BN.from(0))
                expect(last).to.be.eq(BN.from(1))

                const data28 = await snapshotStakingData()
                expect(data28.userData.userClaim).to.be.eq(BN.from(0))
                expect(data28.userData.rewardCount).eq(15)

                // t=32
                await increaseTime(ONE_WEEK.mul(4).sub(100))
                ;[amt, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
                expect(first).to.be.eq(BN.from(0))
                expect(last).to.be.eq(BN.from(6))
                await savingsVault["claimRewards(uint256,uint256)"](0, 6)
                const data32 = await snapshotStakingData()
                expect(data32.userData.userClaim).to.be.eq(data32.userData.lastAction)
                ;[amt, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
                expect(amt).to.be.eq(BN.from(0))
                expect(first).to.be.eq(BN.from(6))
                expect(last).to.be.eq(BN.from(6))

                // t=35
                await increaseTime(ONE_WEEK.mul(3))
                ;[amt, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
                expect(first).to.be.eq(BN.from(6))
                expect(last).to.be.eq(BN.from(12))

                await savingsVault["claimRewards(uint256,uint256)"](6, 12)
                const data35 = await snapshotStakingData()
                expect(data35.userData.userClaim).to.be.eq(data35.userData.lastAction)
                ;[amt, ,] = await savingsVault.unclaimedRewards(sa.default.address)
                expect(amt).to.be.eq(BN.from(0))

                await expect(savingsVault["claimRewards(uint256,uint256)"](0, 1)).to.be.revertedWith("Invalid epoch")
            })
        })
        describe("with a one second entry", () => {
            it("should allow it to be claimed", async () => {
                await rewardToken.connect(rewardsDistributor.signer).transfer(savingsVault.address, hunnit)
                await savingsVault.pokeBoost(sa.default.address)
                await increaseTime(ONE_WEEK)
                // t4
                await expectSuccesfulFunding(hunnit)
                await savingsVault.pokeBoost(sa.default.address)
                await savingsVault.pokeBoost(sa.default.address)
                await savingsVault.pokeBoost(sa.default.address)
                await savingsVault.pokeBoost(sa.default.address)
                await savingsVault.pokeBoost(sa.default.address)
                await savingsVault.pokeBoost(sa.default.address)
                await savingsVault.pokeBoost(sa.default.address)
                await increaseTime(ONE_WEEK.mul(26).sub(10))

                // t30
                const data = await snapshotStakingData()
                expect(data.userData.rewardCount).eq(10)
                const r4 = data.userRewards[4]
                const r5 = data.userRewards[5]
                expect(r4.finish).to.be.eq(r5.start)
                expect(r5.finish).to.be.eq(r5.start.add(1))
                expect(r4.rate).to.be.eq(r5.rate)
                assertBNClosePercent(r4.rate, lockedRewards(data.contractData.rewardRate), "0.001")

                let [, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
                expect(first).to.be.eq(BN.from(0))
                expect(last).to.be.eq(BN.from(3))
                await savingsVault["claimRewards(uint256,uint256)"](0, 3)
                await increaseTime(20)
                ;[, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
                expect(first).to.be.eq(BN.from(3))
                expect(last).to.be.eq(BN.from(10))

                await expect(savingsVault["claimRewards(uint256,uint256)"](0, 8)).to.be.revertedWith("Invalid epoch")
                await savingsVault["claimRewards(uint256,uint256)"](3, 8)
                await expect(savingsVault["claimRewards(uint256,uint256)"](6, 9)).to.be.revertedWith("Invalid epoch")
                await savingsVault["claimRewards()"]
            })
        })
    })

    context("getting the reward token", () => {
        before(async () => {
            savingsVault = await redeployRewards()
        })
        it("should simply return the rewards Token", async () => {
            const readToken = await savingsVault.getRewardToken()
            expect(readToken).eq(rewardToken.address)
            expect(readToken).eq(await savingsVault.rewardsToken())
        })
    })

    context("calling exit", () => {
        const hunnit = simpleToExactAmount(100, 18)
        beforeEach(async () => {
            savingsVault = await redeployRewards()
            await rewardToken.connect(rewardsDistributor.signer).transfer(savingsVault.address, hunnit)
            await expectSuccesfulFunding(hunnit)
            await expectSuccessfulStake(hunnit)
            await increaseTime(ONE_WEEK.add(1))
        })
        context("with no raw balance but rewards unlocked", () => {
            it("errors", async () => {
                await savingsVault.withdraw(hunnit)
                const beforeData = await snapshotStakingData()
                expect(beforeData.boostBalance.totalSupply).to.be.eq(BN.from(0))
                await expect(savingsVault["exit()"]()).to.be.revertedWith("Cannot withdraw 0")
            })
        })
        context("with raw balance", async () => {
            it("withdraws everything and claims unlocked rewards", async () => {
                const beforeData = await snapshotStakingData()
                expect(beforeData.boostBalance.totalSupply).to.be.eq(simpleToExactAmount(50, 18))
                await savingsVault["exit()"]()
                const afterData = await snapshotStakingData()
                expect(afterData.userData.userClaim).to.be.eq(afterData.userData.lastAction)
                expect(afterData.userData.rewards).to.be.eq(BN.from(0))
                expect(afterData.boostBalance.totalSupply).to.be.eq(BN.from(0))
            })
        })
        context("with unlocked rewards", () => {
            it("claims unlocked epochs", async () => {
                await savingsVault.pokeBoost(sa.default.address)
                await increaseTime(ONE_WEEK.mul(27))

                const [amount, first, last] = await savingsVault.unclaimedRewards(sa.default.address)
                expect(first).to.be.eq(BN.from(0))
                expect(last).to.be.eq(BN.from(0))
                assertBNClosePercent(amount, hunnit, "0.01")

                // claims all immediate unlocks
                const tx = savingsVault["exit(uint256,uint256)"](first, last)
                await expect(tx).to.emit(savingsVault, "RewardPaid")
                await expect(tx).to.emit(savingsVault, "Withdrawn").withArgs(sa.default.address, hunnit)
            })
        })
    })

    context("withdrawing stake or rewards", () => {
        context("withdrawing a stake amount", () => {
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, 18)

            before(async () => {
                savingsVault = await redeployRewards()
                await expectSuccesfulFunding(fundAmount)
                await expectSuccessfulStake(stakeAmount)
                await increaseTime(10)
            })
            it("should revert for a non-staker", async () => {
                await expect(savingsVault.connect(sa.dummy1.signer).withdraw(1)).to.be.revertedWith("VM Exception")
            })
            it("should revert if insufficient balance", async () => {
                await expect(savingsVault.connect(sa.default.signer).withdraw(stakeAmount.add(1))).to.be.revertedWith("VM Exception")
            })
            it("should fail if trying to withdraw 0", async () => {
                await expect(savingsVault.connect(sa.default.signer).withdraw(0)).to.be.revertedWith("Cannot withdraw 0")
            })
            it("should withdraw the stake and update the existing reward accrual", async () => {
                // Check that the user has earned something
                const earnedBefore = await savingsVault.earned(sa.default.address)
                expect(earnedBefore).to.be.gt(BN.from(0))
                const dataBefore = await snapshotStakingData()
                expect(dataBefore.userData.rewards).to.be.eq(BN.from(0))

                // Execute the withdrawal
                await expectStakingWithdrawal(stakeAmount)

                // Ensure that the new awards are added + assigned to user
                const earnedAfter = await savingsVault.earned(sa.default.address)
                expect(earnedAfter).to.be.gte(earnedBefore)
                const dataAfter = await snapshotStakingData()
                expect(dataAfter.userData.rewards).to.be.eq(earnedAfter)

                // Zoom forward now
                await increaseTime(10)

                // Check that the user does not earn anything else
                const earnedEnd = await savingsVault.earned(sa.default.address)
                expect(earnedEnd).to.be.eq(earnedAfter)
                const dataEnd = await snapshotStakingData()
                expect(dataEnd.userData.rewards).to.be.eq(dataAfter.userData.rewards)

                // Cannot withdraw anything else
                await expect(savingsVault.connect(sa.default.signer).withdraw(stakeAmount.add(1))).to.be.revertedWith("VM Exception")
            })
        })
    })

    context("notifying new reward amount", () => {
        context("from someone other than the distributor", () => {
            before(async () => {
                savingsVault = await redeployRewards()
            })
            it("should fail", async () => {
                await expect(savingsVault.connect(sa.default.signer).notifyRewardAmount(1)).to.be.revertedWith(
                    "Caller is not reward distributor",
                )
                await expect(savingsVault.connect(sa.dummy1.signer).notifyRewardAmount(1)).to.be.revertedWith(
                    "Caller is not reward distributor",
                )
                await expect(savingsVault.connect(sa.governor.signer).notifyRewardAmount(1)).to.be.revertedWith(
                    "Caller is not reward distributor",
                )
            })
        })
        context("before current period finish", async () => {
            const funding1 = simpleToExactAmount(100, 18)
            const funding2 = simpleToExactAmount(200, 18)
            beforeEach(async () => {
                savingsVault = await redeployRewards()
            })
            it("should factor in unspent units to the new rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1)
                const actualRewardRate = await savingsVault.rewardRate()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).to.be.eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(ONE_WEEK.div(2))

                // Do the second funding, and factor in the unspent units
                const expectedLeftoverReward = funding1.div(2)
                await expectSuccesfulFunding(funding2)
                const actualRewardRateAfter = await savingsVault.rewardRate()
                const totalRewardsForWeek = funding2.add(expectedLeftoverReward)
                const expectedRewardRateAfter = totalRewardsForWeek.div(ONE_WEEK)
                assertBNClose(actualRewardRateAfter, expectedRewardRateAfter, actualRewardRate.div(ONE_WEEK).mul(20))
            })
            it("should factor in unspent units to the new rewardRate if instant", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1)
                const actualRewardRate = await savingsVault.rewardRate()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).to.be.eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(1)

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding2)
                const actualRewardRateAfter = await savingsVault.rewardRate()
                const expectedRewardRateAfter = funding1.add(funding2).div(ONE_WEEK)
                assertBNClose(actualRewardRateAfter, expectedRewardRateAfter, actualRewardRate.div(ONE_WEEK).mul(20))
            })
        })

        context("after current period finish", () => {
            const funding1 = simpleToExactAmount(100, 18)
            before(async () => {
                savingsVault = await redeployRewards()
            })
            it("should start a new period with the correct rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1)
                const actualRewardRate = await savingsVault.rewardRate()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).to.be.eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(ONE_WEEK.add(1))

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding1.mul(2))
                const actualRewardRateAfter = await savingsVault.rewardRate()
                const expectedRewardRateAfter = expectedRewardRate.mul(2)
                expect(actualRewardRateAfter).to.be.eq(expectedRewardRateAfter)
            })
        })
    })
})
