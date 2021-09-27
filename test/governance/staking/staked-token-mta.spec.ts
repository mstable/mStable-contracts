/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import { ethers } from "hardhat"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { MockNexus__factory } from "types/generated/factories/MockNexus__factory"
import {
    AssetProxy__factory,
    MockERC20,
    MockERC20__factory,
    MockNexus,
    PlatformTokenVendorFactory__factory,
    QuestManager__factory,
    SignatureVerifier__factory,
    StakedTokenMTA,
    StakedTokenMTA__factory,
    UserStakingData,
} from "types"
import { DEAD_ADDRESS } from "index"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { getTimestamp, increaseTime } from "@utils/time"
import { assertBNClose, assertBNClosePercent } from "@utils/assertions"
import { formatBytes32String } from "ethers/lib/utils"

export interface SnapData {
    periodFinish: number
    lastUpdateTime: number
    rewardRate: BN
    rewardPerTokenStored: BN
    rewardPerTokenPaid: BN
    rewards: BN
    earned: BN
}

describe("Staked Token MTA rewards", () => {
    let sa: StandardAccounts
    // let deployTime: BN
    let nexus: MockNexus
    let rewardToken: MockERC20
    let stakedToken: StakedTokenMTA
    let rewardsVendorAddress: string
    // const startingMintAmount = simpleToExactAmount(10000000)

    console.log(`Staked Token MTA contract size ${StakedTokenMTA__factory.bytecode.length / 2} bytes`)

    const redeployStakedToken = async (): Promise<void> => {
        // deployTime = await getTimestamp()
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        await nexus.setRecollateraliser(sa.mockRecollateraliser.address)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy(
            "Reward",
            "RWD",
            18,
            sa.mockRewardsDistributor.address,
            10000000,
        )
        const transferPromises = [sa.dummy1.address, sa.dummy2.address, sa.dummy3.address, sa.dummy4.address].map((recipient) =>
            rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(recipient, simpleToExactAmount(100000)),
        )
        await Promise.all(transferPromises)

        const signatureVerifier = await new SignatureVerifier__factory(sa.default.signer).deploy()
        const questManagerLibraryAddresses = {
            "contracts/governance/staking/deps/SignatureVerifier.sol:SignatureVerifier": signatureVerifier.address,
        }
        const questManagerImpl = await new QuestManager__factory(questManagerLibraryAddresses, sa.default.signer).deploy(nexus.address)
        let data = questManagerImpl.interface.encodeFunctionData("initialize", [sa.questMaster.address, sa.questSigner.address])
        const questManagerProxy = await new AssetProxy__factory(sa.default.signer).deploy(questManagerImpl.address, DEAD_ADDRESS, data)

        const platformTokenVendorFactory = await new PlatformTokenVendorFactory__factory(sa.default.signer).deploy()
        const stakedTokenLibraryAddresses = {
            "contracts/rewards/staking/PlatformTokenVendorFactory.sol:PlatformTokenVendorFactory": platformTokenVendorFactory.address,
        }
        const stakedTokenFactory = new StakedTokenMTA__factory(stakedTokenLibraryAddresses, sa.default.signer)
        const stakedTokenImpl = await stakedTokenFactory.deploy(
            nexus.address,
            rewardToken.address,
            questManagerProxy.address,
            rewardToken.address,
            ONE_WEEK,
            ONE_DAY.mul(2),
        )
        data = stakedTokenImpl.interface.encodeFunctionData("initialize", [
            formatBytes32String("Staked Rewards"),
            formatBytes32String("stkRWD"),
            sa.mockRewardsDistributor.address,
        ])
        const stakedTokenProxy = await new AssetProxy__factory(sa.default.signer).deploy(stakedTokenImpl.address, DEAD_ADDRESS, data)
        stakedToken = stakedTokenFactory.attach(stakedTokenProxy.address)

        // Each test user approve reward transfers by the staked token before staking
        const approvePromises = [sa.dummy1.signer, sa.dummy2.signer, sa.dummy3.signer, sa.dummy4.signer].map((signer) =>
            rewardToken.connect(signer).approve(stakedToken.address, simpleToExactAmount(10000)),
        )
        await Promise.all(approvePromises)

        rewardsVendorAddress = await stakedToken.rewardTokenVendor()
    }

    const snapRewardsData = async (user: string): Promise<SnapData> => {
        const globalData = await stakedToken.globalData()
        const userData = await stakedToken.userData(user)
        const earned = await stakedToken.earned(user)
        return {
            ...globalData,
            ...userData,
            earned,
        }
    }

    const snapshotUserStakingData = async (user = sa.default.address): Promise<UserStakingData> => {
        const scaledBalance = await stakedToken.balanceOf(user)
        const votes = await stakedToken.getVotes(user)
        const earnedRewards = await stakedToken.earned(user)
        const numCheckpoints = await stakedToken.numCheckpoints(user)
        const rewardTokenBalance = await rewardToken.balanceOf(user)
        const rawBalance = await stakedToken.balanceData(user)
        const userPriceCoeff = await stakedToken.userPriceCoeff(user)

        return {
            scaledBalance,
            votes,
            earnedRewards,
            numCheckpoints,
            rewardTokenBalance,
            rawBalance,
            userPriceCoeff,
            questBalance: null,
        }
    }

    before("Create test accounts", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
    })

    // '''..................................................................'''
    // '''........................      DATA      ..........................'''
    // '''..................................................................'''

    context("deploy and initialize", () => {
        before(async () => {
            await redeployStakedToken()
        })
        it("post initialize", async () => {
            expect(await stakedToken.rewardsDistributor(), "rewards distributor").to.eq(sa.mockRewardsDistributor.address)
            expect(await stakedToken.name(), "name").to.eq("Staked Rewards")
            expect(await stakedToken.symbol(), "symbol").to.eq("stkRWD")
            expect(await stakedToken.decimals(), "decimals").to.eq(18)
            expect(await stakedToken.nexus(), "nexus").to.eq(nexus.address)
            expect(await stakedToken.STAKED_TOKEN(), "staked token").to.eq(rewardToken.address)
            expect(await stakedToken.REWARDS_TOKEN(), "reward token").to.eq(rewardToken.address)
            expect(await stakedToken.DURATION(), "duration").to.eq(ONE_WEEK)
            const globalData = await stakedToken.globalData()
            expect(globalData.periodFinish, "periodFinish").to.eq(0)
            expect(globalData.lastUpdateTime, "lastUpdateTime").to.eq(0)
            expect(globalData.rewardRate, "rewardRate").to.eq(0)
            expect(globalData.rewardPerTokenStored, "rewardPerTokenStored").to.eq(0)
        })
    })

    // '''..................................................................'''
    // '''..................      COMPOUNDING RWDS      ....................'''
    // '''..................................................................'''

    context("compound rewards", () => {
        before(async () => {
            await redeployStakedToken()
            await rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(stakedToken.address, simpleToExactAmount(20000))
            await stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(simpleToExactAmount(20000))

            await stakedToken.connect(sa.dummy1.signer)["stake(uint256)"](simpleToExactAmount(100))
        })
        it("should compound a users rewards", async () => {
            await increaseTime(ONE_WEEK)
            const data = await snapshotUserStakingData(sa.dummy1.address)
            assertBNClosePercent(data.earnedRewards, simpleToExactAmount(20000), "0.0001")

            await stakedToken.connect(sa.dummy1.signer).compoundRewards()
            const dataAfter = await snapshotUserStakingData(sa.dummy1.address)
            expect(dataAfter.rawBalance.raw).eq(simpleToExactAmount(100).add(data.earnedRewards))

            expect(await stakedToken.totalSupply()).eq(await rewardToken.balanceOf(stakedToken.address))
        })
    })

    // '''..................................................................'''
    // '''................      REWARD DISTRIBUTION      ...................'''
    // '''..................................................................'''

    context("collecting fees in $MTA", () => {
        const stakingAmount = simpleToExactAmount(10000)
        const redemptionFee = stakingAmount.sub(stakingAmount.mul(1000).div(1075))
        before(async () => {
            await redeployStakedToken()
            await stakedToken.connect(sa.dummy1.signer)["stake(uint256)"](stakingAmount)
            await stakedToken.connect(sa.dummy1.signer).startCooldown(stakingAmount)
            await increaseTime(ONE_WEEK)
        })
        it("should collect and store the fees", async () => {
            await stakedToken.connect(sa.dummy1.signer).withdraw(stakingAmount, sa.dummy1.address, true, false)
            expect(await stakedToken.pendingAdditionalReward()).eq(redemptionFee)
            expect(await rewardToken.balanceOf(stakedToken.address)).eq(redemptionFee)
            expect(await stakedToken.totalSupply()).eq(0)
        })
        it("should deposit to the vendor during notification", async () => {
            // Notify
            await rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(stakedToken.address, 1)
            await stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(1)

            // Check all gone to platformVendor
            expect(await rewardToken.balanceOf(await stakedToken.rewardTokenVendor())).eq(redemptionFee)

            // Check 1 remaining
            expect(await stakedToken.pendingAdditionalReward()).eq(1)
            expect(await rewardToken.balanceOf(stakedToken.address)).eq(1)
        })
    })

    context("distribute rewards", () => {
        const distAmount = simpleToExactAmount(10000)
        context("should fail when", () => {
            before(async () => {
                await redeployStakedToken()
            })
            it("not rewards distributor", async () => {
                await expect(stakedToken.connect(sa.default.signer).notifyRewardAmount(distAmount)).to.revertedWith(
                    "Caller is not reward distributor",
                )
                await expect(stakedToken.connect(sa.dummy1.signer).notifyRewardAmount(distAmount)).to.revertedWith(
                    "Caller is not reward distributor",
                )
            })
            it("> 1m rewards", async () => {
                await expect(
                    stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(simpleToExactAmount(1000000)),
                ).to.revertedWith("Notify more than a million units")
            })
        })
        context("should", () => {
            beforeEach(async () => {
                await redeployStakedToken()
            })
            it("distribute first rewards before anything is staked", async () => {
                await rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(stakedToken.address, distAmount)
                const tx = await stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(distAmount)

                const distTimestamp = await getTimestamp()
                await expect(tx).to.emit(stakedToken, "RewardAdded").withArgs(distAmount)
                await expect(tx).to.emit(rewardToken, "Transfer").withArgs(stakedToken.address, rewardsVendorAddress, distAmount)

                const dataAfter = await snapRewardsData(ZERO_ADDRESS)
                expect(dataAfter.periodFinish, "periodFinish after").to.eq(distTimestamp.add(ONE_WEEK))
                expect(dataAfter.lastUpdateTime, "lastUpdateTime after").to.eq(distTimestamp)
                expect(dataAfter.rewardRate, "rewardRate after").to.eq(distAmount.div(ONE_WEEK))
                expect(dataAfter.rewardPerTokenStored, "rewardPerTokenStored after").to.eq(0)
                expect(dataAfter.rewardPerTokenPaid, "rewardPerTokenPaid after").to.eq(0)
                expect(dataAfter.rewards, "rewards after").to.eq(0)

                await increaseTime(ONE_DAY)
                const dataAfter1Day = await snapRewardsData(ZERO_ADDRESS)
                expect(dataAfter1Day.rewardPerTokenPaid, "rewardPerTokenPaid after 1 day").to.eq(0)
                expect(dataAfter1Day.rewards, "rewards after 1 day").to.eq(0)
            })
            it("distribute first rewards after two users staked", async () => {
                const user1StakeAmount = simpleToExactAmount(1000)
                const user2StakeAmount = simpleToExactAmount(2000)
                await stakedToken.connect(sa.dummy1.signer)["stake(uint256)"](user1StakeAmount)
                await stakedToken.connect(sa.dummy2.signer)["stake(uint256)"](user2StakeAmount)
                await increaseTime(ONE_DAY)
                await rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(stakedToken.address, distAmount)
                const tx = await stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(distAmount)

                const distTimestamp = await getTimestamp()
                await expect(tx).to.emit(stakedToken, "RewardAdded").withArgs(distAmount)
                await expect(tx).to.emit(rewardToken, "Transfer").withArgs(stakedToken.address, rewardsVendorAddress, distAmount)

                const dataAfter = await snapRewardsData(ZERO_ADDRESS)
                expect(dataAfter.periodFinish, "periodFinish after").to.eq(distTimestamp.add(ONE_WEEK))
                expect(dataAfter.lastUpdateTime, "lastUpdateTime after").to.eq(distTimestamp)
                expect(dataAfter.rewardRate, "rewardRate after").to.eq(distAmount.div(ONE_WEEK))
                expect(dataAfter.rewardPerTokenStored, "rewardPerTokenStored after").to.eq(0)
                expect(dataAfter.rewardPerTokenPaid, "rewardPerTokenPaid after").to.eq(0)
                expect(dataAfter.rewards, "rewards after").to.eq(0)

                const user1DataAfter = await snapRewardsData(sa.dummy1.address)
                expect(user1DataAfter.periodFinish, "periodFinish user 1 after").to.eq(distTimestamp.add(ONE_WEEK))
                expect(user1DataAfter.lastUpdateTime, "lastUpdateTime user 1 after").to.eq(distTimestamp)
                expect(user1DataAfter.rewardRate, "rewardRate user 1 after").to.eq(distAmount.div(ONE_WEEK))
                expect(user1DataAfter.rewardPerTokenStored, "rewardPerTokenStored user 1 after").to.eq(0)
                expect(user1DataAfter.rewardPerTokenPaid, "rewardPerTokenPaid user 1 after").to.eq(0)
                expect(user1DataAfter.rewards, "rewards user 1 after").to.eq(0)
                expect(user1DataAfter.earned, "earned user 1 after").to.eq(0)
            })
            it("distribute second rewards after 6 days", async () => {
                const user1StakeAmount = simpleToExactAmount(1000)
                const user2StakeAmount = simpleToExactAmount(2000)
                await stakedToken.connect(sa.dummy1.signer)["stake(uint256)"](user1StakeAmount)
                await stakedToken.connect(sa.dummy2.signer)["stake(uint256)"](user2StakeAmount)
                // distribute first rewards
                await increaseTime(ONE_DAY)
                await rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(stakedToken.address, distAmount)
                await stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(distAmount)
                const firstDistTimestamp = await getTimestamp()
                // distribute 2nd rewards
                await increaseTime(ONE_DAY.mul(6))
                const secondDistAmount = simpleToExactAmount(15000)
                await rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(stakedToken.address, secondDistAmount)
                const tx = await stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(secondDistAmount)

                const secondDistTimestamp = await getTimestamp()
                await expect(tx).to.emit(stakedToken, "RewardAdded").withArgs(secondDistAmount)
                await expect(tx).to.emit(rewardToken, "Transfer").withArgs(stakedToken.address, rewardsVendorAddress, secondDistAmount)

                const dataAfter = await snapRewardsData(ZERO_ADDRESS)
                expect(dataAfter.periodFinish, "periodFinish after").to.eq(secondDistTimestamp.add(ONE_WEEK))
                expect(dataAfter.lastUpdateTime, "lastUpdateTime after").to.eq(secondDistTimestamp)
                const secondsLeft = firstDistTimestamp.add(ONE_WEEK).sub(secondDistTimestamp)
                const rewardRate = distAmount.div(ONE_WEEK)
                const leftover = secondsLeft.mul(rewardRate)
                const newStreamAmount = leftover.add(secondDistAmount)
                expect(dataAfter.rewardRate, "rewardRate after").to.eq(newStreamAmount.div(ONE_WEEK))
                // expect(dataAfter.rewardPerTokenStored, "rewardPerTokenStored after").to.eq(distAmount.div(ONE_WEEK))
                expect(dataAfter.rewardPerTokenPaid, "rewardPerTokenPaid after").to.eq(0)
                expect(dataAfter.rewards, "rewards after").to.eq(0)

                const user1DataAfter = await snapRewardsData(sa.dummy1.address)
                expect(user1DataAfter.periodFinish, "periodFinish user 1 after").to.eq(secondDistTimestamp.add(ONE_WEEK))
                expect(user1DataAfter.lastUpdateTime, "lastUpdateTime user 1 after").to.eq(secondDistTimestamp)
                expect(user1DataAfter.rewardRate, "rewardRate user 1 after").to.eq(newStreamAmount.div(ONE_WEEK))
                // expect(user1DataAfter.rewardPerTokenStored, "rewardPerTokenStored user 1 after").to.eq(0)
                expect(user1DataAfter.rewardPerTokenPaid, "rewardPerTokenPaid user 1 after").to.eq(0)
                expect(user1DataAfter.rewards, "rewards user 1 after").to.eq(0)
                const secondsPassed = secondDistTimestamp.sub(firstDistTimestamp)
                // user 1 earned 10000 * 1000 / (1000 + 2000) * 6 / 7 = 10000 * 6 / 21 = 2,857.1428571429
                const user1EarnedExpected = distAmount.mul(secondsPassed).div(ONE_WEEK).div(3)
                assertBNClose(user1DataAfter.earned, user1EarnedExpected, 1000000)
            })
            it("distribute second rewards after 8 days", async () => {
                const user1StakeAmount = simpleToExactAmount(1000)
                const user2StakeAmount = simpleToExactAmount(2000)
                await stakedToken.connect(sa.dummy1.signer)["stake(uint256)"](user1StakeAmount)
                await stakedToken.connect(sa.dummy2.signer)["stake(uint256)"](user2StakeAmount)
                // distribute first rewards
                await increaseTime(ONE_DAY)
                await rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(stakedToken.address, distAmount)
                await stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(distAmount)
                // distribute 2nd rewards
                await increaseTime(ONE_DAY.mul(8))
                const secondDistAmount = simpleToExactAmount(15000)
                await rewardToken.connect(sa.mockRewardsDistributor.signer).transfer(stakedToken.address, secondDistAmount)
                const tx = await stakedToken.connect(sa.mockRewardsDistributor.signer).notifyRewardAmount(secondDistAmount)

                const secondDistTimestamp = await getTimestamp()
                await expect(tx).to.emit(stakedToken, "RewardAdded").withArgs(secondDistAmount)
                await expect(tx).to.emit(rewardToken, "Transfer").withArgs(stakedToken.address, rewardsVendorAddress, secondDistAmount)

                const dataAfter = await snapRewardsData(ZERO_ADDRESS)
                expect(dataAfter.periodFinish, "periodFinish after").to.eq(secondDistTimestamp.add(ONE_WEEK))
                expect(dataAfter.lastUpdateTime, "lastUpdateTime after").to.eq(secondDistTimestamp)
                expect(dataAfter.rewardRate, "rewardRate after").to.eq(secondDistAmount.div(ONE_WEEK))
                // expect(dataAfter.rewardPerTokenStored, "rewardPerTokenStored after").to.eq(distAmount.div(ONE_WEEK))
                expect(dataAfter.rewardPerTokenPaid, "rewardPerTokenPaid after").to.eq(0)
                expect(dataAfter.rewards, "rewards after").to.eq(0)

                const user1DataAfter = await snapRewardsData(sa.dummy1.address)
                expect(user1DataAfter.periodFinish, "periodFinish user 1 after").to.eq(secondDistTimestamp.add(ONE_WEEK))
                expect(user1DataAfter.lastUpdateTime, "lastUpdateTime user 1 after").to.eq(secondDistTimestamp)
                expect(user1DataAfter.rewardRate, "rewardRate user 1 after").to.eq(secondDistAmount.div(ONE_WEEK))
                // expect(user1DataAfter.rewardPerTokenStored, "rewardPerTokenStored user 1 after").to.eq(0)
                expect(user1DataAfter.rewardPerTokenPaid, "rewardPerTokenPaid user 1 after").to.eq(0)
                expect(user1DataAfter.rewards, "rewards user 1 after").to.eq(0)
                // const secondsPassed = secondDistTimestamp.sub(firstDistTimestamp)
                // user 1 earned 10000 * 1000 / (1000 + 2000) * 6 / 7 = 10000 * 6 / 21 = 2,857.1428571429
                const user1EarnedExpected = distAmount.div(3)
                assertBNClose(user1DataAfter.earned, user1EarnedExpected, 1000000)
            })
        })
    })

    context("earning rewards", () => {
        it("should earn rewards on all user actions")
        it("should claim rewards (from the token vendor)")
        it("should calculate earned")
        it("should use boostedBalance and totalSupply to earn rewards")
    })
})
