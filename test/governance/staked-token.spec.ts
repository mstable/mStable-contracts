import { ethers } from "hardhat"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { MockNexus__factory } from "types/generated/factories/MockNexus__factory"
import { AssetProxy__factory, MockERC20, MockERC20__factory, MockNexus } from "types"
import { StakedToken } from "types/generated/StakedToken"
import { StakedToken__factory } from "types/generated/factories/StakedToken__factory"
import { DEAD_ADDRESS } from "index"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { increaseTime } from "@utils/time"

interface UserStakingData {
    stakedBalance: BN
    votes: BN
    earnedRewards: BN
    stakersCooldown: BN
    rewardsBalance: BN
}

enum QuestType {
    PERMANENT,
    SEASONAL,
}

enum QuestStatus {
    ACTIVE,
    EXPIRED,
}

describe("Staked Token", () => {
    // const ctx: Partial<IModuleBehaviourContext> = {}
    let sa: StandardAccounts
    let deployTime: BN

    let nexus: MockNexus
    let rewardToken: MockERC20
    let stakedToken: StakedToken

    const startingMintAmount = simpleToExactAmount(10000000)

    const redeployStakedToken = async (): Promise<StakedToken> => {
        const startingBlock = await sa.default.signer.provider.getBlock("latest")
        deployTime = BN.from(startingBlock.timestamp)
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, 10000000)

        const stakedTokenFactory = await new StakedToken__factory(sa.default.signer)
        const stakedTokenImpl = await stakedTokenFactory.deploy(
            sa.questSigner.address,
            nexus.address,
            rewardToken.address,
            rewardToken.address,
            ONE_WEEK,
            ONE_DAY.mul(2),
        )
        const rewardsDistributorAddress = DEAD_ADDRESS
        const data = stakedTokenImpl.interface.encodeFunctionData("initialize", ["Staked Rewards", "stkRWD", rewardsDistributorAddress])
        const stakedTokenProxy = await new AssetProxy__factory(sa.default.signer).deploy(stakedTokenImpl.address, DEAD_ADDRESS, data)

        return stakedTokenFactory.attach(stakedTokenProxy.address)
    }

    const snapshotUserStakingData = async (user = sa.default): Promise<UserStakingData> => {
        const stakedBalance = await stakedToken.balanceOf(user.address)
        const votes = await stakedToken.getVotes(user.address)
        const earnedRewards = await stakedToken.earned(user.address)
        const stakersCooldown = await stakedToken.stakersCooldowns(user.address)
        const rewardsBalance = await rewardToken.balanceOf(user.address)

        return {
            stakedBalance,
            votes,
            earnedRewards,
            stakersCooldown,
            rewardsBalance,
        }
    }

    before("Create Contract", async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
    })

    // shouldBehaveLikeModule(ctx as Required<typeof ctx>)

    context("deploy and initialize", () => {
        before(async () => {
            stakedToken = await redeployStakedToken()
        })
        it("post initialize", async () => {
            expect(await stakedToken.name(), "name").to.eq("Staked Rewards")
            expect(await stakedToken.symbol(), "symbol").to.eq("stkRWD")
            expect(await stakedToken.decimals(), "decimals").to.eq(18)
            expect(await stakedToken.rewardsDistributor(), "rewards distributor").to.eq(DEAD_ADDRESS)
            // eslint-disable-next-line no-underscore-dangle
            // TODO why is this failing?
            // expect(await stakedToken._signer(), "quest signer").to.eq(sa.questSigner.address)

            expect(await stakedToken.STAKED_TOKEN(), "staked token").to.eq(rewardToken.address)
            expect(await stakedToken.COOLDOWN_SECONDS(), "cooldown").to.eq(ONE_WEEK)
            expect(await stakedToken.UNSTAKE_WINDOW(), "unstake window").to.eq(ONE_DAY.mul(2))
        })
    })

    context("staking and delegating", () => {
        const stakedAmount = simpleToExactAmount(1000)
        beforeEach(async () => {
            stakedToken = await redeployStakedToken()
            await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount.mul(3))

            const beforeDefaultData = await snapshotUserStakingData(sa.default)
            expect(beforeDefaultData.stakedBalance, "staker stkRWD before").to.eq(0)
            expect(beforeDefaultData.rewardsBalance, "staker RWD before").to.eq(startingMintAmount)
            expect(beforeDefaultData.votes, "staker votes before").to.eq(0)
            expect(beforeDefaultData.stakersCooldown, "staker cooldown before").to.eq(0)

            const beforeDelegateData = await snapshotUserStakingData(sa.dummy1)
            expect(beforeDelegateData.stakedBalance, "delegate stkRWD before").to.eq(0)
            expect(beforeDelegateData.rewardsBalance, "delegate RWD before").to.eq(0)
            expect(beforeDelegateData.votes, "delegate votes before").to.eq(0)
            expect(beforeDelegateData.stakersCooldown, "delegate cooldown before").to.eq(0)

            expect(await stakedToken.totalSupply(), "total staked before").to.eq(0)
        })
        it("should delegate to self by default", async () => {
            const tx = await stakedToken["stake(uint256)"](stakedAmount)
            await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, stakedAmount, ZERO_ADDRESS)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").not
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, 0, stakedAmount)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, stakedAmount)

            const afterData = await snapshotUserStakingData(sa.default)
            expect(afterData.stakedBalance, "staker stkRWD after").to.eq(stakedAmount)
            expect(afterData.votes, "staker votes after").to.eq(stakedAmount)
            expect(afterData.stakersCooldown, "staker cooldown after").to.eq(0)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount)
        })
        it("should assign delegate", async () => {
            const tx = await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "Staked").withArgs(sa.default.address, stakedAmount, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.default.address, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, 0, stakedAmount)
            await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, stakedToken.address, stakedAmount)

            const afterStakerData = await snapshotUserStakingData(sa.default)
            expect(afterStakerData.stakedBalance, "staker stkRWD after").to.eq(stakedAmount)
            expect(afterStakerData.votes, "staker votes after").to.eq(0)
            expect(afterStakerData.stakersCooldown, "staker cooldown after").to.eq(0)

            const afterDelegateData = await snapshotUserStakingData(sa.dummy1)
            expect(afterDelegateData.stakedBalance, "delegate stkRWD after").to.eq(0)
            expect(afterDelegateData.votes, "delegate votes after").to.eq(stakedAmount)
            expect(afterDelegateData.stakersCooldown, "delegate cooldown after").to.eq(0)

            expect(await stakedToken.totalSupply(), "total staked after").to.eq(stakedAmount)
        })
        it("should not chain delegate votes", async () => {
            const delegateStakedAmount = simpleToExactAmount(2000)
            await rewardToken.transfer(sa.dummy1.address, delegateStakedAmount)
            await rewardToken.connect(sa.dummy1.signer).approve(stakedToken.address, delegateStakedAmount)

            await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)
            await stakedToken.connect(sa.dummy1.signer)["stake(uint256,address)"](delegateStakedAmount, sa.dummy2.address)

            const afterStakerData = await snapshotUserStakingData(sa.default)
            expect(afterStakerData.stakedBalance, "staker stkRWD after").to.eq(stakedAmount)
            expect(afterStakerData.votes, "staker votes after").to.eq(0)

            const afterDelegateData = await snapshotUserStakingData(sa.dummy1)
            expect(afterDelegateData.stakedBalance, "delegate stkRWD after").to.eq(delegateStakedAmount)
            expect(afterDelegateData.votes, "delegate votes after").to.eq(stakedAmount)

            const afterDelegatesDelegateData = await snapshotUserStakingData(sa.dummy2)
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

            const stakerDataBefore = await snapshotUserStakingData(sa.default)
            expect(stakerDataBefore.votes).to.equal(stakedAmount)
            expect(stakerDataBefore.stakedBalance).to.equal(stakedAmount)
            const delegateDataBefore = await snapshotUserStakingData(sa.dummy1)
            expect(delegateDataBefore.votes).to.equal(0)

            const tx = await stakedToken.delegate(sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.default.address, sa.dummy1.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, stakedAmount, 0)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, 0, stakedAmount)

            const stakerDataAfter = await snapshotUserStakingData(sa.default)
            expect(stakerDataAfter.votes).to.equal(0)
            expect(stakerDataAfter.stakedBalance).to.equal(stakedAmount)
            const delegateDataAfter = await snapshotUserStakingData(sa.dummy1)
            expect(delegateDataAfter.votes).to.equal(stakedAmount)
            expect(delegateDataAfter.stakedBalance).to.equal(0)
        })
        it("should change by staker from 1 to 2", async () => {
            await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)

            const stakerDataBefore = await snapshotUserStakingData(sa.default)
            expect(stakerDataBefore.votes).to.equal(0)
            const oldDelegateDataBefore = await snapshotUserStakingData(sa.dummy1)
            expect(oldDelegateDataBefore.votes).to.equal(stakedAmount)
            const newDelegateDataBefore = await snapshotUserStakingData(sa.dummy2)
            expect(newDelegateDataBefore.votes).to.equal(0)

            const tx = await stakedToken.delegate(sa.dummy2.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.dummy1.address, sa.dummy2.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, stakedAmount, 0)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy2.address, 0, stakedAmount)

            const stakerDataAfter = await snapshotUserStakingData(sa.default)
            expect(stakerDataAfter.votes).to.equal(0)
            expect(stakerDataAfter.stakedBalance).to.equal(stakedAmount)
            const oldDelegateDataAfter = await snapshotUserStakingData(sa.dummy1)
            expect(oldDelegateDataAfter.votes).to.equal(0)
            expect(oldDelegateDataAfter.stakedBalance).to.equal(0)
            const newDelegateDataAfter = await snapshotUserStakingData(sa.dummy2)
            expect(newDelegateDataAfter.votes).to.equal(stakedAmount)
            expect(newDelegateDataAfter.stakedBalance).to.equal(0)
        })
        it("should change by staker from delegate to self", async () => {
            await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)

            const stakerDataBefore = await snapshotUserStakingData(sa.default)
            expect(stakerDataBefore.votes).to.equal(0)
            expect(stakerDataBefore.stakedBalance).to.equal(stakedAmount)
            const delegateDataBefore = await snapshotUserStakingData(sa.dummy1)
            expect(delegateDataBefore.votes).to.equal(stakedAmount)

            const tx = await stakedToken.delegate(sa.default.address)
            await expect(tx).to.emit(stakedToken, "DelegateChanged").withArgs(sa.default.address, sa.dummy1.address, sa.default.address)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.default.address, 0, stakedAmount)
            await expect(tx).to.emit(stakedToken, "DelegateVotesChanged").withArgs(sa.dummy1.address, stakedAmount, 0)

            const stakerDataAfter = await snapshotUserStakingData(sa.default)
            expect(stakerDataAfter.votes).to.equal(stakedAmount)
            expect(stakerDataAfter.stakedBalance).to.equal(stakedAmount)
            expect(stakerDataAfter.stakedBalance).to.equal(stakedAmount)
            const delegateDataAfter = await snapshotUserStakingData(sa.dummy1)
            expect(delegateDataAfter.votes).to.equal(0)
            expect(delegateDataAfter.stakedBalance).to.equal(0)
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
                const multiplier = 60 // 1.6x
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
                it("quest with 2x multiplier", async () => {
                    await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 100, deployTime.add(ONE_WEEK.mul(12)))
                })
                it("quest with 1 day expiry", async () => {
                    const currentBlock = await sa.default.signer.provider.getBlock("latest")
                    const currentTime = BN.from(currentBlock.timestamp)
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
                    ).to.revertedWith("Quest multiplier too large > 2x")
                })
                it("with > 2x multiplier", async () => {
                    await expect(
                        stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 101, deployTime.add(ONE_WEEK)),
                    ).to.revertedWith("Quest multiplier too large > 2x")
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
                const block = await sa.default.signer.provider.getBlock("latest")
                const tx = await stakedToken.connect(sa.governor.signer).expireQuest(id)

                await expect(tx).to.emit(stakedToken, "QuestExpired").withArgs(id)

                const quest = await stakedToken.getQuest(id)
                expect(quest.status).to.eq(QuestStatus.EXPIRED)
                expect(quest.expiry).to.lt(expiry)
                expect(quest.expiry).to.eq(block.timestamp + 1)
            })
            it("should allow governor to expire a permanent quest", async () => {
                const tx0 = await stakedToken.connect(sa.governor.signer).addQuest(QuestType.PERMANENT, 10, expiry)
                const receipt = await tx0.wait()
                const { id } = receipt.events[0].args
                const block = await sa.default.signer.provider.getBlock("latest")
                const tx = await stakedToken.connect(sa.governor.signer).expireQuest(id)

                await expect(tx).to.emit(stakedToken, "QuestExpired").withArgs(id)

                const quest = await stakedToken.getQuest(id)
                expect(quest.status).to.eq(QuestStatus.EXPIRED)
                expect(quest.expiry).to.lt(expiry)
                expect(quest.expiry).to.eq(block.timestamp + 1)
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
            })
            it("should allow governor to start season after 39 weeks", async () => {
                await increaseTime(ONE_WEEK.mul(39).add(60))
                const tx = await stakedToken.connect(sa.governor.signer).startNewQuestSeason()
                await expect(tx).to.emit(stakedToken, "QuestSeasonEnded")
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
        context("complete quest", () => {
            let currentTime
            before(async () => {
                const block = await sa.default.signer.provider.getBlock("latest")
                currentTime = BN.from(block.timestamp)
                const expiry = currentTime.add(ONE_WEEK.mul(12))
                await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, expiry)
                await stakedToken.connect(sa.governor.signer).addQuest(QuestType.SEASONAL, 10, expiry)
            })
            it("should allow a user to complete a seasonal quest with verification", async () => {
                // TODO helper function to sign quests
                // await stakedToken.connect(sa.dummy2.signer).completeQuest()
            })
        })

        it("should increase a users voting power when they complete said quest")
        it("should allow an admin to end the quest season")
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
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, simpleToExactAmount(10000))
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
            })
            it("should start cooldown", async () => {
                const tx = await stakedToken.startCooldown()
                await expect(tx).to.emit(stakedToken, "Cooldown").withArgs(sa.default.address)
                const block = await sa.default.signer.provider.getBlock("latest")
                expect(await stakedToken.stakersCooldowns(sa.default.address), "staked cooldown start").to.eq(block.timestamp)
            })
            it("should cooldown again after it has already started", async () => {
                // First cooldown
                await stakedToken.startCooldown()
                await increaseTime(ONE_DAY)

                // Second cooldown
                await stakedToken.startCooldown()

                const block = await sa.default.signer.provider.getBlock("latest")
                expect(await stakedToken.stakersCooldowns(sa.default.address), "staker cooldown after").to.eq(block.timestamp)
            })
            it("should fail when nothing staked", async () => {
                await expect(stakedToken.connect(sa.dummy1.signer).startCooldown()).to.revertedWith("INVALID_BALANCE_ON_COOLDOWN")
            })
            it("should proportionally reset cooldown when staking in cooldown", async () => {
                await stakedToken.startCooldown()
                const stakerCooldownBefore = await stakedToken.stakersCooldowns(sa.default.address)
                const blockBefore = await sa.default.signer.provider.getBlock("latest")
                expect(await stakedToken.stakersCooldowns(sa.default.address), "staker cooldown after 1st stake").to.eq(
                    blockBefore.timestamp,
                )

                await increaseTime(ONE_DAY.mul(5))

                // stake 10x the last stake
                const secondStakeAmount = simpleToExactAmount(3000)
                await stakedToken["stake(uint256,address)"](secondStakeAmount, sa.default.address)

                const blockAfter = await sa.default.signer.provider.getBlock("latest")
                const currentTimestamp = BN.from(blockAfter.timestamp)
                const secondsAlreadyCooled = currentTimestamp.sub(stakerCooldownBefore)
                const newStakedAmount = stakedAmount.add(secondStakeAmount)
                const weightedSecondsAlreadyCooled = secondsAlreadyCooled.mul(stakedAmount).div(newStakedAmount)

                const stakerCooldownAfter = await stakedToken.stakersCooldowns(sa.default.address)

                // new start cooldown = current time - (time already cooled * first staked amount / (first + second staked amount))
                // current time - (5 days * 3000 / (7000 + 3000))
                expect(stakerCooldownAfter, "staker cooldown after 2nd stake").to.eq(currentTimestamp.sub(weightedSecondsAlreadyCooled))
            })
        })
        context("with delegate", () => {
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.dummy1.address)
            })
            it("should fail by delegate", async () => {
                await expect(stakedToken.connect(sa.dummy1.address).startCooldown()).to.revertedWith("INVALID_BALANCE_ON_COOLDOWN")
            })
        })
    })

    context("withdraw", () => {
        const stakedAmount = simpleToExactAmount(2000)
        const withdrawAmount = simpleToExactAmount(100)
        context("should not be possible", () => {
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
            })
            it("with zero balance", async () => {
                await stakedToken.startCooldown()
                await increaseTime(ONE_DAY.mul(7).add(60))
                await expect(stakedToken.withdraw(0, sa.default.address, false)).to.revertedWith("INVALID_ZERO_AMOUNT")
            })
            it("before cooldown started", async () => {
                await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false)).to.revertedWith("UNSTAKE_WINDOW_FINISHED")
            })
            it("before cooldown finished", async () => {
                await stakedToken.startCooldown()
                await increaseTime(ONE_DAY.mul(7).sub(60))
                await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false)).to.revertedWith("INSUFFICIENT_COOLDOWN")
            })
            it("after the unstake window", async () => {
                await stakedToken.startCooldown()
                await increaseTime(ONE_DAY.mul(9).add(60))
                await expect(stakedToken.withdraw(withdrawAmount, sa.default.address, false)).to.revertedWith("UNSTAKE_WINDOW_FINISHED")
            })
            it("when withdrawing too much", async () => {
                await stakedToken.startCooldown()
                await increaseTime(ONE_DAY.mul(7).add(60))
                await expect(stakedToken.withdraw(stakedAmount.add(1), sa.default.address, false)).to.reverted
            })
        })
        context("with no delegate, after cooldown and in unstake window", () => {
            let beforeData: UserStakingData
            beforeEach(async () => {
                stakedToken = await redeployStakedToken()
                await rewardToken.connect(sa.default.signer).approve(stakedToken.address, stakedAmount)
                await stakedToken["stake(uint256,address)"](stakedAmount, sa.default.address)
                await stakedToken.startCooldown()

                await increaseTime(ONE_DAY.mul(7).add(60))

                beforeData = await snapshotUserStakingData(sa.default)
            })
            it("partial withdraw not including fee", async () => {
                const tx2 = await stakedToken.withdraw(withdrawAmount, sa.default.address, false)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, withdrawAmount)

                const afterData = await snapshotUserStakingData(sa.default)
                // TODO calculate withdraw fee
                // expect(afterData.stakedBalance).to.eq(beforeData.stakedBalance.sub(withdrawAmount))
                // expect(afterData.votes).to.eq(beforeData.votes.sub(withdrawAmount))
                expect(afterData.rewardsBalance, "staker rewards after").to.eq(beforeData.rewardsBalance.add(withdrawAmount))
                expect(afterData.stakersCooldown, "staker cooldown after").to.eq(beforeData.stakersCooldown)
            })

            it("full withdraw including fee", async () => {
                const tx = await stakedToken.startCooldown()
                await expect(tx).to.emit(stakedToken, "Cooldown").withArgs(sa.default.address)
                const block = await sa.default.signer.provider.getBlock("latest")
                expect(await stakedToken.stakersCooldowns(sa.default.address), "staked cooldown start").to.eq(block.timestamp)

                await increaseTime(ONE_DAY.mul(7).add(60))

                const tx2 = await stakedToken.withdraw(stakedAmount, sa.default.address, true)
                await expect(tx2).to.emit(stakedToken, "Withdraw").withArgs(sa.default.address, sa.default.address, stakedAmount)

                const afterData = await snapshotUserStakingData(sa.default)
                expect(afterData.stakedBalance, "staker stkRWD after").to.eq(0)
                expect(afterData.votes, "staker votes after").to.eq(0)
                // TODO calculate withdraw fee
                // expect(afterData.rewardsBalance, "staker rewards after").to.eq(beforeData.rewardsBalance.add(stakedAmount))
                expect(afterData.stakersCooldown, "staker cooldown after").to.eq(0)
            })
            it("not reset the cooldown timer unless all is all unstaked")
            it("apply a redemption fee which is added to the pendingRewards from the rewards contract")
            it("distribute these pendingAdditionalReward with the next notification")
        })
    })

    context("interacting from a smart contract", () => {
        // Will need to create a sample solidity mock wrapper that has the ability to deposit and withdraw
        it("should not be possible to stake and withdraw from a smart contract")
    })

    context("updating lastAction timestamp", () => {
        it("should be triggered after every WRITE action on the contract")
    })
})
