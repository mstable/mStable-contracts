import { Wallet } from "@ethersproject/wallet"
import { DEAD_ADDRESS, ONE_HOUR, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BN, simpleToExactAmount, sum } from "@utils/math"
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
import { currentWeekEpoch, increaseTime, getTimestamp, increaseTimeTo, startWeek, weekEpoch } from "@utils/time"
import { Account } from "types/common"
import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import { MCCP24_CONFIG, TopLevelConfig } from "tasks/utils/emissions-utils"

const INITIAL_DIALS_NO = 3

interface VoteHistoryExpectation {
    dialId: number
    votesNo: number
    lastVote: number | BN
    lastEpoch: number
}
interface DialData {
    disabled: boolean
    notify: boolean
    cap: number
    balance: BN
    recipient: string
    voteHistory: { votes: BN; epoch: number }[]
}

/**
 * Expectations for the last vote casted by the Dial
 *
 * @param {VoteHistoryExpectation} {dialId, votesNo, lastVote, lastEpoch}
 * @return {votesHistory}
 */
const expectDialVotesHistoryForDial = async (
    emissionsController: EmissionsController,
    { dialId, votesNo, lastVote, lastEpoch }: VoteHistoryExpectation,
) => {
    const votesHistory = await emissionsController.getDialVoteHistory(dialId)
    // Expectations for the last vote
    expect(votesHistory, "voteHistory").length(votesNo)
    expect(votesHistory[votesHistory.length - 1][0], "vote").to.eq(lastVote)
    expect(votesHistory[votesHistory.length - 1][1], "epoch").to.eq(lastEpoch)
    return votesHistory[votesHistory.length - 1]
}
const expectDialVotesHistoryForDials = async (
    emissionsController: EmissionsController,
    votesHistoryExpectations: Array<VoteHistoryExpectation> = [],
) => {
    const expectations = Promise.all(
        votesHistoryExpectations.map((voteHistory) =>
            expectDialVotesHistoryForDial(emissionsController, {
                ...voteHistory,
                lastVote: voteHistory.lastVote > 0 ? simpleToExactAmount(voteHistory.lastVote) : voteHistory.lastVote,
            }),
        ),
    )
    return await expectations
}
const expectDialVotesHistoryWithoutChangeOnWeights = async (
    emissionsController: EmissionsController,
    votesHistoryExpectations: Array<VoteHistoryExpectation> = [],
) =>
    expectDialVotesHistoryForDials(
        emissionsController,
        votesHistoryExpectations.map((voteHistory) => ({
            ...voteHistory,
            votesNo: voteHistory.votesNo + 1,
            lastEpoch: voteHistory.lastEpoch + 1,
        })),
    )

/**
 * Mocks EmissionsController.topLineEmission function.
 *
 * @param {number} epochDelta - The number of epochs to move forward.
 * @param {TopLevelConfig} topLevelConfig - top level configuration used for the polynomial
 * @return {emissionForEpoch}  {BN} - The amount of emission for the given epoch, with 18 decimal numbers ex. 165461e18.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const calcWeeklyRewardPolynomial = (epochDelta: number, topLevelConfig: TopLevelConfig): BN => {
    const { A, B, C, D, EPOCHS } = topLevelConfig
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
 * Mocks EmissionsController.topLineEmission function.
 *
 * @param {number} epochDelta - The number of epochs to move forward.
 * @param {TopLevelConfig} topLevelConfig - top level configuration used for the polynomial
 * @return {emissionForEpoch}  {BN} - The amount of emission for the given epoch, with 18 decimal numbers ex. 165461e18.
 */
const calcWeeklyReward = (epochDelta: number, topLevelConfig: TopLevelConfig): BN => {
    const { A, B } = topLevelConfig
    const inputScale = simpleToExactAmount(1, 7)
    const a = BN.from(A).mul(inputScale)
    const b = BN.from(B).mul(inputScale)
    return a.mul(epochDelta).add(b)
}
/**
 * Calculates the amount of emission for the given epoch,
 * it retrieves the lastEpoch from the instance of EmissionsController.
 *
 * @param {EmissionsController} emissionsController
 * @param {TopLevelConfig} topLevelConfig - top level configuration used for the polynomial
 * @param {number} [epoch=1]
 * @return {emissionForEpoch}  {BN} - The amount of emission for the given epoch.
 */
export const nextRewardAmount = async (
    emissionsController: EmissionsController,
    topLevelConfig: TopLevelConfig = MCCP24_CONFIG,
    epoch = 1,
): Promise<BN> => {
    const [startEpoch, lastEpoch] = await emissionsController.epochs()
    return calcWeeklyReward(lastEpoch - startEpoch + epoch, topLevelConfig)
}
/**
 * Expectations for the EmissionsController.topLineEmission function.
 *
 * @param {EmissionsController} emissionsController
 * @param {number} startEpoch - The starting epoch.
 * @param {TopLevelConfig} topLevelConfig - top level configuration used for the polynomial
 * @param {number} deltaEpoch- The delta epoch.
 */
const expectTopLineEmissionForEpoch =
    (emissionsController: EmissionsController, topLevelConfig: TopLevelConfig, startEpoch: number) =>
    async (deltaEpoch: number): Promise<void> => {
        const emissionForEpoch = await emissionsController.topLineEmission(startEpoch + deltaEpoch)
        const expectedEmissionAmount = await nextRewardAmount(emissionsController, topLevelConfig, deltaEpoch)
        expect(emissionForEpoch).eq(expectedEmissionAmount)
    }
export const snapDial = async (emissionsController: EmissionsController, dialId: number): Promise<DialData> => {
    const dialData = await emissionsController.dials(dialId)
    const voteHistory = await emissionsController.getDialVoteHistory(dialId)
    return {
        ...dialData,
        voteHistory,
    }
}

describe("EmissionsController", async () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let staking1: MockStakingContract
    let staking2: MockStakingContract
    let rewardToken: MockERC20
    let dials: MockRewardsDistributionRecipient[]
    let emissionsController: EmissionsController
    let currentEpoch: BN
    let nextEpoch: BN
    let voter1: Account
    let voter2: Account
    let voter3: Account
    const totalRewardsSupply = simpleToExactAmount(100000000)
    const totalRewards = simpleToExactAmount(29400963)
    const configuration = MCCP24_CONFIG
    /**
     * Deploys the emission controller, staking contracts, dials and transfers MTA to the Emission Controller contract.
     *
     * @return {Promise}  {Promise<void>}
     */
    const deployEmissionsController = async (topLevelConfig: TopLevelConfig = MCCP24_CONFIG): Promise<void> => {
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
            topLevelConfig,
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

        const currentTime = await getTimestamp()
        currentEpoch = weekEpoch(currentTime)
        nextEpoch = currentEpoch.add(1)
    }
    before(async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)

        console.log(`Keeper ${keccak256(toUtf8Bytes("Keeper"))}`)

        voter1 = sa.dummy1
        voter2 = sa.dummy2
        voter3 = sa.dummy3

        // Set the time to Thursday, 01:00am UTC time which is just after the start of the distribution period
        const currentTime = await getTimestamp()
        const startCurrentPeriod = startWeek(currentTime)
        const earlyNextPeriod = startCurrentPeriod.add(ONE_WEEK).add(ONE_HOUR)
        await increaseTimeTo(earlyNextPeriod)
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
            const dial1 = await snapDial(emissionsController, 0)
            expect(dial1.recipient, "dial 1 recipient").to.eq(dials[0].address)
            expect(dial1.notify, "dial 1 notify").to.eq(true)
            expect(dial1.cap, "dial 1 cap").to.eq(0)
            expect(dial1.balance, "dial 1 balance").to.eq(0)
            expect(dial1.disabled, "dial 1 disabled").to.eq(false)
            expect(dial1.voteHistory, "dial 1 vote len").to.lengthOf(1)
            expect(dial1.voteHistory[0].votes, "dial 1 votes").to.eq(0)
            expect(dial1.voteHistory[0].epoch, "dial 1 votes epoch").to.eq(nextEpoch)

            const dial3 = await emissionsController.dials(2)
            expect(dial3.recipient, "dial 3 recipient").to.eq(dials[2].address)
            expect(dial3.notify, "dial 3 notify").to.eq(false)
        })
        it("epoch set on initialization", async () => {
            const [startEpoch, lastEpoch] = await emissionsController.epochs()
            expect(startEpoch, "start epoch").to.eq(nextEpoch)
            expect(lastEpoch, "last epoch").to.eq(nextEpoch)
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
                const tx = new EmissionsController__factory(sa.default.signer).deploy(ZERO_ADDRESS, rewardToken.address, configuration)
                await expect(tx).to.revertedWith("Nexus address is zero")
            })
            it("rewards token is zero", async () => {
                const tx = new EmissionsController__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS, configuration)
                await expect(tx).to.revertedWith("Reward token address is zero")
            })
        })
        context("should fail to initialize when", () => {
            before(async () => {
                emissionsController = await new EmissionsController__factory(sa.default.signer).deploy(
                    nexus.address,
                    rewardToken.address,
                    configuration,
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
                    desc: "different recipient and notify lengths",
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
            it("first staking contract is zero", async () => {
                const recipients = dials.map((d) => d.address)
                const tx = emissionsController.initialize(recipients, [0, 0, 0], [true, true, false], [ZERO_ADDRESS, staking2.address])
                await expect(tx).to.revertedWith("Staking contract address is zero")
            })
            it("second staking contract is zero", async () => {
                const recipients = dials.map((d) => d.address)
                const tx = emissionsController.initialize(recipients, [0, 0, 0], [true, true, false], [staking1.address, ZERO_ADDRESS])
                await expect(tx).to.revertedWith("Staking contract address is zero")
            })
        })
    })
    describe("calling view functions", () => {
        // TODO - `getVotes`
        // TODO - `getDialVoteHistory`
        // TODO - `getDialVotes`
        // TODO - `getVoterPreferences`

        describe("fetch weekly emissions", () => {
            let startEpoch
            let expectTopLineEmissions
            before(async () => {
                await deployEmissionsController()
                ;[startEpoch] = await emissionsController.epochs()
                expectTopLineEmissions = expectTopLineEmissionForEpoch(emissionsController, configuration, startEpoch)
            })
            it("fails fetching an smaller epoch than deployed time", async () => {
                const tx = emissionsController.topLineEmission(startEpoch - 10)
                await expect(tx).to.revertedWith("Wrong epoch number")
            })
            it("fails fetching same epoch as deployed time", async () => {
                const tx = emissionsController.topLineEmission(startEpoch)
                await expect(tx).to.revertedWith("Wrong epoch number")
            })
            it("fetches week 1", async () => {
                await expectTopLineEmissions(1) // 165461725488677241000000 , 87931506791325000
            })
            it("fetches week 8 - Two months", async () => {
                await expectTopLineEmissions(8) // 161787972249458966000000 , 86943512332986000
            })
            it("fetches week 100 - one year eleven months", async () => {
                await expectTopLineEmissions(100)
            })
            it(`fetches week ${configuration.EPOCHS / 2} - half total epochs`, async () => {
                await expectTopLineEmissions(Math.ceil(configuration.EPOCHS / 2)) // 1052774388745663000000  , 44883176820840000
            })
            it(`fetches week ${configuration.EPOCHS - 1}  - pre-last epoch`, async () => {
                await expectTopLineEmissions(configuration.EPOCHS - 1) // 1052774388745663000000,  1834846850355000
            })
            it(`fetches week ${configuration.EPOCHS} - last epoch`, async () => {
                await expectTopLineEmissions(configuration.EPOCHS) //  0 , 1693704784878000
            })
            it(`fails week ${configuration.EPOCHS + 1} - last epoch plus one week`, async () => {
                const tx = emissionsController.topLineEmission(startEpoch + configuration.EPOCHS + 1)
                await expect(tx).to.revertedWith("Wrong epoch number")
            })
            it("fails fetching week 5200 - Ten years", async () => {
                const tx = emissionsController.topLineEmission(startEpoch + 5200)
                await expect(tx).to.revertedWith("Wrong epoch number")
            })
        })
        describe("gets a dials weighted votes  ", () => {
            let startEpoch
            before(async () => {
                await deployEmissionsController()
                ;[startEpoch] = await emissionsController.epochs()
            })
            it("gets initial dials vote history ", async () => {
                ;[...Array(INITIAL_DIALS_NO).keys()].forEach(async (dialId) => {
                    const voteHistory = await emissionsController.getDialVoteHistory(dialId)
                    const [[votes, epoch]] = voteHistory
                    expect(voteHistory, "voteHistory").length(1)
                    expect(votes, "votes").to.eq(0)
                    // Starting epoch is one week ahead of deployment, EmissionController.initialize
                    expect(epoch, "epoch").to.eq(startEpoch)
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

                const savedDial = await snapDial(emissionsController, 3)
                expect(savedDial.recipient, "recipient").to.eq(newDial.address)
                expect(savedDial.notify, "notify").to.eq(true)
                expect(savedDial.cap, "staking").to.eq(0)
                expect(savedDial.balance, "balance").to.eq(0)
                expect(savedDial.disabled, "disabled").to.eq(false)

                expect(savedDial.voteHistory, "number votes").to.lengthOf(1)
                // Should be the next week, not this week
                expect(savedDial.voteHistory[0].epoch, "epoch").to.eq(nextEpoch)
                expect(savedDial.voteHistory[0].votes, "votes").to.eq(0)
            })
            it("governor adds new dial in the second launch week", async () => {
                await increaseTime(ONE_WEEK)
                const tx = await emissionsController.connect(sa.governor.signer).addDial(newDial.address, 0, true)

                await expect(tx).to.emit(emissionsController, "AddedDial").withArgs(3, newDial.address)

                const savedDial = await snapDial(emissionsController, 3)
                expect(savedDial.recipient, "recipient").to.eq(newDial.address)
                expect(savedDial.notify, "notify").to.eq(true)
                expect(savedDial.cap, "staking").to.eq(0)
                expect(savedDial.balance, "balance").to.eq(0)
                expect(savedDial.disabled, "disabled").to.eq(false)

                expect(savedDial.voteHistory, "number votes").to.lengthOf(1)
                const epochExpected = await currentWeekEpoch()
                expect(savedDial.voteHistory[0].epoch, "epoch").to.eq(epochExpected)
                expect(savedDial.voteHistory[0].votes, "votes").to.eq(0)
            })
            // TODO add new dial after first week of rewards has been processed.
            context("should fail when", () => {
                it("recipient is zero", async () => {
                    const tx = emissionsController.connect(sa.governor.signer).addDial(ZERO_ADDRESS, 0, true)
                    await expect(tx).to.revertedWith("Dial address is zero")
                })
                it("cap > 100", async () => {
                    const tx = emissionsController.connect(sa.governor.signer).addDial(dials[0].address, 101, true)
                    await expect(tx).to.revertedWith("Invalid cap")
                })
                it("existing dial", async () => {
                    const tx = emissionsController.connect(sa.governor.signer).addDial(dials[0].address, 0, true)
                    await expect(tx).to.revertedWith("Dial already exists")
                })
                it("not governor", async () => {
                    const tx = emissionsController.addDial(newDial.address, 0, true)
                    await expect(tx).to.revertedWith("Only governor can execute")
                })
            })
        })
        describe("update dial", () => {
            const voter1Staking1Votes = simpleToExactAmount(100)
            const voter2Staking1Votes = simpleToExactAmount(200)
            const voter3Staking1Votes = simpleToExactAmount(300)
            let dial1
            let dial2
            let dial3
            beforeEach(async () => {
                await deployEmissionsController()
                await increaseTime(ONE_WEEK)

                await staking1.setVotes(voter1.address, voter1Staking1Votes)
                await staking1.setVotes(voter2.address, voter2Staking1Votes)
                await staking1.setVotes(voter3.address, voter3Staking1Votes)

                // Voter 1 puts 100 votes to dial 1
                await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])

                // Voter 2 puts 200 votes to dial 2
                await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])

                // Voter 3 puts 300 votes to dial 3
                await emissionsController.connect(voter3.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
            })
            it("Governor disables dial 1 with votes", async () => {
                const dialBefore = await snapDial(emissionsController, 0)
                expect(dialBefore.disabled, "dial 1 disabled before").to.eq(false)

                const tx = await emissionsController.connect(sa.governor.signer).updateDial(0, true, true)

                await expect(tx).to.emit(emissionsController, "UpdatedDial").withArgs(0, true, true)

                const dialAfter = await snapDial(emissionsController, 0)
                expect(dialAfter.disabled, "dial 1 disabled after").to.eq(true)
                await increaseTime(ONE_WEEK)

                const nextEpochEmission = await nextRewardAmount(emissionsController)
                const tx2 = await emissionsController.calculateRewards()

                const adjustedDial2 = nextEpochEmission.mul(200).div(500)
                const adjustedDial3 = nextEpochEmission.mul(300).div(500)
                await expect(tx2).to.emit(emissionsController, "PeriodRewards").withArgs([0, adjustedDial2, adjustedDial3])
            })
            it("Governor reenables dial", async () => {
                const dialId = 0
                await emissionsController.connect(sa.governor.signer).updateDial(dialId, true, true)

                await increaseTime(ONE_WEEK)
                await emissionsController.calculateRewards()
                await increaseTime(ONE_WEEK.add(60))

                // Reenable dial 1
                const tx = await emissionsController.connect(sa.governor.signer).updateDial(0, false, true)
                await expect(tx).to.emit(emissionsController, "UpdatedDial").withArgs(0, false, true)
                expect((await emissionsController.dials(0)).disabled, "dial 1 reenabled after").to.eq(false)

                const nextEpochEmission = await nextRewardAmount(emissionsController)
                const tx2 = await emissionsController.calculateRewards()

                dial1 = nextEpochEmission.mul(100).div(600)
                dial2 = nextEpochEmission.mul(200).div(600)
                dial3 = nextEpochEmission.mul(300).div(600)
                await expect(tx2).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])
            })
            it("Governor fails to disable invalid 4th dial", async () => {
                const tx = emissionsController.connect(sa.governor.signer).updateDial(3, true, true)
                await expect(tx).to.revertedWith("Invalid dial id")
            })
            it("Default user fails to update dial", async () => {
                const tx = emissionsController.updateDial(1, true, true)
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
        const voter1Staking1Votes = simpleToExactAmount(100)
        const voter1Staking2Votes = simpleToExactAmount(200)
        const voter2Staking1Votes = simpleToExactAmount(600)
        const voter3Staking1Votes = simpleToExactAmount(300)
        beforeEach(async () => {
            await deployEmissionsController()

            await rewardToken.approve(emissionsController.address, totalRewardsSupply)
            await staking1.setVotes(voter1.address, voter1Staking1Votes)
            await staking2.setVotes(voter1.address, voter1Staking2Votes)
            await staking1.setVotes(voter2.address, voter2Staking1Votes)
            await staking1.setVotes(voter3.address, voter3Staking1Votes)
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
        context("Voter 1 80/20 votes to dial 1 & 2, Voter 2 50/50 votes to dial 2 & 3", () => {
            // 80% of Voter 1's 300 votes
            let dial1
            // 20% of Voter 1's 300 votes + 50% of Voter 2's 600 votes
            let dial2
            // 50% of Voter 2's 600 votes
            let dial3
            beforeEach(async () => {
                // Voter 1 splits their 300 votes with 80% to dial 1 and 20% to dial 2
                await emissionsController.connect(voter1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 160 },
                    { dialId: 1, weight: 40 },
                ])
                // Voter 2 splits their 600 votes with 50% to dial 1 and 50% to dial 2
                await emissionsController.connect(voter2.signer).setVoterDialWeights([
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
    //        - reading voteHistory of NEW dials, and of OLD dials  - [DONE]
    //        - dials that go enabled -> disabled and vice versa  - [DONE]
    //        - capped dials and vote redistribution
    //          - cap not met (< maxVotes)
    //          - total distribution equal
    describe("calculating rewards", () => {
        const VOTERS = { "1": { votes: 300 }, "2": { votes: 600 }, "3": { votes: 300 } }
        const voter1Staking1Votes = simpleToExactAmount(VOTERS["1"].votes / 3)
        const voter1Staking2Votes = simpleToExactAmount((VOTERS["1"].votes / 3) * 2)
        const voter2Staking1Votes = simpleToExactAmount(VOTERS["2"].votes)
        const voter3Staking1Votes = simpleToExactAmount(VOTERS["3"].votes)

        beforeEach(async () => {
            await deployEmissionsController()
            await staking1.setVotes(voter1.address, voter1Staking1Votes)
            await staking2.setVotes(voter1.address, voter1Staking2Votes)
            await staking1.setVotes(voter2.address, voter2Staking1Votes)
            await staking1.setVotes(voter3.address, voter3Staking1Votes)
            await increaseTime(ONE_WEEK)

            // Dial's rewards balances
            expect((await emissionsController.dials(0)).balance, "dial 1 balance before").to.eq(0)
            expect((await emissionsController.dials(1)).balance, "dial 2 balance before").to.eq(0)
            expect((await emissionsController.dials(2)).balance, "dial 3 balance before").to.eq(0)

            // Voter voting power
            expect(await emissionsController.callStatic.getVotes(voter1.address), "Voter 1 votes before").to.eq(
                simpleToExactAmount(VOTERS["1"].votes),
            )
            expect(await emissionsController.callStatic.getVotes(voter2.address), "Voter 2 votes before").to.eq(
                simpleToExactAmount(VOTERS["2"].votes),
            )
            expect(await emissionsController.callStatic.getVotes(voter3.address), "Voter 3 votes before").to.eq(
                simpleToExactAmount(VOTERS["3"].votes),
            )
        })
        it("with no weights", async () => {
            const [startEpoch, lastEpochBefore] = await emissionsController.epochs()
            await increaseTime(ONE_WEEK)

            // Expect initial vote with no weight
            const dialsVoteHistory = [{ dialId: 0, votesNo: 1, lastVote: 0, lastEpoch: startEpoch }]
            await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

            const tx = await emissionsController.calculateRewards()

            await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, 0, 0])

            const [, lastEpochMid] = await emissionsController.epochs()
            expect(lastEpochMid, "last epoch after").to.eq(lastEpochBefore + 1)

            // Should increase the vote history after calculateRewards, no weight
            await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

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
                    ;[startEpoch, lastEpochBefore] = await emissionsController.epochs()

                    // Expects initial vote history with no weight
                    ;[...Array(INITIAL_DIALS_NO).keys()].forEach(async (dialId) =>
                        expectDialVotesHistoryForDial(emissionsController, { dialId, votesNo: 1, lastVote: 0, lastEpoch: startEpoch }),
                    )
                })
                afterEach(async () => {
                    const [, lastEpochAfter] = await emissionsController.epochs()
                    expect(lastEpochAfter, "last epoch after").to.eq(lastEpochBefore + 1)
                })
                it("Voter 1 all votes to dial 1", async () => {
                    // Voter 1 gives all 300 votes to dial 1
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])

                    // Expect dial 1 vote history updated with 300 votes (dialId = n-1)
                    const dialsVoteHistory = [
                        {
                            dialId: 0,
                            votesNo: 1,
                            lastVote: VOTERS["1"].votes,
                            lastEpoch: startEpoch,
                        },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)
                    await increaseTime(ONE_WEEK)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Should increase the vote history after calculateRewards, no change on weights
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([nextEpochEmission, 0, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(nextEpochEmission)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                it("Voter 1 all votes to dial 1, Voter 2 all votes to dial 2", async () => {
                    // Voter 1 gives all 300 votes to dial 1
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                    // Voter 2 gives all 600 votes to dial 2
                    await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1)
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 1, lastVote: VOTERS["1"].votes, lastEpoch: startEpoch },
                        { dialId: 1, votesNo: 1, lastVote: VOTERS["2"].votes, lastEpoch: startEpoch },
                        { dialId: 2, votesNo: 1, lastVote: 0, lastEpoch: startEpoch },
                    ]

                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Voter 1 has 300 of the 900 votes (1/3)
                    const dial1 = nextEpochEmission.div(3)
                    // Voter 2 has 600 of the 900 votes (2/3)
                    const dial2 = nextEpochEmission.mul(2).div(3)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                    // Should increase the vote history after calculateRewards, no  change on weights
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                it("Voter 1 50/50 votes to dial 1 & 2, Voter 2 50/50 votes to dial 1 & 2", async () => {
                    // Voter 1 splits their 300 votes with 50% to dial 1 and 50% to dial 2
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 100 },
                        { dialId: 1, weight: 100 },
                    ])
                    // Voter 2 splits their 600 votes with 50% to dial 1 and 50% to dial 2
                    await emissionsController.connect(voter2.signer).setVoterDialWeights([
                        { dialId: 0, weight: 100 },
                        { dialId: 1, weight: 100 },
                    ])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 450 , dial 2 - 450 , dial 3 - 0 (dialId = n-1)
                    const dial1Votes = VOTERS["1"].votes * 0.5 + VOTERS["2"].votes * 0.5
                    const dial2Votes = VOTERS["1"].votes * 0.5 + VOTERS["2"].votes * 0.5
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 1, lastVote: dial1Votes, lastEpoch: startEpoch },
                        { dialId: 1, votesNo: 1, lastVote: dial2Votes, lastEpoch: startEpoch },
                        { dialId: 2, votesNo: 1, lastVote: 0, lastEpoch: startEpoch },
                    ]

                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Should increase the vote history after calculateRewards, no change on weights
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    // Voter 1 and 2 split their votes 50/50
                    const dial1 = nextEpochEmission.div(2)
                    const dial2 = nextEpochEmission.div(2)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                it("Voter 1 20/80 votes to dial 1 & 2, Voter 2 all votes to dial 3", async () => {
                    // Voter 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 40 },
                        { dialId: 1, weight: 160 },
                    ])
                    // Voter 2 gives all 600 votes to dial 3
                    await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    const dial1Votes = VOTERS["1"].votes * 0.2
                    const dial2Votes = VOTERS["1"].votes * 0.8
                    const dial3Votes = VOTERS["2"].votes
                    // Expects dial 1 - 60 , dial 240 - 600 , dial 3 - 600
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 1, lastVote: dial1Votes, lastEpoch: startEpoch },
                        { dialId: 1, votesNo: 1, lastVote: dial2Votes, lastEpoch: startEpoch },
                        { dialId: 2, votesNo: 1, lastVote: dial3Votes, lastEpoch: startEpoch },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1)
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    // Voter 1 20% of 300 votes
                    const dial1 = nextEpochEmission.mul(VOTERS["1"].votes).div(5).div(900)
                    // Voter 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul(VOTERS["1"].votes).mul(4).div(5).div(900)
                    // Voter 2 600 votes
                    const dial3 = nextEpochEmission.mul(VOTERS["2"].votes).div(900)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(dial3)
                })
            })
            context("in second emissions period", () => {
                // Voter's previous votes
                // Voter 1 300 20% dial 1, 80% dial 2
                // Voter 2 600 100% dial 3
                let balDial1Before
                let balDial2Before
                let balDial3Before
                let startEpoch
                beforeEach(async () => {
                    ;[startEpoch] = await emissionsController.epochs()

                    // Voter 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 40 },
                        { dialId: 1, weight: 160 },
                    ])
                    // Voter 2 gives all 600 votes to dial 2
                    await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
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
                it("Voter 1 changes weights to 80/20 dial 1 & 2", async () => {
                    // User 1 splits their 300 votes with 80% to dial 1 and 20% to dial 2
                    // User 2 keeps its 600 votes on dial 3
                    // Voter 1 splits their 300 votes with 80% to dial 1 and 20% to dial 2
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 160 },
                        { dialId: 1, weight: 40 },
                    ])
                    await increaseTime(ONE_WEEK)
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 2, lastVote: VOTERS["1"].votes * 0.8, lastEpoch: startEpoch + 1 },
                        { dialId: 1, votesNo: 2, lastVote: VOTERS["1"].votes * 0.2, lastEpoch: startEpoch + 1 },
                        { dialId: 2, votesNo: 2, lastVote: VOTERS["2"].votes, lastEpoch: startEpoch + 1 },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()
                    // Expects dial 1 - 240 , dial 2 - 60 , dial 3 - 600 (dialId = n-1)
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    // Voter 1 80% of 300 votes
                    const dial1 = nextEpochEmission.mul(VOTERS["1"].votes * 0.8).div(900)
                    // Voter 1 20% of 300 votes
                    const dial2 = nextEpochEmission.mul(VOTERS["1"].votes * 0.2).div(900)
                    // Voter 2 600 votes
                    const dial3 = nextEpochEmission.mul(VOTERS["2"].votes).div(900)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("Voter 1 removes 20% to dial 1", async () => {
                    // Voter gives 80% of their 300 votes to dial 2. The remaining 20% (40) is not set
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 1, weight: 160 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 0 , dial 2 - 600 , dial 3 - 0 (dialId = n-1)
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 2, lastVote: 0, lastEpoch: startEpoch + 1 },
                        { dialId: 1, votesNo: 2, lastVote: VOTERS["1"].votes * 0.8, lastEpoch: startEpoch + 1 },
                        { dialId: 2, votesNo: 2, lastVote: VOTERS["2"].votes, lastEpoch: startEpoch + 1 },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1)
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    // Total votes is 900 - 20% * 300 = 900 - 60 = 840
                    // Voter 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul((VOTERS["1"].votes * 4) / 5).div(840)
                    // Voter 2 600 votes
                    const dial3 = nextEpochEmission.mul(VOTERS["2"].votes).div(840)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("Voter 1 changes all to dial 3", async () => {
                    // Voter 1 gives all 300 votes to dial 3
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 0 , dial 2 - 0 , dial 3 - 900 (dialId = n-1)
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 2, lastVote: 0, lastEpoch: startEpoch + 1 },
                        { dialId: 1, votesNo: 2, lastVote: 0, lastEpoch: startEpoch + 1 },
                        { dialId: 2, votesNo: 2, lastVote: VOTERS["1"].votes + VOTERS["2"].votes, lastEpoch: startEpoch + 1 },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 0 , dial 2 - 0 , dial 3 - 900 (dialId = n-1)
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, 0, nextEpochEmission])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(
                        balDial3Before.add(nextEpochEmission),
                    )
                })
                it("Voter 3 all weight on dial 1", async () => {
                    // Voter 3 gives all 300 votes to dial 1
                    await emissionsController.connect(voter3.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 360 , dial 2 - 240 , dial 3 - 600 (dialId = n-1)
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 2, lastVote: VOTERS["1"].votes * 0.2 + VOTERS["3"].votes, lastEpoch: startEpoch + 1 },
                        { dialId: 1, votesNo: 2, lastVote: VOTERS["1"].votes * 0.8, lastEpoch: startEpoch + 1 },
                        { dialId: 2, votesNo: 2, lastVote: VOTERS["2"].votes, lastEpoch: startEpoch + 1 },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 360 , dial 2 - 240 , dial 3 - 600 (dialId = n-1)
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    // Voter 1 20% of 300 votes + User 3 300 votes
                    const dial1 = nextEpochEmission.mul(300 + 300 / 5).div(1200)
                    // Voter 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul((300 * 4) / 5).div(1200)
                    // Voter 2 600 votes
                    const dial3 = nextEpochEmission.mul(VOTERS["2"].votes).div(1200)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("Voter 3 all weight on dial 2", async () => {
                    // Voter 3 gives all 300 votes to dial 2
                    await emissionsController.connect(voter3.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1)
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 2, lastVote: VOTERS["1"].votes * 0.2, lastEpoch: startEpoch + 1 },
                        { dialId: 1, votesNo: 2, lastVote: VOTERS["1"].votes * 0.8 + VOTERS["3"].votes, lastEpoch: startEpoch + 1 },
                        { dialId: 2, votesNo: 2, lastVote: VOTERS["2"].votes, lastEpoch: startEpoch + 1 },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1)
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    // Voter 1 20% of 300 votes + User 3 300 votes
                    const dial1 = nextEpochEmission.mul(300 / 5).div(1200)
                    // Voter 1 80% of 300 votes, Voter 3 300 votes
                    const dial2 = nextEpochEmission.mul(300 + (300 * 4) / 5).div(1200)
                    // Voter 2 600 votes
                    const dial3 = nextEpochEmission.mul(600).div(1200)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("Voter 2 removes all votes to dial 3", async () => {
                    // Voter 2 removes all 600 votes from dial 3
                    await emissionsController.connect(voter2.signer).setVoterDialWeights([])
                    await increaseTime(ONE_WEEK)

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1)
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 2, lastVote: VOTERS["1"].votes * 0.2, lastEpoch: startEpoch + 1 },
                        { dialId: 1, votesNo: 2, lastVote: VOTERS["1"].votes * 0.8, lastEpoch: startEpoch + 1 },
                        { dialId: 2, votesNo: 2, lastVote: 0, lastEpoch: startEpoch + 1 },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Expects dial 1 - 300 , dial 2 - 600 , dial 3 - 0 (dialId = n-1)
                    await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                    // Voter 1 20% of 300 votes
                    const dial1 = nextEpochEmission.mul(300 / 5).div(300)
                    // Voter 1 80% of 300 votes
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
                it("Voter 1 changes weights to 80/20 dial 1 & 2", async () => {
                    // Voter 1 splits their 300 votes with 80% to dial 1 and 20% to dial 2
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([
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
                it("Voter 1 does not change their voting power", async () => {
                    expect(await emissionsController.callStatic.getVotes(voter1.address), "Voter 1 votes before").to.eq(
                        simpleToExactAmount(300),
                    )

                    await staking1.setVotes(voter1.address, voter1Staking1Votes)

                    expect(await emissionsController.callStatic.getVotes(voter1.address), "Voter 1 votes after").to.eq(
                        simpleToExactAmount(300),
                    )
                })
                it("Voter 3 increases voting power before setting weights", async () => {
                    expect(await emissionsController.callStatic.getVotes(voter3.address), "Voter 3 votes before").to.eq(voter3Staking1Votes)

                    await staking1.setVotes(voter3.address, simpleToExactAmount(400))

                    expect(await emissionsController.callStatic.getVotes(voter3.address), "Voter 3 votes after").to.eq(
                        simpleToExactAmount(400),
                    )
                })
                it("Voter 1 increases voting power to dial 1", async () => {
                    // Voter 1 gives all 300 votes to dial 1
                    await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    // Voter 1 increases votes from 300 to 400 by increasing staking 2 from 200 to 300
                    await staking2.setVotes(voter1.address, simpleToExactAmount(300))
                    expect(await emissionsController.callStatic.getVotes(voter1.address), "Voter 1 votes after").to.eq(
                        simpleToExactAmount(400),
                    )

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([nextEpochEmission, 0, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(nextEpochEmission)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                context("Voter 1 votes to dial 1, Voter 2 votes to dial 2", () => {
                    beforeEach(async () => {
                        // Voter 1 gives all 300 votes to dial 1
                        await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                        // Voter 2 gives all 600 votes to dial 2
                        await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
                    })
                    it("Voter 2 doubled voting power", async () => {
                        // Voter 2 doubles votes from 600 to 1200
                        await staking1.setVotes(voter2.address, simpleToExactAmount(1200))
                        expect(await emissionsController.callStatic.getVotes(voter1.address), "Voter 1 votes after").to.eq(
                            simpleToExactAmount(300),
                        )
                        expect(await emissionsController.callStatic.getVotes(voter2.address), "Voter 2 votes after").to.eq(
                            simpleToExactAmount(1200),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // Voter 1 has 300 of the 1500 votes (1/5)
                        const dial1 = nextEpochEmission.div(5)
                        // Voter 2 has 1200 of the 1500 votes (4/5)
                        const dial2 = nextEpochEmission.mul(4).div(5)
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                    it("Voter 2 halves voting power", async () => {
                        // Voter 2 halves votes from 600 to 300
                        await staking1.setVotes(voter2.address, simpleToExactAmount(300))
                        expect(await emissionsController.callStatic.getVotes(voter1.address), "Voter 1 votes after").to.eq(
                            simpleToExactAmount(300),
                        )
                        expect(await emissionsController.callStatic.getVotes(voter2.address), "Voter 2 votes after").to.eq(
                            simpleToExactAmount(300),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // Voter 1 has 300 of the 600 votes (1/2)
                        const dial1 = nextEpochEmission.div(2)
                        // Voter 2 has 300 of the 600 votes (1/2)
                        const dial2 = nextEpochEmission.div(2)
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                    it("Voter 2 removes all voting power", async () => {
                        // Voter 2 cooldowns all stake which removes their voting power
                        await staking1.setVotes(voter2.address, simpleToExactAmount(0))
                        expect(await emissionsController.callStatic.getVotes(voter1.address), "Voter 1 votes after").to.eq(
                            simpleToExactAmount(300),
                        )
                        expect(await emissionsController.callStatic.getVotes(voter2.address), "Voter 2 votes after").to.eq(
                            simpleToExactAmount(0),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // Voter 1 has 300 of the 300 votes
                        const dial1 = nextEpochEmission
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, 0, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                    it("Voter 2 delegates to Voter 1 who has set weights", async () => {
                        // Voter 2 delegates votes to Voter 1
                        await staking1.transferVotes(voter2.address, voter1.address, simpleToExactAmount(600))
                        expect(await emissionsController.callStatic.getVotes(voter1.address), "Voter 1 votes after").to.eq(
                            simpleToExactAmount(900),
                        )
                        expect(await emissionsController.callStatic.getVotes(voter2.address), "Voter 2 votes after").to.eq(
                            simpleToExactAmount(0),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // Voter 1 has 900 of the 900 votes
                        const dial1 = nextEpochEmission
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, 0, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                    it("Voter 2 delegates to Voter 3 who has not set weights", async () => {
                        // Voter 2 delegates votes to Voter 3
                        await staking1.transferVotes(voter2.address, voter1.address, simpleToExactAmount(600))
                        expect(await emissionsController.callStatic.getVotes(voter1.address), "Voter 1 votes after").to.eq(
                            simpleToExactAmount(900),
                        )
                        expect(await emissionsController.callStatic.getVotes(voter2.address), "Voter 2 votes after").to.eq(
                            simpleToExactAmount(0),
                        )
                        await increaseTime(ONE_WEEK)

                        const nextEpochEmission = await nextRewardAmount(emissionsController)
                        const tx = await emissionsController.calculateRewards()

                        // Voter 1 has 300 of the 300 votes
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
            it("Only Voter 1 allocates 1% to dial 1", async () => {
                // Voter 1 gives 1% of their 300 votes to dial 1
                await emissionsController.connect(voter1.signer).setVoterDialWeights([
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
            it("Voter 1 20/80 votes to dial 1 & 2, Voter 2 all votes to dial 4", async () => {
                // Voter 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                await emissionsController.connect(voter1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 40 },
                    { dialId: 1, weight: 160 },
                ])
                // Voter 2 gives all 600 votes to dial 3
                await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 3, weight: 200 }])
                await increaseTime(ONE_WEEK)

                const tx = await emissionsController.calculateRewards()

                // Voter 1 20% of 300 votes
                const dial1 = weightedDistributionAmount.mul(20).div(100)
                // Voter 1 80% of 300 votes
                const dial2 = weightedDistributionAmount.mul(80).div(100)
                // Voter 2 600 votes
                await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0, fixedDistributionAmount])

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                expect((await emissionsController.dials(3)).balance, "dial 4 balance after").to.eq(fixedDistributionAmount)
            })
            it("Voter 1 and 2 all to dial 4 which is fixed", async () => {
                // Voter 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 3, weight: 200 }])
                // Voter 2 gives all 600 votes to dial 3
                await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 3, weight: 200 }])
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

                // Voter 1 all 300 votes to dial 1
                await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                // Voter 2 all 600 votes to dial 2
                await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
                await increaseTime(ONE_WEEK)

                const tx = emissionsController.calculateRewards()

                await expect(tx).to.revertedWith("staking amounts > weekly emission")
            })
        })
        context("dial is", () => {
            let startEpoch: number
            beforeEach(async () => {
                ;[startEpoch] = await emissionsController.epochs()
                await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
            })
            context("in first emissions period", () => {
                it("is disable then it should not receive any distribution", async () => {
                    // Given that dial 1 is disabled, and dial 2 is enabled
                    // and voter 1 gives all its votes to dial 1, and voter 2 gives all its votes to dial 2,
                    // and dial 3 does not have any vote weight
                    const dialBefore = []
                    let tx = await emissionsController.connect(sa.governor.signer).updateDial(0, true, true)
                    dialBefore[0] = await snapDial(emissionsController, 0)
                    dialBefore[1] = await snapDial(emissionsController, 1)
                    expect(dialBefore[0].disabled, "dial 1 disabled before").to.eq(true)
                    expect(dialBefore[1].disabled, "dial 2 disabled before").to.eq(false)
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 1, lastVote: VOTERS["1"].votes, lastEpoch: startEpoch },
                        { dialId: 1, votesNo: 1, lastVote: VOTERS["2"].votes, lastEpoch: startEpoch },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    // When it calculates rewards
                    await increaseTime(ONE_WEEK)
                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    tx = await emissionsController.calculateRewards()

                    const dialAfter = []
                    dialAfter[0] = await snapDial(emissionsController, 0)
                    dialAfter[1] = await snapDial(emissionsController, 1)

                    // Then disabled dials should not receive any distribution
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, nextEpochEmission, 0])
                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(0)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(nextEpochEmission)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)

                    // No new votes should be cast for disabled dials
                    expect(dialBefore[0].voteHistory.length, "dial 1 vote history should not change").to.eq(dialAfter[0].voteHistory.length)
                    expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, [dialsVoteHistory[1]])
                })
            })
            context("in second emissions period", () => {
                const dialBefore: Array<DialData> = []
                const dialAfter: Array<DialData> = []
                let nextEpochEmission: Array<BN>

                beforeEach(async () => {
                    // Given a dial 1 is disabled, and dial 2 is enabled
                    // and voter 1 gives all its votes to dial 1, and voter 2 gives all its votes to dial 2,
                    // and dial 3 does not have any vote weight
                    await emissionsController.connect(sa.governor.signer).updateDial(0, true, true)

                    dialBefore[0] = await snapDial(emissionsController, 0)
                    dialBefore[1] = await snapDial(emissionsController, 1)
                    expect(dialBefore[0].disabled, "dial 1 disabled before").to.eq(true)
                    expect(dialBefore[1].disabled, "dial 2 disabled before").to.eq(false)
                    const dialsVoteHistory = [
                        { dialId: 0, votesNo: 1, lastVote: VOTERS["1"].votes, lastEpoch: startEpoch },
                        { dialId: 1, votesNo: 1, lastVote: VOTERS["2"].votes, lastEpoch: startEpoch },
                    ]
                    await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                    // When it calculates rewards for week one (dial 1 disabled)
                    await increaseTime(ONE_WEEK)
                    nextEpochEmission = [await nextRewardAmount(emissionsController)]
                    await emissionsController.calculateRewards()

                    dialAfter[0] = await snapDial(emissionsController, 0)
                    dialAfter[1] = await snapDial(emissionsController, 1)

                    // Then no new votes should be cast for disabled dials
                    expect(dialBefore[0].voteHistory.length, "dial 1 vote history should not change").to.eq(dialAfter[0].voteHistory.length)
                })
                it("is disabled then re-enabled it should receive distribution", async () => {
                    // Given a dial 1 is disabled, and dial 2 is enabled
                    // and voter 1 gives all its votes to dial 1, and voter 2 gives all its votes to dial 2,
                    // and dial 3 does not have any vote weight

                    // When the dial is re-enabled and it calculates rewards
                    let tx = await emissionsController.connect(sa.governor.signer).updateDial(0, false, true)
                    await expect(tx).to.emit(emissionsController, "UpdatedDial").withArgs(0, false, true)

                    await increaseTime(ONE_WEEK)
                    nextEpochEmission[1] = await nextRewardAmount(emissionsController)
                    tx = await emissionsController.calculateRewards()
                    dialAfter[0] = await snapDial(emissionsController, 0)
                    dialAfter[1] = await snapDial(emissionsController, 1)

                    // Then re-enabled dials should receive distribution
                    // Voter 1 has 300 of the 900 votes (1/3)
                    const adjustedDial1 = nextEpochEmission[1].div(3)
                    // Voter 2 has 600 of the 900 votes (2/3)
                    const adjustedDial2 = nextEpochEmission[1].mul(2).div(3)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([adjustedDial1, adjustedDial2, 0])
                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(adjustedDial1)
                    // Balance on dial 2, is the full first epoch emission + the adjusted dial 2 second emission
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(
                        nextEpochEmission[0].add(adjustedDial2),
                    )
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)

                    // New votes should be cast for enabled dials
                    expect(dialBefore[0].voteHistory.length + 1, "dial 1 vote history should increase").to.eq(
                        dialAfter[0].voteHistory.length,
                    )
                    expect(dialBefore[0].voteHistory.slice(-1)[0].votes, "dial 1 vote weight should not change").to.eq(
                        dialAfter[0].voteHistory.slice(-1)[0].votes,
                    )

                    expect(dialBefore[1].voteHistory.length + 2, "dial 2 vote history should increase").to.eq(
                        dialAfter[1].voteHistory.length,
                    )
                    expect(dialBefore[1].voteHistory.slice(-1)[0].votes, "dial 2 vote weight should not change").to.eq(
                        dialAfter[1].voteHistory.slice(-1)[0].votes,
                    )
                })
            })
            // TODO after a new dial was added that was not in previous distributions [DONE]
            it("added that was not in previous distributions", async () => {
                // --- Given ---
                // that dial 1,2 and 3 are enabled
                // and voter 1 gives all its votes to dial 1, and voter 2 gives all its votes to dial 2, and dial 3 does not have any vote weight

                const dialBefore: Array<DialData> = []
                const dialAfter: Array<DialData> = []
                const adjustedDials: BN[][] = [[]]

                dialBefore[0] = await snapDial(emissionsController, 0)
                dialBefore[1] = await snapDial(emissionsController, 1)
                expect(dialBefore[0].disabled, "dial 1 disabled before").to.eq(false)
                expect(dialBefore[1].disabled, "dial 2 disabled before").to.eq(false)
                const dialsVoteHistory = [
                    { dialId: 0, votesNo: 1, lastVote: VOTERS["1"].votes, lastEpoch: startEpoch },
                    { dialId: 1, votesNo: 1, lastVote: VOTERS["2"].votes, lastEpoch: startEpoch },
                    { dialId: 2, votesNo: 1, lastVote: 0, lastEpoch: startEpoch },
                ]
                await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                // it calculates rewards for week one
                await increaseTime(ONE_WEEK)
                let nextEpochEmission = await nextRewardAmount(emissionsController)
                let tx = await emissionsController.calculateRewards()

                dialAfter[0] = await snapDial(emissionsController, 0)
                dialAfter[1] = await snapDial(emissionsController, 1)

                adjustedDials[0] = []
                adjustedDials[1] = []
                adjustedDials[3] = []

                // Voter 1 has 300 of the 900 votes (1/3)
                adjustedDials[0][0] = nextEpochEmission.div(3)
                // Voter 2 has 600 of the 900 votes (2/3)
                adjustedDials[1][0] = nextEpochEmission.mul(2).div(3)
                await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([adjustedDials[0][0], adjustedDials[1][0], 0])
                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(adjustedDials[0][0])
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(adjustedDials[1][0])
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)

                // -- When --
                // it adds a new dial and calculates the distribution

                const newDial = await new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(
                    rewardToken.address,
                    DEAD_ADDRESS,
                )
                tx = await emissionsController.connect(sa.governor.signer).addDial(newDial.address, 0, true)
                await expect(tx).to.emit(emissionsController, "AddedDial").withArgs(3, newDial.address)

                // Assign voters 3 weight  to new dial
                await emissionsController.connect(voter3.signer).setVoterDialWeights([{ dialId: 3, weight: 200 }])
                dialBefore[3] = await snapDial(emissionsController, 3)

                // calculates distribution

                await increaseTime(ONE_WEEK)
                nextEpochEmission = await nextRewardAmount(emissionsController)
                tx = await emissionsController.calculateRewards()

                dialAfter[0] = await snapDial(emissionsController, 0)
                dialAfter[1] = await snapDial(emissionsController, 1)
                dialAfter[3] = await snapDial(emissionsController, 3)

                // -- Then --
                // the new dial should receive emissions after calculating rewards
                // Voter 1 has 300 of the 1200 votes (1/4)
                adjustedDials[0][1] = nextEpochEmission.div(4)
                // Voter 2 has 600 of the 1200 votes (2/4)
                adjustedDials[1][1] = nextEpochEmission.div(2)
                // Voter 3 has 300 of the 1200 votes (2/5)
                adjustedDials[3][0] = BN.from(0)
                adjustedDials[3][1] = nextEpochEmission.div(4)
                // Then disabled dials should not receive any distribution

                await expect(tx)
                    .to.emit(emissionsController, "PeriodRewards")
                    .withArgs([adjustedDials[0][1], adjustedDials[1][1], 0, adjustedDials[3][1]])

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(adjustedDials[0].reduce(sum))
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(adjustedDials[1].reduce(sum))
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                expect((await emissionsController.dials(3)).balance, "dial new balance after").to.eq(adjustedDials[3].reduce(sum))
                // New votes should be cast for new dial
                expect(dialBefore[3].voteHistory.length + 1, "dial new vote history should increase").to.eq(dialAfter[3].voteHistory.length)
                expect(dialBefore[3].voteHistory.slice(-1)[0].votes, "dial 1 vote weight should not change").to.eq(
                    dialAfter[3].voteHistory.slice(-1)[0].votes,
                )
            })
        })
        // after a new staking contract was added that was not in previous distributions [DONE]
        context("change the number of contracts", async () => {
            const dialBefore: Array<DialData> = []
            const dialAfter: Array<DialData> = []
            const nextEpochEmission: Array<BN> = []
            const adjustedDials: BN[][] = [[]]
            let startEpoch: number
            let staking3: MockStakingContract
            const voter1Staking3Votes = simpleToExactAmount(300)

            // Perform first emissions period and calculate distribution
            beforeEach(async () => {
                // Given  dial 1, 2 and 3 are enabled.
                // and voter 1 gives all its votes to dial 1, and voter 2 gives all its votes to dial 2,
                // and dial 3 does not have any vote weight
                ;[startEpoch] = await emissionsController.epochs()
                await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                await emissionsController.connect(voter2.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])

                dialBefore[0] = await snapDial(emissionsController, 0)
                dialBefore[1] = await snapDial(emissionsController, 1)
                expect(dialBefore[0].disabled, "dial 1 disabled before").to.eq(false)
                expect(dialBefore[1].disabled, "dial 2 disabled before").to.eq(false)
                const dialsVoteHistory = [
                    { dialId: 0, votesNo: 1, lastVote: VOTERS["1"].votes, lastEpoch: startEpoch },
                    { dialId: 1, votesNo: 1, lastVote: VOTERS["2"].votes, lastEpoch: startEpoch },
                ]
                await expectDialVotesHistoryForDials(emissionsController, dialsVoteHistory)

                // When it calculates rewards for week one (dial 1 disabled)
                await increaseTime(ONE_WEEK)
                nextEpochEmission[0] = await nextRewardAmount(emissionsController)
                const tx = await emissionsController.calculateRewards()
                // Voter 1 has 300 of the 900 votes (1/3)
                adjustedDials[0] = []
                adjustedDials[0][0] = nextEpochEmission[0].div(3)
                // Voter 2 has 600 of the 900 votes (2/3)
                adjustedDials[1] = []
                adjustedDials[1][0] = nextEpochEmission[0].mul(2).div(3)

                await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([adjustedDials[0][0], adjustedDials[1][0], 0])

                // Should increase the vote history after calculateRewards, no weight
                await expectDialVotesHistoryWithoutChangeOnWeights(emissionsController, dialsVoteHistory)
                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(adjustedDials[0].reduce(sum))
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(adjustedDials[1].reduce(sum))
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)

                // Deploys new staking contract
                staking3 = await new MockStakingContract__factory(sa.default.signer).deploy()
            })

            it("adds a new staking contract and sets voter dial weights", async () => {
                // -- Given -- First distribution is done, a new staking contract is added.
                let tx = await emissionsController.connect(sa.governor.signer).addStakingContract(staking3.address)
                await expect(tx).to.emit(emissionsController, "AddStakingContract").withArgs(staking3.address)

                // Voter 1 sets voting power on staking contract 3 (new)
                await staking3.setVotes(voter1.address, voter1Staking3Votes)

                // Expect voter 1 total voting power to  increase by 300  = 600
                const voter1VotingPower = simpleToExactAmount(VOTERS["1"].votes).add(voter1Staking3Votes)
                expect(await emissionsController.getVotes(voter1.address), "Voter 1 voting power").to.eq(voter1VotingPower)

                const voter1PreferenceBefore = await emissionsController.voterPreferences(voter1.address)
                // Update voter 1 dial weights to reflect the new voting power
                await emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])

                const dialVotes = await emissionsController.getDialVotes()
                const voter1PreferenceAfter = await emissionsController.voterPreferences(voter1.address)

                expect(dialVotes[0], "dial 1 votes").to.eq(voter1VotingPower) // 600000000000000000000
                expect(dialVotes[1], "dial 2 votes").to.eq(simpleToExactAmount(VOTERS["2"].votes)) // 600000000000000000000
                expect(dialVotes[2], "dial 3 votes").to.eq(BN.from(0)) // 0
                expect(voter1PreferenceAfter.votesCast, "voter 1 votesCast").to.eq(voter1VotingPower) // 600000000000000000000
                expect(voter1PreferenceBefore.lastSourcePoke, "voter 1 lastSourcePoke updated").to.lessThan(
                    voter1PreferenceAfter.lastSourcePoke,
                )

                // -- When -- Second distribution is done
                await increaseTime(ONE_WEEK)
                nextEpochEmission[1] = await nextRewardAmount(emissionsController)
                tx = await emissionsController.calculateRewards()

                // -- Then --
                // Voter 1 has 600 of the 1200 votes (1/2)
                adjustedDials[0][1] = nextEpochEmission[1].div(2)
                // Voter 2 has 600 of the 1200 votes (1/2)
                adjustedDials[1][1] = nextEpochEmission[1].div(2)

                await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([adjustedDials[0][1], adjustedDials[1][1], 0])
                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(adjustedDials[0].reduce(sum))
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(adjustedDials[1].reduce(sum))

                // New votes should be cast, dial 1 should have 600 votes, dial 2 should have 600 votes
                dialAfter[0] = await snapDial(emissionsController, 0)
                dialAfter[1] = await snapDial(emissionsController, 1)
                expect(dialBefore[0].voteHistory.length + 2, "dial 1 vote history should increase").to.eq(dialAfter[0].voteHistory.length)
                expect(dialBefore[1].voteHistory.length + 2, "dial 2 vote history should increase").to.eq(dialAfter[1].voteHistory.length)

                expect(dialAfter[0].voteHistory.slice(-1)[0].votes, "dial 1 last vote").to.eq(voter1VotingPower)
                expect(dialBefore[1].voteHistory.slice(-1)[0].votes, "dial 2 vote weight should not change").to.eq(
                    dialAfter[1].voteHistory.slice(-1)[0].votes,
                )
            })
            it("adds a new staking contract and pokes voter 1", async () => {
                // -- Given -- First distribution is done, a new staking contract is added.
                let tx = await emissionsController.connect(sa.governor.signer).addStakingContract(staking3.address)
                await expect(tx).to.emit(emissionsController, "AddStakingContract").withArgs(staking3.address)

                // Voter 1 sets voting power on staking contract 3 (new)
                await staking3.setVotes(voter1.address, voter1Staking3Votes)

                // Expect voter 1 total voting power to  increase by 300  = 600
                const voter1VotingPower = simpleToExactAmount(VOTERS["1"].votes).add(voter1Staking3Votes)
                expect(await emissionsController.getVotes(voter1.address), "Voter 1 voting power").to.eq(voter1VotingPower)

                const voter1PreferenceBefore = await emissionsController.voterPreferences(voter1.address)
                // Update voter 1 dial weights to reflect the new voting power
                // Pokes voter 1 to update their dial weights
                tx = await emissionsController.pokeSources(voter1.address)
                await expect(tx).to.emit(emissionsController, "SourcesPoked")

                const dialVotes = await emissionsController.getDialVotes()
                const voter1PreferenceAfter = await emissionsController.voterPreferences(voter1.address)

                expect(dialVotes[0], "dial 1 votes").to.eq(voter1VotingPower) // 600000000000000000000
                expect(dialVotes[1], "dial 2 votes").to.eq(simpleToExactAmount(VOTERS["2"].votes)) // 600000000000000000000
                expect(dialVotes[2], "dial 3 votes").to.eq(BN.from(0)) // 0
                expect(voter1PreferenceAfter.votesCast, "voter 1 votesCast").to.eq(voter1VotingPower) // 600000000000000000000
                expect(voter1PreferenceBefore.lastSourcePoke, "voter 1 lastSourcePoke updated").to.lessThan(
                    voter1PreferenceAfter.lastSourcePoke,
                )

                // -- When -- Second distribution is done
                await increaseTime(ONE_WEEK)
                nextEpochEmission[1] = await nextRewardAmount(emissionsController)
                tx = await emissionsController.calculateRewards()

                // -- Then --
                // Voter 1 has 600 of the 1200 votes (1/2)
                adjustedDials[0][1] = nextEpochEmission[1].div(2)
                // Voter 2 has 600 of the 1200 votes (1/2)
                adjustedDials[1][1] = nextEpochEmission[1].div(2)

                await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([adjustedDials[0][1], adjustedDials[1][1], 0])
                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(adjustedDials[0].reduce(sum))
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(adjustedDials[1].reduce(sum))

                // New votes should be cast, dial 1 should have 600 votes, dial 2 should have 600 votes
                dialAfter[0] = await snapDial(emissionsController, 0)
                dialAfter[1] = await snapDial(emissionsController, 1)
                expect(dialBefore[0].voteHistory.length + 2, "dial 1 vote history should increase").to.eq(dialAfter[0].voteHistory.length)
                expect(dialBefore[1].voteHistory.length + 2, "dial 2 vote history should increase").to.eq(dialAfter[1].voteHistory.length)

                expect(dialAfter[0].voteHistory.slice(-1)[0].votes, "dial 1 last vote").to.eq(voter1VotingPower)
                expect(dialBefore[1].voteHistory.slice(-1)[0].votes, "dial 2 vote weight should not change").to.eq(
                    dialAfter[1].voteHistory.slice(-1)[0].votes,
                )
            })
            it("adds a new staking contract and without updating voter dial weights", async () => {
                // -- Given -- First distribution is done, a new staking contract is added.
                let tx = await emissionsController.connect(sa.governor.signer).addStakingContract(staking3.address)
                await expect(tx).to.emit(emissionsController, "AddStakingContract").withArgs(staking3.address)

                // Voter 1 sets voting power on staking contract 3 (new)
                await staking3.setVotes(voter1.address, voter1Staking3Votes)

                // Expect voter 1 total voting power to  increase by 300  = 600
                const voter1VotingPower = simpleToExactAmount(VOTERS["1"].votes).add(voter1Staking3Votes)
                expect(await emissionsController.getVotes(voter1.address), "Voter 1 voting power").to.eq(voter1VotingPower)

                // -- When -- Second distribution is done
                await increaseTime(ONE_WEEK)
                nextEpochEmission[1] = await nextRewardAmount(emissionsController)
                tx = await emissionsController.calculateRewards()

                // -- Then --
                // The voting power does not change because the setVoterDialWeights or poke is not called.
                // Voter 1 has 300 of the 900 votes (1/2)
                adjustedDials[0][1] = nextEpochEmission[1].div(3)
                // Voter 2 has 600 of the 900 votes (1/2)
                adjustedDials[1][1] = nextEpochEmission[1].mul(2).div(3)

                await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([adjustedDials[0][1], adjustedDials[1][1], 0])
                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(adjustedDials[0].reduce(sum))
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(adjustedDials[1].reduce(sum))

                // New votes should be cast, dial 1 should have 300 votes, dial 2 should have 600 votes, no changes to vote history
                dialAfter[0] = await snapDial(emissionsController, 0)
                dialAfter[1] = await snapDial(emissionsController, 1)
                expect(dialBefore[0].voteHistory.length + 2, "dial 1 vote history should increase").to.eq(dialAfter[0].voteHistory.length)
                expect(dialBefore[1].voteHistory.length + 2, "dial 2 vote history should increase").to.eq(dialAfter[1].voteHistory.length)

                expect(dialBefore[0].voteHistory.slice(-1)[0].votes, "dial 1 vote weight should not change").to.eq(
                    dialAfter[0].voteHistory.slice(-1)[0].votes,
                )
                expect(dialBefore[1].voteHistory.slice(-1)[0].votes, "dial 2 vote weight should not change").to.eq(
                    dialAfter[1].voteHistory.slice(-1)[0].votes,
                )
            })
        })
    })
    describe("distributing rewards", () => {
        const voter1Staking1Votes = simpleToExactAmount(100)
        const voter1Staking2Votes = simpleToExactAmount(200)
        const voter2Staking1Votes = simpleToExactAmount(600)
        const voter3Staking1Votes = simpleToExactAmount(300)
        beforeEach(async () => {
            await deployEmissionsController()
            await staking1.setVotes(voter1.address, voter1Staking1Votes)
            await staking2.setVotes(voter1.address, voter1Staking2Votes)
            await staking1.setVotes(voter2.address, voter2Staking1Votes)
            await staking1.setVotes(voter3.address, voter3Staking1Votes)
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
        let currentTime: BN
        beforeEach(async () => {
            await deployEmissionsController()

            // Add 2 staking contracts to the existing 3 dials
            await emissionsController.connect(sa.governor.signer).addDial(staking1.address, 10, true)
            await emissionsController.connect(sa.governor.signer).addDial(staking2.address, 10, true)

            // increase 1 week so in the second launch week
            await increaseTime(ONE_WEEK)

            currentTime = await getTimestamp()
        })
        it("should poke voter 1 with no voting power", async () => {
            const tx = await emissionsController.pokeSources(voter1.address)
            await expect(tx).to.not.emit(emissionsController, "SourcesPoked")
        })
        it("should poke voter 1 with voting power but no preferences set", async () => {
            const voterPreferencesBefore = await emissionsController.voterPreferences(voter1.address)
            expect(voterPreferencesBefore.lastSourcePoke, "last poke time before").to.eq(0)
            expect(voterPreferencesBefore.votesCast, "votes cast before").to.eq(0)

            // Voter 1 has voting power in staking contracts 1 and 2
            await staking1.setVotes(voter1.address, simpleToExactAmount(50))
            await staking2.setVotes(voter1.address, simpleToExactAmount(70))

            const tx = await emissionsController.pokeSources(voter1.address)

            await expect(tx).to.not.emit(emissionsController, "SourcesPoked")

            const voterPreferencesAfter = await emissionsController.voterPreferences(voter1.address)
            expect(voterPreferencesAfter.lastSourcePoke, "last poke time after").to.eq(0)
            expect(voterPreferencesAfter.votesCast, "votes cast after").to.eq(0)
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
            const epochs = await emissionsController.epochs()
            expect(epochs.lastEpoch, "last epoch").to.eq(currentEpochWeek)
            expect(epochs.startEpoch, "start epoch").to.eq(currentEpochWeek)

            const tx = await emissionsController.pokeSources(voter1.address)

            await expect(tx).to.emit(emissionsController, "SourcesPoked").withArgs(voter1.address, 0)
            const voterPreferencesAfter = await emissionsController.voterPreferences(voter1.address)
            expect(voterPreferencesAfter.lastSourcePoke, "last poke time after").to.gt(currentTime)

            const dialVotes = await emissionsController.getDialVotes()
            expect(dialVotes, "number of dials").to.lengthOf(5)
            expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(60))
            expect(dialVotes[1], "dial 2 votes").to.eq(0)
            expect(dialVotes[2], "dial 3 votes").to.eq(0)
            expect(dialVotes[3], "dial 4 votes").to.eq(simpleToExactAmount(40))
            expect(dialVotes[4], "dial 5 votes").to.eq(0)
        })
        context("after a new staking contract added with voter 1 voting power", () => {
            const voter1Staking1VotingPower = simpleToExactAmount(1000)
            const voter1Staking2VotingPower = simpleToExactAmount(2000)
            const voter1Staking3VotingPower = simpleToExactAmount(6000)
            const voter2Staking1VotingPower = simpleToExactAmount(2222)
            let staking3: MockStakingContract
            beforeEach(async () => {
                // Voter 1 has voting power in staking contracts 1 and 2
                await staking1.setVotes(voter1.address, voter1Staking1VotingPower)
                await staking2.setVotes(voter1.address, voter1Staking2VotingPower)
                // Voter 2 only has voting power in the first staking contract
                await staking1.setVotes(voter2.address, voter2Staking1VotingPower)
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
                // New staking contract is hooked back to the emissions controller
                await staking3.setGovernanceHook(emissionsController.address)
            })
            it("should poke voter 1", async () => {
                const tx = await emissionsController.pokeSources(voter1.address)

                await expect(tx).to.emit(emissionsController, "SourcesPoked").withArgs(voter1.address, voter1Staking3VotingPower)

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(5)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(9000).mul(6).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(0)
                expect(dialVotes[2], "dial 3 votes").to.eq(0)
                expect(dialVotes[3], "dial 4 votes").to.eq(simpleToExactAmount(9000).mul(4).div(10))
                expect(dialVotes[4], "dial 5 votes").to.eq(0)

                const preferencesAfter = await emissionsController.voterPreferences(voter1.address)
                expect(preferencesAfter.lastSourcePoke, "lastSourcePoke after").to.gte(currentTime)
                expect(preferencesAfter.votesCast, "votes cast after").to.eq(simpleToExactAmount(9000))
            })
            it("should poke voter 2 with no preferences set", async () => {
                const tx = await emissionsController.pokeSources(voter2.address)

                await expect(tx).to.not.emit(emissionsController, "SourcesPoked")

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(5)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(3000).mul(6).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(0)
                expect(dialVotes[2], "dial 3 votes").to.eq(0)
                expect(dialVotes[3], "dial 4 votes").to.eq(simpleToExactAmount(3000).mul(4).div(10))
                expect(dialVotes[4], "dial 5 votes").to.eq(0)

                const preferencesAfter = await emissionsController.voterPreferences(voter2.address)
                expect(preferencesAfter.lastSourcePoke, "lastSourcePoke after").to.eq(0)
                expect(preferencesAfter.votesCast, "votes cast after").to.eq(0)
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
                // eslint-disable-next-line no-await-in-loop
                await emissionsController.connect(sa.governor.signer).addDial(Wallet.createRandom().address, 0, true)
            }
        })
        it("should set 15 preferences", async () => {
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
            const tx = await emissionsController.connect(voter1.signer).setVoterDialWeights(preferences)

            await expect(tx).to.emit(emissionsController, "PreferencesChanged")

            const receipt = await tx.wait()
            expect(receipt.events[0].args[0], "sender").to.eq(voter1.address)
            expect(receipt.events[0].args[1], "preferences length").to.lengthOf(15)
            expect(receipt.events[0].args[1][0].dialId, "first preference dial id").to.eq(preferences[0].dialId)
            expect(receipt.events[0].args[1][0].weight, "first preference weight").to.eq(preferences[0].weight)
            expect(receipt.events[0].args[1][14].dialId, "last preference dial id").to.eq(preferences[14].dialId)
            expect(receipt.events[0].args[1][14].weight, "last preference weight").to.eq(preferences[14].weight)

            const voterPreferencesAfter = await emissionsController.getVoterPreferences(voter1.address)
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
            const tx = await emissionsController.connect(voter1.signer).setVoterDialWeights(preferences)
            await expect(tx).to.emit(emissionsController, "PreferencesChanged")
            const receipt = await tx.wait()
            expect(receipt.events[0].args[0], "sender").to.eq(voter1.address)
            expect(receipt.events[0].args[1], "preferences length").to.lengthOf(16)
            expect(receipt.events[0].args[1][0].dialId, "first preference dial id").to.eq(preferences[0].dialId)
            expect(receipt.events[0].args[1][0].weight, "first preference weight").to.eq(preferences[0].weight)
            expect(receipt.events[0].args[1][15].dialId, "last preference dial id").to.eq(preferences[15].dialId)
            expect(receipt.events[0].args[1][15].weight, "last preference weight").to.eq(preferences[15].weight)

            const voterPreferencesAfter = await emissionsController.getVoterPreferences(voter1.address)
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
            const voterPreferencesBefore = await emissionsController.voterPreferences(voter2.address)
            expect(voterPreferencesBefore.lastSourcePoke, "lastSourcePoke after").to.eq(0)
            // dial 20 has dial identifier 19
            const preferences = [{ dialId: 19, weight: 200 }]

            const tx = await emissionsController.connect(voter2.signer).setVoterDialWeights(preferences)

            await expect(tx).to.emit(emissionsController, "PreferencesChanged")

            const receipt = await tx.wait()
            expect(receipt.events[0].args[0], "sender").to.eq(voter2.address)
            expect(receipt.events[0].args[1], "preferences length").to.lengthOf(1)
            expect(receipt.events[0].args[1][0].dialId, "first preference dial id").to.eq(preferences[0].dialId)
            expect(receipt.events[0].args[1][0].weight, "first preference weight").to.eq(preferences[0].weight)

            const voterWeightsAfter = await emissionsController.getVoterPreferences(voter2.address)
            expect(voterWeightsAfter[0].dialId, "pos 1 dial id after").to.eq(preferences[0].dialId)
            expect(voterWeightsAfter[0].weight, "pos 1 weight after").to.eq(preferences[0].weight)
            expect(voterWeightsAfter[1].dialId, "pos 2 dial id after").to.eq(255)
            expect(voterWeightsAfter[1].weight, "pos 2 weight after").to.eq(0)
            expect(voterWeightsAfter[2].dialId, "pos 3 dial id after").to.eq(0)
            expect(voterWeightsAfter[2].weight, "pos 3 weight after").to.eq(0)

            const voterPreferencesAfter = await emissionsController.voterPreferences(voter2.address)
            expect(voterPreferencesAfter.lastSourcePoke, "lastSourcePoke after").to.gt(0)
        })
        it("should override previous dial weights", async () => {
            const previousPreferences = [
                { dialId: 0, weight: 120 }, // 60%
                { dialId: 1, weight: 60 }, // 30%
                { dialId: 2, weight: 20 }, // 10%
            ]

            await emissionsController.connect(voter1.signer).setVoterDialWeights(previousPreferences)

            const voterPreferencesBefore = await emissionsController.getVoterPreferences(voter1.address)
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
                { dialId: 1, weight: 60 }, // 30%
                { dialId: 2, weight: 20 }, // 10%
                { dialId: 5, weight: 30 }, // 15%
                { dialId: 19, weight: 70 }, // 35%
            ]

            await emissionsController.connect(voter1.signer).setVoterDialWeights(newPreferences)

            const voterPreferencesAfter = await emissionsController.getVoterPreferences(voter1.address)
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
                // Voter 1 gives 100.01% to dial 1
                const tx = emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 0, weight: 201 }])
                await expect(tx).to.revertedWith("Imbalanced weights")
            })
            it("weights > 100% across multiple dials", async () => {
                // Voter 1 gives 90% to dial 1 and 10.01% to dial 2
                const tx = emissionsController.connect(voter1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 180 }, // 90%
                    { dialId: 1, weight: 21 }, // 10.5%
                ])
                await expect(tx).to.revertedWith("Imbalanced weights")
            })
            it("invalid dial id", async () => {
                const tx = emissionsController.connect(voter1.signer).setVoterDialWeights([{ dialId: 20, weight: 200 }])
                await expect(tx).to.revertedWith("Invalid dial id")
            })
            it("0% weight", async () => {
                const tx = emissionsController.connect(voter1.signer).setVoterDialWeights([
                    { dialId: 1, weight: 100 }, // 50%
                    { dialId: 18, weight: 0 },
                ])
                await expect(tx).to.revertedWith("Must give a dial some weight")
            })
            it("setting 17 preferences", async () => {
                // using 17 dials with 5% (10/2) each
                const tx = emissionsController.connect(voter1.signer).setVoterDialWeights([
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
    describe("staking contract hook", () => {
        const amount = simpleToExactAmount(100)
        let currentTime: BN
        let voter1PreferencesBefore: { votesCast: BN; lastSourcePoke: number }
        beforeEach(async () => {
            await deployEmissionsController()

            await staking1.setVotes(voter1.address, simpleToExactAmount(100))
            await staking1.setVotes(voter2.address, simpleToExactAmount(200))

            const preferencesBefore = await emissionsController.voterPreferences(voter1.address)
            expect(preferencesBefore.lastSourcePoke, "lastSourcePoke before").to.eq(0)

            await emissionsController.connect(voter1.signer).setVoterDialWeights([
                { dialId: 2, weight: 120 }, // 60%
                { dialId: 1, weight: 60 }, // 30%
                { dialId: 0, weight: 20 }, // 10%
            ])
            voter1PreferencesBefore = await emissionsController.voterPreferences(voter1.address)
        })
        context("in first launch week", () => {
            beforeEach(async () => {
                currentTime = await getTimestamp()
            })
            it("should increase voter 1's voting power", async () => {
                const preferencesBefore = await emissionsController.voterPreferences(voter1.address)
                expect(preferencesBefore.lastSourcePoke, "lastSourcePoke before").to.gt(0)

                // Voter 1's voting power is tripled from 100 to 300 which is a 200 increase
                const tx = await staking1.setVotes(voter1.address, simpleToExactAmount(300))

                await expect(tx)
                    .to.emit(emissionsController, "VotesCast")
                    .withArgs(staking1.address, ZERO_ADDRESS, voter1.address, simpleToExactAmount(200))

                // Is the next epoch as we are still in the first week of the launch
                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(300).mul(1).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(simpleToExactAmount(300).mul(3).div(10))
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(300).mul(6).div(10))

                const preferencesAfter = await emissionsController.voterPreferences(voter1.address)
                expect(preferencesAfter.lastSourcePoke, "lastSourcePoke after").to.eq(voter1PreferencesBefore.lastSourcePoke)
                expect(preferencesAfter.votesCast, "votes cast after").to.eq(simpleToExactAmount(300))
            })
            it("should set voter 2's preferences", async () => {
                const tx = await emissionsController.connect(voter2.signer).setVoterDialWeights([
                    { dialId: 1, weight: 180 }, // 90%
                ])

                await expect(tx).to.emit(emissionsController, "PreferencesChanged")
                const receipt = await tx.wait()
                expect(receipt.events[0].args[0], "sender").to.eq(voter2.address)
                expect(receipt.events[0].args[1], "preferences length").to.lengthOf(1)
                expect(receipt.events[0].args[1][0].dialId, "first preference dial id").to.eq(1)
                expect(receipt.events[0].args[1][0].weight, "first preference weight").to.eq(180)

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(100).mul(1).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(
                    simpleToExactAmount(100).mul(3).div(10).add(simpleToExactAmount(200).mul(9).div(10)),
                )
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(100).mul(6).div(10))

                const preferences = await emissionsController.voterPreferences(voter2.address)
                expect(preferences.lastSourcePoke, "lastSourcePoke after").to.gte(currentTime)
                expect(preferences.votesCast, "votes cast after").to.eq(simpleToExactAmount(200))
            })
            it("should increase voter 3's voting power who doesn't have preferences", async () => {
                // Voter 3's voting power is increased from 0 to 1000 which is a 1000 increase
                const tx = await staking1.setVotes(voter3.address, simpleToExactAmount(1000))

                await expect(tx).to.not.emit(emissionsController, "VotesCast")

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(100).mul(1).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(simpleToExactAmount(100).mul(3).div(10))
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(100).mul(6).div(10))

                const preferences = await emissionsController.voterPreferences(voter3.address)
                expect(preferences.lastSourcePoke, "lastSourcePoke after").to.eq(0)
                expect(preferences.votesCast, "votes cast after").to.eq(0)
            })
        })
        context("in second launch week", () => {
            beforeEach(async () => {
                // Move to the second launch week
                await increaseTime(ONE_WEEK)

                currentTime = await getTimestamp()
            })
            it("should increase voter 1's voting power", async () => {
                // Voter 1's voting power is increased from 100 to 500 which is a 400 increase
                const tx = await staking1.setVotes(voter1.address, simpleToExactAmount(500))

                await expect(tx)
                    .to.emit(emissionsController, "VotesCast")
                    .withArgs(staking1.address, ZERO_ADDRESS, voter1.address, simpleToExactAmount(400))

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(500).mul(1).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(simpleToExactAmount(500).mul(3).div(10))
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(500).mul(6).div(10))

                const preferencesAfter = await emissionsController.voterPreferences(voter1.address)
                expect(preferencesAfter.lastSourcePoke, "lastSourcePoke after").to.gte(voter1PreferencesBefore.lastSourcePoke)
                expect(preferencesAfter.votesCast, "votes cast after").to.eq(simpleToExactAmount(500))
            })
            it("should decrease voter 1's voting power", async () => {
                // Voter 1's voting power is decreased from 100 to 10 which is a 90 decrease
                const tx = await staking1.setVotes(voter1.address, simpleToExactAmount(10))

                await expect(tx)
                    .to.emit(emissionsController, "VotesCast")
                    .withArgs(staking1.address, voter1.address, ZERO_ADDRESS, simpleToExactAmount(90))

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(10).mul(1).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(simpleToExactAmount(10).mul(3).div(10))
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(10).mul(6).div(10))

                const preferencesAfter = await emissionsController.voterPreferences(voter1.address)
                expect(preferencesAfter.lastSourcePoke, "lastSourcePoke after").to.eq(voter1PreferencesBefore.lastSourcePoke)
                expect(preferencesAfter.votesCast, "votes cast after").to.eq(simpleToExactAmount(10))
            })
            it("should set voter 2's preferences", async () => {
                const tx = await emissionsController.connect(voter2.signer).setVoterDialWeights([
                    { dialId: 1, weight: 180 }, // 90%
                ])

                await expect(tx).to.emit(emissionsController, "PreferencesChanged")
                const receipt = await tx.wait()
                expect(receipt.events[0].args[0], "sender").to.eq(voter2.address)
                expect(receipt.events[0].args[1], "preferences length").to.lengthOf(1)
                expect(receipt.events[0].args[1][0].dialId, "first preference dial id").to.eq(1)
                expect(receipt.events[0].args[1][0].weight, "first preference weight").to.eq(180)

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(100).mul(1).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(
                    simpleToExactAmount(100).mul(3).div(10).add(simpleToExactAmount(200).mul(9).div(10)),
                )
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(100).mul(6).div(10))

                const preferencesAfter = await emissionsController.voterPreferences(voter2.address)
                expect(preferencesAfter.lastSourcePoke, "lastSourcePoke after").to.gte(currentTime)
                expect(preferencesAfter.votesCast, "votes cast after").to.eq(simpleToExactAmount(200))
            })
            it("should increase voter 2's voting power after setting preferences", async () => {
                await emissionsController.connect(voter2.signer).setVoterDialWeights([
                    { dialId: 1, weight: 180 }, // 90%
                ])

                // Voter 2's voting power is increased from 200 to 300 which is a 100 increase
                const tx = await staking1.setVotes(voter2.address, simpleToExactAmount(300))

                await expect(tx)
                    .to.emit(emissionsController, "VotesCast")
                    .withArgs(staking1.address, ZERO_ADDRESS, voter2.address, simpleToExactAmount(100))

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(100).mul(1).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(
                    simpleToExactAmount(100).mul(3).div(10).add(simpleToExactAmount(300).mul(9).div(10)),
                )
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(100).mul(6).div(10))

                const preferencesAfter = await emissionsController.voterPreferences(voter2.address)
                expect(preferencesAfter.lastSourcePoke, "lastSourcePoke after").to.gte(currentTime)
                expect(preferencesAfter.votesCast, "votes cast after").to.eq(simpleToExactAmount(300))
            })
            it("should increase voter 3's voting power who doesn't have preferences", async () => {
                // Voter 3's voting power is increased from 0 to 1000 which is a 1000 increase
                const tx = await staking1.setVotes(voter3.address, simpleToExactAmount(1000))

                await expect(tx).to.not.emit(emissionsController, "VotesCast")

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(100).mul(1).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(simpleToExactAmount(100).mul(3).div(10))
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(100).mul(6).div(10))

                const preferencesAfter = await emissionsController.voterPreferences(voter3.address)
                expect(preferencesAfter.lastSourcePoke, "lastSourcePoke after").to.eq(0)
                expect(preferencesAfter.votesCast, "votes cast after").to.eq(0)
            })
        })
        context("should fail when", () => {
            it("called by default account", async () => {
                const tx = emissionsController.moveVotingPowerHook(voter1.address, voter2.address, amount)
                await expect(tx).to.revertedWith("Caller must be staking contract")
            })
            it("called by governor", async () => {
                const tx = emissionsController.connect(sa.governor.signer).moveVotingPowerHook(voter1.address, voter2.address, amount)
                await expect(tx).to.revertedWith("Caller must be staking contract")
            })
        })
        context("after a new staking contract added with voter 1's voting power", () => {
            const voter1Staking1VotingPower = simpleToExactAmount(1000)
            const voter1Staking2VotingPower = simpleToExactAmount(2000)
            const voter1Staking3VotingPower = simpleToExactAmount(6000)
            const voter2Staking3VotingPower = simpleToExactAmount(2300)
            let staking3: MockStakingContract
            beforeEach(async () => {
                // Voter 1 has voting power in staking contracts 1 and 2
                await staking1.setVotes(voter1.address, voter1Staking1VotingPower)
                await staking2.setVotes(voter1.address, voter1Staking2VotingPower)
                // Voter 1 splits their 3000 votes with 60% to dial 1 and 40% to dial 3
                await emissionsController.connect(voter1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 120 }, // 60%
                    { dialId: 2, weight: 80 }, // 40%
                ])
                // Voter 1 and 2 get voting power in new staking contract
                staking3 = await new MockStakingContract__factory(sa.default.signer).deploy()
                await staking3.setVotes(voter1.address, voter1Staking3VotingPower)
                await staking3.setVotes(voter2.address, voter2Staking3VotingPower)

                // New staking contract is added to emissions controller
                await emissionsController.connect(sa.governor.signer).addStakingContract(staking3.address)
                // New staking contract is hooked back to the emissions controller
                await staking3.setGovernanceHook(emissionsController.address)

                currentTime = await getTimestamp()
            })
            it("should poke when voter 1 increases voting power in new staking contract", async () => {
                // Voter 1's voting power is tripled
                const tx = staking3.setVotes(voter1.address, voter1Staking3VotingPower.mul(3))

                await expect(tx).to.emit(emissionsController, "SourcesPoked").withArgs(voter1.address, voter1Staking3VotingPower.mul(3))

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(21000).mul(6).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(0)
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(21000).mul(4).div(10))

                const preferences = await emissionsController.voterPreferences(voter1.address)
                expect(preferences.lastSourcePoke, "lastSourcePoke after").to.gte(currentTime)
                expect(preferences.votesCast, "votes cast after").to.eq(simpleToExactAmount(21000))
            })
            it("should poke when voter 1 removes voting power from new staking contract", async () => {
                // Voter 1's voting power is tripled
                const tx = staking3.setVotes(voter1.address, 0)

                await expect(tx).to.emit(emissionsController, "SourcesPoked").withArgs(voter1.address, 0)

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(3000).mul(6).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(0)
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(3000).mul(4).div(10))

                const preferences = await emissionsController.voterPreferences(voter1.address)
                expect(preferences.lastSourcePoke, "lastSourcePoke after").to.gte(currentTime)
                expect(preferences.votesCast, "votes cast after").to.eq(simpleToExactAmount(3000))
            })
            it("should add voter 2's preferences", async () => {
                const tx = await emissionsController.connect(voter2.signer).setVoterDialWeights([
                    { dialId: 1, weight: 200 }, // 100%
                ])

                await expect(tx).to.emit(emissionsController, "PreferencesChanged")
                const receipt = await tx.wait()
                expect(receipt.events[0].args[0], "sender").to.eq(voter2.address)
                expect(receipt.events[0].args[1], "preferences length").to.lengthOf(1)
                expect(receipt.events[0].args[1][0].dialId, "first preference dial id").to.eq(1)
                expect(receipt.events[0].args[1][0].weight, "first preference weight").to.eq(200)

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(3000).mul(6).div(10))
                // Adding 2300 in third staking contract to 200 already in first staking contract
                expect(dialVotes[1], "dial 2 votes").to.eq(simpleToExactAmount(2300 + 200))
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(3000).mul(4).div(10))

                const preferences = await emissionsController.voterPreferences(voter2.address)
                expect(preferences.lastSourcePoke, "lastSourcePoke after").to.gte(currentTime)
                expect(preferences.votesCast, "votes cast after").to.eq(simpleToExactAmount(2300 + 200))
            })
            it("should do nothing when voter 3 adds voting power to new staking contract", async () => {
                // Voter 3 add voting power
                const tx = staking3.setVotes(voter3.address, simpleToExactAmount(4000))

                await expect(tx).to.not.emit(emissionsController, "SourcesPoked")
                await expect(tx).to.not.emit(emissionsController, "VotesCast")

                const dialVotes = await emissionsController.getDialVotes()
                expect(dialVotes, "number of dials").to.lengthOf(3)
                expect(dialVotes[0], "dial 1 votes").to.eq(simpleToExactAmount(3000).mul(6).div(10))
                expect(dialVotes[1], "dial 2 votes").to.eq(0)
                expect(dialVotes[2], "dial 3 votes").to.eq(simpleToExactAmount(3000).mul(4).div(10))

                const preferences = await emissionsController.voterPreferences(voter3.address)
                expect(preferences.lastSourcePoke, "lastSourcePoke after").to.eq(0)
                expect(preferences.votesCast, "votes cast after").to.eq(0)
            })
        })
    })
})
