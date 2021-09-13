import { StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { FIVE_DAYS, fullScale, ONE_DAY, ONE_WEEK } from "@utils/constants"
import { getTimestamp, increaseTime } from "@utils/time"
import {
    AssetProxy__factory,
    MockERC20,
    MockERC20__factory,
    MockNexus,
    MockNexus__factory,
    StakingRewards,
    StakingRewards__factory,
} from "types/generated"
import { ethers } from "hardhat"
import { expect } from "chai"
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions"
import { Account } from "types"

describe("StakingRewards", async () => {
    let sa: StandardAccounts
    let rewardsDistributor: Account
    let nexus: MockNexus

    let rewardToken: MockERC20
    let stakingToken: MockERC20
    let stakingRewards: StakingRewards

    const redeployRewards = async (nexusAddress = nexus.address, rewardDecimals = 18, stakingDecimals = 18): Promise<StakingRewards> => {
        const deployer = sa.default.signer
        rewardToken = await new MockERC20__factory(deployer).deploy("Reward", "RWD", rewardDecimals, rewardsDistributor.address, 1000000)
        stakingToken = await new MockERC20__factory(deployer).deploy("Staking", "ST8k", stakingDecimals, sa.default.address, 1000000)
        const stakingRewardsImpl = await new StakingRewards__factory(deployer).deploy(
            nexusAddress,
            stakingToken.address,
            rewardToken.address,
            ONE_DAY.mul(7),
        )
        const initializeData = stakingRewardsImpl.interface.encodeFunctionData("initialize", [
            rewardsDistributor.address,
            "StakingToken",
            "ST8k",
        ])
        const proxy = await new AssetProxy__factory(deployer).deploy(stakingRewardsImpl.address, sa.governor.address, initializeData)
        stakingRewards = StakingRewards__factory.connect(proxy.address, deployer)
        return stakingRewards
    }

    interface StakingData {
        totalSupply: BN
        userStakingBalance: BN
        senderStakingTokenBalance: BN
        contractStakingTokenBalance: BN
        userRewardPerTokenPaid: BN
        beneficiaryRewardsEarned: BN
        rewardPerTokenStored: BN
        rewardRate: BN
        lastUpdateTime: BN
        lastTimeRewardApplicable: BN
        periodFinishTime: BN
    }

    const snapshotStakingData = async (sender = sa.default, beneficiary = sa.default): Promise<StakingData> => {
        const userData = await stakingRewards.userData(beneficiary.address)
        const globalData = await stakingRewards.globalData()

        return {
            totalSupply: await stakingRewards.totalSupply(),
            userStakingBalance: await stakingRewards.balanceOf(beneficiary.address),
            userRewardPerTokenPaid: await userData[0],
            beneficiaryRewardsEarned: await userData[1],
            senderStakingTokenBalance: await stakingToken.balanceOf(sender.address),
            contractStakingTokenBalance: await stakingToken.balanceOf(stakingRewards.address),
            periodFinishTime: BN.from(globalData[0]),
            lastUpdateTime: BN.from(globalData[1]),
            rewardRate: globalData[2],
            rewardPerTokenStored: globalData[3],
            lastTimeRewardApplicable: await stakingRewards.lastTimeRewardApplicable(),
        }
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        rewardsDistributor = sa.fundManager
        nexus = await new MockNexus__factory(sa.default.signer).deploy(
            sa.governor.address,
            sa.mockSavingsManager.address,
            sa.mockInterestValidator.address,
        )
    })

    describe("constructor & settings", async () => {
        before(async () => {
            await redeployRewards()
        })
        it("should set all initial state", async () => {
            const data = await snapshotStakingData()
            // Set in constructor
            expect(await stakingRewards.nexus(), nexus.address)
            expect(await stakingRewards.stakingToken(), stakingToken.address)
            expect(await stakingRewards.rewardsToken(), rewardToken.address)
            expect(await stakingRewards.rewardsDistributor(), rewardsDistributor.address)

            // Basic storage
            expect(data.totalSupply).eq(0)
            expect(data.periodFinishTime).eq(0)
            expect(data.rewardRate).eq(0)
            expect(data.lastUpdateTime).eq(0)
            expect(data.rewardPerTokenStored).eq(0)
            expect(data.lastTimeRewardApplicable).eq(0)
            expect(await stakingRewards.rewardPerToken()).eq(0)
        })
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
        const periodIsFinished = timeAfter.gt(beforeData.periodFinishTime)
        const beforeDataLastUpdateTime =
            beforeData.rewardPerTokenStored.eq(0) && beforeData.totalSupply.eq(0) ? beforeData.lastUpdateTime : timeAfter

        //    LastUpdateTime
        expect(periodIsFinished ? beforeData.periodFinishTime : beforeDataLastUpdateTime).eq(afterData.lastUpdateTime)

        //    RewardRate doesnt change
        expect(beforeData.rewardRate).eq(afterData.rewardRate)
        //    RewardPerTokenStored goes up
        expect(afterData.rewardPerTokenStored).gte(beforeData.rewardPerTokenStored)
        //      Calculate exact expected 'rewardPerToken' increase since last update
        const timeApplicableToRewards = periodIsFinished
            ? beforeData.periodFinishTime.sub(beforeData.lastUpdateTime)
            : timeAfter.sub(beforeData.lastUpdateTime)
        const increaseInRewardPerToken = beforeData.totalSupply.eq(0)
            ? 0
            : beforeData.rewardRate.mul(timeApplicableToRewards).mul(fullScale).div(beforeData.totalSupply)
        expect(beforeData.rewardPerTokenStored.add(increaseInRewardPerToken)).eq(afterData.rewardPerTokenStored)

        // Expect updated personal state
        //    userRewardPerTokenPaid(beneficiary) should update
        expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored)

        //    If existing staker, then rewards Should increase
        if (shouldResetRewards) {
            expect(afterData.beneficiaryRewardsEarned).eq(0)
        } else if (isExistingStaker) {
            // rewards(beneficiary) should update with previously accrued tokens
            const increaseInUserRewardPerToken = afterData.rewardPerTokenStored.sub(beforeData.userRewardPerTokenPaid)
            const assignment = beforeData.userStakingBalance.mul(increaseInUserRewardPerToken).div(fullScale)
            expect(beforeData.beneficiaryRewardsEarned.add(assignment)).eq(afterData.beneficiaryRewardsEarned)
        } else {
            // else `rewards` should stay the same
            expect(beforeData.beneficiaryRewardsEarned).eq(afterData.beneficiaryRewardsEarned)
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

        const isExistingStaker = beforeData.userStakingBalance.gt(0)
        if (confirmExistingStaker) {
            expect(isExistingStaker).eq(true)
        }
        // 2. Approve staking token spending and send the TX
        await stakingToken.connect(sender.signer).approve(stakingRewards.address, stakeAmount)
        const tx = await (senderIsBeneficiary
            ? stakingRewards.connect(sender.signer)["stake(uint256)"](stakeAmount)
            : stakingRewards.connect(sender.signer)["stake(address,uint256)"](beneficiary.address, stakeAmount))
        await expect(tx).to.emit(stakingRewards, "Staked").withArgs(beneficiary.address, stakeAmount, sender.address)

        // 3. Ensure rewards are accrued to the beneficiary
        const afterData = await snapshotStakingData(sender, beneficiary)
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker)

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.senderStakingTokenBalance.sub(stakeAmount)).eq(afterData.senderStakingTokenBalance)
        //    StakingToken balance of StakingRewards
        expect(beforeData.contractStakingTokenBalance.add(stakeAmount)).eq(afterData.contractStakingTokenBalance)
        //    TotalSupply of StakingRewards
        expect(beforeData.totalSupply.add(stakeAmount)).eq(afterData.totalSupply)
    }

    /**
     * @dev Ensures a funding is successful, checking that it updates the rewardRate etc
     * @param rewardUnits Number of units to stake
     */
    const expectSuccessfulFunding = async (rewardUnits: BN): Promise<void> => {
        const beforeData = await snapshotStakingData()
        const tx = await stakingRewards.connect(rewardsDistributor.signer).notifyRewardAmount(rewardUnits)
        await expect(tx).to.emit(stakingRewards, "RewardAdded").withArgs(rewardUnits)

        const cur = await getTimestamp()
        const leftOverRewards = beforeData.rewardRate.mul(beforeData.periodFinishTime.sub(beforeData.lastTimeRewardApplicable))
        const afterData = await snapshotStakingData()

        // Sets lastTimeRewardApplicable to latest
        expect(cur).eq(afterData.lastTimeRewardApplicable)
        // Sets lastUpdateTime to latest
        expect(cur).eq(afterData.lastUpdateTime)
        // Sets periodFinish to 1 week from now
        expect(cur.add(ONE_WEEK)).eq(afterData.periodFinishTime)
        // Sets rewardRate to rewardUnits / ONE_WEEK
        if (leftOverRewards.gt(0)) {
            const total = rewardUnits.add(leftOverRewards)
            assertBNClose(
                total.div(ONE_WEEK),
                afterData.rewardRate,
                beforeData.rewardRate.div(ONE_WEEK).mul(5), // the effect of 1 second on the future scale
            )
        } else {
            expect(rewardUnits.div(ONE_WEEK)).eq(afterData.rewardRate)
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
        const isExistingStaker = beforeData.userStakingBalance.gt(0)
        expect(isExistingStaker).eq(true)
        expect(withdrawAmount).gte(beforeData.userStakingBalance)

        // 2. Send withdrawal tx
        const tx = await stakingRewards.connect(sender.signer).withdraw(withdrawAmount)
        await expect(tx).to.emit(stakingRewards, "Withdrawn").withArgs(sender.address, withdrawAmount)

        // 3. Expect Rewards to accrue to the beneficiary
        //    StakingToken balance of sender
        const afterData = await snapshotStakingData(sender)
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker)

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.senderStakingTokenBalance.add(withdrawAmount)).eq(afterData.senderStakingTokenBalance)
        //    Withdraws from the actual rewards wrapper token
        expect(beforeData.userStakingBalance.sub(withdrawAmount)).eq(afterData.userStakingBalance)
        //    Updates total supply
        expect(beforeData.totalSupply.sub(withdrawAmount)).eq(afterData.totalSupply)
    }

    context("initialising and staking in a new pool", () => {
        before(async () => {
            await redeployRewards()
        })
        describe("notifying the pool of reward", () => {
            it("should begin a new period through", async () => {
                const rewardUnits = simpleToExactAmount(1, 18)
                await expectSuccessfulFunding(rewardUnits)
            })
        })
        describe("staking in the new period", () => {
            it("should assign rewards to the staker", async () => {
                // Do the stake
                const data = await snapshotStakingData()
                const { rewardRate } = data
                const stakeAmount = simpleToExactAmount(100, 18)
                await expectSuccessfulStake(stakeAmount)

                await increaseTime(ONE_DAY)

                // This is the total reward per staked token, since the last update
                const rewardPerToken = await stakingRewards.rewardPerToken()
                const rewardPerSecond = BN.from(rewardRate).mul(fullScale).div(stakeAmount)
                assertBNClose(rewardPerToken, ONE_DAY.mul(rewardPerSecond), rewardPerSecond.mul(10))

                // Calc estimated unclaimed reward for the user
                // earned == balance * (rewardPerToken-userExistingReward)
                const earned = await stakingRewards.earned(sa.default.address)
                expect(stakeAmount.mul(rewardPerToken).div(fullScale)).eq(earned)
            })
            it("should update stakers rewards after consequent stake", async () => {
                const stakeAmount = simpleToExactAmount(100, 18)
                // This checks resulting state after second stake
                await expectSuccessfulStake(stakeAmount, sa.default, sa.default, true)
            })
            it("should fail if stake amount is 0", async () => {
                await expect(stakingRewards.connect(sa.default.signer)["stake(uint256)"](0)).to.revertedWith("Cannot stake 0")
            })
            it("should fail if staker has insufficient balance", async () => {
                await stakingToken.connect(sa.dummy2.signer).approve(stakingRewards.address, 1)
                await expect(stakingRewards.connect(sa.dummy2.signer)["stake(uint256)"](1)).to.revertedWith(
                    "ERC20: transfer amount exceeds balance",
                )
            })
        })
    })
    context("funding with too much rewards", () => {
        before(async () => {
            await redeployRewards()
        })
        it("should fail", async () => {
            await expect(stakingRewards.connect(sa.fundManager.signer).notifyRewardAmount(simpleToExactAmount(1, 25))).to.revertedWith(
                "Cannot notify with more than a million units",
            )
        })
    })
    context("staking before rewards are added", () => {
        before(async () => {
            await redeployRewards()
        })
        it("should assign no rewards", async () => {
            // Get data before
            const stakeAmount = simpleToExactAmount(100, 18)
            const beforeData = await snapshotStakingData()
            expect(beforeData.rewardRate).eq(0)
            expect(beforeData.rewardPerTokenStored).eq(0)
            expect(beforeData.beneficiaryRewardsEarned).eq(0)
            expect(beforeData.totalSupply).eq(0)
            expect(beforeData.lastTimeRewardApplicable).eq(0)

            // Do the stake
            await expectSuccessfulStake(stakeAmount)

            // Wait a day
            await increaseTime(ONE_DAY)

            // Do another stake
            await expectSuccessfulStake(stakeAmount)

            // Get end results
            const afterData = await snapshotStakingData()
            expect(afterData.rewardRate).eq(0)
            expect(afterData.rewardPerTokenStored).eq(0)
            expect(afterData.beneficiaryRewardsEarned).eq(0)
            expect(afterData.totalSupply).eq(stakeAmount.mul(2))
            expect(afterData.lastTimeRewardApplicable).eq(0)
        })
    })
    context("adding first stake days after funding", () => {
        before(async () => {
            await redeployRewards()
        })
        it("should retrospectively assign rewards to the first staker", async () => {
            await expectSuccessfulFunding(simpleToExactAmount(100, 18))

            // Do the stake
            const { rewardRate } = await stakingRewards.globalData()

            await increaseTime(FIVE_DAYS)

            const stakeAmount = simpleToExactAmount(100, 18)
            await expectSuccessfulStake(stakeAmount)

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await stakingRewards.rewardPerToken()

            const rewardPerSecond = BN.from(rewardRate).mul(fullScale).div(stakeAmount)
            assertBNClose(rewardPerToken, FIVE_DAYS.mul(rewardPerSecond), rewardPerSecond.mul(4))

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await stakingRewards.earned(sa.default.address)
            expect(stakeAmount.mul(rewardPerToken).div(fullScale)).eq(earnedAfterConsequentStake)
        })
    })
    context("staking over multiple funded periods", () => {
        context("with a single staker", () => {
            before(async () => {
                await redeployRewards()
            })
            it("should assign all the rewards from the periods", async () => {
                const fundAmount1 = simpleToExactAmount(100, 18)
                const fundAmount2 = simpleToExactAmount(200, 18)
                await expectSuccessfulFunding(fundAmount1)

                const stakeAmount = simpleToExactAmount(1, 18)
                await expectSuccessfulStake(stakeAmount)

                await increaseTime(ONE_WEEK.mul(2))

                await expectSuccessfulFunding(fundAmount2)

                await increaseTime(ONE_WEEK.mul(2))

                const earned = await stakingRewards.earned(sa.default.address)
                assertBNSlightlyGT(fundAmount1.add(fundAmount2), earned, BN.from(1000000), false)
            })
        })
        context("with multiple stakers coming in and out", () => {
            let staker2: Account
            let staker3: Account

            const fundAmount1 = simpleToExactAmount(100, 21)
            const fundAmount2 = simpleToExactAmount(200, 21)
            const staker1Stake1 = simpleToExactAmount(100, 18)
            const staker1Stake2 = simpleToExactAmount(200, 18)
            const staker2Stake = simpleToExactAmount(100, 18)
            const staker3Stake = simpleToExactAmount(100, 18)

            before(async () => {
                await redeployRewards()

                staker2 = sa.dummy1
                staker3 = sa.dummy2
                await stakingToken.transfer(staker2.address, staker2Stake)
                await stakingToken.transfer(staker3.address, staker3Stake)
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

                await expectSuccessfulFunding(fundAmount1)

                await increaseTime(ONE_WEEK.div(2).add(1))

                await expectSuccessfulStake(staker2Stake, staker2, staker2)

                await increaseTime(ONE_WEEK.div(2).add(1))

                // WEEK 1-2 START
                await expectSuccessfulFunding(fundAmount2)

                await stakingRewards.connect(staker3.signer).withdraw(staker3Stake)
                await expectSuccessfulStake(staker1Stake2, sa.default, sa.default, true)

                await increaseTime(ONE_WEEK)

                // WEEK 2 FINISH
                const earned1 = await stakingRewards.earned(sa.default.address)
                assertBNClose(earned1, simpleToExactAmount("191.66", 21), simpleToExactAmount(1, 19))
                const earned2 = await stakingRewards.earned(staker2.address)
                assertBNClose(earned2, simpleToExactAmount("66.66", 21), simpleToExactAmount(1, 19))
                const earned3 = await stakingRewards.earned(staker3.address)
                assertBNClose(earned3, simpleToExactAmount("41.66", 21), simpleToExactAmount(1, 19))
                // Ensure that sum of earned rewards does not exceed funcing amount
                expect(fundAmount1.add(fundAmount2)).gte(earned1.add(earned2).add(earned3))
            })
        })
    })
    context("staking after period finish", () => {
        const fundAmount1 = simpleToExactAmount(100, 21)

        before(async () => {
            await redeployRewards()
        })
        it("should stop accruing rewards after the period is over", async () => {
            await expectSuccessfulStake(simpleToExactAmount(1, 18))
            await expectSuccessfulFunding(fundAmount1)

            await increaseTime(ONE_WEEK.add(1))

            const earnedAfterWeek = await stakingRewards.earned(sa.default.address)

            await increaseTime(ONE_WEEK.add(1))
            const now = await getTimestamp()

            const earnedAfterTwoWeeks = await stakingRewards.earned(sa.default.address)

            expect(earnedAfterWeek).eq(earnedAfterTwoWeeks)

            const lastTimeRewardApplicable = await stakingRewards.lastTimeRewardApplicable()
            assertBNClose(lastTimeRewardApplicable, now.sub(ONE_WEEK).sub(2), BN.from(2))
        })
    })
    context("staking on behalf of a beneficiary", () => {
        const fundAmount = simpleToExactAmount(100, 21)
        let beneficiary: Account
        const stakeAmount = simpleToExactAmount(100, 18)

        before(async () => {
            await redeployRewards()
            beneficiary = sa.dummy1
            await expectSuccessfulFunding(fundAmount)
            await expectSuccessfulStake(stakeAmount, sa.default, beneficiary)
            await increaseTime(10)
        })
        it("should update the beneficiaries reward details", async () => {
            const earned = await stakingRewards.earned(beneficiary.address)
            expect(earned).gt(0)

            const balance = await stakingRewards.balanceOf(beneficiary.address)
            expect(balance).eq(stakeAmount)
        })
        it("should not update the senders details", async () => {
            const earned = await stakingRewards.earned(sa.default.address)
            expect(earned).eq(0)

            const balance = await stakingRewards.balanceOf(sa.default.address)
            expect(balance).eq(0)
        })
    })
    context("using staking / reward tokens with diff decimals", () => {
        before(async () => {
            await redeployRewards(nexus.address, 12, 16)
        })
        it("should not affect the pro rata payouts", async () => {
            // Add 100 reward tokens
            await expectSuccessfulFunding(simpleToExactAmount(100, 12))
            const { rewardRate } = await stakingRewards.globalData()

            // Do the stake
            const stakeAmount = simpleToExactAmount(100, 16)
            await expectSuccessfulStake(stakeAmount)

            await increaseTime(ONE_WEEK.add(1))

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await stakingRewards.rewardPerToken()
            assertBNClose(
                rewardPerToken,
                ONE_WEEK.mul(rewardRate).mul(fullScale).div(stakeAmount),
                rewardRate.mul(fullScale).div(stakeAmount),
            )

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await stakingRewards.earned(sa.default.address)
            assertBNSlightlyGT(simpleToExactAmount(100, 12), earnedAfterConsequentStake, simpleToExactAmount(1, 9))
        })
    })

    context("getting the reward token", () => {
        before(async () => {
            await redeployRewards()
        })
        it("should simply return the rewards Token", async () => {
            const readToken = await stakingRewards.getRewardToken()
            expect(readToken).eq(rewardToken.address)
            expect(readToken).eq(await stakingRewards.rewardsToken())
        })
    })

    context("notifying new reward amount", () => {
        context("from someone other than the distributor", () => {
            before(async () => {
                await redeployRewards()
            })
            it("should fail using default signer", async () => {
                await expect(stakingRewards.connect(sa.default.signer).notifyRewardAmount(1)).to.revertedWith(
                    "Caller is not reward distributor",
                )
            })
            it("should fail using dummy1", async () => {
                await expect(stakingRewards.connect(sa.dummy1.signer).notifyRewardAmount(1)).to.revertedWith(
                    "Caller is not reward distributor",
                )
            })
            it("should fail using governor", async () => {
                await expect(stakingRewards.connect(sa.governor.signer).notifyRewardAmount(1)).to.revertedWith(
                    "TransparentUpgradeableProxy: admin cannot fallback to proxy target",
                )
            })
        })
        context("before current period finish", async () => {
            const funding1 = simpleToExactAmount(100, 18)
            const funding2 = simpleToExactAmount(200, 18)
            beforeEach(async () => {
                await redeployRewards()
            })
            it("should factor in unspent units to the new rewardRate", async () => {
                // Do the initial funding
                await expectSuccessfulFunding(funding1)
                const { rewardRate: actualRewardRate } = await stakingRewards.globalData()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(ONE_WEEK.div(2))

                // Do the second funding, and factor in the unspent units
                const expectedLeftoverReward = funding1.div(2)
                await expectSuccessfulFunding(funding2)
                const { rewardRate: actualRewardRateAfter } = await stakingRewards.globalData()
                const totalRewardsForWeek = funding2.add(expectedLeftoverReward)
                const expectedRewardRateAfter = totalRewardsForWeek.div(ONE_WEEK)
                assertBNClose(actualRewardRateAfter, expectedRewardRateAfter, actualRewardRate.div(ONE_WEEK).mul(20))
            })
            it("should factor in unspent units to the new rewardRate if instant", async () => {
                // Do the initial funding
                await expectSuccessfulFunding(funding1)
                const { rewardRate: actualRewardRate } = await stakingRewards.globalData()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(1)

                // Do the second funding, and factor in the unspent units
                await expectSuccessfulFunding(funding2)
                const { rewardRate: actualRewardRateAfter } = await stakingRewards.globalData()
                const expectedRewardRateAfter = funding1.add(funding2).div(ONE_WEEK)
                assertBNClose(actualRewardRateAfter, expectedRewardRateAfter, actualRewardRate.div(ONE_WEEK).mul(20))
            })
        })

        context("after current period finish", () => {
            const funding1 = simpleToExactAmount(100, 18)
            before(async () => {
                await redeployRewards()
            })
            it("should start a new period with the correct rewardRate", async () => {
                // Do the initial funding
                await expectSuccessfulFunding(funding1)
                const { rewardRate: actualRewardRate } = await stakingRewards.globalData()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(ONE_WEEK.add(1))

                // Do the second funding, and factor in the unspent units
                await expectSuccessfulFunding(funding1.mul(2))
                const { rewardRate: actualRewardRateAfter } = await stakingRewards.globalData()
                const expectedRewardRateAfter = expectedRewardRate.mul(2)
                expect(actualRewardRateAfter).eq(expectedRewardRateAfter)
            })
        })
    })

    context("withdrawing stake or rewards", () => {
        context("withdrawing a stake amount", () => {
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, 18)

            before(async () => {
                await redeployRewards()
                await expectSuccessfulFunding(fundAmount)
                await expectSuccessfulStake(stakeAmount)
                await increaseTime(10)
            })
            it("should revert for a non-staker", async () => {
                await expect(stakingRewards.connect(sa.dummy1.signer).withdraw(1)).to.revertedWith("Not enough user rewards")
            })
            it("should revert if insufficient balance", async () => {
                await expect(stakingRewards.connect(sa.default.signer).withdraw(stakeAmount.add(1))).to.revertedWith(
                    "Not enough user rewards",
                )
            })
            it("should fail if trying to withdraw 0", async () => {
                await expect(stakingRewards.connect(sa.default.signer).withdraw(0)).to.revertedWith("Cannot withdraw 0")
            })
            it("should withdraw the stake and update the existing reward accrual", async () => {
                // Check that the user has earned something
                const earnedBefore = await stakingRewards.earned(sa.default.address)
                expect(earnedBefore).gt(0)
                const { rewards: rewardsBefore } = await stakingRewards.userData(sa.default.address)
                expect(rewardsBefore).eq(0)

                // Execute the withdrawal
                await expectStakingWithdrawal(stakeAmount)

                // Ensure that the new awards are added + assigned to user
                const earnedAfter = await stakingRewards.earned(sa.default.address)
                expect(earnedAfter).gte(earnedBefore)
                const { rewards: rewardsAfter } = await stakingRewards.userData(sa.default.address)
                expect(rewardsAfter).eq(earnedAfter)

                // Zoom forward now
                await increaseTime(10)

                // Check that the user does not earn anything else
                const earnedEnd = await stakingRewards.earned(sa.default.address)
                expect(earnedEnd).eq(earnedAfter)
                const { rewards: rewardsEnd } = await stakingRewards.userData(sa.default.address)
                expect(rewardsEnd).eq(rewardsAfter)

                // Cannot withdraw anything else
                await expect(stakingRewards.connect(sa.default.signer).withdraw(stakeAmount.add(1))).to.revertedWith(
                    "Not enough user rewards",
                )
            })
        })
        context("claiming rewards", async () => {
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, 18)

            before(async () => {
                await redeployRewards()
                await expectSuccessfulFunding(fundAmount)
                await rewardToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
                await expectSuccessfulStake(stakeAmount, sa.default, sa.dummy2)
                await increaseTime(ONE_WEEK.add(1))
            })
            it("should do nothing for a non-staker", async () => {
                const beforeData = await snapshotStakingData(sa.dummy1, sa.dummy1)
                await stakingRewards.connect(sa.dummy1.signer).claimReward()

                const afterData = await snapshotStakingData(sa.dummy1, sa.dummy1)
                expect(beforeData.beneficiaryRewardsEarned).eq(0)
                expect(afterData.beneficiaryRewardsEarned).eq(0)
                expect(afterData.senderStakingTokenBalance).eq(0)
                expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored)
            })
            it("should send all accrued rewards to the rewardee", async () => {
                const beforeData = await snapshotStakingData(sa.dummy2, sa.dummy2)
                const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.dummy2.address)
                expect(rewardeeBalanceBefore).eq(0)
                const tx = await stakingRewards.connect(sa.dummy2.signer).claimReward()
                await expect(tx).to.emit(stakingRewards, "RewardPaid")
                const afterData = await snapshotStakingData(sa.dummy2, sa.dummy2)
                await assertRewardsAssigned(beforeData, afterData, false, true)
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.dummy2.address)
                assertBNClose(rewardeeBalanceAfter, fundAmount, simpleToExactAmount(1, 16))

                // 'rewards' reset to 0
                expect(afterData.beneficiaryRewardsEarned).eq(0)
                // Paid up until the last block
                expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored)
                // Token balances dont change
                expect(afterData.senderStakingTokenBalance).eq(beforeData.senderStakingTokenBalance)
                expect(beforeData.userStakingBalance).eq(afterData.userStakingBalance)
            })
        })
        context("completely 'exiting' the system", () => {
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, 18)

            before(async () => {
                await redeployRewards()
                await expectSuccessfulFunding(fundAmount)
                await rewardToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
                await expectSuccessfulStake(stakeAmount)
                await increaseTime(ONE_WEEK.add(1))
            })
            it("should fail if the sender has no stake", async () => {
                await expect(stakingRewards.connect(sa.dummy1.signer).exit()).to.revertedWith("Cannot withdraw 0")
            })
            it("should withdraw all senders stake and send outstanding rewards to the staker", async () => {
                const beforeData = await snapshotStakingData()
                const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.default.address)

                const tx = await stakingRewards.exit()
                await expect(tx).to.emit(stakingRewards, "Withdrawn").withArgs(sa.default.address, stakeAmount)
                await expect(tx).to.emit(stakingRewards, "RewardPaid")

                const afterData = await snapshotStakingData()
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.default.address)
                assertBNClose(rewardeeBalanceAfter.sub(rewardeeBalanceBefore), fundAmount, simpleToExactAmount(1, 16))

                // Expect Rewards to accrue to the beneficiary
                //    StakingToken balance of sender
                await assertRewardsAssigned(beforeData, afterData, false, true)

                // Expect token transfer
                //    StakingToken balance of sender
                expect(beforeData.senderStakingTokenBalance.add(stakeAmount)).eq(afterData.senderStakingTokenBalance)
                //    Withdraws from the actual rewards wrapper token
                expect(beforeData.userStakingBalance.sub(stakeAmount)).eq(afterData.userStakingBalance)
                //    Updates total supply
                expect(beforeData.totalSupply.sub(stakeAmount)).eq(afterData.totalSupply)

                await expect(stakingRewards.exit()).to.revertedWith("Cannot withdraw 0")
            })
        })
    })
    context("running a full integration test", () => {
        const fundAmount = simpleToExactAmount(100, 21)
        const stakeAmount = simpleToExactAmount(100, 18)

        before(async () => {
            await redeployRewards()
        })
        it("1. should allow the rewardsDistributor to fund the pool", async () => {
            await rewardToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
            await expectSuccessfulFunding(fundAmount)
        })
        it("2. should allow stakers to stake and earn rewards", async () => {
            await expectSuccessfulStake(stakeAmount)
            await increaseTime(ONE_WEEK.add(1))
        })
        it("3. should credit earnings directly to beneficiary", async () => {
            const beforeData = await snapshotStakingData()
            const beneficiaryBalanceBefore = await rewardToken.balanceOf(sa.default.address)

            await stakingRewards.exit()

            const afterData = await snapshotStakingData()
            // Balance transferred to the rewardee
            const beneficiaryBalanceAfter = await rewardToken.balanceOf(sa.default.address)
            assertBNClose(beneficiaryBalanceAfter.sub(beneficiaryBalanceBefore), fundAmount, simpleToExactAmount(1, 16))

            await assertRewardsAssigned(beforeData, afterData, false, true)
        })
    })
})
