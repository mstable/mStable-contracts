/* eslint-disable no-nested-ternary */
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions"
import { FIVE_DAYS, fullScale, MAX_UINT256, ONE_DAY, ONE_WEEK, ZERO, ZERO_ADDRESS } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { getTimestamp, increaseTime } from "@utils/time"
import { expect } from "chai"
import { ethers } from "hardhat"
import { Account } from "types"
import {
    AssetProxy__factory,
    ExposedMasset,
    FeederPool,
    MockERC20,
    MockERC20__factory,
    MockNexus,
    MockNexus__factory,
    MockSavingsContract__factory,
    PlatformTokenVendor__factory,
    StakingRewardsWithPlatformToken,
    StakingRewardsWithPlatformToken__factory,
} from "types/generated"

interface StakingData {
    totalSupply: BN
    userStakingBalance: BN
    senderStakingTokenBalance: BN
    contractStakingTokenBalance: BN
    userRewardPerTokenPaid: BN
    userPlatformRewardPerTokenPaid: BN
    beneficiaryRewardsEarned: BN
    beneficiaryPlatformRewardsEarned: BN
    rewardPerTokenStored: BN
    platformRewardPerTokenStored: BN
    rewardRate: BN
    platformRewardRate: BN
    lastUpdateTime: BN
    lastTimeRewardApplicable: BN
    periodFinishTime: BN
    platformTokenVendor: string
    platformTokenBalanceVendor: BN
    platformTokenBalanceStakingRewards: BN
}

interface ConfigRedeemAndUnwrap {
    amount: BN
    minAmountOut: BN
    isBassetOut: boolean
    beneficiary: Account
    output: MockERC20 // Asset to unwrap from underlying
    router: ExposedMasset | FeederPool | MockERC20 // Router address = mAsset || feederPool
}

describe("StakingRewardsWithPlatformToken", async () => {
    let sa: StandardAccounts
    let rewardsDistributor: Account
    let nexus: MockNexus

    let rewardToken: MockERC20
    let platformToken: MockERC20
    let stakingToken: MockERC20
    let stakingRewards: StakingRewardsWithPlatformToken

    const redeployRewards = async (
        nexusAddress = nexus.address,
        rewardDecimals = 18,
        platformDecimals = 18,
        stakingDecimals = 18,
    ): Promise<StakingRewardsWithPlatformToken> => {
        const deployer = sa.default.signer
        rewardToken = await new MockERC20__factory(deployer).deploy("Reward", "RWD", rewardDecimals, rewardsDistributor.address, 1000000)
        platformToken = await new MockERC20__factory(deployer).deploy(
            "PLAT4M",
            "PLAT",
            platformDecimals,
            rewardsDistributor.address,
            1000000,
        )
        const mAsset = await new MockERC20__factory(sa.default.signer).deploy("mUSD", "mUSD", stakingDecimals, sa.default.address, 1000000)
        stakingToken = await new MockSavingsContract__factory(sa.default.signer).deploy(
            "Staking",
            "ST8k",
            stakingDecimals,
            sa.default.address,
            1000000,
            mAsset.address,
        )

        const stakingRewardsImpl = await new StakingRewardsWithPlatformToken__factory(deployer).deploy(
            nexusAddress,
            stakingToken.address,
            rewardToken.address,
            platformToken.address,
            ONE_DAY.mul(7),
        )
        const initializeData = stakingRewardsImpl.interface.encodeFunctionData("initialize", [
            rewardsDistributor.address,
            "StakingToken",
            "ST8k",
        ])
        const proxy = await new AssetProxy__factory(deployer).deploy(stakingRewardsImpl.address, sa.governor.address, initializeData)
        stakingRewards = StakingRewardsWithPlatformToken__factory.connect(proxy.address, deployer)

        return stakingRewards
    }

    const snapshotStakingData = async (sender = sa.default, beneficiary = sa.default): Promise<StakingData> => {
        const platformTokenVendor = await stakingRewards.platformTokenVendor()
        return {
            totalSupply: await stakingRewards.totalSupply(),
            userStakingBalance: await stakingRewards.balanceOf(beneficiary.address),
            senderStakingTokenBalance: await stakingToken.balanceOf(sender.address),
            contractStakingTokenBalance: await stakingToken.balanceOf(stakingRewards.address),
            userRewardPerTokenPaid: await stakingRewards.userRewardPerTokenPaid(beneficiary.address),
            userPlatformRewardPerTokenPaid: await stakingRewards.userPlatformRewardPerTokenPaid(beneficiary.address),
            beneficiaryRewardsEarned: await stakingRewards.rewards(beneficiary.address),
            beneficiaryPlatformRewardsEarned: await stakingRewards.platformRewards(beneficiary.address),
            rewardPerTokenStored: await stakingRewards.rewardPerTokenStored(),
            platformRewardPerTokenStored: await stakingRewards.platformRewardPerTokenStored(),
            rewardRate: await stakingRewards.rewardRate(),
            platformRewardRate: await stakingRewards.platformRewardRate(),
            lastUpdateTime: await stakingRewards.lastUpdateTime(),
            lastTimeRewardApplicable: await stakingRewards.lastTimeRewardApplicable(),
            periodFinishTime: await stakingRewards.periodFinish(),
            platformTokenVendor,
            platformTokenBalanceVendor: await platformToken.balanceOf(platformTokenVendor),
            platformTokenBalanceStakingRewards: await platformToken.balanceOf(stakingRewards.address),
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
            // Set in constructor
            expect(await stakingRewards.nexus(), nexus.address)
            expect(await stakingRewards.stakingToken(), stakingToken.address)
            expect(await stakingRewards.rewardsToken(), rewardToken.address)
            expect(await stakingRewards.platformToken(), platformToken.address)
            expect(await stakingRewards.platformTokenVendor()).not.eq(ZERO_ADDRESS)
            expect(await stakingRewards.rewardsDistributor(), rewardsDistributor.address)

            // Basic storage
            expect(await stakingRewards.totalSupply()).eq(0)
            expect(await stakingRewards.periodFinish()).eq(0)
            expect(await stakingRewards.rewardRate()).eq(0)
            expect(await stakingRewards.platformRewardRate()).eq(0)
            expect(await stakingRewards.lastUpdateTime()).eq(0)
            expect(await stakingRewards.rewardPerTokenStored()).eq(0)
            expect(await stakingRewards.platformRewardPerTokenStored()).eq(0)
            expect(await stakingRewards.lastTimeRewardApplicable()).eq(0)
            expect((await stakingRewards.rewardPerToken())[0]).eq(0)
            expect((await stakingRewards.rewardPerToken())[1]).eq(0)
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
        shouldResetPlatformRewards = false,
    ): Promise<void> => {
        const timeAfter = await getTimestamp()
        const periodIsFinished = timeAfter.gt(beforeData.periodFinishTime)

        //    LastUpdateTime
        expect(
            periodIsFinished
                ? beforeData.periodFinishTime
                : beforeData.rewardPerTokenStored.eq(0) && beforeData.totalSupply.eq(0)
                ? beforeData.lastUpdateTime
                : timeAfter,
        ).eq(afterData.lastUpdateTime)

        //    RewardRate doesnt change
        expect(beforeData.rewardRate).eq(afterData.rewardRate)
        expect(beforeData.platformRewardRate).eq(afterData.platformRewardRate)
        //    RewardPerTokenStored goes up
        expect(afterData.rewardPerTokenStored).gte(beforeData.rewardPerTokenStored)
        expect(afterData.platformRewardPerTokenStored).gte(beforeData.platformRewardPerTokenStored)

        //      Calculate exact expected 'rewardPerToken' increase since last update
        const timeApplicableToRewards = periodIsFinished
            ? beforeData.periodFinishTime.sub(beforeData.lastUpdateTime)
            : timeAfter.sub(beforeData.lastUpdateTime)
        const increaseInRewardPerToken = beforeData.totalSupply.eq(0)
            ? 0
            : beforeData.rewardRate.mul(timeApplicableToRewards).mul(fullScale).div(beforeData.totalSupply)
        const increaseInPlatformRewardPerToken = beforeData.totalSupply.eq(0)
            ? 0
            : beforeData.platformRewardRate.mul(timeApplicableToRewards).mul(fullScale).div(beforeData.totalSupply)

        expect(beforeData.rewardPerTokenStored.add(increaseInRewardPerToken)).eq(afterData.rewardPerTokenStored)
        expect(beforeData.platformRewardPerTokenStored.add(increaseInPlatformRewardPerToken)).eq(afterData.platformRewardPerTokenStored)

        // Expect updated personal state
        //    userRewardPerTokenPaid(beneficiary) should update
        expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored)
        expect(afterData.userPlatformRewardPerTokenPaid).eq(afterData.platformRewardPerTokenStored)

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

        //    If existing staker, then platform rewards Should increase
        if (shouldResetPlatformRewards) {
            expect(afterData.beneficiaryPlatformRewardsEarned).eq(0)
        } else if (isExistingStaker) {
            // rewards(beneficiary) should update with previously accrued tokens
            const increaseInUserPlatformRewardPerToken = afterData.platformRewardPerTokenStored.sub(
                beforeData.userPlatformRewardPerTokenPaid,
            )
            const assignment = beforeData.userStakingBalance.mul(increaseInUserPlatformRewardPerToken).div(fullScale)
            expect(beforeData.beneficiaryPlatformRewardsEarned.add(assignment)).eq(afterData.beneficiaryPlatformRewardsEarned)
        } else {
            // else `rewards` should stay the same
            expect(beforeData.beneficiaryPlatformRewardsEarned).eq(afterData.beneficiaryPlatformRewardsEarned)
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
            expect(isExistingStaker, "isExistingStaker true").eq(true)
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
        expect(afterData.senderStakingTokenBalance, "sender staking balance after").eq(
            beforeData.senderStakingTokenBalance.sub(stakeAmount),
        )

        //    StakingToken balance of StakingRewardsWithPlatformToken
        expect(afterData.contractStakingTokenBalance, "contract staking balance after").eq(
            beforeData.contractStakingTokenBalance.add(stakeAmount),
        )

        //    TotalSupply of StakingRewardsWithPlatformToken
        expect(afterData.totalSupply, "total supply after").eq(beforeData.totalSupply.add(stakeAmount))
    }

    /**
     * @dev Ensures a funding is successful, checking that it updates the rewardRate etc
     * @param rewardUnits Number of units to stake
     */
    const expectSuccessfulFunding = async (rewardUnits: BN, platformUnitsExpected = BN.from(0)): Promise<void> => {
        const beforeData = await snapshotStakingData()
        expect(beforeData.platformTokenBalanceStakingRewards, "staking rewards platform balance before").gte(platformUnitsExpected)

        const tx = await stakingRewards.connect(rewardsDistributor.signer).notifyRewardAmount(rewardUnits)
        await expect(tx).to.emit(stakingRewards, "RewardAdded").withArgs(rewardUnits, platformUnitsExpected)

        const cur = await getTimestamp()
        const leftOverRewards = beforeData.rewardRate.mul(beforeData.periodFinishTime.sub(beforeData.lastTimeRewardApplicable))
        const leftOverPlatformRewards = beforeData.platformRewardRate.mul(
            beforeData.periodFinishTime.sub(beforeData.lastTimeRewardApplicable),
        )

        const afterData = await snapshotStakingData()

        // Expect the tokens to be transferred to the vendor
        expect(afterData.platformTokenBalanceStakingRewards, "staking rewards platform balance after").eq(0)
        expect(afterData.platformTokenBalanceVendor, "vendor platform balance after").eq(
            beforeData.platformTokenBalanceVendor.add(beforeData.platformTokenBalanceStakingRewards),
        )

        // Sets lastTimeRewardApplicable to latest
        expect(cur, "lastTimeRewardApplicable updated").eq(afterData.lastTimeRewardApplicable)

        // Sets lastUpdateTime to latest
        expect(cur, "lastUpdateTime updated").eq(afterData.lastUpdateTime)

        // Sets periodFinish to 1 week from now
        expect(cur.add(ONE_WEEK), "periodFinishTime updated").eq(afterData.periodFinishTime)

        // Sets rewardRate to rewardUnits / ONE_WEEK
        if (leftOverRewards.gt(0)) {
            const total = rewardUnits.add(leftOverRewards)
            assertBNClose(
                total.div(ONE_WEEK),
                afterData.rewardRate,
                beforeData.rewardRate.div(ONE_WEEK).mul(10), // the effect of 10 second on the future scale
            )
        } else {
            expect(rewardUnits.div(ONE_WEEK), "rewardRate updated").eq(afterData.rewardRate)
        }

        // Sets platformRewardRate to rewardUnits / ONE_WEEK
        if (leftOverPlatformRewards.gt(0)) {
            const total = platformUnitsExpected.add(leftOverRewards)
            assertBNClose(
                total.div(ONE_WEEK),
                afterData.platformRewardRate,
                beforeData.platformRewardRate.div(ONE_WEEK).mul(10), // the effect of 10 second on the future scale
            )
        } else {
            expect(platformUnitsExpected.div(ONE_WEEK), "platformRewardRate updated").eq(afterData.platformRewardRate)
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
    /**
     * @dev Makes a withdrawal adn unwrap from the contract, and ensures that resulting state is correct
     * and the rewards have been unwrapped
     * @param withdrawAmount Exact amount to withdraw
     * @param sender User to execute the tx
     */
    const expectStakingWithdrawalAndUnwrap = async (config: ConfigRedeemAndUnwrap): Promise<void> => {
        // 1. Get data from the contract
        const sender = config.beneficiary || sa.default
        const beforeData = await snapshotStakingData(sender)
        const isExistingStaker = beforeData.userStakingBalance.gt(BN.from(0))
        const withdrawAmount = config.amount
        expect(isExistingStaker).eq(true)
        expect(withdrawAmount).to.be.gte(beforeData.userStakingBalance)

        // 2. Send withdrawal tx
        const tx = stakingRewards
            .connect(sender.signer)
            .withdrawAndUnwrap(
                config.amount,
                config.minAmountOut,
                config.output.address,
                config.beneficiary.address,
                config.router.address,
                config.isBassetOut,
            )
        await expect(tx).to.emit(stakingRewards, "Withdrawn").withArgs(sender.address, withdrawAmount)

        // 3. Expect Rewards to accrue to the beneficiary
        //    StakingToken balance of sender
        const afterData = await snapshotStakingData(sender)
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker)

        // 4. Expect token transfer
        //    StakingToken balance of sender is reduced, as the staked token is unwrapped to a bAsset or fAsset
        expect(beforeData.senderStakingTokenBalance).to.be.eq(afterData.senderStakingTokenBalance)
        //    Withdraws from the actual rewards wrapper token
        expect(beforeData.userStakingBalance.sub(withdrawAmount)).to.be.eq(afterData.userStakingBalance)
        //    Updates total supply
        expect(beforeData.totalSupply.sub(withdrawAmount)).eq(afterData.totalSupply)
    }
    context("initializing and staking in a new pool", () => {
        before(async () => {
            await redeployRewards()
        })
        describe("notifying the pool of reward", () => {
            it("should begin a new period through", async () => {
                const rewardUnits = simpleToExactAmount(1, 18)
                const airdropAmount = simpleToExactAmount(100, 18)
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdropAmount)
                await expectSuccessfulFunding(rewardUnits, airdropAmount)
            })
        })
        describe("staking in the new period", () => {
            it("should assign rewards to the staker", async () => {
                // Do the stake
                const rewardRate = await stakingRewards.rewardRate()
                const platformRewardRate = await stakingRewards.platformRewardRate()
                const stakeAmount = simpleToExactAmount(100, 18)
                await expectSuccessfulStake(stakeAmount)

                await increaseTime(ONE_DAY)

                // This is the total reward per staked token, since the last update
                const [rewardPerToken, platformRewardPerToken] = await stakingRewards.rewardPerToken()
                expect(rewardPerToken).gt(0)
                expect(platformRewardPerToken).gt(0)
                const rewardPerSecond = rewardRate.mul(fullScale).div(stakeAmount)
                assertBNClose(rewardPerToken, ONE_DAY.mul(rewardPerSecond), rewardPerSecond.mul(10))
                const platformRewardPerSecond = platformRewardRate.mul(fullScale).div(stakeAmount)
                assertBNClose(platformRewardPerToken, ONE_DAY.mul(platformRewardPerSecond), platformRewardPerSecond.mul(10))
                // Calc estimated unclaimed reward for the user
                // earned == balance * (rewardPerToken-userExistingReward)
                const [earned, platformEarned] = await stakingRewards.earned(sa.default.address)
                expect(stakeAmount.mul(rewardPerToken).div(fullScale)).eq(earned)
                expect(stakeAmount.mul(platformRewardPerToken).div(fullScale)).eq(platformEarned)
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
            expect(beforeData.platformRewardRate).eq(0)
            expect(beforeData.platformRewardPerTokenStored).eq(0)
            expect(beforeData.beneficiaryRewardsEarned).eq(0)
            expect(beforeData.beneficiaryPlatformRewardsEarned).eq(0)
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
            expect(afterData.platformRewardRate).eq(0)
            expect(afterData.platformRewardPerTokenStored).eq(0)
            expect(afterData.beneficiaryPlatformRewardsEarned).eq(0)
            expect(afterData.totalSupply).eq(stakeAmount.mul(2))
            expect(afterData.lastTimeRewardApplicable).eq(0)
        })
    })
    context("adding first stake days after funding", () => {
        before(async () => {
            await redeployRewards()
        })
        it("should retrospectively assign rewards to the first staker", async () => {
            const airdropAmount = simpleToExactAmount(100, 18)
            await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdropAmount)
            await expectSuccessfulFunding(simpleToExactAmount(100, 18), airdropAmount)

            // Do the stake
            const rewardRate = await stakingRewards.rewardRate()
            const platformRewardRate = await stakingRewards.platformRewardRate()

            await increaseTime(FIVE_DAYS)

            const stakeAmount = simpleToExactAmount(100, 18)
            await expectSuccessfulStake(stakeAmount)

            // This is the total reward per staked token, since the last update
            const [rewardPerToken, platformRewardPerToken] = await stakingRewards.rewardPerToken()

            const rewardPerSecond = rewardRate.mul(fullScale).div(stakeAmount)
            assertBNClose(rewardPerToken, FIVE_DAYS.mul(rewardPerSecond), rewardPerSecond.mul(4))

            const platformRewardPerSecond = platformRewardRate.mul(fullScale).div(stakeAmount)
            assertBNClose(platformRewardPerToken, FIVE_DAYS.mul(platformRewardPerSecond), platformRewardPerSecond.mul(4))

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const [earnedAfterConsequentStake, platformEarnedAfterConsequentStake] = await stakingRewards.earned(sa.default.address)
            expect(stakeAmount.mul(rewardPerToken).div(fullScale)).eq(earnedAfterConsequentStake)
            expect(stakeAmount.mul(platformRewardPerToken).div(fullScale)).eq(platformEarnedAfterConsequentStake)
        })
    })
    context("staking over multiple funded periods", () => {
        context("with a single staker", () => {
            before(async () => {
                await redeployRewards()
            })
            it("should assign all the rewards from the periods", async () => {
                const airdropAmount1 = simpleToExactAmount(100, 18)
                const fundAmount1 = simpleToExactAmount(100, 18)
                const fundAmount2 = simpleToExactAmount(200, 18)
                await expectSuccessfulFunding(fundAmount1)

                const stakeAmount = simpleToExactAmount(1, 18)
                await expectSuccessfulStake(stakeAmount)

                await increaseTime(ONE_WEEK.mul(2))

                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdropAmount1)
                await expectSuccessfulFunding(fundAmount2, airdropAmount1)

                await increaseTime(ONE_WEEK.mul(2))

                const [earned, platformEarned] = await stakingRewards.earned(sa.default.address)
                assertBNSlightlyGT(fundAmount1.add(fundAmount2), earned, BN.from(1000000), false)
                assertBNSlightlyGT(airdropAmount1, platformEarned, BN.from(1000000), false)
            })
        })
        context("with multiple stakers coming in and out", () => {
            beforeEach(async () => {
                await redeployRewards()
            })
            it("should accrue rewards on a pro rata basis", async () => {
                const airdropAmount = simpleToExactAmount(100, 21)
                const fundAmount1 = simpleToExactAmount(100, 21)
                const fundAmount2 = simpleToExactAmount(200, 21)
                const staker2 = sa.dummy1
                const staker3 = sa.dummy2
                const staker1Stake1 = simpleToExactAmount(100, 18)
                const staker1Stake2 = simpleToExactAmount(200, 18)
                const staker2Stake = simpleToExactAmount(100, 18)
                const staker3Stake = simpleToExactAmount(100, 18)

                await stakingToken.transfer(staker2.address, staker2Stake)
                await stakingToken.transfer(staker3.address, staker3Stake)

                /*
                 *  0               1               2   <-- Weeks
                 *   [ - - - - - - ] [ - - - - - - ]
                 * 100k            200k                 <-- Funding
                 *                 100k                 <-- Airdrop
                 * +100            +200                 <-- Staker 1
                 *        +100                          <-- Staker 2
                 * +100            -100                 <-- Staker 3
                 *
                 * Staker 1 gets 25k + 16.66k from week 1 n 150k = 191.66k
                 *          gets 75k
                 * Staker 2 gets 16.66k from week 1 n 50k from week 2 = 66.66k
                 *          gets 25k
                 * Staker 3 gets 25k + 16.66k from week 1 n 0 from week 2 = 41.66k
                 *          gets 0
                 */

                // WEEK 0-1 START
                await expectSuccessfulStake(staker1Stake1)
                await expectSuccessfulStake(staker3Stake, staker3, staker3)

                await expectSuccessfulFunding(fundAmount1)

                await increaseTime(ONE_WEEK.div(2).add(1))

                await expectSuccessfulStake(staker2Stake, staker2, staker2)

                await increaseTime(ONE_WEEK.div(2).add(1))

                // WEEK 1-2 START
                await stakingRewards.connect(staker3.signer).withdraw(staker3Stake)
                await expectSuccessfulStake(staker1Stake2, sa.default, sa.default, true)
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdropAmount)
                await expectSuccessfulFunding(fundAmount2, airdropAmount)

                await increaseTime(ONE_WEEK)

                // WEEK 2 FINISH
                const [earned1, platformEarned1] = await stakingRewards.earned(sa.default.address)
                assertBNClose(earned1, simpleToExactAmount("191.66", 21), simpleToExactAmount(1, 19))
                assertBNClose(platformEarned1, simpleToExactAmount(75, 21), simpleToExactAmount(1, 19))
                const [earned2, platformEarned2] = await stakingRewards.earned(staker2.address)
                assertBNClose(earned2, simpleToExactAmount("66.66", 21), simpleToExactAmount(1, 19))
                assertBNClose(platformEarned2, simpleToExactAmount(25, 21), simpleToExactAmount(1, 19))
                const [earned3, platformEarned3] = await stakingRewards.earned(staker3.address)
                assertBNClose(earned3, simpleToExactAmount("41.66", 21), simpleToExactAmount(1, 19))
                expect(platformEarned3).eq(0)
                // Ensure that sum of earned rewards does not exceed funcing amount
                expect(fundAmount1.add(fundAmount2)).gte(earned1.add(earned2).add(earned3))
                expect(airdropAmount).gte(platformEarned1.add(platformEarned2).add(platformEarned3))
            })
            it("should accrue rewards on a pro rata basis 2", async () => {
                const airdropAmount1 = simpleToExactAmount(50, 21)
                const airdropAmount2 = simpleToExactAmount(100, 21)
                const fundAmount1 = simpleToExactAmount(50, 21)
                const fundAmount2 = simpleToExactAmount(200, 21)
                const staker2 = sa.dummy1
                const staker3 = sa.dummy2
                const staker1Stake1 = simpleToExactAmount(100, 18)
                const staker1Stake2 = simpleToExactAmount(100, 18)
                const staker2Stake = simpleToExactAmount(100, 18)
                const staker3Stake = simpleToExactAmount(100, 18)

                await stakingToken.transfer(staker2.address, staker2Stake)
                await stakingToken.transfer(staker3.address, staker3Stake)

                /*
                 *  0               1               2   <-- Weeks
                 *   [ - - - - - - ] [ - - - - - - ]
                 *  50k            200k                 <-- Funding
                 *  50k            100k                 <-- Airdrop
                 * +100            +100                 <-- Staker 1
                 *        +100                          <-- Staker 2
                 *        +100            -100          <-- Staker 3
                 *
                 * Staker 1 gets 25k + 8.33 from week 1 n 50k + 66.66 = 150k
                 *          gets 25k + 8.33 from week 1 n 25k + 33.33 = 91.66k
                 * Staker 2 gets 8.33 from week 1 n 25k + 33.33 = 66.66k
                 *          gets 8.33 from week 1 n 12.5 + 16.67 = 37.5k
                 * Staker 3 gets 8.33 from week 1 n 25k = 33.33
                 *          gets 8.33 from week 1 n 12.5k = 20.83
                 */

                // WEEK 0-1 START
                await expectSuccessfulStake(staker1Stake1)

                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdropAmount1)
                await expectSuccessfulFunding(fundAmount1, airdropAmount1)

                await increaseTime(ONE_WEEK.div(2).add(1))

                await expectSuccessfulStake(staker2Stake, staker2, staker2)
                await expectSuccessfulStake(staker3Stake, staker3, staker3)

                await increaseTime(ONE_WEEK.div(2).add(1))

                // WEEK 1-2 START
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdropAmount2)
                await expectSuccessfulFunding(fundAmount2, airdropAmount2)

                await expectSuccessfulStake(staker1Stake2, sa.default, sa.default, true)

                await increaseTime(ONE_WEEK.div(2).add(1))

                await stakingRewards.connect(staker3.signer).withdraw(staker3Stake)

                await increaseTime(ONE_WEEK.div(2).add(1))

                // WEEK 2 FINISH
                const [earned1, platformEarned1] = await stakingRewards.earned(sa.default.address)
                assertBNClose(earned1, simpleToExactAmount(150, 21), simpleToExactAmount(1, 19))
                assertBNClose(platformEarned1, simpleToExactAmount("91.66", 21), simpleToExactAmount(1, 19))
                const [earned2, platformEarned2] = await stakingRewards.earned(staker2.address)
                assertBNClose(earned2, simpleToExactAmount("66.66", 21), simpleToExactAmount(1, 19))
                assertBNClose(platformEarned2, simpleToExactAmount("37.5", 21), simpleToExactAmount(1, 19))
                const [earned3, platformEarned3] = await stakingRewards.earned(staker3.address)
                assertBNClose(earned3, simpleToExactAmount("33.33", 21), simpleToExactAmount(1, 19))
                assertBNClose(platformEarned3, simpleToExactAmount("20.83", 21), simpleToExactAmount(1, 19))
                // Ensure that sum of earned rewards does not exceed funcing amount
                expect(fundAmount1.add(fundAmount2)).gte(earned1.add(earned2).add(earned3))
                expect(airdropAmount1.add(airdropAmount2)).gte(platformEarned1.add(platformEarned2).add(platformEarned3))
            })
        })
    })
    context("staking after period finish", () => {
        const airdropAmount1 = simpleToExactAmount(100, 21)
        const fundAmount1 = simpleToExactAmount(100, 21)

        before(async () => {
            await redeployRewards()
        })
        it("should stop accruing rewards after the period is over", async () => {
            await expectSuccessfulStake(simpleToExactAmount(1, 18))
            await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdropAmount1)
            await expectSuccessfulFunding(fundAmount1, airdropAmount1)

            await increaseTime(ONE_WEEK.add(1))

            const [earnedAfterWeek, platformEarnedAfterWeek] = await stakingRewards.earned(sa.default.address)

            await increaseTime(ONE_WEEK.add(1))
            const now = await getTimestamp()

            const [earnedAfterTwoWeeks, platformEarnedAfterTwoWeeks] = await stakingRewards.earned(sa.default.address)

            expect(earnedAfterWeek).eq(earnedAfterTwoWeeks)
            expect(platformEarnedAfterWeek).eq(platformEarnedAfterTwoWeeks)

            const lastTimeRewardApplicable = await stakingRewards.lastTimeRewardApplicable()
            assertBNClose(lastTimeRewardApplicable, now.sub(ONE_WEEK).sub(2), BN.from(2))
        })
    })
    context("staking on behalf of a beneficiary", () => {
        const fundAmount = simpleToExactAmount(100, 21)
        let beneficiary: Account
        const stakeAmount = simpleToExactAmount(100, 18)

        before(async () => {
            beneficiary = sa.dummy1
            await redeployRewards()
            await expectSuccessfulFunding(fundAmount)
            await expectSuccessfulStake(stakeAmount, sa.default, beneficiary)
            await increaseTime(10)
        })
        it("should update the beneficiaries reward details", async () => {
            const earned = await stakingRewards.earned(beneficiary.address)
            expect(earned[0]).gt(0)

            const balance = await stakingRewards.balanceOf(beneficiary.address)
            expect(balance).eq(stakeAmount)
        })
        it("should not update the senders details", async () => {
            const earned = await stakingRewards.earned(sa.default.address)
            expect(earned[0]).eq(0)

            const balance = await stakingRewards.balanceOf(sa.default.address)
            expect(balance).eq(0)
        })
    })
    context("using staking / reward tokens with diff decimals", () => {
        before(async () => {
            await redeployRewards(nexus.address, 12, 18, 16)
        })
        it("should not affect the pro rata payouts", async () => {
            // Add 100 reward tokens
            await expectSuccessfulFunding(simpleToExactAmount(100, 12))
            const rewardRate = await stakingRewards.rewardRate()

            // Do the stake
            const stakeAmount = simpleToExactAmount(100, 16)
            await expectSuccessfulStake(stakeAmount)

            await increaseTime(ONE_WEEK.add(1))

            // This is the total reward per staked token, since the last update
            const [rewardPerToken, platformRewardPerToken] = await stakingRewards.rewardPerToken()
            assertBNClose(
                rewardPerToken,
                ONE_WEEK.mul(rewardRate).mul(fullScale).div(stakeAmount),
                rewardRate.mul(fullScale).div(stakeAmount),
            )
            expect(platformRewardPerToken).eq(0)

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const [earnedAfterConsequentStake, platformEarned] = await stakingRewards.earned(sa.default.address)
            assertBNSlightlyGT(simpleToExactAmount(100, 12), earnedAfterConsequentStake, simpleToExactAmount(1, 9))
            expect(platformEarned).eq(0)
        })
    })

    context("getting the reward and platform token", () => {
        before(async () => {
            await redeployRewards()
        })
        it("should simply return the rewards Token", async () => {
            expect(await stakingRewards.getRewardToken(), "getRewardToken").eq(rewardToken.address)
            expect(await stakingRewards.rewardsToken(), "rewardsToken").eq(rewardToken.address)
        })
        it("should simply return the platform Token", async () => {
            expect(await stakingRewards.getPlatformToken(), "getPlatformToken").eq(platformToken.address)
            expect(await stakingRewards.platformToken(), "platformToken").eq(platformToken.address)
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
                    "admin cannot fallback to proxy target",
                )
            })
        })
        context("before current period finish", async () => {
            const airdrop1 = simpleToExactAmount(100, 18)
            const airdrop2 = simpleToExactAmount(200, 18)
            const funding1 = simpleToExactAmount(100, 18)
            const funding2 = simpleToExactAmount(200, 18)
            beforeEach(async () => {
                await redeployRewards()
            })
            it("should factor in unspent units to the new rewardRate", async () => {
                // Do the initial funding
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdrop1)

                await expectSuccessfulFunding(funding1, airdrop1)
                const actualRewardRate = await stakingRewards.rewardRate()
                const actualPlatformRewardRate = await stakingRewards.platformRewardRate()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).eq(actualRewardRate)
                expect(expectedRewardRate).eq(actualPlatformRewardRate)

                // Zoom forward half a week
                await increaseTime(ONE_WEEK.div(2))

                // Do the second funding, and factor in the unspent units
                const expectedLeftoverReward = funding1.div(2)
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdrop2)
                await expectSuccessfulFunding(funding2, airdrop2)
                const actualRewardRateAfter = await stakingRewards.rewardRate()
                const actualPlatformRewardRateAfter = await stakingRewards.platformRewardRate()
                const totalRewardsForWeek = funding2.add(expectedLeftoverReward)
                const expectedRewardRateAfter = totalRewardsForWeek.div(ONE_WEEK)

                assertBNClose(actualRewardRateAfter, expectedRewardRateAfter, actualRewardRate.div(1000))

                assertBNClose(actualPlatformRewardRateAfter, expectedRewardRateAfter, actualRewardRate.div(1000))
            })

            it("should factor in unspent units to the new rewardRate if instant", async () => {
                // Do the initial funding
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdrop1)
                await expectSuccessfulFunding(funding1, airdrop1)
                const actualRewardRate = await stakingRewards.rewardRate()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).eq(actualRewardRate)
                const actualPlatformRewardRate = await stakingRewards.platformRewardRate()
                const expectedPlatformRewardRate = airdrop1.div(ONE_WEEK)
                expect(expectedPlatformRewardRate).eq(actualPlatformRewardRate)

                // Zoom forward 1 second
                await increaseTime(1)

                // Do the second funding, and factor in the unspent units
                await expectSuccessfulFunding(funding2)
                const actualRewardRateAfter = await stakingRewards.rewardRate()
                const expectedRewardRateAfter = funding1.add(funding2).div(ONE_WEEK)
                assertBNClose(actualRewardRateAfter, expectedRewardRateAfter, actualRewardRate.div(1000))

                const actualPlatformRewardRateAfter = await stakingRewards.platformRewardRate()
                assertBNClose(actualPlatformRewardRateAfter, actualPlatformRewardRate, actualPlatformRewardRate.div(1000))
            })
        })

        context("after current period finish", () => {
            const airdrop1 = simpleToExactAmount(1, 18)
            const funding1 = simpleToExactAmount(100, 18)
            before(async () => {
                await redeployRewards()
            })
            it("should start a new period with the correct rewardRate", async () => {
                // Do the initial funding
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdrop1)
                await expectSuccessfulFunding(funding1, airdrop1)
                const actualRewardRate = await stakingRewards.rewardRate()
                const expectedRewardRate = funding1.div(ONE_WEEK)
                expect(expectedRewardRate).eq(actualRewardRate)

                // Zoom forward half a week
                await increaseTime(ONE_WEEK.add(1))

                // Do the second funding, and factor in the unspent units
                await expectSuccessfulFunding(funding1.mul(2))
                const actualRewardRateAfter = await stakingRewards.rewardRate()
                const expectedRewardRateAfter = expectedRewardRate.mul(2)
                expect(actualRewardRateAfter).eq(expectedRewardRateAfter)

                const actualPlatformRewardRateAfter = await stakingRewards.platformRewardRate()
                expect(actualPlatformRewardRateAfter).eq(0)
            })
        })
    })

    context("withdrawing stake or rewards", () => {
        context("withdrawing a stake amount", () => {
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, 18)

            before(async () => {
                await redeployRewards()
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
                await expectSuccessfulFunding(fundAmount, fundAmount)
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
                expect(earnedBefore[0]).gt(0)
                expect(earnedBefore[1]).gt(0)
                const rewardsBefore = await stakingRewards.rewards(sa.default.address)
                expect(rewardsBefore).eq(0)

                // Execute the withdrawal
                await expectStakingWithdrawal(stakeAmount)

                // Ensure that the new awards are added + assigned to user
                const earnedAfter = await stakingRewards.earned(sa.default.address)
                expect(earnedAfter[0]).gte(earnedBefore[0])
                expect(earnedAfter[1]).gte(earnedBefore[1])
                const rewardsAfter = await stakingRewards.rewards(sa.default.address)
                expect(rewardsAfter).eq(earnedAfter[0])

                // Zoom forward now
                await increaseTime(10)

                // Check that the user does not earn anything else
                const earnedEnd = await stakingRewards.earned(sa.default.address)
                expect(earnedEnd[0]).eq(earnedAfter[0])
                expect(earnedEnd[1]).eq(earnedAfter[1])
                const rewardsEnd = await stakingRewards.rewards(sa.default.address)
                expect(rewardsEnd).eq(rewardsAfter)

                // Cannot withdraw anything else
                await expect(stakingRewards.connect(sa.default.signer).withdraw(stakeAmount.add(1))).to.revertedWith(
                    "Not enough user rewards",
                )
            })
        })
        context("claiming rewards", async () => {
            const airdropAmount = simpleToExactAmount(100, 21)
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, 18)

            before(async () => {
                await redeployRewards()
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdropAmount)
                await rewardToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
                await expectSuccessfulFunding(fundAmount, airdropAmount)
                await expectSuccessfulStake(stakeAmount, sa.default, sa.dummy2)
                await increaseTime(ONE_WEEK.add(1))
            })
            it("should do nothing for a non-staker", async () => {
                const beforeData = await snapshotStakingData(sa.dummy1, sa.dummy1)
                await stakingRewards.connect(sa.dummy1.signer).claimReward()

                const afterData = await snapshotStakingData(sa.dummy1, sa.dummy1)
                expect(beforeData.beneficiaryRewardsEarned).eq(0)
                expect(afterData.beneficiaryRewardsEarned).eq(0)
                expect(afterData.beneficiaryPlatformRewardsEarned).eq(0)
                expect(afterData.senderStakingTokenBalance).eq(0)
                expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored)
                expect(afterData.userPlatformRewardPerTokenPaid).eq(afterData.platformRewardPerTokenStored)
            })
            it("should send all accrued rewards to the rewardee and withdraw platform token", async () => {
                const beforeData = await snapshotStakingData(sa.dummy2, sa.dummy2)
                const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.dummy2.address)
                expect(rewardeeBalanceBefore).eq(0)
                // Expect no platform rewards before
                const platformBalanceBefore = await platformToken.balanceOf(sa.dummy2.address)
                expect(platformBalanceBefore).eq(0)

                const tx = await stakingRewards.connect(sa.dummy2.signer).claimReward()
                const afterData = await snapshotStakingData(sa.dummy2, sa.dummy2)

                await assertRewardsAssigned(beforeData, afterData, false, true, true)

                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.dummy2.address)
                assertBNClose(rewardeeBalanceAfter, fundAmount, simpleToExactAmount(1, 16))
                // Expect the platform rewards to send out
                const platformBalanceAfter = await platformToken.balanceOf(sa.dummy2.address)
                assertBNClose(platformBalanceAfter, airdropAmount, simpleToExactAmount(1, 16))
                expect(afterData.platformTokenBalanceVendor).eq(beforeData.platformTokenBalanceVendor.sub(platformBalanceAfter))

                await expect(tx)
                    .to.emit(stakingRewards, "RewardPaid")
                    .withArgs(
                        sa.dummy2.address,
                        rewardeeBalanceAfter.sub(rewardeeBalanceBefore),
                        beforeData.platformTokenBalanceVendor.sub(afterData.platformTokenBalanceVendor),
                    )
                // 'rewards' reset to 0
                expect(afterData.beneficiaryRewardsEarned).eq(0)

                expect(afterData.beneficiaryPlatformRewardsEarned).eq(0)
                // Paid up until the last block
                expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored)

                expect(afterData.userPlatformRewardPerTokenPaid).eq(afterData.platformRewardPerTokenStored)
                // Token balances don't change
                expect(afterData.senderStakingTokenBalance).eq(beforeData.senderStakingTokenBalance)

                expect(beforeData.userStakingBalance).eq(afterData.userStakingBalance)
            })
        })
        context("claiming rewards only", async () => {
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, 18)

            before(async () => {
                await redeployRewards()
                await expectSuccessfulFunding(fundAmount)
                await rewardToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
                await expectSuccessfulStake(stakeAmount)
                await increaseTime(ONE_WEEK.add(1))
            })
            it("should do nothing for a non-staker", async () => {
                const beforeData = await snapshotStakingData(sa.dummy1, sa.dummy1)
                await stakingRewards.connect(sa.dummy1.signer).claimRewardOnly()

                const afterData = await snapshotStakingData(sa.dummy1, sa.dummy1)
                expect(beforeData.beneficiaryRewardsEarned).eq(0)
                expect(afterData.beneficiaryRewardsEarned).eq(0)
                expect(afterData.senderStakingTokenBalance).eq(0)
                expect(afterData.userRewardPerTokenPaid).eq(afterData.rewardPerTokenStored)
            })
            it("should send all accrued rewards to the rewardee", async () => {
                const beforeData = await snapshotStakingData()
                const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.default.address)

                const tx = await stakingRewards.claimRewardOnly()
                const afterData = await snapshotStakingData()
                await assertRewardsAssigned(beforeData, afterData, false, true)
                // Balance transferred to the rewardee
                const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.default.address)
                await expect(tx)
                    .to.emit(stakingRewards, "RewardPaid")
                    .withArgs(sa.default.address, rewardeeBalanceAfter.sub(rewardeeBalanceBefore), 0)
                assertBNClose(rewardeeBalanceAfter.sub(rewardeeBalanceBefore), fundAmount, simpleToExactAmount(1, 16))

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
    context("withdrawing and unwrapping", () => {
        context("withdrawing a stake amount", () => {
            let config: ConfigRedeemAndUnwrap
            const fundAmount = simpleToExactAmount(100, 21)
            const stakeAmount = simpleToExactAmount(100, 18)

            before(async () => {
                stakingRewards = await redeployRewards()
                await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
                await expectSuccessfulFunding(fundAmount, fundAmount)
                await expectSuccessfulStake(stakeAmount)
                await increaseTime(10)
                config = {
                    amount: stakeAmount,
                    minAmountOut: stakeAmount.mul(98).div(100),
                    isBassetOut: true,
                    beneficiary: sa.default,
                    output: stakingToken, // bAsset,
                    router: stakingToken, // mAsset,
                }
            })
            it("should revert for a non-staker", async () => {
                await expect(
                    stakingRewards
                        .connect(sa.dummy1.signer)
                        .withdrawAndUnwrap(1, ZERO, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, config.isBassetOut),
                ).to.be.revertedWith("VM Exception")
            })
            it("should revert if insufficient balance", async () => {
                await expect(
                    stakingRewards
                        .connect(sa.default.signer)
                        .withdrawAndUnwrap(stakeAmount.add(1), ZERO, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, config.isBassetOut),
                ).to.be.revertedWith("VM Exception")
            })
            it("should fail if trying to withdraw 0", async () => {
                await expect(
                    stakingRewards
                        .connect(sa.default.signer)
                        .withdrawAndUnwrap(ZERO, ZERO, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, config.isBassetOut),
                ).to.be.revertedWith("Cannot withdraw 0")
            })
            it("should withdraw the stake and update the existing reward accrual", async () => {
                // Check that the user has earned something
                const earnedBefore = await stakingRewards.earned(sa.default.address)
                expect(earnedBefore[0]).gt(0)
                expect(earnedBefore[1]).gt(0)
                const rewardsBefore = await stakingRewards.rewards(sa.default.address)
                expect(rewardsBefore).eq(0)

                const dataBefore = await snapshotStakingData()
                expect(dataBefore.userRewardPerTokenPaid).to.be.eq(BN.from(0))
                expect(dataBefore.userPlatformRewardPerTokenPaid).to.be.eq(BN.from(0))

                // Execute the withdrawal
                await expectStakingWithdrawalAndUnwrap(config)
                // AssertionError: Expected "21494708994708994" to be equal 2149470899470899400

                // Ensure that the new awards are added + assigned to user
                const earnedAfter = await stakingRewards.earned(sa.default.address)
                expect(earnedAfter[0]).gte(earnedBefore[0])
                expect(earnedAfter[1]).gte(earnedBefore[1])
                const rewardsAfter = await stakingRewards.rewards(sa.default.address)
                expect(rewardsAfter).eq(earnedAfter[0])

                const dataAfter = await snapshotStakingData()
                expect(dataAfter.beneficiaryRewardsEarned).to.be.eq(earnedAfter[0])
                expect(dataAfter.beneficiaryPlatformRewardsEarned).to.be.eq(earnedAfter[0])

                expect(dataAfter.totalSupply).to.be.eq(dataBefore.totalSupply.sub(config.amount))
                expect(dataAfter.userStakingBalance).to.be.eq(dataBefore.userStakingBalance.sub(config.amount))
                // As the token is not wrapped, the contractStakingTokenBalance should be the same
                expect(dataAfter.senderStakingTokenBalance, "Sender token balance unchanged").to.be.eq(dataBefore.senderStakingTokenBalance)
                expect(dataAfter.contractStakingTokenBalance).to.be.eq(dataBefore.contractStakingTokenBalance.sub(config.amount))
                expect(dataAfter.totalSupply).to.be.eq(dataBefore.totalSupply.sub(config.amount))

                // Zoom forward now
                await increaseTime(10)

                // Check that the user does not earn anything else
                const earnedEnd = await stakingRewards.earned(sa.default.address)
                expect(earnedEnd[0]).eq(earnedAfter[0])
                expect(earnedEnd[1]).eq(earnedAfter[1])
                const rewardsEnd = await stakingRewards.rewards(sa.default.address)
                expect(rewardsEnd).eq(rewardsAfter)

                const dataEnd = await snapshotStakingData()
                expect(dataEnd.beneficiaryRewardsEarned).to.be.eq(dataAfter.beneficiaryRewardsEarned)
                expect(dataEnd.beneficiaryPlatformRewardsEarned).to.be.eq(dataAfter.beneficiaryPlatformRewardsEarned)

                // Cannot withdraw anything else
                await expect(stakingRewards.connect(sa.default.signer).withdraw(stakeAmount.add(1))).to.revertedWith(
                    "Not enough user rewards",
                )
            })
        })
    })
    context("testing platformTokenVendor", () => {
        before(async () => {
            await redeployRewards()
        })
        it("should re-approve spending of the platformToken", async () => {
            const beforeData = await snapshotStakingData()
            const maxApproval = await platformToken.allowance(beforeData.platformTokenVendor, stakingRewards.address)
            expect(maxApproval).eq(MAX_UINT256)

            const fundAmount = simpleToExactAmount(1, 18)
            await rewardToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
            await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
            await expectSuccessfulFunding(fundAmount, fundAmount)
            await expectSuccessfulStake(fundAmount)
            await increaseTime(ONE_WEEK.add(1))
            await stakingRewards.exit()

            const approvalAfter = await platformToken.allowance(beforeData.platformTokenVendor, stakingRewards.address)
            expect(approvalAfter).lt(MAX_UINT256)

            const vendor = await PlatformTokenVendor__factory.connect(beforeData.platformTokenVendor, sa.default.signer)
            await vendor.reApproveOwner()

            const approvalEnd = await platformToken.allowance(beforeData.platformTokenVendor, stakingRewards.address)
            expect(approvalEnd).eq(MAX_UINT256)
        })
    })
    context("running a full integration test", () => {
        const airdropAmount = simpleToExactAmount(200, 21)
        const fundAmount = simpleToExactAmount(100, 21)
        const stakeAmount = simpleToExactAmount(100, 18)

        before(async () => {
            await redeployRewards()
        })
        it("1. should allow the rewardsDistributor to fund the pool", async () => {
            await platformToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, airdropAmount)
            await rewardToken.connect(rewardsDistributor.signer).transfer(stakingRewards.address, fundAmount)
            await expectSuccessfulFunding(fundAmount, airdropAmount)
        })
        it("2. should allow stakers to stake and earn rewards", async () => {
            await expectSuccessfulStake(stakeAmount)
            await increaseTime(ONE_WEEK.add(1))
        })
        it("3. should deposit earnings to the beneficiary", async () => {
            const beforeData = await snapshotStakingData()

            const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.default.address)

            await stakingRewards.exit()

            const afterData = await snapshotStakingData()
            // Balance transferred to the beneficiary
            const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.default.address)
            assertBNClose(rewardeeBalanceAfter.sub(rewardeeBalanceBefore), fundAmount, simpleToExactAmount(1, 16))

            const platformBalanceAfter = await platformToken.balanceOf(sa.default.address)
            assertBNClose(platformBalanceAfter, airdropAmount, simpleToExactAmount(1, 16))

            await assertRewardsAssigned(beforeData, afterData, false, true, true)
        })
    })
})
