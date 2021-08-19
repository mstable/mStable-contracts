/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import { ethers } from "hardhat"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { MockNexus__factory } from "types/generated/factories/MockNexus__factory"
import {
    AssetProxy__factory,
    GamifiedManager__factory,
    MockERC20,
    MockERC20__factory,
    MockNexus,
    PlatformTokenVendorFactory__factory,
    SignatureVerifier__factory,
    StakedToken,
    StakedTokenWrapper__factory,
    StakedToken__factory,
} from "types"
import { assertBNClose, DEAD_ADDRESS } from "index"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { getTimestamp, increaseTime } from "@utils/time"
import { arrayify, solidityKeccak256 } from "ethers/lib/utils"
import { BigNumberish, Signer } from "ethers"
import { QuestStatus, QuestType, UserStakingData } from "types/stakedToken"

const signUserQuest = async (user: string, questId: BigNumberish, questSigner: Signer): Promise<string> => {
    const messageHash = solidityKeccak256(["address", "uint256"], [user, questId])
    const signature = await questSigner.signMessage(arrayify(messageHash))
    return signature
}

describe("Staked Token", () => {
    let sa: StandardAccounts
    let deployTime: BN

    let nexus: MockNexus
    let rewardToken: MockERC20
    let stakedToken: StakedToken

    const startingMintAmount = simpleToExactAmount(10000000)
    const cooldown100Percentage = simpleToExactAmount(1)

    console.log(`Staked contract size ${StakedToken__factory.bytecode.length / 2} bytes`)

    const redeployStakedToken = async (): Promise<StakedToken> => {
        deployTime = await getTimestamp()
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, 10000000)

        const signatureVerifier = await new SignatureVerifier__factory(sa.default.signer).deploy()
        const gamifiedManager = await new GamifiedManager__factory(sa.default.signer).deploy()
        const platformTokenVendorFactory = await new PlatformTokenVendorFactory__factory(sa.default.signer).deploy()
        const stakedTokenLibraryAddresses = {
            "contracts/governance/staking/GamifiedManager.sol:GamifiedManager": gamifiedManager.address,
            "contracts/rewards/staking/PlatformTokenVendorFactory.sol:PlatformTokenVendorFactory": platformTokenVendorFactory.address,
            "contracts/governance/staking/deps/SignatureVerifier.sol:SignatureVerifier": signatureVerifier.address,
        }
        const stakedTokenFactory = new StakedToken__factory(stakedTokenLibraryAddresses, sa.default.signer)
        const stakedTokenImpl = await stakedTokenFactory.deploy(
            nexus.address,
            rewardToken.address,
            rewardToken.address,
            ONE_WEEK,
            ONE_DAY.mul(2),
        )
        const rewardsDistributorAddress = DEAD_ADDRESS
        const data = stakedTokenImpl.interface.encodeFunctionData("initialize", [
            "Staked Rewards",
            "stkRWD",
            rewardsDistributorAddress,
            sa.questSigner.address,
        ])
        const stakedTokenProxy = await new AssetProxy__factory(sa.default.signer).deploy(stakedTokenImpl.address, DEAD_ADDRESS, data)

        return stakedTokenFactory.attach(stakedTokenProxy.address)
    }

    const snapshotUserStakingData = async (user = sa.default.address): Promise<UserStakingData> => {
        const stakedBalance = await stakedToken.balanceOf(user)
        const votes = await stakedToken.getVotes(user)
        const earnedRewards = await stakedToken.earned(user)
        const [cooldownTimestamp, cooldownPercentage] = await stakedToken.stakersCooldowns(user)
        const rewardsBalance = await rewardToken.balanceOf(user)
        const userBalances = await stakedToken.balanceData(user)

        return {
            stakedBalance,
            votes,
            earnedRewards,
            cooldownTimestamp,
            cooldownPercentage,
            rewardsBalance,
            userBalances,
        }
    }

    before("Create Contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
    })

    context("deploy and initialize", () => {
        before(async () => {
            stakedToken = await redeployStakedToken()
        })
        it("post initialize", async () => {
            expect(await stakedToken.name(), "name").to.eq("Staked Rewards")
            expect(await stakedToken.symbol(), "symbol").to.eq("stkRWD")
            expect(await stakedToken.decimals(), "decimals").to.eq(18)
            expect(await stakedToken.rewardsDistributor(), "rewards distributor").to.eq(DEAD_ADDRESS)
            expect(await stakedToken.nexus(), "nexus").to.eq(nexus.address)
            expect(await stakedToken.STAKED_TOKEN(), "staked token").to.eq(rewardToken.address)
            expect(await stakedToken.COOLDOWN_SECONDS(), "cooldown").to.eq(ONE_WEEK)
            expect(await stakedToken.UNSTAKE_WINDOW(), "unstake window").to.eq(ONE_DAY.mul(2))
            expect(await stakedToken.COOLDOWN_PERCENTAGE_SCALE(), "unstake window").to.eq(cooldown100Percentage)

            // eslint-disable-next-line no-underscore-dangle
            expect(await stakedToken.questMaster(), "quest master").to.eq(sa.questSigner.address)
        })
    })
    context("staking and delegating", () => {
        const stakedAmount = simpleToExactAmount(1000)
        beforeEach(async () => {
            stakedToken = await redeployStakedToken()
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount.mul(3))

            const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataBefore.userBalances.weightedTimestamp, "weighted timestamp before").to.eq(0)
            expect(stakerDataBefore.userBalances.lastAction, "last action before").to.eq(0)
            expect(stakerDataBefore.userBalances.permMultiplier, "perm multiplier before").to.eq(0)
            expect(stakerDataBefore.userBalances.seasonMultiplier, "season multiplier before").to.eq(0)
            expect(stakerDataBefore.userBalances.timeMultiplier, "time multiplier before").to.eq(0)
            expect(stakerDataBefore.userBalances.cooldownMultiplier, "cooldown multiplier before").to.eq(0)
            expect(stakerDataBefore.stakedBalance, "staker stkRWD before").to.eq(0)
            expect(stakerDataBefore.rewardsBalance, "staker RWD before").to.eq(startingMintAmount)
            expect(stakerDataBefore.votes, "staker votes before").to.eq(0)
            expect(stakerDataBefore.cooldownTimestamp, "staker cooldown before").to.eq(0)

            const delegateDataBefore = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataBefore.stakedBalance, "delegate stkRWD before").to.eq(0)
            expect(delegateDataBefore.rewardsBalance, "delegate RWD before").to.eq(0)
            expect(delegateDataBefore.votes, "delegate votes before").to.eq(0)
            expect(delegateDataBefore.cooldownTimestamp, "delegate cooldown before").to.eq(0)

            expect(await stakedToken.totalSupply(), "total staked before").to.eq(0)
        })
        it("should delegate to self by default", async () => {
            const tx = await stakedToken["stake(uint256)"](stakedAmount)

            const stakedTimestamp = await getTimestamp()

            await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, stakedAmount, ZERO_ADDRESS)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").not
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, 0, stakedAmount)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, stakedAmount)

            const afterData = await snapshotUserStakingData(sa.default.address)

            expect(afterData.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
            expect(afterData.cooldownPercentage, "cooldown percentage after").to.eq(0)
            expect(afterData.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
            expect(afterData.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
            expect(afterData.userBalances.lastAction, "last action after").to.eq(stakedTimestamp)
            expect(afterData.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
            expect(afterData.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
            expect(afterData.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
            expect(afterData.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
            expect(afterData.stakedBalance, "staked balance after").to.eq(stakedAmount)
            expect(afterData.votes, "staker votes after").to.eq(stakedAmount)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount)
        })
        it("should assign delegate", async () => {
            const tx = await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)

            const stakedTimestamp = await getTimestamp()

            await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, stakedAmount, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.default.address, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, 0, stakedAmount)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, stakedAmount)

            const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataAfter.userBalances.raw, "staker raw balance after").to.eq(stakedAmount)
            expect(stakerDataAfter.userBalances.weightedTimestamp, "staker weighted timestamp after").to.eq(stakedTimestamp)
            expect(stakerDataAfter.userBalances.lastAction, "staker last action after").to.eq(stakedTimestamp)
            expect(stakerDataAfter.stakedBalance, "staker stkRWD after").to.eq(stakedAmount)
            expect(stakerDataAfter.votes, "staker votes after").to.eq(0)
            expect(stakerDataAfter.cooldownTimestamp, "staker cooldown after").to.eq(0)

            const delegateDataAfter = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataAfter.userBalances.raw, "delegate raw balance after").to.eq(0)
            expect(delegateDataAfter.userBalances.weightedTimestamp, "delegate weighted timestamp after").to.eq(0)
            expect(delegateDataAfter.userBalances.lastAction, "delegate last action after").to.eq(0)
            expect(delegateDataAfter.stakedBalance, "delegate stkRWD after").to.eq(0)
            expect(delegateDataAfter.votes, "delegate votes after").to.eq(stakedAmount)
            expect(delegateDataAfter.cooldownTimestamp, "delegate cooldown after").to.eq(0)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount)
        })
        it("should not chain delegate votes", async () => {
            const delegateStakedAmount = simpleToExactAmount(2000)
            await rewardToken.transfer(sa.dummy1.address, delegateStakedAmount)
            await rewardToken.connect(sa.dummy1.signer).approve(stakedToken.address, delegateStakedAmount)

            await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)
            await stakedToken.connect(sa.dummy1.signer)["stake(uint256,address)"](delegateStakedAmount, sa.dummy2.address)

            const afterStakerData = await snapshotUserStakingData(sa.default.address)
            expect(afterStakerData.stakedBalance, "staker stkRWD after").to.eq(stakedAmount)
            expect(afterStakerData.votes, "staker votes after").to.eq(0)

            const afterDelegateData = await snapshotUserStakingData(sa.dummy1.address)
            expect(afterDelegateData.stakedBalance, "delegate stkRWD after").to.eq(delegateStakedAmount)
            expect(afterDelegateData.votes, "delegate votes after").to.eq(stakedAmount)

            const afterDelegatesDelegateData = await snapshotUserStakingData(sa.dummy2.address)
            expect(afterDelegatesDelegateData.stakedBalance, "delegate stkRWD after").to.eq(0)
            expect(afterDelegatesDelegateData.votes, "delegate votes after").to.eq(delegateStakedAmount)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount.add(delegateStakedAmount))
        })
    })
    context("change delegate votes", () => {
        const stakedAmount = simpleToExactAmount(100)
        beforeEach(async () => {
            stakedToken = await redeployStakedToken()
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
        })
        it("should change by staker from self to delegate", async () => {
            await stakedToken["stake(uint256)"](stakedAmount)

            const stakedTimestamp = await getTimestamp()
            const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataBefore.votes).to.equal(stakedAmount)
            expect(stakerDataBefore.stakedBalance).to.equal(stakedAmount)
            const delegateDataBefore = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataBefore.votes).to.equal(0)

            await increaseTime(ONE_WEEK)

            // Staker delegates to delegate
            const tx = await stakedToken.delegate(sa.dummy1.address)

            // Events from delegate tx
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.default.address, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, stakedAmount, 0)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, 0, stakedAmount)

            // Staker
            const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataAfter.userBalances.raw, "staker raw balance after").to.eq(stakedAmount)
            expect(stakerDataAfter.userBalances.weightedTimestamp, "staker weighted timestamp after").to.eq(stakedTimestamp)
            expect(stakerDataAfter.userBalances.lastAction, "staker last action after").to.eq(stakedTimestamp)
            expect(stakerDataAfter.votes, "staker votes after").to.equal(0)
            expect(stakerDataAfter.stakedBalance, "staker staked balance after").to.equal(stakedAmount)
            // Delegate
            const delegateDataAfter = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataAfter.userBalances.raw, "delegate raw balance after").to.eq(0)
            expect(delegateDataAfter.userBalances.weightedTimestamp, "delegate weighted timestamp after").to.eq(0)
            expect(delegateDataAfter.userBalances.lastAction, "delegate last action after").to.eq(0)
            expect(delegateDataAfter.votes, "delegate votes after").to.equal(stakedAmount)
            expect(delegateDataAfter.stakedBalance, "delegate staked balance after").to.equal(0)
        })
        it("should change delegate by staker from dummy 1 to 2", async () => {
            await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)

            const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataBefore.votes).to.equal(0)
            const oldDelegateDataBefore = await snapshotUserStakingData(sa.dummy1.address)
            expect(oldDelegateDataBefore.votes).to.equal(stakedAmount)
            const newDelegateDataBefore = await snapshotUserStakingData(sa.dummy2.address)
            expect(newDelegateDataBefore.votes).to.equal(0)

            const tx = await stakedToken.delegate(sa.dummy2.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.dummy1.address, sa.dummy2.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, stakedAmount, 0)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy2.address, 0, stakedAmount)

            const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataAfter.votes).to.equal(0)
            expect(stakerDataAfter.stakedBalance).to.equal(stakedAmount)
            const oldDelegateDataAfter = await snapshotUserStakingData(sa.dummy1.address)
            expect(oldDelegateDataAfter.votes).to.equal(0)
            expect(oldDelegateDataAfter.stakedBalance).to.equal(0)
            const newDelegateDataAfter = await snapshotUserStakingData(sa.dummy2.address)
            expect(newDelegateDataAfter.votes).to.equal(stakedAmount)
            expect(newDelegateDataAfter.stakedBalance).to.equal(0)
        })
        it("should change by staker from delegate to self", async () => {
            await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)

            const stakedTimestamp = await getTimestamp()
            const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataBefore.votes).to.equal(0)
            expect(stakerDataBefore.stakedBalance).to.equal(stakedAmount)
            const delegateDataBefore = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataBefore.votes).to.equal(stakedAmount)

            // Staker delegates from delegate back to themselves
            const tx = await stakedToken.delegate(sa.default.address)

            // Events
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.dummy1.address, sa.default.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, 0, stakedAmount)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, stakedAmount, 0)

            // Staker
            const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
            expect(stakerDataAfter.userBalances.raw, "staker raw balance after").to.eq(stakedAmount)
            expect(stakerDataAfter.userBalances.weightedTimestamp, "staker weighted timestamp after").to.eq(stakedTimestamp)
            expect(stakerDataAfter.userBalances.lastAction, "staker last action after").to.eq(stakedTimestamp)
            expect(stakerDataAfter.votes, "staker votes after").to.equal(stakedAmount)
            expect(stakerDataAfter.stakedBalance, "staker staked balance after").to.equal(stakedAmount)
            // Delegate
            const delegateDataAfter = await snapshotUserStakingData(sa.dummy1.address)
            expect(delegateDataAfter.votes, "delegate votes after").to.equal(0)
            expect(delegateDataAfter.stakedBalance, "delegate staked balance after").to.equal(0)
        })
        it("by delegate", async () => {
            const tx = await stakedToken.connect(sa.dummy1.signer).delegate(sa.dummy2.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.dummy1.address, sa.dummy1.address, sa.dummy2.address)
        })
        context("should fail", () => {
            it("by delegate", async () => {
                stakedToken.connect(sa.dummy1.signer).delegate(sa.dummy2.address)
            })
        })
    })

    context("boosting", () => {
        it("should apply a multiplier if the user stakes within the migration window")
        it("should apply the multiplier to voting power but not raw balance")
        it("should update total votingPower, totalSupply, etc, retroactively")
    })

    context("questing and multipliers", () => {
        const stakedAmount = simpleToExactAmount(5000)
        before(async () => {
            stakedToken = await redeployStakedToken()
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
            await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
        })
        context("add quest", () => {
            let id = 0
            it("should allow governor to add a seasonal quest", async () => {
                const multiplier = 20 // 1.2x
                const expiry = deployTime.add(ONE_WEEK.mul(12))
                const tx = await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, multiplier, expiry)

                await expect(tx)
                    .to.emit(stakedToken, "QuestAdded")
                    .withArgs(sa.governor.address, 0, QuestType.SEASONAL, multiplier, QuestStatus.ACTIVE, expiry)

                const quest = await stakedToken.getQuest(id)
                expect(quest.model).to.eq(QuestType.SEASONAL)
                expect(quest.multiplier).to.eq(multiplier)
                expect(quest.status).to.eq(QuestStatus.ACTIVE)
                expect(quest.expiry).to.eq(expiry)
            })
            it("should allow governor to add a permanent quest", async () => {
                id += 1
                const multiplier = 40 // 1.4x
                const expiry = deployTime.add(ONE_WEEK.mul(26))
                const tx = await stakedToken.connect(sa.governor.signer).addQuest(QuestType.PERMANENT, multiplier, expiry)

                await expect(tx)
                    .to.emit(stakedToken, "QuestAdded")
                    .withArgs(sa.governor.address, 1, QuestType.PERMANENT, multiplier, QuestStatus.ACTIVE, expiry)

                const quest = await stakedToken.getQuest(id)
                expect(quest.model).to.eq(QuestType.PERMANENT)
                expect(quest.multiplier).to.eq(multiplier)
                expect(quest.status).to.eq(QuestStatus.ACTIVE)
                expect(quest.expiry).to.eq(expiry)
            })
            context("should allow governor to add", () => {
                it("quest with 1.01x multiplier", async () => {
                    await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 1, deployTime.add(ONE_WEEK.mul(12)))
                })
                it("quest with 50x multiplier", async () => {
                    await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 50, deployTime.add(ONE_WEEK.mul(12)))
                })
                it("quest with 1 day expiry", async () => {
                    const currentTime = await getTimestamp()
                    await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, currentTime.add(ONE_DAY).add(2))
                })
            })
            context("should not add quest", () => {
                const multiplier = 10 // 1.1x
                it("from deployer account", async () => {
                    await expect(stakedToken.addQuest(QuestType.SEASONAL, multiplier, deployTime.add(ONE_WEEK))).to.revertedWith(
                        "Not verified",
                    )
                })
                it("with < 1 day expiry", async () => {
                    await expect(
                        stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, multiplier, deployTime.add(ONE_DAY).sub(60)),
                    ).to.revertedWith("Quest window too small")
                })
                it("with 0 multiplier", async () => {
                    await expect(
                        stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 0, deployTime.add(ONE_WEEK)),
                    ).to.revertedWith("Quest multiplier too large > 1.5x")
                })
                it("with > 1.5x multiplier", async () => {
                    await expect(
                        stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 51, deployTime.add(ONE_WEEK)),
                    ).to.revertedWith("Quest multiplier too large > 1.5x")
                })
            })
        })
        context("expire quest", () => {
            let expiry: BN
            before(async () => {
                expiry = deployTime.add(ONE_WEEK.mul(12))
            })
            it("should allow governor to expire a seasonal quest", async () => {
                const tx0 = await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, expiry)
                const receipt = await tx0.wait()
                const { id } = receipt.events[0].args
                const currentTime = await getTimestamp()
                const tx = await stakedToken.connect(sa.governor.signer).expireQuest(id)

                await expect(tx).to.emit(stakedToken, "QuestExpired").withArgs(id)

                const quest = await stakedToken.getQuest(id)
                expect(quest.status).to.eq(QuestStatus.EXPIRED)
                expect(quest.expiry).to.lt(expiry)
                expect(quest.expiry).to.eq(currentTime.add(1))
            })
            it("should allow governor to expire a permanent quest", async () => {
                const tx0 = await stakedToken.connect(sa.governor.signer).addQuest(QuestType.PERMANENT, 10, expiry)
                const receipt = await tx0.wait()
                const { id } = receipt.events[0].args
                const currentTime = await getTimestamp()
                const tx = await stakedToken.connect(sa.governor.signer).expireQuest(id)

                await expect(tx).to.emit(stakedToken, "QuestExpired").withArgs(id)

                const quest = await stakedToken.getQuest(id)
                expect(quest.status).to.eq(QuestStatus.EXPIRED)
                expect(quest.expiry).to.lt(expiry)
                expect(quest.expiry).to.eq(currentTime.add(1))
            })
            context("should fail to expire quest", () => {
                let id: number
                before(async () => {
                    const tx = await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, expiry)
                    const receipt = await tx.wait()
                    id = receipt.events[0].args.id
                })
                it("from deployer", async () => {
                    await expect(stakedToken.expireQuest(id)).to.revertedWith("Not verified")
                })
                it("with id does not exists", async () => {
                    await expect(stakedToken.connect(sa.governor.signer).expireQuest(id + 1)).to.revertedWith("Quest does not exist")
                })
                it("that has already been expired", async () => {
                    await stakedToken.connect(sa.governor.signer).expireQuest(id)
                    await expect(stakedToken.connect(sa.governor.signer).expireQuest(id)).to.revertedWith("Quest already expired")
                })
            })
            it("expired quest can no longer be completed")
        })
        context("start season", () => {
            before(async () => {
                const expiry = deployTime.add(ONE_WEEK.mul(12))
                await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, expiry)
                await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, expiry)
                expect(await stakedToken.seasonEpoch(), "season epoch before").to.gt(deployTime)
            })
            it("should allow governor to start season after 39 weeks", async () => {
                await increaseTime(ONE_WEEK.mul(39).add(60))
                const tx = await stakedToken.connect(sa.governor.signer).startNewQuestSeason()
                await expect(tx).to.emit(stakedToken, "QuestSeasonEnded")
                const currentTime = await getTimestamp()
                expect(await stakedToken.seasonEpoch(), "season epoch after").to.eq(currentTime)
            })
            context("should fail to start season", () => {
                it("from deployer", async () => {
                    await expect(stakedToken.startNewQuestSeason()).to.revertedWith("Not verified")
                })
                it("before 39 week from last season", async () => {
                    await increaseTime(ONE_WEEK.mul(39).sub(60))
                    await expect(stakedToken.connect(sa.governor.signer).startNewQuestSeason()).to.revertedWith("Season has not elapsed")
                })
            })
        })
        context("complete quests", () => {
            let stakedTime
            let permanentQuestId: BN
            let seasonQuestId: BN
            const permanentMultiplier = 10
            const seasonMultiplier = 20
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)

                stakedTime = await getTimestamp()
                const expiry = stakedTime.add(ONE_WEEK.mul(12))
                await stakedToken.connect(sa.governor.signer).addQuest(QuestType.PERMANENT, permanentMultiplier, expiry)
                const tx = await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, seasonMultiplier, expiry)
                const receipt = await tx.wait()
                seasonQuestId = receipt.events[0].args.id
                permanentQuestId = seasonQuestId.sub(1)
            })
            it("should allow quest signer to complete a user's seasonal quest", async () => {
                const userAddress = sa.default.address
                expect(await stakedToken.hasCompleted(userAddress, seasonQuestId), "quest completed before").to.be.false

                // Complete User Season Quest
                const signature = await signUserQuest(userAddress, seasonQuestId, sa.questSigner.signer)
                const tx = await stakedToken.connect(sa.default.signer).completeQuests(userAddress, [seasonQuestId], [signature])

                const completeQuestTimestamp = await getTimestamp()

                // Check events
                await expect(tx).to.emit(stakedToken, "QuestComplete").withArgs(userAddress, seasonQuestId)

                // Check data
                expect(await stakedToken.hasCompleted(userAddress, seasonQuestId), "quest completed after").to.be.true
                const userDataAfter = await snapshotUserStakingData(userAddress)
                expect(userDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                expect(userDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(0)
                expect(userDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                expect(userDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTime)
                expect(userDataAfter.userBalances.lastAction, "last action after").to.eq(completeQuestTimestamp)
                expect(userDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
                expect(userDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(seasonMultiplier)
                expect(userDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                expect(userDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                const expectedBalance = stakedAmount.mul(100 + seasonMultiplier).div(100)
                expect(userDataAfter.stakedBalance, "staked balance after").to.eq(expectedBalance)
                expect(userDataAfter.votes, "votes after").to.eq(expectedBalance)
            })
            it("should allow quest signer to complete a user's permanent quest", async () => {
                const userAddress = sa.default.address
                expect(await stakedToken.hasCompleted(userAddress, permanentQuestId), "quest completed before").to.be.false

                // Complete User Permanent Quest
                const signature = await signUserQuest(userAddress, permanentQuestId, sa.questSigner.signer)
                const tx = await stakedToken.connect(sa.questSigner.signer).completeQuests(userAddress, [permanentQuestId], [signature])

                const completeQuestTimestamp = await getTimestamp()

                // Check events
                await expect(tx).to.emit(stakedToken, "QuestComplete").withArgs(userAddress, permanentQuestId)

                // Check data
                expect(await stakedToken.hasCompleted(userAddress, permanentQuestId), "quest completed after").to.be.true
                const userDataAfter = await snapshotUserStakingData(userAddress)
                expect(userDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                expect(userDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(0)
                expect(userDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                expect(userDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTime)
                expect(userDataAfter.userBalances.lastAction, "last action after").to.eq(completeQuestTimestamp)
                expect(userDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(permanentMultiplier)
                expect(userDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
                expect(userDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                expect(userDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                const expectedBalance = stakedAmount.mul(100 + permanentMultiplier).div(100)
                expect(userDataAfter.stakedBalance, "staked balance after").to.eq(expectedBalance)
                expect(userDataAfter.votes, "votes after").to.eq(expectedBalance)
            })
            it("should complete user quest before a user stakes", async () => {
                const userAddress = sa.dummy1.address
                expect(await stakedToken.hasCompleted(userAddress, permanentQuestId), "quest completed before").to.be.false

                // Complete User Permanent and Seasonal Quests
                const permSignature = await signUserQuest(userAddress, permanentQuestId, sa.questSigner.signer)
                const seasonSignature = await signUserQuest(userAddress, seasonQuestId, sa.questSigner.signer)
                const tx = await stakedToken
                    .connect(sa.questSigner.signer)
                    .completeQuests(userAddress, [permanentQuestId, seasonQuestId], [permSignature, seasonSignature])

                const completeQuestTimestamp = await getTimestamp()

                // Check events
                await expect(tx).to.emit(stakedToken, "QuestComplete").withArgs(userAddress, permanentQuestId)

                // Check data
                expect(await stakedToken.hasCompleted(userAddress, permanentQuestId), "quest completed after").to.be.true
                const userDataAfter = await snapshotUserStakingData(userAddress)
                expect(userDataAfter.userBalances.raw, "staked raw balance after").to.eq(0)
                expect(userDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(0)
                expect(userDataAfter.userBalances.lastAction, "last action after").to.eq(completeQuestTimestamp)
                expect(userDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(permanentMultiplier)
                expect(userDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(seasonMultiplier)
                expect(userDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                expect(userDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                expect(userDataAfter.stakedBalance, "staked balance after").to.eq(0)
                expect(userDataAfter.votes, "votes after").to.eq(0)
            })
            it("should fail to complete a user quest again", async () => {
                const userAddress = sa.dummy2.address
                const signature = await signUserQuest(userAddress, permanentQuestId, sa.questSigner.signer)
                await stakedToken.connect(sa.questSigner.signer).completeQuests(userAddress, [permanentQuestId], [signature])
                await expect(
                    stakedToken.connect(sa.questSigner.signer).completeQuests(userAddress, [permanentQuestId], [signature]),
                ).to.revertedWith("Err: Already Completed")
            })
            it("should fail a user signing quest completion", async () => {
                const userAddress = sa.dummy3.address
                const signature = await signUserQuest(userAddress, permanentQuestId, sa.dummy3.signer)
                await expect(
                    stakedToken.connect(sa.dummy3.signer).completeQuests(userAddress, [permanentQuestId], [signature]),
                ).to.revertedWith("Err: Invalid Signature")
            })
        })
        context("time multiplier", () => {
            let stakerDataBefore: UserStakingData
            let anySigner: Signer
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)

                anySigner = sa.dummy4.signer
            })
            it("staker data just after stake", async () => {
                stakerDataBefore = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataBefore.userBalances.timeMultiplier).to.eq(0)
                expect(stakerDataBefore.userBalances.raw).to.eq(stakedAmount)
                expect(stakerDataBefore.votes).to.eq(stakedAmount)
                expect(stakerDataBefore.stakedBalance).to.eq(stakedAmount)
            })
            const runs = [
                { weeks: 13, multiplierBefore: BN.from(0), multiplierAfter: BN.from(20) },
                { weeks: 26, multiplierBefore: BN.from(20), multiplierAfter: BN.from(30) },
                { weeks: 52, multiplierBefore: BN.from(30), multiplierAfter: BN.from(40) },
                { weeks: 78, multiplierBefore: BN.from(40), multiplierAfter: BN.from(50) },
                { weeks: 104, multiplierBefore: BN.from(50), multiplierAfter: BN.from(60) },
                { weeks: 312, multiplierBefore: BN.from(60), multiplierAfter: BN.from(60) },
            ]
            runs.forEach((run) => {
                it(`anyone can review timestamp before ${run.weeks} weeks`, async () => {
                    await increaseTime(ONE_WEEK.mul(run.weeks).sub(60))

                    if (run.multiplierBefore.eq(0)) {
                        await expect(stakedToken.connect(anySigner).reviewTimestamp(sa.default.address)).to.revertedWith(
                            "Nothing worth poking here",
                        )
                    } else {
                        await stakedToken.connect(anySigner).reviewTimestamp(sa.default.address)
                    }

                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "timeMultiplier After").to.eq(run.multiplierBefore)
                    expect(stakerDataAfter.userBalances.raw, "raw balance after").to.eq(stakedAmount)
                    // balance = staked amount * (100 + time multiplier) / 100
                    const expectedBalance = stakedAmount.mul(run.multiplierBefore.add(100)).div(100)
                    expect(stakerDataAfter.votes, "votes after").to.eq(expectedBalance)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(expectedBalance)
                })
                it(`anyone can review timestamp after ${run.weeks} weeks`, async () => {
                    await increaseTime(ONE_WEEK.mul(run.weeks).add(60))

                    await stakedToken.connect(anySigner).reviewTimestamp(sa.default.address)

                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "timeMultiplier After").to.eq(run.multiplierAfter)
                    expect(stakerDataAfter.userBalances.raw, "raw balance after").to.eq(stakedAmount)
                    // balance = staked amount * (100 + time multiplier) / 100
                    const expectedBalance = stakedAmount.mul(run.multiplierAfter.add(100)).div(100)
                    expect(stakerDataAfter.votes, "votes after").to.eq(expectedBalance)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(expectedBalance)
                })
            })
        })
        context("multiple multipliers", () => {
            const quests: { type: QuestType; multiplier: number; weeks: number }[] = [
                { type: QuestType.PERMANENT, multiplier: 12, weeks: 12 },
                { type: QuestType.PERMANENT, multiplier: 22, weeks: 4 },
                { type: QuestType.SEASONAL, multiplier: 5, weeks: 6 },
                { type: QuestType.SEASONAL, multiplier: 8, weeks: 10 },
            ]
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()

                const questStart = await getTimestamp()
                for (const quest of quests) {
                    await stakedToken
                        .connect(sa.governor.signer)
                        .addQuest(quest.type, quest.multiplier, questStart.add(ONE_WEEK.mul(quest.weeks)))
                }

                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
            })
            const runs: {
                desc: string
                weeks: number
                completedQuests: number[]
                cooldown?: {
                    start: number
                    end?: number
                    percentage: BN
                }
                timeMultiplier?: number
                permMultiplier?: number
                seasonMultiplier?: number
                cooldownMultiplier?: number
                reviewTimestamp?: boolean
            }[] = [
                { desc: "no multipliers", weeks: 1, completedQuests: [] },
                {
                    desc: "all quests before 13 weeks",
                    weeks: 2,
                    completedQuests: [0, 1, 2, 3],
                    timeMultiplier: 0,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                },
                {
                    desc: "all quests after 13 weeks",
                    weeks: 14,
                    completedQuests: [0, 1, 2, 3],
                    timeMultiplier: 20,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                    reviewTimestamp: true,
                },
                {
                    desc: "only perm quests after 27 weeks",
                    weeks: 27,
                    completedQuests: [0, 1],
                    timeMultiplier: 30,
                    permMultiplier: 34,
                    seasonMultiplier: 0,
                    reviewTimestamp: true,
                },
                {
                    desc: "only season quests after 55 weeks",
                    weeks: 55,
                    completedQuests: [2, 3],
                    timeMultiplier: 40,
                    permMultiplier: 0,
                    seasonMultiplier: 13,
                    reviewTimestamp: true,
                },
                {
                    desc: "no quests, 10 weeks in 100% cooldown",
                    weeks: 10,
                    completedQuests: [],
                    cooldown: {
                        start: 8,
                        percentage: simpleToExactAmount(1),
                    },
                    timeMultiplier: 0,
                    permMultiplier: 0,
                    seasonMultiplier: 0,
                    cooldownMultiplier: 100,
                },
                {
                    desc: "no quests, 11 weeks out of 100% cooldown not ended",
                    weeks: 11,
                    completedQuests: [],
                    cooldown: {
                        start: 8,
                        percentage: simpleToExactAmount(1),
                    },
                    timeMultiplier: 0,
                    permMultiplier: 0,
                    seasonMultiplier: 0,
                    cooldownMultiplier: 100,
                },
                {
                    desc: "no quests, 11 weeks out of 100% cooldown ended",
                    weeks: 11,
                    completedQuests: [],
                    cooldown: {
                        start: 8,
                        percentage: simpleToExactAmount(1),
                        end: 10,
                    },
                    timeMultiplier: 0,
                    permMultiplier: 0,
                    seasonMultiplier: 0,
                    cooldownMultiplier: 0,
                },
                {
                    desc: "all quests, 20 weeks in 20% cooldown",
                    weeks: 20,
                    completedQuests: [0, 1, 2, 3],
                    cooldown: {
                        start: 19,
                        percentage: simpleToExactAmount(0.2),
                    },
                    timeMultiplier: 20,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                    cooldownMultiplier: 20,
                },
                {
                    desc: "all quests, 23 weeks after 30% cooldown not ended",
                    weeks: 23,
                    completedQuests: [0, 1, 2, 3],
                    cooldown: {
                        start: 19,
                        percentage: simpleToExactAmount(0.3),
                    },
                    timeMultiplier: 20,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                    cooldownMultiplier: 30,
                },
                {
                    desc: "all quests, 24 weeks after 20% cooldown ended",
                    weeks: 24,
                    completedQuests: [0, 1, 2, 3],
                    cooldown: {
                        start: 19,
                        end: 23,
                        percentage: simpleToExactAmount(0.2),
                    },
                    timeMultiplier: 20,
                    permMultiplier: 34,
                    seasonMultiplier: 13,
                    cooldownMultiplier: 0,
                },
            ]
            runs.forEach((run) => {
                it(run.desc, async () => {
                    const user = sa.default.address
                    if (run.completedQuests.length) {
                        const signatures = []
                        for (const questId of run.completedQuests) {
                            signatures.push(await signUserQuest(user, questId, sa.questSigner.signer))
                        }
                        await stakedToken.completeQuests(user, run.completedQuests, signatures)
                    }

                    if (run.cooldown?.start) {
                        await increaseTime(ONE_WEEK.mul(run.cooldown.start))
                        await stakedToken.startCooldown(run.cooldown.percentage)

                        if (run.cooldown.end) {
                            await increaseTime(ONE_WEEK.mul(run.weeks - run.cooldown.end))
                            await stakedToken.endCooldown()
                            await increaseTime(ONE_WEEK.mul(run.weeks - run.cooldown.end))
                        } else {
                            await increaseTime(ONE_WEEK.mul(run.weeks - run.cooldown.start))
                        }
                    } else {
                        await increaseTime(ONE_WEEK.mul(run.weeks))
                    }

                    if (run.reviewTimestamp) {
                        await stakedToken.reviewTimestamp(user)
                    }

                    const timeMultiplierExpected = BN.from(run.timeMultiplier || 0)
                    const permMultiplierExpected = BN.from(run.permMultiplier || 0)
                    const seasonMultiplierExpected = BN.from(run.seasonMultiplier || 0)
                    const cooldownMultiplierExpected = BN.from(run.cooldownMultiplier || 0)

                    const questBalanceExpected = stakedAmount.mul(permMultiplierExpected.add(seasonMultiplierExpected).add(100)).div(100)
                    const timeBalanceExpected = questBalanceExpected.mul(timeMultiplierExpected.add(100)).div(100)
                    const balanceExpected = timeBalanceExpected.mul(BN.from(100).sub(cooldownMultiplierExpected)).div(100)

                    const stakerDataAfter = await snapshotUserStakingData(user)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "timeMultiplier After").to.eq(timeMultiplierExpected)
                    expect(stakerDataAfter.userBalances.permMultiplier, "permMultiplier After").to.eq(permMultiplierExpected)
                    expect(stakerDataAfter.userBalances.seasonMultiplier, "seasonMultiplier After").to.eq(seasonMultiplierExpected)
                    expect(stakerDataAfter.userBalances.cooldownMultiplier, "seasonMultiplier After").to.eq(cooldownMultiplierExpected)
                    expect(stakerDataAfter.userBalances.raw, "raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "votes after").to.eq(balanceExpected)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(balanceExpected)
                })
            })
        })
        context("questMaster", () => {
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                expect(await stakedToken.questMaster(), "quest master before").to.eq(sa.questSigner.address)
            })
            it("should set questMaster by governor", async () => {
                const tx = await stakedToken.connect(sa.governor.signer).setQuestMaster(sa.dummy1.address)
                await expect(tx).to.emit(stakedToken, "QuestMaster").withArgs(sa.questSigner.address, sa.dummy1.address)
                expect(await stakedToken.questMaster(), "quest master after").to.eq(sa.dummy1.address)
            })
            it("should set questMaster by quest master", async () => {
                const tx = await stakedToken.connect(sa.questSigner.signer).setQuestMaster(sa.dummy2.address)
                await expect(tx).to.emit(stakedToken, "QuestMaster").withArgs(sa.questSigner.address, sa.dummy2.address)
                expect(await stakedToken.questMaster(), "quest master after").to.eq(sa.dummy2.address)
            })
            it("should fail to set quest master by anyone", async () => {
                await expect(stakedToken.connect(sa.dummy3.signer).setQuestMaster(sa.dummy3.address)).to.revertedWith("Not verified")
            })
        })

        // Important that each action (checkTimestamp, completeQuest, mint) applies this because
        // scaledBalance could actually decrease, even in these situations, since old seasonMultipliers are slashed
        it("should slash an old seasons reward on any action")
    })
    context("triggering the governance hook", () => {
        it("should allow governor to add a governanceHook")
        it("should trigger governanceHook each time voting weight changes")
        // WE should write a mock IGovernanceHook here.. and project how much it's going to cost.
        // If the flow is:
        //  - Look up preferences of the user
        //  - Update their personal balances in each gauge <- can we remove the SSTORES from this step and just use the gain/loss in voting power?
        //  - Update the total balance in each gauge & total overall balance
        // Then it could end up costing ~4 SLOADS and ~2 SSTORES per dial preference, which is >18k per dial (4 dials and we are up to 80k...)
        // This can be optimised as part of the dials release but worth thinking about now.
        it("should not cause a ridiculous amount of extra gas to trigger")
    })
    context("cooldown", () => {
        const stakedAmount = simpleToExactAmount(7000)
        context("with no delegate", () => {
            let stakedTimestamp: BN
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
                stakedTimestamp = await getTimestamp()
            })
            context("should fail when", () => {
                it("nothing staked", async () => {
                    await expect(stakedToken.connect(sa.dummy1.signer).startCooldown(cooldown100Percentage)).to.revertedWith(
                        "INVALID_BALANCE_ON_COOLDOWN",
                    )
                })
                it("0 percentage", async () => {
                    await expect(stakedToken.startCooldown(0)).to.revertedWith("Invalid percentage")
                })
                it("percentage too large", async () => {
                    await expect(stakedToken.startCooldown(cooldown100Percentage.add(1))).to.revertedWith("Invalid percentage")
                })
            })
            it("should start cooldown", async () => {
                const tx = await stakedToken.startCooldown(cooldown100Percentage)

                await expect(tx).to.emit(stakedToken, "Cooldown").withArgs(sa.default.address, cooldown100Percentage)

                const startCooldownTimestamp = await getTimestamp()
                const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(startCooldownTimestamp)
                expect(stakerDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(cooldown100Percentage)
                expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                // TODO why is weightedTimestamp 1 second behind lastAction?
                expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(startCooldownTimestamp.sub(1))
                expect(stakerDataAfter.userBalances.lastAction, "last action after").to.eq(startCooldownTimestamp)
                expect(stakerDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
                expect(stakerDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
                expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                expect(stakerDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(100)
                expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(0)
                expect(stakerDataAfter.votes, "votes after").to.eq(0)
            })
            it("should partial cooldown again after it has already started", async () => {
                const stakerDataBefore = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataBefore.userBalances.weightedTimestamp, "weighted timestamp before").to.eq(stakedTimestamp)

                // First cooldown for 80% of stake
                const firstCooldown = simpleToExactAmount(0.8)
                await stakedToken.startCooldown(firstCooldown)

                const cooldown1stTimestamp = await getTimestamp()
                const stakerDataAfter1stooldown = await snapshotUserStakingData(sa.default.address)

                expect(stakerDataAfter1stooldown.cooldownTimestamp, "cooldown timestamp after 1st").to.eq(cooldown1stTimestamp)
                expect(stakerDataAfter1stooldown.cooldownPercentage, "cooldown percentage after 1st").to.eq(firstCooldown)
                expect(stakerDataAfter1stooldown.userBalances.raw, "staked raw balance after 1st").to.eq(stakedAmount)
                expect(stakerDataAfter1stooldown.userBalances.weightedTimestamp, "weighted timestamp after 1st").to.eq(
                    cooldown1stTimestamp.sub(1),
                )
                expect(stakerDataAfter1stooldown.userBalances.lastAction, "last action after 1st").to.eq(cooldown1stTimestamp)
                expect(stakerDataAfter1stooldown.userBalances.permMultiplier, "perm multiplier after 1st").to.eq(0)
                expect(stakerDataAfter1stooldown.userBalances.seasonMultiplier, "season multiplier after 1st").to.eq(0)
                expect(stakerDataAfter1stooldown.userBalances.timeMultiplier, "time multiplier after 1st").to.eq(0)
                expect(stakerDataAfter1stooldown.userBalances.cooldownMultiplier, "cooldown multiplier after 1st").to.eq(80)
                expect(stakerDataAfter1stooldown.stakedBalance, "staked balance after 1st").to.eq(stakedAmount.div(5))

                await increaseTime(ONE_DAY)

                // Second cooldown for only 20% of stake
                const secondCooldown = simpleToExactAmount(0.2)
                await stakedToken.startCooldown(secondCooldown)

                const cooldown2ndTimestamp = await getTimestamp()
                const stakerDataAfter2ndCooldown = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfter2ndCooldown.cooldownTimestamp, "cooldown timestamp after 2nd").to.eq(cooldown2ndTimestamp)
                expect(stakerDataAfter2ndCooldown.cooldownPercentage, "cooldown percentage after 2nd").to.eq(secondCooldown)
                expect(stakerDataAfter2ndCooldown.userBalances.raw, "staked raw balance after 2nd").to.eq(stakedAmount)
                expect(stakerDataAfter2ndCooldown.userBalances.weightedTimestamp, "weighted timestamp after 2nd").to.eq(stakedTimestamp)
                expect(stakerDataAfter2ndCooldown.userBalances.lastAction, "last action after 2nd").to.eq(cooldown2ndTimestamp)
                expect(stakerDataAfter2ndCooldown.userBalances.permMultiplier, "perm multiplier after 2nd").to.eq(0)
                expect(stakerDataAfter2ndCooldown.userBalances.seasonMultiplier, "season multiplier after 2nd").to.eq(0)
                expect(stakerDataAfter2ndCooldown.userBalances.timeMultiplier, "time multiplier after 2nd").to.eq(0)
                expect(stakerDataAfter2ndCooldown.userBalances.cooldownMultiplier, "cooldown multiplier after 2nd").to.eq(20)
                expect(stakerDataAfter2ndCooldown.stakedBalance, "staked balance after 2nd").to.eq(stakedAmount.mul(4).div(5))
            })
            it("should reduce cooldown percentage enough to end the cooldown")
            context("should end 100% cooldown", () => {
                beforeEach(async () => {
                    await increaseTime(ONE_WEEK)
                    await stakedToken.startCooldown(cooldown100Percentage)
                })
                it("in cooldown", async () => {
                    await increaseTime(ONE_DAY)
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.userBalances.lastAction, "last action after").to.eq(endCooldownTimestamp)
                    expect(stakerDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("in unstake window", async () => {
                    await increaseTime(ONE_DAY.mul(8))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.userBalances.lastAction, "last action after").to.eq(endCooldownTimestamp)
                    expect(stakerDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("after unstake window", async () => {
                    await increaseTime(ONE_DAY.mul(12))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.userBalances.lastAction, "last action after").to.eq(endCooldownTimestamp)
                    expect(stakerDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("after time multiplier increases", async () => {
                    await increaseTime(ONE_WEEK.mul(14))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.userBalances.lastAction, "last action after").to.eq(endCooldownTimestamp)
                    expect(stakerDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(20)
                    expect(stakerDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount.mul(12).div(10))
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount.mul(12).div(10))
                })
            })
            context("should end partial cooldown", () => {
                beforeEach(async () => {
                    await increaseTime(ONE_WEEK)
                    await stakedToken.startCooldown(simpleToExactAmount(0.3))
                })
                it("in cooldown", async () => {
                    await increaseTime(ONE_DAY)
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.userBalances.lastAction, "last action after").to.eq(endCooldownTimestamp)
                    expect(stakerDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("in unstake window", async () => {
                    await increaseTime(ONE_DAY.mul(8))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.userBalances.lastAction, "last action after").to.eq(endCooldownTimestamp)
                    expect(stakerDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
                it("after unstake window", async () => {
                    await increaseTime(ONE_DAY.mul(12))
                    const tx = await stakedToken.endCooldown()

                    await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                    const endCooldownTimestamp = await getTimestamp()
                    const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                    expect(stakerDataAfter.cooldownTimestamp, "cooldown timestamp after").to.eq(0)
                    expect(stakerDataAfter.cooldownPercentage, "cooldown percentage after").to.eq(0)
                    expect(stakerDataAfter.userBalances.raw, "staked raw balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.userBalances.weightedTimestamp, "weighted timestamp after").to.eq(stakedTimestamp)
                    expect(stakerDataAfter.userBalances.lastAction, "last action after").to.eq(endCooldownTimestamp)
                    expect(stakerDataAfter.userBalances.permMultiplier, "perm multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.seasonMultiplier, "season multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.timeMultiplier, "time multiplier after").to.eq(0)
                    expect(stakerDataAfter.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                    expect(stakerDataAfter.stakedBalance, "staked balance after").to.eq(stakedAmount)
                    expect(stakerDataAfter.votes, "staked votes after").to.eq(stakedAmount)
                })
            })
            context("should end partial cooldown", () => {
                it("in cooldown")
                it("in unstake window")
                it("after unstake window")
            })
            it("should end partial cooldown via staking", async () => {
                // skip ahead 4 weeks
                await increaseTime(ONE_WEEK.mul(4))

                // Cooldown 80% of stake so only 20% of their voting power remains
                const cooldownPercentage = simpleToExactAmount(0.8)
                await stakedToken.startCooldown(cooldownPercentage)
                const cooldownTimestamp = await getTimestamp()

                const stakerDataAfterCooldown = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfterCooldown.cooldownTimestamp, "cooldown timestamp after cooldown").to.eq(cooldownTimestamp)
                expect(stakerDataAfterCooldown.cooldownPercentage, "cooldown percentage after cooldown").to.eq(cooldownPercentage)
                expect(stakerDataAfterCooldown.userBalances.raw, "staked raw balance after cooldown").to.eq(stakedAmount)
                expect(stakerDataAfterCooldown.userBalances.weightedTimestamp, "weighted timestamp after cooldown").to.eq(stakedTimestamp)
                expect(stakerDataAfterCooldown.userBalances.lastAction, "last action after cooldown").to.eq(cooldownTimestamp)
                expect(stakerDataAfterCooldown.stakedBalance, "staked after cooldown").to.eq(stakedAmount.div(5))
                expect(stakerDataAfterCooldown.userBalances.cooldownMultiplier, "cooldown multiplier after cooldown").to.eq(80)
                expect(stakerDataAfterCooldown.userBalances.timeMultiplier, "time multiplier after cooldown").to.eq(0)
                expect(stakerDataAfterCooldown.votes, "20% of vote after 80% cooldown").to.eq(stakedAmount.div(5))

                // Stake 3000 on top of 7000 and end cooldown
                const secondStakeAmount = simpleToExactAmount(3000)
                const tx = await stakedToken["stake(uint256,bool)"](secondStakeAmount, true)
                const secondStakedTimestamp = await getTimestamp()

                await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, secondStakeAmount, ZERO_ADDRESS)
                await expect(tx).to.emit(stakedToken, "DelegateChanged").not
                await expect(tx)
                    .to.emit(stakedToken, "DelegateVotesChanged")
                    .withArgs(sa.default.address, stakedAmount.div(5), stakedAmount.add(secondStakeAmount))
                await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, secondStakeAmount)
                await expect(tx).to.emit(stakedToken, "CooldownExited").withArgs(sa.default.address)

                const stakerDataAfter2ndStake = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfter2ndStake.cooldownTimestamp, "cooldown timestamp after 2nd stake").to.eq(0)
                expect(stakerDataAfter2ndStake.cooldownPercentage, "cooldown percentage after 2nd stake").to.eq(0)
                expect(stakerDataAfter2ndStake.userBalances.raw, "staked raw balance after 2nd stake").to.eq(
                    stakedAmount.add(secondStakeAmount),
                )
                // TODO need to calculate the weightedTimestamp =
                console.log(`1st staked ${new Date(stakedTimestamp.toNumber() * 1000)}`)
                console.log(`cooldown ${new Date(cooldownTimestamp.toNumber() * 1000)}`)
                console.log(`2nd staked ${new Date(secondStakedTimestamp.toNumber() * 1000)}`)
                console.log(`weighted timestamp ${new Date(stakerDataAfter2ndStake.userBalances.weightedTimestamp * 1000)}`)
                // expect(stakerDataAfter2ndStake.userBalances.weightedTimestamp, "weighted timestamp after 2nd stake").to.eq(stakedTimestamp)
                expect(stakerDataAfter2ndStake.userBalances.lastAction, "last action after 2nd stake").to.eq(secondStakedTimestamp)
                expect(stakerDataAfter2ndStake.userBalances.timeMultiplier, "time multiplier after 2nd stake").to.eq(0)
                expect(stakerDataAfter2ndStake.userBalances.cooldownMultiplier, "cooldown multiplier after 2nd stake").to.eq(0)
                expect(stakerDataAfter2ndStake.stakedBalance, "staked after 2nd stake").to.eq(stakedAmount.add(secondStakeAmount))
                expect(stakerDataAfter2ndStake.votes, "vote after 2nd stake").to.eq(stakedAmount.add(secondStakeAmount))
            })
            it("should proportionally reset cooldown when staking in cooldown", async () => {
                await increaseTime(ONE_WEEK)

                // Staker cooldown 100% of stake
                await stakedToken.startCooldown(cooldown100Percentage)

                const stakerDataAfterCooldown = await snapshotUserStakingData(sa.default.address)
                const cooldownTime = await getTimestamp()
                expect(stakerDataAfterCooldown.cooldownTimestamp, "staker cooldown timestamp after cooldown").to.eq(cooldownTime)

                await increaseTime(ONE_DAY.mul(5))

                // 2nd stake of 3000 on top of the existing 7000
                const secondStakeAmount = simpleToExactAmount(3000)
                await stakedToken["stake(uint256,address)"](secondStakeAmount, sa.default.address)

                const secondStakeTimestamp = await getTimestamp()
                const newStakedAmount = stakedAmount.add(secondStakeAmount)

                const stakerDataAfter = await snapshotUserStakingData(sa.default.address)
                expect(stakerDataAfter.cooldownTimestamp, "staker cooldown timestamp after 2nd stake").to.eq(
                    stakerDataAfterCooldown.cooldownTimestamp,
                )
                expect(stakerDataAfter.cooldownPercentage, "staker cooldown percentage after 2nd stake").to.eq(
                    cooldown100Percentage.mul(stakedAmount).div(newStakedAmount),
                )
                expect(stakerDataAfter.userBalances.raw, "staked raw balance after 2nd stake").to.eq(newStakedAmount)
                expect(stakerDataAfter.stakedBalance, "staker staked after 2nd stake").to.eq(secondStakeAmount)
                expect(stakerDataAfter.votes, "staker votes after 2nd stake").to.eq(secondStakeAmount)
                // TODO calculate new weighted timestamp
                // expect(stakerDataAfter.userBalances.weightedTimestamp, "staker weighted timestamp after").to.eq(stakedTimestamp)
                expect(stakerDataAfter.userBalances.lastAction, "staker last action after 2nd stake").to.eq(secondStakeTimestamp)
                expect(stakerDataAfter.userBalances.cooldownMultiplier, "staker cooldown multiplier after 2nd stake").to.eq(70)
                expect(stakerDataAfter.userBalances.timeMultiplier, "staker time multiplier after 2nd stake").to.eq(0)
            })
        })
        context("with delegate", () => {
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)
            })
            it("should fail by delegate", async () => {
                await expect(stakedToken.connect(sa.dummy1.address).startCooldown(cooldown100Percentage)).to.revertedWith(
                    "INVALID_BALANCE_ON_COOLDOWN",
                )
            })
        })
    })
    context.skip("withdraw", () => {
        const stakedAmount = simpleToExactAmount(2000)
        let cooldownTimestamp: BN
        context("should not be possible", () => {
            const withdrawAmount = simpleToExactAmount(100)
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
            })
            it("with zero balance", async () => {
                await stakedToken.startCooldown(cooldown100Percentage)
                await increaseTime(ONE_DAY.mul(7).add(60))
                await expect(stakedToken.withdraw(0, sa.default.address, false, false)).to.revertedWith("INVALID_ZERO_AMOUNT")
            })
            it("before cooldown started", async () => {
                await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)).to.revertedWith(
                    "UNSTAKE_WINDOW_FINISHED",
                )
            })
            it("before cooldown finished", async () => {
                await stakedToken.startCooldown(cooldown100Percentage)
                await increaseTime(ONE_DAY.mul(7).sub(60))
                await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)).to.revertedWith(
                    "INSUFFICIENT_COOLDOWN",
                )
            })
            it("after the unstake window", async () => {
                await stakedToken.startCooldown(cooldown100Percentage)
                await increaseTime(ONE_DAY.mul(9).add(60))
                await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)).to.revertedWith(
                    "UNSTAKE_WINDOW_FINISHED",
                )
            })
            it("when withdrawing too much", async () => {
                await stakedToken.startCooldown(10000)
                await increaseTime(ONE_DAY.mul(7).add(60))
                await expect(stakedToken.withdraw(stakedAmount.add(1), sa.default.address, false, false)).to.reverted
            })
        })
        context("with no delegate, after 100% cooldown and in unstake window", () => {
            let beforeData: UserStakingData
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
                await stakedToken.startCooldown(simpleToExactAmount(1))
                cooldownTimestamp = await getTimestamp()

                await increaseTime(ONE_DAY.mul(7).add(60))

                beforeData = await snapshotUserStakingData(sa.default.address)
                expect(beforeData.userBalances.raw, "staked raw balance before").to.eq(stakedAmount)
                expect(beforeData.stakedBalance, "staker staked before").to.eq(0)
                expect(beforeData.votes, "staker votes before").to.eq(0)
                expect(beforeData.rewardsBalance, "staker rewards before").to.eq(startingMintAmount.sub(stakedAmount))
                expect(beforeData.cooldownTimestamp, "cooldown timestamp before").to.eq(cooldownTimestamp)
                expect(beforeData.cooldownPercentage, "cooldown percentage before").to.eq(simpleToExactAmount(1))
                expect(beforeData.userBalances.cooldownMultiplier, "cooldown multiplier before").to.eq(100)
            })
            it("partial withdraw not including fee", async () => {
                const withdrawAmount = simpleToExactAmount(100)
                const redemptionFee = withdrawAmount.div(10)
                const tx2 = await stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, withdrawAmount)

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker staked after").to.eq(0)
                expect(afterData.votes, "staker votes after").to.eq(0)
                expect(afterData.cooldownTimestamp, "cooldown timestamp after").to.eq(beforeData.cooldownTimestamp)
                expect(afterData.cooldownPercentage, "cooldown percentage after").to.eq(beforeData.cooldownPercentage)
                expect(afterData.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(100)
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(stakedAmount.sub(withdrawAmount).sub(redemptionFee))
                expect(afterData.rewardsBalance, "staker rewards after").to.eq(beforeData.rewardsBalance.add(withdrawAmount))
            })
            it("full withdraw including fee", async () => {
                // withdraw with fee = staked withdraw + staked withdraw * 0.1 = 1.1 * staked withdraw
                // staked withdraw = withdraw with fee / 1.1
                // fee = staked withdraw * 0.1
                // fee = withdraw with fee / 1.1 * 0.1 = withdraw with fee / 11
                const redemptionFee = stakedAmount.div(11)
                const tx2 = await stakedToken.withdraw(stakedAmount, sa.default.address, true, true)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, stakedAmount)

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker stkRWD after").to.eq(0)
                expect(afterData.votes, "staker votes after").to.eq(0)
                expect(afterData.cooldownTimestamp, "staked cooldown start").to.eq(0)
                expect(afterData.cooldownPercentage, "staked cooldown percentage").to.eq(0)
                expect(afterData.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(0)
                // expect(afterData.rewardsBalance, "staker rewards after").to.eq(
                //     beforeData.rewardsBalance.add(stakedAmount).sub(redemptionFee),
                // )
                assertBNClose(afterData.rewardsBalance, beforeData.rewardsBalance.add(stakedAmount).sub(redemptionFee), 1)
            })
            it("not reset the cooldown timer unless all is all unstaked")
            it("apply a redemption fee which is added to the pendingRewards from the rewards contract")
            it("distribute these pendingAdditionalReward with the next notification")
        })
        context("with no delegate, after 70% cooldown and in unstake window", () => {
            let beforeData: UserStakingData
            // 2000 * 0.3 = 600
            const remainingBalance = stakedAmount.mul(3).div(10)
            // 2000 * 0.7 = 1400
            const cooldownAmount = stakedAmount.mul(7).div(10)
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                // Stake 2000
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
                // Cooldown 70% of 2000 = 1400
                await stakedToken.startCooldown(simpleToExactAmount(0.7))
                cooldownTimestamp = await getTimestamp()

                await increaseTime(ONE_DAY.mul(7).add(60))

                beforeData = await snapshotUserStakingData(sa.default.address)
                expect(beforeData.userBalances.raw, "staked raw balance before").to.eq(stakedAmount)
                expect(beforeData.stakedBalance, "staker staked before").to.eq(remainingBalance)
                expect(beforeData.votes, "staker votes before").to.eq(remainingBalance)
                expect(beforeData.rewardsBalance, "staker rewards before").to.eq(startingMintAmount.sub(stakedAmount))
                expect(beforeData.cooldownTimestamp, "cooldown timestamp before").to.eq(cooldownTimestamp)
                expect(beforeData.cooldownPercentage, "cooldown percentage before").to.eq(simpleToExactAmount(0.7))
                expect(beforeData.userBalances.cooldownMultiplier, "cooldown multiplier before").to.eq(70)
            })
            it("partial withdraw not including fee", async () => {
                const withdrawAmount = simpleToExactAmount(300)
                const redemptionFee = withdrawAmount.div(10)
                const tx2 = await stakedToken.withdraw(withdrawAmount, sa.default.address, false, false)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, withdrawAmount)

                const afterData = await snapshotUserStakingData(sa.default.address)
                console.log("data before")
                console.log(beforeData.cooldownPercentage.toString(), beforeData.userBalances.raw.toString())
                console.log(afterData.cooldownPercentage.toString(), afterData.userBalances.raw.toString())
                expect(afterData.stakedBalance, "staker staked after").to.eq(remainingBalance)
                expect(afterData.votes, "staker votes after").to.eq(remainingBalance)
                expect(afterData.cooldownTimestamp, "cooldown timestamp after").to.eq(beforeData.cooldownTimestamp)
                // 1400 / 2000 * 100 = 70
                // (1400 - 300 - 30) / (2000 - 300 - 30) * 1e18 = 64.0718563e16
                const newCooldownPercentage = cooldownAmount
                    .sub(withdrawAmount)
                    .sub(redemptionFee)
                    .mul(simpleToExactAmount(1))
                    .div(stakedAmount.sub(withdrawAmount).sub(redemptionFee))
                expect(afterData.cooldownPercentage, "cooldown percentage after").to.eq(newCooldownPercentage)
                expect(afterData.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(64)
                // 2000 - 300 - 30 = 1670
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(stakedAmount.sub(withdrawAmount).sub(redemptionFee))
                expect(afterData.rewardsBalance, "staker rewards after").to.eq(beforeData.rewardsBalance.add(withdrawAmount))
            })
            it("full withdraw of cooldown amount including fee", async () => {
                // withdraw with fee = staked withdraw + staked withdraw * 0.1 = 1.1 * staked withdraw
                // staked withdraw = withdraw with fee / 1.1
                // fee = staked withdraw * 0.1
                // fee = withdraw with fee / 1.1 * 0.1 = withdraw with fee / 11
                const redemptionFee = cooldownAmount.div(11)
                const tx2 = await stakedToken.withdraw(cooldownAmount, sa.default.address, true, true)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, cooldownAmount)

                const afterData = await snapshotUserStakingData(sa.default.address)
                expect(afterData.stakedBalance, "staker stkRWD after").to.eq(remainingBalance)
                expect(afterData.votes, "staker votes after").to.eq(remainingBalance)
                expect(afterData.cooldownTimestamp, "staked cooldown start").to.eq(0)
                expect(afterData.cooldownPercentage, "staked cooldown percentage").to.eq(0)
                expect(afterData.userBalances.cooldownMultiplier, "cooldown multiplier after").to.eq(0)
                expect(afterData.userBalances.raw, "staked raw balance after").to.eq(stakedAmount.sub(cooldownAmount))
                // expect(afterData.rewardsBalance, "staker rewards after").to.eq(
                //     beforeData.rewardsBalance.add(cooldownAmount).sub(redemptionFee),
                // )
                assertBNClose(afterData.rewardsBalance, beforeData.rewardsBalance.add(cooldownAmount).sub(redemptionFee), 1)
            })
            it("not reset the cooldown timer unless all is all unstaked")
            it("apply a redemption fee which is added to the pendingRewards from the rewards contract")
            it("distribute these pendingAdditionalReward with the next notification")
        })
    })

    context("interacting from a smart contract", () => {
        let stakedTokenWrapper
        const stakedAmount = simpleToExactAmount(1000)
        before(async () => {
            stakedToken = await redeployStakedToken()

            stakedTokenWrapper = await new StakedTokenWrapper__factory(sa.default.signer).deploy(rewardToken.address, stakedToken.address)
            await rewardToken.transfer(stakedTokenWrapper.address, stakedAmount.mul(2))
        })
        it("should not be possible to stake when not whitelisted", async () => {
            await expect(stakedTokenWrapper["stake(uint256)"](stakedAmount)).to.revertedWith("Not a whitelisted contract")
        })
        it("should allow governor to whitelist a contract", async () => {
            expect(await stakedToken.whitelistedWrappers(stakedTokenWrapper.address), "wrapper not whitelisted before").to.be.false
            const tx = await stakedToken.connect(sa.governor.signer).whitelistWrapper(stakedTokenWrapper.address)
            await expect(tx).to.emit(stakedToken, "WrapperWhitelisted").withArgs(stakedTokenWrapper.address)
            expect(await stakedToken.whitelistedWrappers(stakedTokenWrapper.address), "wrapper whitelisted after").to.be.true

            const tx2 = await stakedTokenWrapper["stake(uint256)"](stakedAmount)
            await expect(tx2).to.emit(stakedToken, "Staked").withArgs(stakedTokenWrapper.address, stakedAmount, ZERO_ADDRESS)
        })
        it("should allow governor to blacklist a contract", async () => {
            const tx = await stakedToken.connect(sa.governor.signer).whitelistWrapper(stakedTokenWrapper.address)
            await expect(tx).to.emit(stakedToken, "WrapperWhitelisted").withArgs(stakedTokenWrapper.address)
            expect(await stakedToken.whitelistedWrappers(stakedTokenWrapper.address), "wrapper whitelisted").to.be.true

            const tx2 = await stakedToken.connect(sa.governor.signer).blackListWrapper(stakedTokenWrapper.address)
            await expect(tx2).to.emit(stakedToken, "WrapperBlacklisted").withArgs(stakedTokenWrapper.address)
            expect(await stakedToken.whitelistedWrappers(stakedTokenWrapper.address), "wrapper not whitelisted").to.be.false

            await expect(stakedTokenWrapper["stake(uint256)"](stakedAmount)).to.revertedWith("Not a whitelisted contract")
        })
        it("Votes can be delegated to a smart contract", async () => {
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)

            const tx = await stakedToken["stake(uint256,address)"](stakedAmount, stakedTokenWrapper.address)

            await expect(tx).to.emit(stakedToken, "Staked").withArgs(stakedTokenWrapper.address, stakedAmount, stakedTokenWrapper.address)
        })
    })

    context("updating lastAction timestamp", () => {
        it("should be triggered after every WRITE action on the contract")
    })
})
