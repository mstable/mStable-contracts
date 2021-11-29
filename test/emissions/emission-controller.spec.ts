import { Wallet } from "@ethersproject/wallet"
import { DEAD_ADDRESS, ONE_HOUR, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BN, simpleToExactAmount } from "@utils/math"
import {
    AssetProxy__factory,
    EmissionsController,
    EmissionsController__factory,
    MockERC20,
    MockERC20__factory,
    MockNexus,
    MockNexus__factory,
    MockRewardsDistributionRecipient,
    MockRewardsDistributionRecipient__factory,
    MockStakingContract,
    MockStakingContract__factory,
} from "types/generated"
import { currentWeekEpoch, increaseTime, getTimestamp, increaseTimeTo, startWeek, startCurrentWeek, weekEpoch } from "@utils/time"
import { Account } from "types/common"

const defaultConfig = {
    A: -166000000000000,
    B: 168479942061125,
    C: -168479942061125,
    D: 166000000000000,
    EPOCHS: 312,
}
const INITIAL_DIALS_NO = 3

interface VoteHistoryExpectation {
    dialId: number
    votesNo: number
    lastVote: number | BN
    lastEpoch: number
}

/**
 * Expectations for the last vote casted by the Dial
 *
 * @param {VoteHistoryExpectation} {dialId, votesNo, lastVote, lastEpoch}
 * @return {votesHistory} 
 */
const expectDialVotesHistoryForDial = async (emissionsController: EmissionsController, { dialId, votesNo, lastVote, lastEpoch }: VoteHistoryExpectation) => {
    const votesHistory = await emissionsController.getDialVoteHistory(dialId)
    // Expectations for the last vote
    expect(votesHistory, "voteHistory").length(votesNo)
    expect(votesHistory[votesHistory.length - 1][0], "vote").to.eq(lastVote)
    expect(votesHistory[votesHistory.length - 1][1], "epoch").to.eq(lastEpoch)
    return votesHistory[votesHistory.length - 1]
}
const expectDialVotesHistoryForDials = async (emissionsController: EmissionsController, votesHistoryExpectations: Array<VoteHistoryExpectation> = []) => {
    const expectations = Promise.all(votesHistoryExpectations.map(
        (voteHistory) =>
            expectDialVotesHistoryForDial(emissionsController, {
                ...voteHistory,
                lastVote: voteHistory.lastVote > 0 ? simpleToExactAmount(voteHistory.lastVote) : voteHistory.lastVote
            })
    ))
    return await expectations;
}
const expectDialVotesHistoryWithoutChangeOnWeights = async (emissionsController: EmissionsController, votesHistoryExpectations: Array<VoteHistoryExpectation> = [], lastEpoch: number) =>
    expectDialVotesHistoryForDials(emissionsController, votesHistoryExpectations.map(
        (voteHistory) => ({ ...voteHistory, votesNo: voteHistory.votesNo + 1, lastEpoch }))
    )


/**
 * Mocks EmissionsController.topLineEmission function.
 *
 * @param {number} epochDelta - The number of epochs to move forward.
 * @return {emissionForEpoch}  {BN} - The amount of emission for the given epoch, with 18 decimal numbers ex. 165461e18.
 */
const calcWeeklyReward = (epochDelta: number): BN => {
    const { A, B, C, D, EPOCHS } = defaultConfig
    const inputScale = simpleToExactAmount(1, 3)
    const calculationScale = 12

    const x = BN.from(epochDelta).mul(simpleToExactAmount(1, calculationScale)).div(BN.from(EPOCHS))
    const a = BN.from(A)
        .mul(inputScale)
        .mul(x.pow(3))
        .div(simpleToExactAmount(1, calculationScale * 3))
    const b = BN.from(B)
        .mul(inputScale)
        .mul(x.pow(2))
        .div(simpleToExactAmount(1, calculationScale * 2))
    const c = BN.from(C).mul(inputScale).mul(x).div(simpleToExactAmount(1, calculationScale))
    const d = BN.from(D).mul(inputScale)
    return a.add(b).add(c).add(d).mul(simpleToExactAmount(1, 6))
}
/**
 * Calculates the amount of emission for the given epoch,
 * it retrieves the lastEpoch from the instance of EmissionsController.
 *
 * @param {EmissionsController} emissionsController
 * @param {number} [epoch=1]
 * @return {emissionForEpoch}  {BN} - The amount of emission for the given epoch.
 */
const nextRewardAmount = async (emissionsController: EmissionsController, epoch = 1): Promise<BN> => {
    const [startEpoch, lastEpoch] = await emissionsController.epochs()
    return calcWeeklyReward(lastEpoch - startEpoch + epoch)
}
/**
 * Expectations for the EmissionsController.topLineEmission function.
 *
 * @param {EmissionsController} emissionsController
 * @param {number} startingEpoch - The starting epoch.
 * @param {number} deltaEpoch- The delta epoch.
 */
const expectTopLineEmissionForEpoch = (emissionsController: EmissionsController, startingEpoch: number) => async (deltaEpoch: number) => {
    const emissionForEpoch = await emissionsController.topLineEmission(startingEpoch + deltaEpoch)
    const expectedEmissionAmount = await nextRewardAmount(emissionsController, deltaEpoch)
    expect(emissionForEpoch).eq(expectedEmissionAmount)
}

describe("EmissionsController", async () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let staking1: MockStakingContract
    let staking2: MockStakingContract
    let rewardToken: MockERC20
    let dials: MockRewardsDistributionRecipient[]
    let emissionsController: EmissionsController
    const totalRewardsSupply = simpleToExactAmount(100000000)
    const totalRewards = simpleToExactAmount(29400963)
    /**
     * Deploys the emission controller, staking contracts, dials and transfers MTA to the Emission Controller contract.
     * 
     * @return {Promise}  {Promise<void>}
     */
    const deployEmissionsController = async (): Promise<void> => {

        // staking contracts
        staking1 = await new MockStakingContract__factory(sa.default.signer).deploy()
        staking2 = await new MockStakingContract__factory(sa.default.signer).deploy()

        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, totalRewardsSupply)

        // Deploy dials
        const deployDial = () => new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(rewardToken.address, DEAD_ADDRESS)

        dials = await Promise.all([...Array(INITIAL_DIALS_NO).keys()].map(deployDial))
        const dialAddresses = dials.map((dial) => dial.address)

        // Deploy logic contract
        const emissionsControllerImpl = await new EmissionsController__factory(sa.default.signer).deploy(
            nexus.address,
            rewardToken.address,
            defaultConfig,
        )

        // Deploy proxy and initialize
        const initializeData = emissionsControllerImpl.interface.encodeFunctionData("initialize", [
            dialAddresses,
            [0, 0, 0],
            [true, true, false],
            [staking1.address, staking2.address],
        ])
        const proxy = await new AssetProxy__factory(sa.default.signer).deploy(emissionsControllerImpl.address, DEAD_ADDRESS, initializeData)
        emissionsController = new EmissionsController__factory(sa.default.signer).attach(proxy.address)

        // Transfer MTA into the Emissions Controller
        await rewardToken.transfer(emissionsController.address, totalRewards)

        await staking1.setGovernanceHook(emissionsController.address)
        await staking2.setGovernanceHook(emissionsController.address)
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        console.log(`User 1 ${sa.dummy1.address}`)
        console.log(`User 2 ${sa.dummy2.address}`)
        console.log(`User 3 ${sa.dummy3.address}`)

        // Set the time to Thursday, 01:00am UTC time which is just after the start of the distribution period
        const currentTime = await getTimestamp()
        const startCurrentPeriod = startWeek(currentTime)
        const earlyNextPeriod = startCurrentPeriod.add(ONE_WEEK).add(ONE_HOUR)
        const nextEpoch = weekEpoch(earlyNextPeriod)
        await increaseTimeTo(earlyNextPeriod)
        console.log(
            `Time at start ${new Date(
                earlyNextPeriod.toNumber() * 1000,
            ).toUTCString()}, epoch weeks ${nextEpoch}, unix time seconds ${earlyNextPeriod}`,
        )
    })
    describe("deploy and initialize", () => {
        before(async () => {
            await deployEmissionsController()
            console.log(`Emissions Controller contract size ${EmissionsController__factory.bytecode.length}`)
        })
        it("Immutable variables set on deployment", async () => {
            expect(await emissionsController.nexus(), "nexus").to.eq(nexus.address)
            expect(await emissionsController.REWARD_TOKEN(), "rewardToken").to.eq(rewardToken.address)
        })
        it("Dials set on initialization", async () => {
            const dial1 = await emissionsController.dials(0)
            expect(dial1.recipient, "dial 1 recipient").to.eq(dials[0].address)
            expect(dial1.notify, "dial 1 notify").to.eq(true)

            const dial3 = await emissionsController.dials(2)
            expect(dial3.recipient, "dial 3 recipient").to.eq(dials[2].address)
            expect(dial3.notify, "dial 3 notify").to.eq(false)
        })
        it("epoch set on initialization", async () => {
            const [startEpoch, lastEpoch] = await emissionsController.epochs()
            const e = await currentWeekEpoch()
            expect(startEpoch, "start epoch").to.eq(e.add(1))
            expect(lastEpoch, "last epoch").to.eq(e.add(1))
        })
        it("transfer MTA on initialization", async () => {
            expect(await rewardToken.balanceOf(emissionsController.address), "ec rewards bal").to.eq(totalRewards)
        })
        it("Staking contracts set on initialization", async () => {
            expect(await emissionsController.stakingContracts(0), "staking contract 1").to.eq(staking1.address)
            expect(await emissionsController.stakingContracts(1), "staking contract 2").to.eq(staking2.address)
        })
        context("should fail when", () => {
            it("nexus is zero", async () => {
                const tx = new EmissionsController__factory(sa.default.signer).deploy(ZERO_ADDRESS, rewardToken.address, defaultConfig)
                await expect(tx).to.revertedWith("Nexus address is zero")
            })
            it("rewards token is zero", async () => {
                const tx = new EmissionsController__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS, defaultConfig)
                await expect(tx).to.revertedWith("Reward token address is zero")
            })
        })
        context("initialize recipients and notifies", () => {
            before(async () => {
                emissionsController = await new EmissionsController__factory(sa.default.signer).deploy(
                    nexus.address,
                    rewardToken.address,
                    defaultConfig,
                )
            })
            const stakingContract1 = Wallet.createRandom()
            const stakingContract2 = Wallet.createRandom()
            const tests: {
                desc: string
                dialIndexes: number[]
                caps: number[]
                notifies: boolean[]
                fixedDistributionAmounts: number[]
                stakingContracts: string[]
            }[] = [
                {
                    desc: "recipients empty",
                    dialIndexes: [],
                    caps: [],
                    notifies: [true, false],
                    fixedDistributionAmounts: [0, 0],
                    stakingContracts: [stakingContract1.address, stakingContract2.address],
                },
                {
                    desc: "notifies empty",
                    dialIndexes: [0, 1],
                    caps: [0, 0],
                    notifies: [],
                    fixedDistributionAmounts: [0, 0],
                    stakingContracts: [stakingContract1.address, stakingContract2.address],
                },
                {
                    desc: "different lengths",
                    dialIndexes: [0],
                    caps: [0, 0],
                    notifies: [true, false],
                    fixedDistributionAmounts: [0, 0],
                    stakingContracts: [stakingContract1.address, stakingContract2.address],
                },
            ]
            // tests initialize permutations
            tests.forEach((test) => {
                it(test.desc, async () => {
                    const recipients = test.dialIndexes.map((i) => dials[i].address)
                    const tx = emissionsController.initialize(recipients, test.caps, test.notifies, test.stakingContracts)
                    await expect(tx).to.revertedWith("Initialize args mismatch")
                })
            })
            it("First staking contract is zero", async () => {
                const recipients = dials.map((d) => d.address)
                const tx = emissionsController.initialize(recipients, [0, 0, 0], [true, true, false], [ZERO_ADDRESS, staking2.address])
                await expect(tx).to.revertedWith("Staking contract address is zero")
            })
            it("Second staking contract is zero", async () => {
                const recipients = dials.map((d) => d.address)
                const tx = emissionsController.initialize(recipients, [0, 0, 0], [true, true, false], [staking1.address, ZERO_ADDRESS])
                await expect(tx).to.revertedWith("Staking contract address is zero")
            })
        })
    })
    describe("calling view functions", () => {
        describe("fetch weekly emissions", () => {
            let startingEpoch
            let expectTopLineEmissions
            before(async () => {
                await deployEmissionsController()
                    ;[startingEpoch] = await emissionsController.epochs()
                expectTopLineEmissions = expectTopLineEmissionForEpoch(emissionsController, startingEpoch)
            })
            it("fails fetching an smaller epoch than deployed time", async () => {
                const tx = emissionsController.topLineEmission(startingEpoch - 1)
                await expect(tx).to.revertedWith("Wrong epoch number")
            })
            it("fails fetching same epoch as deployed time", async () => {
                const tx = emissionsController.topLineEmission(startingEpoch)
                await expect(tx).to.revertedWith("Wrong epoch number")
            })
            it("fetches week 1", async () => {
                expectTopLineEmissions(1) // ~= 165,461,725,488,656,000
            })
            it("fetches week 8 - Two months", async () => {
                expectTopLineEmissions(8)// ~= 161,787,972,249,455,000
            })
            it("fetches week 100 - one year eleven months", async () => {
                expectTopLineEmissions(100) // ~= 123,842,023,609,600,000
            })
            it("fetches week 311 - six years, pre-last epoch", async () => {
                expectTopLineEmissions(311) // ~= 1,052,774,388,460,220
            })
            it("fetches week 312 - six years, last epoch", async () => {
                expectTopLineEmissions(312) // = 0
            })
            it("fails fetching week 313 - six years + one week", async () => {
                const tx = emissionsController.topLineEmission(startingEpoch + 313)
                await expect(tx).to.revertedWith("Wrong epoch number")
            })
            it("fails fetching week 5200 - Ten years", async () => {
                const tx = emissionsController.topLineEmission(startingEpoch + 5200)
                await expect(tx).to.revertedWith("Wrong epoch number")
            })
        })
        describe("gets a dials weighted votes  ", () => {
            let startingEpoch
            before(async () => {
                await deployEmissionsController()
                    ;[startingEpoch] = await emissionsController.epochs()
            })
            it("gets initial dials vote history ", async () => {
                [...Array(INITIAL_DIALS_NO).keys()].forEach(async (dialId) => {
                    const voteHistory = await emissionsController.getDialVoteHistory(dialId)
                    const [[votes, epoch]] = voteHistory;
                    expect(voteHistory, "voteHistory").length(1)
                    expect(votes, "votes").to.eq(0)
                    // Starting epoch is one week ahead of deployment, EmissionController.initialize
                    expect(epoch + 1, "epoch").to.eq(startingEpoch)
                })

            })
        })
    })
    describe("using admin functions", () => {
        describe("add dial", () => {
            let newDial: MockRewardsDistributionRecipient
            beforeEach(async () => {
                await deployEmissionsController()

                newDial = await new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(rewardToken.address, DEAD_ADDRESS)
                dials.push(newDial)
            })
            it("governor adds new dial in the first launch week", async () => {
                const tx = await emissionsController.connect(sa.governor.signer).addDial(newDial.address, 0, true)
                await expect(tx).to.emit(emissionsController, "AddedDial").withArgs(3, newDial.address)
                const savedDial = await emissionsController.dials(3)
                expect(savedDial.recipient, "recipient").to.eq(newDial.address)
                expect(savedDial.notify, "notify").to.eq(true)
                expect(savedDial.cap, "staking").to.eq(0)
                const voteHistory = await emissionsController.getDialVoteHistory(3)
                expect(voteHistory, "number votes").to.lengthOf(1)
                const epochExpected = (await currentWeekEpoch()).add(1)
                expect(voteHistory[0].epoch, "epoch").to.eq(epochExpected)
                expect(voteHistory[0].votes, "votes").to.eq(0)
            })
            it("governor adds new dial in the second launch week", async () => {
                await increaseTime(ONE_WEEK)
                const tx = await emissionsController.connect(sa.governor.signer).addDial(newDial.address, 0, true)
                await expect(tx).to.emit(emissionsController, "AddedDial").withArgs(3, newDial.address)
                const savedDial = await emissionsController.dials(3)
                expect(savedDial.recipient, "recipient").to.eq(newDial.address)
                expect(savedDial.notify, "notify").to.eq(true)
                expect(savedDial.cap, "staking").to.eq(0)
                const voteHistory = await emissionsController.getDialVoteHistory(3)
                expect(voteHistory, "number votes").to.lengthOf(1)
                const epochExpected = await currentWeekEpoch()
                expect(voteHistory[0].epoch, "epoch").to.eq(epochExpected)
                expect(voteHistory[0].votes, "votes").to.eq(0)
            })
            // TODO add new dial after first week of rewards has been processed.
            it("fail to add recipient with zero address", async () => {
                const tx = emissionsController.connect(sa.governor.signer).addDial(ZERO_ADDRESS, 0, true)
                await expect(tx).to.revertedWith("Dial address is zero")
            })
            it("fail to add existing dial", async () => {
                const tx = emissionsController.connect(sa.governor.signer).addDial(dials[0].address, 0, true)
                await expect(tx).to.revertedWith("Dial already exists")
            })
            it("Default user fails to add new dial", async () => {
                const tx = emissionsController.addDial(newDial.address, 0, true)
                await expect(tx).to.revertedWith("Only governor can execute")
            })
        })
        describe("update dial", () => {
            const user1Staking1Votes = simpleToExactAmount(100)
            const user2Staking1Votes = simpleToExactAmount(200)
            const user3Staking1Votes = simpleToExactAmount(300)
            let dial1
            let dial2
            let dial3
            beforeEach(async () => {
                await deployEmissionsController()
                await increaseTime(ONE_WEEK)

                await staking1.setVotes(sa.dummy1.address, user1Staking1Votes)
                await staking1.setVotes(sa.dummy2.address, user2Staking1Votes)
                await staking1.setVotes(sa.dummy3.address, user3Staking1Votes)

                // User 1 puts 100 votes to dial 1
                await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])

                // User 2 puts 200 votes to dial 2
                await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])

                // User 3 puts 300 votes to dial 3
                await emissionsController.connect(sa.dummy3.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
            })
            it("Governor disables dial 1 with votes", async () => {
                expect((await emissionsController.dials(0)).disabled, "dial 1 disabled before").to.equal(false)  
                const tx = await emissionsController.connect(sa.governor.signer).updateDial(0, true)
                await expect(tx).to.emit(emissionsController, "UpdatedDial").withArgs(0, true)
                expect((await emissionsController.dials(0)).disabled, "dial 1 disabled after").to.equal(true)
                await increaseTime(ONE_WEEK)

                const nextEpochEmission = await nextRewardAmount(emissionsController)
                const tx2 = await emissionsController.calculateRewards()

                const adjustedDial2 = nextEpochEmission.mul(200).div(500)
                const adjustedDial3 = nextEpochEmission.mul(300).div(500)
                await expect(tx2).to.emit(emissionsController, "PeriodRewards").withArgs([0, adjustedDial2, adjustedDial3])
            })
            it("Governor reenables dial", async () => {
                const dialId = 0;
                await emissionsController.connect(sa.governor.signer).updateDial(dialId, true)

                await increaseTime(ONE_WEEK)
                await emissionsController.calculateRewards()
                await increaseTime(ONE_WEEK.add(60))

                // Reenable dial 1
                const tx = await emissionsController.connect(sa.governor.signer).updateDial(dialId, false)
                await expect(tx).to.emit(emissionsController, "UpdatedDial").withArgs(dialId, false)
                expect((await emissionsController.dials(0)).disabled, "dial 1 reenabled after").to.equal(false)

                const nextEpochEmission = await nextRewardAmount(emissionsController)
                const tx2 = await emissionsController.calculateRewards()

                dial1 = nextEpochEmission.mul(100).div(600)
                dial2 = nextEpochEmission.mul(200).div(600)
                dial3 = nextEpochEmission.mul(300).div(600)
                await expect(tx2).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])
            })
            it("Governor fails to disable invalid 4th dial", async () => {
                const tx = emissionsController.connect(sa.governor.signer).updateDial(3, true)
                await expect(tx).to.revertedWith("Invalid dial id")
            })
            it("Default user fails to update dial", async () => {
                const tx = emissionsController.updateDial(1, true)
                await expect(tx).to.revertedWith("Only governor can execute")
            })
        })
        describe("adding staking contract", () => {
            let newStakingContract: MockStakingContract
            before(async () => {
                await deployEmissionsController()

                newStakingContract = await new MockStakingContract__factory(sa.default.signer).deploy()
            })
            context("should fail when", () => {
                it("Only governor", async () => {
                    const tx = emissionsController.addStakingContract(newStakingContract.address)

                    await expect(tx).to.revertedWith("Only governor can execute")
                })
                it("staking contract already exists", async () => {
                    const tx = emissionsController.connect(sa.governor.signer).addStakingContract(staking1.address)

                    await expect(tx).to.revertedWith("StakingContract already exists")
                })
                it("staking contract is zero", async () => {
                    const tx = emissionsController.connect(sa.governor.signer).addStakingContract(ZERO_ADDRESS)

                    await expect(tx).to.revertedWith("Staking contract address is zero")
                })
            })
            it("should add staking contract", async () => {
                const tx = await emissionsController.connect(sa.governor.signer).addStakingContract(newStakingContract.address)

                await expect(tx).to.emit(emissionsController, "AddStakingContract").withArgs(newStakingContract.address)

                const currentTime = await getTimestamp()
                expect(await emissionsController.stakingContractAddTime(newStakingContract.address), "add timestamp").to.gte(currentTime)
                expect(await emissionsController.stakingContracts(2), "add to staking contract array").to.eq(newStakingContract.address)
            })
        })
    })
    describe("donating", () => {
        const user1Staking1Votes = simpleToExactAmount(100)
        const user1Staking2Votes = simpleToExactAmount(200)
        const user2Staking1Votes = simpleToExactAmount(600)
        const user3Staking1Votes = simpleToExactAmount(300)
        beforeEach(async () => {
            await deployEmissionsController()

            await rewardToken.approve(emissionsController.address, totalRewardsSupply)
            await staking1.setVotes(sa.dummy1.address, user1Staking1Votes)
            await staking2.setVotes(sa.dummy1.address, user1Staking2Votes)
            await staking1.setVotes(sa.dummy2.address, user2Staking1Votes)
            await staking1.setVotes(sa.dummy3.address, user3Staking1Votes)
            await increaseTime(ONE_WEEK)
        })
        context("fail to donate when", () => {
            it("No dial ids or amounts", async () => {
                const tx = emissionsController.donate([], [])
                await expect(tx).to.revertedWith("Invalid inputs")
            })
            it("No dial ids but amounts", async () => {
                const tx = emissionsController.donate([], [100])
                await expect(tx).to.revertedWith("Invalid inputs")
            })
            it("No amounts but dials", async () => {
                const tx = emissionsController.donate([0], [])
                await expect(tx).to.revertedWith("Invalid inputs")
            })
            it("Less dial ids than amounts", async () => {
                const tx = emissionsController.donate([0], [100, 200])
                await expect(tx).to.revertedWith("Invalid inputs")
            })
            it("Less amounts than dials", async () => {
                const tx = emissionsController.donate([0, 1, 2], [100, 200])
                await expect(tx).to.revertedWith("Invalid inputs")
            })
            it("first dial is invalid", async () => {
                const tx = emissionsController.donate([3], [100])
                await expect(tx).to.revertedWith("Invalid dial id")
            })
        })
        context("User 1 80/20 votes to dial 1 & 2, User 2 50/50 votes to dial 2 & 3", () => {
            // 80% of User 1's 300 votes
            let dial1
            // 20% of User 1's 300 votes + 50% of User 2's 600 votes
            let dial2
            // 50% of User 2's 600 votes
            let dial3
            beforeEach(async () => {
                // User 1 splits their 300 votes with 80% to dial 1 and 20% to dial 2
                await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 160 },
                    { dialId: 1, weight: 40 },
                ])
                // User 2 splits their 600 votes with 50% to dial 1 and 50% to dial 2
                await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([
                    { dialId: 1, weight: 100 },
                    { dialId: 2, weight: 100 },
                ])
                await increaseTime(ONE_WEEK)

                const nextEpochEmission = await nextRewardAmount(emissionsController)
                dial1 = nextEpochEmission.mul((300 * 4) / 5).div(900)
                dial2 = nextEpochEmission.mul(300 / 5 + 600 / 2).div(900)
                dial3 = nextEpochEmission.mul(600 / 2).div(900)
            })
            it("donation to dial 1 before rewards calculated", async () => {
                const donationAmount = simpleToExactAmount(100)
                const tx = await emissionsController.donate([0], [donationAmount])

                await expect(tx).to.emit(emissionsController, "DonatedRewards").withArgs(0, donationAmount)
                await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, emissionsController.address, donationAmount)

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(donationAmount)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
            })
            it("donation to dial 1 after rewards calculated", async () => {
                await emissionsController.calculateRewards()

                const donationAmount = simpleToExactAmount(100)
                const tx = await emissionsController.donate([0], [donationAmount])

                await expect(tx).to.emit(emissionsController, "DonatedRewards").withArgs(0, donationAmount)
                await expect(tx).to.emit(rewardToken, "Transfer").withArgs(sa.default.address, emissionsController.address, donationAmount)

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(donationAmount.add(dial1))
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(dial3)
            })
            it("donation to dials 1, 2 and 3 after rewards calculated", async () => {
                await emissionsController.calculateRewards()
                const donationAmounts = [simpleToExactAmount(100), simpleToExactAmount(200), simpleToExactAmount(300)]

                const tx = await emissionsController.donate([0, 1, 2], donationAmounts)

                await expect(tx).to.emit(emissionsController, "DonatedRewards").withArgs(0, donationAmounts[0])
                await expect(tx).to.emit(emissionsController, "DonatedRewards").withArgs(1, donationAmounts[1])
                await expect(tx).to.emit(emissionsController, "DonatedRewards").withArgs(2, donationAmounts[2])
                await expect(tx)
                    .to.emit(rewardToken, "Transfer")
                    .withArgs(sa.default.address, emissionsController.address, simpleToExactAmount(600))

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1.add(donationAmounts[0]))
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2.add(donationAmounts[1]))
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(dial3.add(donationAmounts[2]))
            })
        })
    })
    // TODO - add tests for:
    //        - new epoch, update balances, then calculate (should read most recent)
    //        - updating voteHistory during calculate - [DONE]
    //        - reading voteHistory of NEW dials, and of OLD dials
    //        - dials that go enabled -> disabled and vice versa
    //        - capped dials and vote redistribution
    //          - cap not met (< maxVotes)
    //          - total distribution equal
    describe("calculating rewards", () => {
        const USERS = { "1": { votes: 300 }, "2": { votes: 600 }, "3": { votes: 300 } };
        const user1Staking1Votes = simpleToExactAmount(USERS["1"].votes / 3)
        const user1Staking2Votes = simpleToExactAmount((USERS["1"].votes / 3) * 2)
        const user2Staking1Votes = simpleToExactAmount(USERS["2"].votes)
        const user3Staking1Votes = simpleToExactAmount(USERS["3"].votes)

        beforeEach(async () => {
            await deployEmissionsController()
            await staking1.setVotes(sa.dummy1.address, user1Staking1Votes)
            await staking2.setVotes(sa.dummy1.address, user1Staking2Votes)
            await staking1.setVotes(sa.dummy2.address, user2Staking1Votes)
            await staking1.setVotes(sa.dummy3.address, user3Staking1Votes)
            await increaseTime(ONE_WEEK)

            // Dial's rewards balances
            expect((await emissionsController.dials(0)).balance, "dial 1 balance before").to.eq(0)
            expect((await emissionsController.dials(1)).balance, "dial 2 balance before").to.eq(0)
            expect((await emissionsController.dials(2)).balance, "dial 3 balance before").to.eq(0)

            // User voting power
            expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes before").to.eq(simpleToExactAmount(300))
            expect(await emissionsController.callStatic.getVotes(sa.dummy2.address), "User 2 votes before").to.eq(simpleToExactAmount(600))
            expect(await emissionsController.callStatic.getVotes(sa.dummy3.address), "User 3 votes before").to.eq(simpleToExactAmount(300))
        })
        it("with no weights", async () => {
            const [startingEpoch, lastEpochBefore] = await emissionsController.epochs()
            await increaseTime(ONE_WEEK)

            // Expect initial vote with no weight 
            await expectDialVotesHistoryForDial(emissionsController,{dialId: 0, votesNo: 1, lastVote: 0, lastEpoch: startingEpoch - 1})

            const tx = await emissionsController.calculateRewards()

            await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, 0, 0])

            const [, lastEpochMid] = await emissionsController.epochs()
            expect(lastEpochMid, "last epoch after").to.eq(lastEpochBefore + 1)
            
            // Should increase the vote history after calculateRewards, no weight
            await expectDialVotesHistoryForDial(emissionsController,{dialId: 0, votesNo: 2, lastVote: 0, lastEpoch: lastEpochBefore + 1})

            expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
            expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
            expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)


        })
        it("fails after not waiting a week", async () => {
            await increaseTime(ONE_WEEK)
            await emissionsController.calculateRewards()
            await increaseTime(60) // add 1 minute

            const tx = emissionsController.calculateRewards()
            await expect(tx).to.revertedWith("Must wait for new period")
        })
        context("after change to voting weights", () => {
            context("in first emissions period", () => {
                let lastEpochBefore: number
                let startEpoch: number
                beforeEach(async () => {
                    ;[startEpoch, lastEpochBefore] = await emissionsController.epochs();
                    
                    // Expects initial vote history with no weight
                    [...Array(INITIAL_DIALS_NO).keys()].forEach(
                        async (dialId) => expectDialVotesHistoryForDial(emissionsController,{ dialId, votesNo: 1, lastVote: 0, lastEpoch: startEpoch - 1 }))
                    
                })
                afterEach(async () => {
                    const [, lastEpochAfter] = await emissionsController.epochs()
                    expect(lastEpochAfter, "last epoch after").to.eq(lastEpochBefore + 1)
                })
                it("User 1 all votes to dial 1", async () => {

                    // User 1 gives all 300 votes to dial 1
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                    
                    // Expect dial 1 vote history updated with 300 votes (dialId = n-1) 
                    const dialVoteHistory = { dialId: 0, votesNo: 2, lastVote: simpleToExactAmount(USERS["1"].votes), lastEpoch: startEpoch};
                    await expectDialVotesHistoryForDial(emissionsController,dialVoteHistory)
                    await increaseTime(ONE_WEEK)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Should increase the vote history after calculateRewards, no change on weights
                    await expectDialVotesHistoryForDial(emissionsController,{...dialVoteHistory, votesNo: dialVoteHistory.votesNo + 1,  lastEpoch: dialVoteHistory.lastEpoch + 1 })                    

                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([nextEpochEmission, 0, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(nextEpochEmission)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                it("User 1 all votes to dial 1, User 2 all votes to dial 2", async () => {
                    // User 1 gives all 300 votes to dial 1
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                    // User 2 gives all 600 votes to dial 2
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1) 
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 2, lastVote: USERS["1"].votes, lastEpoch: startEpoch },
                        { dialId: 1, votesNo: 2, lastVote: USERS["2"].votes, lastEpoch: startEpoch },
                        { dialId: 2, votesNo: 1, lastVote: 0, lastEpoch: startEpoch - 1 }];

                    await expectDialVotesHistoryForDials(emissionsController,dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // User 1 has 300 of the 900 votes (1/3)
                    const dial1 = nextEpochEmission.div(3)
                    // User 2 has 600 of the 900 votes (2/3)
                    const dial2 = nextEpochEmission.mul(2).div(3)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                    // Should increase the vote history after calculateRewards, no  change on weights
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController,dialsVoteHistory, startEpoch + 1)

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                it("User 1 50/50 votes to dial 1 & 2, User 2 50/50 votes to dial 1 & 2", async () => {
                    // User 1 splits their 300 votes with 50% to dial 1 and 50% to dial 2
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 100 },
                        { dialId: 1, weight: 100 },
                    ])
                    // User 2 splits their 600 votes with 50% to dial 1 and 50% to dial 2
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([
                        { dialId: 0, weight: 100 },
                        { dialId: 1, weight: 100 },
                    ])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 450 , dial 2 - 450 , dial 3 - 0 (dialId = n-1) 
                    const dial1Votes = USERS["1"].votes * 0.5 + USERS["2"].votes * 0.5
                    const dial2Votes = USERS["1"].votes * 0.5 + USERS["2"].votes * 0.5
                    const dialsVoteHistory = [  
                    { dialId: 0, votesNo: 2, lastVote: dial1Votes, lastEpoch: startEpoch},
                    { dialId: 1, votesNo: 2, lastVote: dial2Votes, lastEpoch: startEpoch},
                    { dialId: 2, votesNo: 1, lastVote: 0, lastEpoch: startEpoch - 1 }];

                    await expectDialVotesHistoryForDials(emissionsController,dialsVoteHistory)                    

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Should increase the vote history after calculateRewards, no change on weights
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController,dialsVoteHistory, startEpoch + 1)

                    // User 1 and 2 split their votes 50/50
                    const dial1 = nextEpochEmission.div(2)
                    const dial2 = nextEpochEmission.div(2)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                it("User 1 20/80 votes to dial 1 & 2, User 2 all votes to dial 3", async () => {
                    // User 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 40 },
                        { dialId: 1, weight: 160 },
                    ])
                    // User 2 gives all 600 votes to dial 3
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    const dial1Votes = USERS["1"].votes * 0.2
                    const dial2Votes = USERS["1"].votes * 0.8
                    const dial3Votes = USERS["2"].votes
                    // Expects dial 1 - 60 , dial 240 - 600 , dial 3 - 600 
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 2, lastVote: dial1Votes, lastEpoch: startEpoch },
                        { dialId: 1, votesNo: 2, lastVote: dial2Votes, lastEpoch: startEpoch },
                        { dialId: 2, votesNo: 2, lastVote: dial3Votes, lastEpoch: startEpoch }];
                    await expectDialVotesHistoryForDials(emissionsController,dialsVoteHistory)     

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1) 
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController,dialsVoteHistory, startEpoch + 1)

                    // User 1 20% of 300 votes
                    const dial1 = nextEpochEmission.mul(USERS["1"].votes).div(5).div(900)
                    // User 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul(USERS["1"].votes).mul(4).div(5).div(900)
                    // User 2 600 votes
                    const dial3 = nextEpochEmission.mul(USERS["2"].votes).div(900)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(dial3)
                })
            })
            context("in second emissions period", () => {
                // Users previous votes
                // User 1 300 20% dial 1, 80% dial 2
                // User 2 600 100% dial 3
                let balDial1Before
                let balDial2Before
                let balDial3Before
                let startEpoch
                beforeEach(async () => {
                    [startEpoch,] = await emissionsController.epochs()

                    // User 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 40 },
                        { dialId: 1, weight: 160 },
                    ])
                    // User 2 gives all 600 votes to dial 2
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    balDial1Before = nextEpochEmission.mul(300).div(5).div(900)
                    balDial2Before = nextEpochEmission.mul(300).mul(4).div(5).div(900)
                    balDial3Before = nextEpochEmission.mul(600).div(900)
                    await emissionsController.calculateRewards()
                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before)
                })
                it("User 1 changes weights to 80/20 dial 1 & 2", async () => {
                    // User 1 splits their 300 votes with 80% to dial 1 and 20% to dial 2
                    // User 2 keeps its 600 votes on dial 3
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 160 },
                        { dialId: 1, weight: 40 },
                    ])
                    await increaseTime(ONE_WEEK)
                    const dialsVoteHistory = [  
                        { dialId: 0, votesNo: 3, lastVote: USERS["1"].votes * .8, lastEpoch: startEpoch + 1},
                        { dialId: 1, votesNo: 3, lastVote: USERS["1"].votes * .2, lastEpoch: startEpoch + 1},
                        { dialId: 2, votesNo: 3, lastVote: USERS["2"].votes, lastEpoch: startEpoch + 1}];
                    await expectDialVotesHistoryForDials(emissionsController,dialsVoteHistory)    


                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()
                    // Expects dial 1 - 240 , dial 2 - 60 , dial 3 - 600 (dialId = n-1) 
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController,dialsVoteHistory, startEpoch + 2)

                    // User 1 80% of 300 votes
                    const dial1 = nextEpochEmission.mul(USERS["1"].votes * .8).div(900)
                    // User 1 20% of 300 votes
                    const dial2 = nextEpochEmission.mul(USERS["1"].votes * .2).div(900)
                    // User 2 600 votes
                    const dial3 = nextEpochEmission.mul(USERS["2"].votes).div(900)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 1 removes 20% to dial 1", async () => {
                    // User 1 gives 80% of their 300 votes to dial 2. The remaining 20% (40) is not set
                    // User 2 keeps its 600 votes on dial 3
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 1, weight: 160 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 0 , dial 2 - 600 , dial 3 - 0 (dialId = n-1) 
                    const dialsVoteHistory = [  
                        { dialId: 0, votesNo: 3, lastVote: 0, lastEpoch: startEpoch + 1},
                        { dialId: 1, votesNo: 3, lastVote: USERS["1"].votes * .8, lastEpoch: startEpoch + 1},
                        { dialId: 2, votesNo: 3, lastVote: USERS["2"].votes, lastEpoch: startEpoch + 1}];
                    await expectDialVotesHistoryForDials(emissionsController,dialsVoteHistory)    

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1) 
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController,dialsVoteHistory, startEpoch + 2)

                    // Total votes is 900 - 20% * 300 = 900 - 60 = 840
                    // User 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul((USERS["1"].votes * 4) / 5).div(840)
                    // User 2 600 votes
                    const dial3 = nextEpochEmission.mul(USERS["2"].votes).div(840)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 1 changes all to dial 3", async () => {
                    // User 1 gives all 300 votes to dial 3
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 0 , dial 2 - 0 , dial 3 - 900 (dialId = n-1) 
                    const dialsVoteHistory = [  
                        { dialId: 0, votesNo: 3, lastVote: 0, lastEpoch: startEpoch + 1},
                        { dialId: 1, votesNo: 3, lastVote: 0, lastEpoch: startEpoch + 1},
                        { dialId: 2, votesNo: 3, lastVote: USERS["1"].votes + USERS["2"].votes, lastEpoch: startEpoch + 1}];
                    await expectDialVotesHistoryForDials(emissionsController,dialsVoteHistory)                      

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 0 , dial 2 - 0 , dial 3 - 900 (dialId = n-1) 
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController,dialsVoteHistory, startEpoch + 2)


                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, 0, nextEpochEmission])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(
                        balDial3Before.add(nextEpochEmission),
                    )
                })
                it("User 3 all weight on dial 1", async () => {
                    // User 3 gives all 300 votes to dial 1
                    await emissionsController.connect(sa.dummy3.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 360 , dial 2 - 240 , dial 3 - 600 (dialId = n-1) 
                    const dialsVoteHistory = [  
                        { dialId: 0, votesNo: 3, lastVote: USERS["1"].votes * .2 + USERS["3"].votes, lastEpoch: startEpoch + 1},
                        { dialId: 1, votesNo: 3, lastVote: USERS["1"].votes * .8, lastEpoch: startEpoch + 1},
                        { dialId: 2, votesNo: 3, lastVote: USERS["2"].votes, lastEpoch: startEpoch + 1}];
                    await expectDialVotesHistoryForDials(emissionsController,dialsVoteHistory)                       

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 360 , dial 2 - 240 , dial 3 - 600 (dialId = n-1) 
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController,dialsVoteHistory, startEpoch + 2)


                    // User 1 20% of 300 votes + User 3 300 votes
                    const dial1 = nextEpochEmission.mul(300 + 300 / 5).div(1200)
                    // User 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul((300 * 4) / 5).div(1200)
                    // User 2 600 votes
                    const dial3 = nextEpochEmission.mul(USERS["2"].votes).div(1200)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 3 all weight on dial 2", async () => {
                    // User 3 gives all 300 votes to dial 2
                    await emissionsController.connect(sa.dummy3.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1) 
                    const dialsVoteHistory = [  
                        { dialId: 0, votesNo: 3, lastVote: USERS["1"].votes * .2, lastEpoch: startEpoch + 1},
                        { dialId: 1, votesNo: 3, lastVote: USERS["1"].votes * .8 + USERS["3"].votes, lastEpoch: startEpoch + 1},
                        { dialId: 2, votesNo: 3, lastVote: USERS["2"].votes, lastEpoch: startEpoch + 1}];
                    await expectDialVotesHistoryForDials(emissionsController,dialsVoteHistory)                       

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1) 
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController,dialsVoteHistory, startEpoch + 2)

                    // User 1 20% of 300 votes + User 3 300 votes
                    const dial1 = nextEpochEmission.mul(300 / 5).div(1200)
                    // User 1 80% of 300 votes, User 3 300 votes
                    const dial2 = nextEpochEmission.mul(300 + (300 * 4) / 5).div(1200)
                    // User 2 600 votes
                    const dial3 = nextEpochEmission.mul(600).div(1200)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 2 removes all votes to dial 3", async () => {
                    // User 2 removes all 600 votes from dial 3
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1) 
                    const dialsVoteHistory = [  
                        { dialId: 0, votesNo: 3, lastVote: USERS["1"].votes * .2, lastEpoch: startEpoch + 1},
                        { dialId: 1, votesNo: 3, lastVote: USERS["1"].votes * .8, lastEpoch: startEpoch + 1},
                        { dialId: 2, votesNo: 3, lastVote: 0, lastEpoch: startEpoch + 1}];
                    await expectDialVotesHistoryForDials(emissionsController,dialsVoteHistory)                       

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1) 
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController,dialsVoteHistory, startEpoch + 2)

                    // User 1 20% of 300 votes
                    const dial1 = nextEpochEmission.mul(300 / 5).div(300)
                    // User 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul((300 * 4) / 5).div(300)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before)
                })
            })
            context("after first emissions period", () => {
                beforeEach(async () => {
                    await increaseTime(ONE_WEEK)
                })
                it("User 1 changes weights to 80/20 dial 1 & 2", async () => {
                    // User 1 splits their 300 votes with 80% to dial 1 and 20% to dial 2
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 160 },
                        { dialId: 1, weight: 40 },
                    ])

                    const tx = await emissionsController.calculateRewards()

                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, 0, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
            })
        })
        context("change voting power", () => {
            context("first voting period", () => {
                it("User 1 does not change their voting power", async () => {
                    expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes before").to.eq(
                        simpleToExactAmount(300),
                    )

                    await staking1.setVotes(sa.dummy1.address, user1Staking1Votes)

                    expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes after").to.eq(
                        simpleToExactAmount(300),
                    )
                })
                it("User 3 increases voting power before setting weights", async () => {
                    expect(await emissionsController.callStatic.getVotes(sa.dummy3.address), "User 3 votes before").to.eq(
                        user3Staking1Votes,
                    )

                    await staking1.setVotes(sa.dummy3.address, simpleToExactAmount(400))

                    expect(await emissionsController.callStatic.getVotes(sa.dummy3.address), "User 3 votes after").to.eq(
                        simpleToExactAmount(400),
                    )
                })
                it("User 1 increases voting power to dial 1", async () => {
                    // User 1 gives all 300 votes to dial 1
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // User 1 increases votes from 300 to 400 by increasing staking 2 from 200 to 300
                    await staking2.setVotes(sa.dummy1.address, simpleToExactAmount(300))
                    expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes after").to.eq(
                        simpleToExactAmount(400),
                    )

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([nextEpochEmission, 0, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(nextEpochEmission)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                context("User 1 votes to dial 1, User 2 votes to dial 2", () => {
                    beforeEach(async () => {
                        // User 1 gives all 300 votes to dial 1
                        await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                        // User 2 gives all 600 votes to dial 2
                        await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
                    })
                    it("User 2 doubled voting power", async () => {
                        // User 2 doubles votes from 600 to 1200
                        await staking1.setVotes(sa.dummy2.address, simpleToExactAmount(1200))
                        expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes after").to.eq(
                            simpleToExactAmount(300),
                        )
                        expect(await emissionsController.callStatic.getVotes(sa.dummy2.address), "User 2 votes after").to.eq(
                            simpleToExactAmount(1200),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 300 of the 1500 votes (1/5)
                        const dial1 = nextEpochEmission.div(5)
                        // User 2 has 1200 of the 1500 votes (4/5)
                        const dial2 = nextEpochEmission.mul(4).div(5)
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                    it("User 2 halves voting power", async () => {
                        // User 2 halves votes from 600 to 300
                        await staking1.setVotes(sa.dummy2.address, simpleToExactAmount(300))
                        expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes after").to.eq(
                            simpleToExactAmount(300),
                        )
                        expect(await emissionsController.callStatic.getVotes(sa.dummy2.address), "User 2 votes after").to.eq(
                            simpleToExactAmount(300),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 300 of the 600 votes (1/2)
                        const dial1 = nextEpochEmission.div(2)
                        // User 2 has 300 of the 600 votes (1/2)
                        const dial2 = nextEpochEmission.div(2)
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                    it("User 2 removes all voting power", async () => {
                        // User 2 cooldowns all stake which removes their voting power
                        await staking1.setVotes(sa.dummy2.address, simpleToExactAmount(0))
                        expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes after").to.eq(
                            simpleToExactAmount(300),
                        )
                        expect(await emissionsController.callStatic.getVotes(sa.dummy2.address), "User 2 votes after").to.eq(
                            simpleToExactAmount(0),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 300 of the 300 votes
                        const dial1 = nextEpochEmission
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, 0, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                    it("User 2 delegates to User 1 who has set weights", async () => {
                        // User 2 delegates votes to User 1
                        await staking1.transferVotes(sa.dummy2.address, sa.dummy1.address, simpleToExactAmount(600))
                        expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes after").to.eq(
                            simpleToExactAmount(900),
                        )
                        expect(await emissionsController.callStatic.getVotes(sa.dummy2.address), "User 2 votes after").to.eq(
                            simpleToExactAmount(0),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 900 of the 900 votes
                        const dial1 = nextEpochEmission
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, 0, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                    it("User 2 delegates to User 3 who has not set weights", async () => {
                        // User 2 delegates votes to User 3
                        await staking1.transferVotes(sa.dummy2.address, sa.dummy1.address, simpleToExactAmount(600))
                        expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes after").to.eq(
                            simpleToExactAmount(900),
                        )
                        expect(await emissionsController.callStatic.getVotes(sa.dummy2.address), "User 2 votes after").to.eq(
                            simpleToExactAmount(0),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 300 of the 300 votes
                        const dial1 = nextEpochEmission
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, 0, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                })
            })
        })
        context("with fixed distribution dial", () => {
            let fixedDistributionAmount: BN
            let nextEpochEmission: BN
            let weightedDistributionAmount: BN
            beforeEach(async () => {
                // Add staking contract as a dial
                await emissionsController.connect(sa.governor.signer).addDial(staking1.address, 10, true)

                nextEpochEmission = await nextRewardAmount(emissionsController)
                fixedDistributionAmount = nextEpochEmission.div(10)
                weightedDistributionAmount = nextEpochEmission.sub(fixedDistributionAmount)
            })
            it("Only User 1 allocates 1% to dial 1", async () => {
                // User 1 gives 1% of their 300 votes to dial 1
                await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 2 },
                    { dialId: 3, weight: 10 },
                ])
                await increaseTime(ONE_WEEK)

                const tx = await emissionsController.calculateRewards()

                await expect(tx)
                    .to.emit(emissionsController, "PeriodRewards")
                    .withArgs([weightedDistributionAmount, 0, 0, fixedDistributionAmount])

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(weightedDistributionAmount)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                expect((await emissionsController.dials(3)).balance, "dial 4 balance after").to.eq(fixedDistributionAmount)
            })
            it("User 1 20/80 votes to dial 1 & 2, User 2 all votes to dial 4", async () => {
                // User 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 40 },
                    { dialId: 1, weight: 160 },
                ])
                // User 2 gives all 600 votes to dial 3
                await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 3, weight: 200 }])
                await increaseTime(ONE_WEEK)

                const tx = await emissionsController.calculateRewards()

                // User 1 20% of 300 votes
                const dial1 = weightedDistributionAmount.mul(20).div(100)
                // User 1 80% of 300 votes
                const dial2 = weightedDistributionAmount.mul(80).div(100)
                // User 2 600 votes
                await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0, fixedDistributionAmount])

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                expect((await emissionsController.dials(3)).balance, "dial 4 balance after").to.eq(fixedDistributionAmount)
            })
            it("User 1 and 2 all to dial 4 which is fixed", async () => {
                // User 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 3, weight: 200 }])
                // User 2 gives all 600 votes to dial 3
                await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 3, weight: 200 }])
                await increaseTime(ONE_WEEK)

                const tx = await emissionsController.calculateRewards()

                await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, 0, 0, fixedDistributionAmount])

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                expect((await emissionsController.dials(3)).balance, "dial 4 balance after").to.eq(fixedDistributionAmount)
            })
            it.skip("Fixed distributions > weekly emissions", async () => {
                const newDial = await new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(
                    rewardToken.address,
                    DEAD_ADDRESS,
                )
                await emissionsController.connect(sa.governor.signer).addDial(newDial.address, 0, true)

                // User 1 all 300 votes to dial 1
                await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                // User 2 all 600 votes to dial 2
                await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
                await increaseTime(ONE_WEEK)

                const tx = emissionsController.calculateRewards()

                await expect(tx).to.revertedWith("staking amounts > weekly emission")
            })
        })
    })
    describe("distributing rewards", () => {
        const user1Staking1Votes = simpleToExactAmount(100)
        const user1Staking2Votes = simpleToExactAmount(200)
        const user2Staking1Votes = simpleToExactAmount(600)
        const user3Staking1Votes = simpleToExactAmount(300)
        beforeEach(async () => {
            await deployEmissionsController()
            await staking1.setVotes(sa.dummy1.address, user1Staking1Votes)
            await staking2.setVotes(sa.dummy1.address, user1Staking2Votes)
            await staking1.setVotes(sa.dummy2.address, user2Staking1Votes)
            await staking1.setVotes(sa.dummy3.address, user3Staking1Votes)
            await increaseTime(ONE_WEEK.mul(2))
        })
        context("Fail to distribute rewards when", () => {
            it("when first dial id is invalid", async () => {
                const tx = emissionsController.distributeRewards([4])
                await expect(tx).to.revertedWith("Invalid dial id")
            })
            it("when middle dial id is invalid", async () => {
                const tx = emissionsController.distributeRewards([1, 4, 2])
                await expect(tx).to.revertedWith("Invalid dial id")
            })
            it("when last dial id is invalid", async () => {
                const tx = emissionsController.distributeRewards([0, 1, 2, 4])
                await expect(tx).to.revertedWith("Invalid dial id")
            })
        })
        context("No rewards", () => {
            beforeEach(async () => {
                // Dial's rewards balances
                expect((await emissionsController.dials(0)).balance, "dial 1 balance before").to.eq(0)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance before").to.eq(0)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance before").to.eq(0)
            })
            it("first dial only", async () => {
                const tx = await emissionsController.distributeRewards([0])

                await expect(tx).to.not.emit(emissionsController, "DistributedReward")

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
            })
            it("all dials", async () => {
                const tx = await emissionsController.distributeRewards([0, 1, 2])

                await expect(tx).to.not.emit(emissionsController, "DistributedReward")

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
            })
        })
        context("Rewards in each dial", () => {
            beforeEach(async () => {
                await rewardToken.approve(emissionsController.address, simpleToExactAmount(600))
                await emissionsController.donate([0, 1, 2], [simpleToExactAmount(100), simpleToExactAmount(200), simpleToExactAmount(300)])

                expect((await emissionsController.dials(0)).balance, "dial 1 balance before").to.eq(simpleToExactAmount(100))
                expect((await emissionsController.dials(1)).balance, "dial 2 balance before").to.eq(simpleToExactAmount(200))
                expect((await emissionsController.dials(2)).balance, "dial 3 balance before").to.eq(simpleToExactAmount(300))
            })
            it("no dials", async () => {
                const tx = await emissionsController.distributeRewards([])

                await expect(tx).to.not.emit(emissionsController, "DistributedReward")

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(simpleToExactAmount(100))
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(simpleToExactAmount(200))
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(simpleToExactAmount(300))
            })
            it("first dial only", async () => {
                const tx = await emissionsController.distributeRewards([0])

                await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(0, simpleToExactAmount(100))

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(simpleToExactAmount(200))
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(simpleToExactAmount(300))
            })
            it("all dials ", async () => {
                const tx = await emissionsController.distributeRewards([0, 1, 2])

                await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(0, simpleToExactAmount(100))
                await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(1, simpleToExactAmount(200))
                await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(2, simpleToExactAmount(300))

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
            })
            it("all dials in reverse order", async () => {
                const tx = await emissionsController.distributeRewards([2, 1, 0])

                await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(0, simpleToExactAmount(100))
                await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(1, simpleToExactAmount(200))
                await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(2, simpleToExactAmount(300))

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
            })
            it("first and last dials", async () => {
                const tx = await emissionsController.distributeRewards([0, 2])

                await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(0, simpleToExactAmount(100))
                await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(2, simpleToExactAmount(300))

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(simpleToExactAmount(200))
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
            })
        })
    })
    describe("Poke sources", () => {
        let voter1: Account
        let currentTime: BN
        beforeEach(async () => {
            await deployEmissionsController()

            voter1 = sa.dummy1

            // Add 2 staking contracts to the existing 3 dials
            await emissionsController.connect(sa.governor.signer).addDial(staking1.address, 10, true)
            await emissionsController.connect(sa.governor.signer).addDial(staking2.address, 10, true)

            // increase 1 week as there is two weeks at the start
            await increaseTime(ONE_WEEK)

            currentTime = await getTimestamp()
        })
        it("should poke voter 1 with no voting power", async () => {
            const tx = await emissionsController.pokeSources(voter1.address)
            await expect(tx).to.emit(emissionsController, "SourcesPoked").withArgs(voter1.address, 0)
        })
        it("should poke voter 1 with voting power but no weights set", async () => {
            const voterPreferencesBefore = await emissionsController.voterPreferences(voter1.address)
            expect(voterPreferencesBefore.lastSourcePoke, "last poke time before").to.eq(0)

            // Voter 1 has voting power in staking contracts 1 and 2
            await staking1.setVotes(voter1.address, simpleToExactAmount(50))
            await staking2.setVotes(voter1.address, simpleToExactAmount(70))

            const tx = await emissionsController.pokeSources(voter1.address)

            await expect(tx).to.emit(emissionsController, "SourcesPoked").withArgs(voter1.address, 0)
            const voterPreferencesAfter = await emissionsController.voterPreferences(voter1.address)
            expect(voterPreferencesAfter.lastSourcePoke, "last poke time after").to.gt(currentTime)
        })
        it("should poke voter 1 with voting power and weights set", async () => {
            const voterPreferencesBefore = await emissionsController.voterPreferences(voter1.address)
            expect(voterPreferencesBefore.lastSourcePoke, "last poke time before").to.eq(0)

            // Voter 1 has voting power in staking contracts 1 and 2
            await staking1.setVotes(voter1.address, simpleToExactAmount(30))
            await staking2.setVotes(voter1.address, simpleToExactAmount(70))
            await emissionsController.connect(voter1.signer).setVoterDialWeights([
                { dialId: 0, weight: 120 },
                { dialId: 3, weight: 80 },
            ])
            const currentEpochWeek = await currentWeekEpoch()
            console.log(`Current epoch ${currentEpochWeek.toString()}`)
            const epochs = await emissionsController.epochs()
            expect(epochs.lastEpoch, "last epoch").to.eq(currentEpochWeek)
            expect(epochs.startEpoch, "start epoch").to.eq(currentEpochWeek)

            const tx = await emissionsController.pokeSources(voter1.address)

            await expect(tx).to.emit(emissionsController, "SourcesPoked").withArgs(voter1.address, 0)
            const voterPreferencesAfter = await emissionsController.voterPreferences(voter1.address)
            expect(voterPreferencesAfter.lastSourcePoke, "last poke time after").to.gt(currentTime)

            const dialVotes = await emissionsController.getEpochVotes(currentEpochWeek)
            expect(dialVotes, "number of dials").to.lengthOf(5)
            expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(60))
            expect(dialVotes[1], "dial 2 votes").to.eq(0)
            expect(dialVotes[2], "dial 3 votes").to.eq(0)
            expect(dialVotes[3], "dial 4 votes").to.eq(simpleToExactAmount(40))
            expect(dialVotes[4], "dial 5 votes").to.eq(0)
        })
        context("after a new staking contract added with voter 1's voting power", () => {
            const voter1Staking1VotingPower = simpleToExactAmount(1000)
            const voter1Staking2VotingPower = simpleToExactAmount(2000)
            const voter1Staking3VotingPower = simpleToExactAmount(3000)
            let staking3: MockStakingContract
            beforeEach(async () => {
                // Voter 1 has voting power in staking contracts 1 and 2
                await staking1.setVotes(voter1.address, voter1Staking1VotingPower)
                await staking2.setVotes(voter1.address, voter1Staking2VotingPower)
                // Voter 1 splits their 300 votes with 60% to dial 1 and 40% to dial 2
                await emissionsController.connect(voter1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 120 },
                    { dialId: 3, weight: 80 },
                ])
                // Voter 1 gets voting power in new staking contract
                staking3 = await new MockStakingContract__factory(sa.default.signer).deploy()
                await staking3.setVotes(voter1.address, voter1Staking3VotingPower)

                // New staking contract is added to emissions controller
                await emissionsController.connect(sa.governor.signer).addStakingContract(staking3.address)
                await staking3.setGovernanceHook(emissionsController.address)
            })
            it("should poke voter 1's", async () => {
                const tx = await emissionsController.pokeSources(voter1.address)

                await expect(tx).to.emit(emissionsController, "SourcesPoked").withArgs(voter1.address, voter1Staking3VotingPower)

                const dialVotes = await emissionsController.getEpochVotes(await currentWeekEpoch())
                expect(dialVotes, "number of dials").to.lengthOf(5)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(6000).mul(6).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(0)
                expect(dialVotes[2], "dial 3 votes").to.eq(0)
                expect(dialVotes[3], "dial 4 votes").to.eq(simpleToExactAmount(6000).mul(4).div(10))
                expect(dialVotes[4], "dial 5 votes").to.eq(0)
            })
            it("should poke when the hook is called", async () => {
                // Voter 1's voting power is tripled
                const tx = staking3.setVotes(voter1.address, voter1Staking3VotingPower.mul(3))

                await expect(tx).to.emit(emissionsController, "SourcesPoked").withArgs(voter1.address, voter1Staking3VotingPower.mul(3))

                const dialVotes = await emissionsController.getEpochVotes(await currentWeekEpoch())
                expect(dialVotes, "number of dials").to.lengthOf(5)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(12000).mul(6).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(0)
                expect(dialVotes[2], "dial 3 votes").to.eq(0)
                expect(dialVotes[3], "dial 4 votes").to.eq(simpleToExactAmount(12000).mul(4).div(10))
                expect(dialVotes[4], "dial 5 votes").to.eq(0)
            })
        })
    })
    // TODO - setVoterDialWeights
    //          - read and update cached voting power
    describe("setting preferences", () => {
        before(async () => {
            await deployEmissionsController()

            // Add 2 staking contracts to the existing 3 dials
            await emissionsController.connect(sa.governor.signer).addDial(staking1.address, 10, true)
            await emissionsController.connect(sa.governor.signer).addDial(staking2.address, 10, true)
            // Add another 15 dials to make 20 dials
            for (let i = 0; i < 15; i += 1) {
                await emissionsController.connect(sa.governor.signer).addDial(Wallet.createRandom().address, 0, true)
            }
        })
        it("should set 15 preferences", async () => {
            const voter = sa.dummy1
            // using 15 dials
            const preferences = [
                { dialId: 0, weight: 1 },
                { dialId: 1, weight: 2 },
                { dialId: 2, weight: 3 },
                { dialId: 3, weight: 4 },
                { dialId: 4, weight: 5 },
                { dialId: 5, weight: 6 },
                { dialId: 6, weight: 7 },
                { dialId: 7, weight: 8 },
                { dialId: 8, weight: 9 },
                { dialId: 9, weight: 10 },
                { dialId: 10, weight: 11 },
                { dialId: 11, weight: 12 },
                { dialId: 12, weight: 13 },
                { dialId: 13, weight: 14 },
                { dialId: 14, weight: 15 },
            ]
            const tx = await emissionsController.connect(voter.signer).setVoterDialWeights(preferences)
            await expect(tx).to.emit(emissionsController, "PreferencesChanged")
            const receipt = await tx.wait()
            expect(receipt.events[0].args[0], "sender").to.eq(voter.address)
            expect(receipt.events[0].args[1], "preferences length").to.lengthOf(15)
            expect(receipt.events[0].args[1][0].dialId, "first preference dial id").to.eq(preferences[0].dialId)
            expect(receipt.events[0].args[1][0].weight, "first preference weight").to.eq(preferences[0].weight)
            expect(receipt.events[0].args[1][14].dialId, "last preference dial id").to.eq(preferences[14].dialId)
            expect(receipt.events[0].args[1][14].weight, "last preference weight").to.eq(preferences[14].weight)

            const voterPreferencesAfter = await emissionsController.getVoterPreferences(voter.address)
            expect(voterPreferencesAfter[0].dialId, "pos 1 dial id after").to.eq(preferences[0].dialId)
            expect(voterPreferencesAfter[0].weight, "pos 1 weight after").to.eq(preferences[0].weight)
            expect(voterPreferencesAfter[1].dialId, "pos 2 dial id after").to.eq(preferences[1].dialId)
            expect(voterPreferencesAfter[1].weight, "pos 2 weight after").to.eq(preferences[1].weight)
            expect(voterPreferencesAfter[14].dialId, "pos 15 dial id after").to.eq(preferences[14].dialId)
            expect(voterPreferencesAfter[14].weight, "pos 15 weight after").to.eq(preferences[14].weight)
            expect(voterPreferencesAfter[15].dialId, "pos 16 dial id after").to.eq(255)
            expect(voterPreferencesAfter[15].weight, "pos 16 weight after").to.eq(0)
        })
        it("should set 16 preferences", async () => {
            const voter = sa.dummy1
            // using 16 dials
            const preferences = [
                { dialId: 0, weight: 1 },
                { dialId: 1, weight: 2 },
                { dialId: 2, weight: 3 },
                { dialId: 3, weight: 4 },
                { dialId: 4, weight: 5 },
                { dialId: 5, weight: 6 },
                { dialId: 6, weight: 7 },
                { dialId: 7, weight: 8 },
                { dialId: 8, weight: 9 },
                { dialId: 9, weight: 10 },
                { dialId: 10, weight: 11 },
                { dialId: 11, weight: 12 },
                { dialId: 12, weight: 13 },
                { dialId: 13, weight: 14 },
                { dialId: 14, weight: 15 },
                { dialId: 15, weight: 16 },
            ]
            const tx = await emissionsController.connect(voter.signer).setVoterDialWeights(preferences)
            await expect(tx).to.emit(emissionsController, "PreferencesChanged")
            const receipt = await tx.wait()
            expect(receipt.events[0].args[0], "sender").to.eq(voter.address)
            expect(receipt.events[0].args[1], "preferences length").to.lengthOf(16)
            expect(receipt.events[0].args[1][0].dialId, "first preference dial id").to.eq(preferences[0].dialId)
            expect(receipt.events[0].args[1][0].weight, "first preference weight").to.eq(preferences[0].weight)
            expect(receipt.events[0].args[1][15].dialId, "last preference dial id").to.eq(preferences[15].dialId)
            expect(receipt.events[0].args[1][15].weight, "last preference weight").to.eq(preferences[15].weight)

            const voterPreferencesAfter = await emissionsController.getVoterPreferences(voter.address)
            expect(voterPreferencesAfter[0].dialId, "pos 1 dial id after").to.eq(preferences[0].dialId)
            expect(voterPreferencesAfter[0].weight, "pos 1 weight after").to.eq(preferences[0].weight)
            expect(voterPreferencesAfter[1].dialId, "pos 2 dial id after").to.eq(preferences[1].dialId)
            expect(voterPreferencesAfter[1].weight, "pos 2 weight after").to.eq(preferences[1].weight)
            expect(voterPreferencesAfter[14].dialId, "pos 15 dial id after").to.eq(preferences[14].dialId)
            expect(voterPreferencesAfter[14].weight, "pos 15 weight after").to.eq(preferences[14].weight)
            expect(voterPreferencesAfter[15].dialId, "pos 16 dial id after").to.eq(preferences[15].dialId)
            expect(voterPreferencesAfter[15].weight, "pos 16 weight after").to.eq(preferences[15].weight)
        })
        it("should set 100% on dial 20", async () => {
            const voter = sa.dummy2
            // dial 20 has dial identifier 19
            const preferences = [{ dialId: 19, weight: 200 }]

            const tx = await emissionsController.connect(voter.signer).setVoterDialWeights(preferences)

            await expect(tx).to.emit(emissionsController, "PreferencesChanged")
            const receipt = await tx.wait()
            expect(receipt.events[0].args[0], "sender").to.eq(voter.address)
            expect(receipt.events[0].args[1], "preferences length").to.lengthOf(1)
            expect(receipt.events[0].args[1][0].dialId, "first preference dial id").to.eq(preferences[0].dialId)
            expect(receipt.events[0].args[1][0].weight, "first preference weight").to.eq(preferences[0].weight)

            const voterPreferencesAfter = await emissionsController.getVoterPreferences(voter.address)
            expect(voterPreferencesAfter[0].dialId, "pos 1 dial id after").to.eq(preferences[0].dialId)
            expect(voterPreferencesAfter[0].weight, "pos 1 weight after").to.eq(preferences[0].weight)
            expect(voterPreferencesAfter[1].dialId, "pos 2 dial id after").to.eq(255)
            expect(voterPreferencesAfter[1].weight, "pos 2 weight after").to.eq(0)
            expect(voterPreferencesAfter[2].dialId, "pos 3 dial id after").to.eq(0)
            expect(voterPreferencesAfter[2].weight, "pos 3 weight after").to.eq(0)
        })
        it("should override previous dial weights", async () => {
            const voter = sa.dummy1
            const previousPreferences = [
                { dialId: 0, weight: 120 },
                { dialId: 1, weight: 60 },
                { dialId: 2, weight: 20 },
            ]

            await emissionsController.connect(voter.signer).setVoterDialWeights(previousPreferences)

            const voterPreferencesBefore = await emissionsController.getVoterPreferences(voter.address)
            expect(voterPreferencesBefore[0].dialId, "pos 1 dial id before").to.eq(0)
            expect(voterPreferencesBefore[0].weight, "pos 1 weight before").to.eq(120)
            expect(voterPreferencesBefore[1].dialId, "pos 2 dial id before").to.eq(1)
            expect(voterPreferencesBefore[1].weight, "pos 2 weight before").to.eq(60)
            expect(voterPreferencesBefore[2].dialId, "pos 3 dial id before").to.eq(2)
            expect(voterPreferencesBefore[2].weight, "pos 3 weight before").to.eq(20)
            expect(voterPreferencesBefore[3].dialId, "pos 4 dial id before").to.eq(255)
            expect(voterPreferencesBefore[3].weight, "pos 4 weight before").to.eq(0)
            expect(voterPreferencesBefore[4].dialId, "pos 5 dial id before").to.eq(0)
            expect(voterPreferencesBefore[4].weight, "pos 5 weight before").to.eq(0)
            expect(voterPreferencesBefore[15].dialId, "pos 16 dial id before").to.eq(0)
            expect(voterPreferencesBefore[15].weight, "pos 16 weight before").to.eq(0)

            const newPreferences = [
                { dialId: 1, weight: 60 },
                { dialId: 2, weight: 20 },
                { dialId: 5, weight: 30 },
                { dialId: 19, weight: 70 },
            ]

            await emissionsController.connect(voter.signer).setVoterDialWeights(newPreferences)

            const voterPreferencesAfter = await emissionsController.getVoterPreferences(voter.address)
            expect(voterPreferencesAfter[0].dialId, "pos 1 dial id after").to.eq(1)
            expect(voterPreferencesAfter[0].weight, "pos 1 weight after").to.eq(60)
            expect(voterPreferencesAfter[1].dialId, "pos 2 dial id after").to.eq(2)
            expect(voterPreferencesAfter[1].weight, "pos 2 weight after").to.eq(20)
            expect(voterPreferencesAfter[2].dialId, "pos 3 dial id after").to.eq(5)
            expect(voterPreferencesAfter[2].weight, "pos 3 weight after").to.eq(30)
            expect(voterPreferencesAfter[3].dialId, "pos 4 dial id after").to.eq(19)
            expect(voterPreferencesAfter[3].weight, "pos 4 weight after").to.eq(70)
            expect(voterPreferencesAfter[4].dialId, "pos 5 dial id after").to.eq(255)
            expect(voterPreferencesAfter[4].weight, "pos 5 weight after").to.eq(0)
            expect(voterPreferencesBefore[5].dialId, "pos 6 dial id after").to.eq(0)
            expect(voterPreferencesBefore[5].weight, "pos 6 weight after").to.eq(0)
            expect(voterPreferencesBefore[15].dialId, "pos 16 dial id after").to.eq(0)
            expect(voterPreferencesBefore[15].weight, "pos 16 weight after").to.eq(0)
        })
        describe("should fail when", () => {
            it("weights > 100% to a single dial", async () => {
                // User 1 gives 100.01% to dial 1
                const tx = emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 201 }])
                await expect(tx).to.revertedWith("Imbalanced weights")
            })
            it("weights > 100% across multiple dials", async () => {
                // User 1 gives 90% to dial 1 and 10.01% to dial 2
                const tx = emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 180 },
                    { dialId: 1, weight: 21 },
                ])
                await expect(tx).to.revertedWith("Imbalanced weights")
            })
            it("invalid dial id", async () => {
                const tx = emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 20, weight: 200 }])
                await expect(tx).to.revertedWith("Invalid dial id")
            })
            it("0% weight", async () => {
                const tx = emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                    { dialId: 1, weight: 100 },
                    { dialId: 18, weight: 0 },
                ])
                await expect(tx).to.revertedWith("Must give a dial some weight")
            })
            it("setting 17 preferences", async () => {
                // using 17 dials with 5% (10/2) each
                const tx = emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 10 },
                    { dialId: 1, weight: 10 },
                    { dialId: 2, weight: 10 },
                    { dialId: 3, weight: 10 },
                    { dialId: 4, weight: 10 },
                    { dialId: 5, weight: 10 },
                    { dialId: 6, weight: 10 },
                    { dialId: 7, weight: 10 },
                    { dialId: 8, weight: 10 },
                    { dialId: 9, weight: 10 },
                    { dialId: 10, weight: 10 },
                    { dialId: 11, weight: 10 },
                    { dialId: 12, weight: 10 },
                    { dialId: 13, weight: 10 },
                    { dialId: 14, weight: 10 },
                    { dialId: 15, weight: 10 },
                    { dialId: 16, weight: 10 },
                ])
                await expect(tx).to.revertedWith("Max of 16 preferences")
            })
        })
    })
    // TODO - actually call the hook
    // TODO - skips if the new staking contract is added or preferences not cast
    describe("staking contract hook", () => {
        let user1: string
        let user2: string
        const amount = simpleToExactAmount(100)
        beforeEach(async () => {
            await deployEmissionsController()

            user1 = sa.dummy1.address
            user2 = sa.dummy1.address
            await staking1.setVotes(user1, simpleToExactAmount(1000))
            await staking1.setVotes(user2, simpleToExactAmount(2000))
        })
        it("Default can not move voting power", async () => {
            const tx = emissionsController.moveVotingPowerHook(user1, user2, amount)
            await expect(tx).to.revertedWith("Caller must be staking contract")
        })
        it("Governor can not move voting power", async () => {
            const tx = emissionsController.connect(sa.governor.signer).moveVotingPowerHook(user1, user2, amount)
            await expect(tx).to.revertedWith("Caller must be staking contract")
        })
    })
})
