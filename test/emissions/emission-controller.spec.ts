/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-plusplus */
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
import { deployContract } from "tasks/utils/deploy-utils"
import { currentWeekEpoch, increaseTime, increaseTimeTo, startCurrentWeek } from "@utils/time"

const defaultConfig = {
    A: -166000,
    B: 180000,
    C: -180000,
    D: 166000,
    EPOCHS: 312,
}

const calcWeeklyReward = (epochDelta: number): BN => {
    const { A, B, C, D, EPOCHS } = defaultConfig
    const x = BN.from(epochDelta)
        .mul(simpleToExactAmount(1))
        .div(BN.from(EPOCHS).mul(simpleToExactAmount(1, 6)))
    const a = BN.from(A).mul(x.pow(3)).div(simpleToExactAmount(1, 24))
    const b = BN.from(B).mul(x.pow(2)).div(simpleToExactAmount(1, 12))
    const c = BN.from(C).mul(x)
    const d = BN.from(D).mul(simpleToExactAmount(1, 12))
    return a.add(b).add(c).add(d).mul(simpleToExactAmount(1, 6))
}

const nextRewardAmount = async (emissionsController: EmissionsController): Promise<BN> => {
    const lastEpoch = await emissionsController.lastEpoch()
    const startEpoch = await emissionsController.startEpoch()
    return calcWeeklyReward(lastEpoch - startEpoch + 1)
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

    const deployEmissionsController = async (): Promise<void> => {
        // staking contracts
        staking1 = await new MockStakingContract__factory(sa.default.signer).deploy()
        staking2 = await new MockStakingContract__factory(sa.default.signer).deploy()

        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, totalRewardsSupply)

        // Deploy dials
        dials = []
        for (let i = 0; i < 3; i++) {
            const newDial = await new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(rewardToken.address, DEAD_ADDRESS)
            dials.push(newDial)
        }
        const dialAddresses = dials.map((dial) => dial.address)

        // Deploy logic contract
        const emissionsControllerImpl = await new EmissionsController__factory(sa.default.signer).deploy(
            nexus.address,
            rewardToken.address,
            defaultConfig,
        )

        // Deploy proxy and initialize
        const proxy = await deployContract(new AssetProxy__factory(sa.default.signer), "AssetProxy", [
            emissionsControllerImpl.address,
            DEAD_ADDRESS,
            "0x",
        ])
        emissionsController = new EmissionsController__factory(sa.default.signer).attach(proxy.address)

        await rewardToken.approve(emissionsController.address, totalRewards)
        await emissionsController.initialize(
            dialAddresses,
            [true, true, false],
            [staking1.address, staking2.address],
            simpleToExactAmount(29400963),
        )

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
        const startCurrentPeriod = startCurrentWeek()
        const earlyNextPeriod = startCurrentPeriod.add(ONE_WEEK).add(ONE_HOUR)
        await increaseTimeTo(earlyNextPeriod)
        console.log(`Time at start ${new Date(earlyNextPeriod.toNumber() * 1000).toUTCString()}, epoch ${earlyNextPeriod}`)
    })
    describe("deploy and initialize", () => {
        before(async () => {
            await deployEmissionsController()
            console.log(`Emissions Controller contract size ${EmissionsController__factory.bytecode.length}`)
        })
        it("Immutable variables set on deployment", async () => {
            expect(await emissionsController.nexus(), "nexus").to.eq(nexus.address)
            expect(await emissionsController.rewardToken(), "rewardToken").to.eq(rewardToken.address)
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
            expect(await emissionsController.startEpoch(), "start epoch").to.eq(currentWeekEpoch().add(2))
            expect(await emissionsController.lastEpoch(), "last epoch").to.eq(currentWeekEpoch().add(2))
        })
        it("transfer MTA on initialization", async () => {
            expect(await rewardToken.balanceOf(emissionsController.address), "ec rewards bal").to.eq(totalRewards)
        })
        it("Staking contracts set on initialization", async () => {
            expect(await emissionsController.stakingContracts(0), "staking contract 1").to.eq(staking1.address)
            expect(await emissionsController.stakingContracts(1), "staking contract 2").to.eq(staking2.address)
        })
        it("Zero nexus address", async () => {
            const tx = new EmissionsController__factory(sa.default.signer).deploy(ZERO_ADDRESS, rewardToken.address, defaultConfig)
            await expect(tx).to.revertedWith("Nexus address is zero")
        })
        it("Zero rewards address", async () => {
            const tx = new EmissionsController__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS, defaultConfig)
            await expect(tx).to.revertedWith("Reward token address is zero")
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
                notifies: boolean[]
                fixedDistributionAmounts: number[]
                stakingContracts: string[]
            }[] = [
                {
                    desc: "recipients empty",
                    dialIndexes: [],
                    notifies: [true, false],
                    fixedDistributionAmounts: [0, 0],
                    stakingContracts: [stakingContract1.address, stakingContract2.address],
                },
                {
                    desc: "notifies empty",
                    dialIndexes: [0, 1],
                    notifies: [],
                    fixedDistributionAmounts: [0, 0],
                    stakingContracts: [stakingContract1.address, stakingContract2.address],
                },
                {
                    desc: "different lengths",
                    dialIndexes: [0],
                    notifies: [true, false],
                    fixedDistributionAmounts: [0, 0],
                    stakingContracts: [stakingContract1.address, stakingContract2.address],
                },
            ]
            for (const test of tests) {
                it(test.desc, async () => {
                    const recipients = test.dialIndexes.map((i) => dials[i].address)
                    const tx = emissionsController.initialize(recipients, test.notifies, test.stakingContracts, 0)
                    await expect(tx).to.revertedWith("Initialize args mistmatch")
                })
            }
            it("First staking contract is zero", async () => {
                const recipients = dials.map((d) => d.address)
                const tx = emissionsController.initialize(recipients, [true, true, false], [ZERO_ADDRESS, staking2.address], 0)
                await expect(tx).to.revertedWith("Staking contract address is zero")
            })
            it("Second staking contract is zero", async () => {
                const recipients = dials.map((d) => d.address)
                const tx = emissionsController.initialize(recipients, [true, true, false], [staking1.address, ZERO_ADDRESS], 0)
                await expect(tx).to.revertedWith("Staking contract address is zero")
            })
        })
    })
    context("setVoterDialWeights fails when", () => {
        before(async () => {
            await deployEmissionsController()
        })
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
            const tx = emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 3, weight: 200 }])
            await expect(tx).to.revertedWith("Invalid dial id")
        })
    })
    context("fetch weekly emissions", () => {
        let startingEpoch
        before(async () => {
            await deployEmissionsController()
            startingEpoch = await emissionsController.startEpoch()
        })
        it("fetches week 1", async () => {
            expect(await emissionsController.topLineEmission(startingEpoch + 1)).eq(await nextRewardAmount(emissionsController))
        })
    })
    describe("calculate rewards", () => {
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
            const lastEpochBefore = await emissionsController.lastEpoch()
            await increaseTime(ONE_WEEK)

            const tx = await emissionsController.calculateRewards()

            await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, 0, 0])

            expect(await emissionsController.lastEpoch(), "last epoch after").to.eq(lastEpochBefore + 1)

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
                beforeEach(async () => {
                    lastEpochBefore = await emissionsController.lastEpoch()
                })
                afterEach(async () => {
                    expect(await emissionsController.lastEpoch(), "last epoch after").to.eq(lastEpochBefore + 1)
                })
                it("User 1 all votes to dial 1", async () => {
                    // User 1 gives all 300 votes to dial 1
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

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

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // User 1 has 300 of the 900 votes (1/3)
                    const dial1 = nextEpochEmission.div(3)
                    // User 2 has 600 of the 900 votes (2/3)
                    const dial2 = nextEpochEmission.mul(2).div(3)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

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

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

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

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // User 1 20% of 300 votes
                    const dial1 = nextEpochEmission.mul(300).div(5).div(900)
                    // User 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul(300).mul(4).div(5).div(900)
                    // User 2 600 votes
                    const dial3 = nextEpochEmission.mul(600).div(900)
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
                beforeEach(async () => {
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
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 160 },
                        { dialId: 1, weight: 40 },
                    ])
                    await increaseTime(ONE_WEEK)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // User 1 80% of 300 votes
                    const dial1 = nextEpochEmission.mul((300 * 4) / 5).div(900)
                    // User 1 20% of 300 votes
                    const dial2 = nextEpochEmission.mul(300 / 5).div(900)
                    // User 2 600 votes
                    const dial3 = nextEpochEmission.mul(600).div(900)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 1 removes 20% to dial 1", async () => {
                    console.log("Start User 1 removes 20% to dial 1")
                    // User gives 80% of their 300 votes to dial 2. The remaining 20% (40) is not set
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 1, weight: 160 }])
                    await increaseTime(ONE_WEEK)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // Total votes is 900 - 20% * 300 = 900 - 60 = 840
                    // User 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul((300 * 4) / 5).div(840)
                    // User 2 600 votes
                    const dial3 = nextEpochEmission.mul(600).div(840)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 1 changes all to dial 3", async () => {
                    // User 1 gives all 300 votes to dial 3
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

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

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

                    // User 1 20% of 300 votes + User 3 300 votes
                    const dial1 = nextEpochEmission.mul(300 + 300 / 5).div(1200)
                    // User 1 80% of 300 votes
                    const dial2 = nextEpochEmission.mul((300 * 4) / 5).div(1200)
                    // User 2 600 votes
                    const dial3 = nextEpochEmission.mul(600).div(1200)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 3 all weight on dial 2", async () => {
                    // User 3 gives all 300 votes to dial 2
                    await emissionsController.connect(sa.dummy3.signer).setVoterDialWeights([{ dialId: 1, weight: 200 }])
                    await increaseTime(ONE_WEEK)

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

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

                    const nextEpochEmission = await nextRewardAmount(emissionsController)
                    const tx = await emissionsController.calculateRewards()

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
                await emissionsController.connect(sa.governor.signer).addDial(staking1.address, true)

                nextEpochEmission = await nextRewardAmount(emissionsController)
                fixedDistributionAmount = nextEpochEmission.div(10)
                weightedDistributionAmount = nextEpochEmission.sub(fixedDistributionAmount)
            })
            it("Only User 1 allocates 1% to dial 1", async () => {
                // User 1 gives 1% of their 300 votes to dial 1
                await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 2 }])
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
            it("User 1 20/80 votes to dial 1 & 2, User 2 all votes to dial 3", async () => {
                // User 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 40 },
                    { dialId: 1, weight: 160 },
                ])
                // User 2 gives all 600 votes to dial 3
                await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 2, weight: 200 }])
                await increaseTime(ONE_WEEK)

                const tx = await emissionsController.calculateRewards()

                // User 1 20% of 300 votes
                const dial1 = weightedDistributionAmount.mul(300).div(5).div(900)
                // User 1 80% of 300 votes
                const dial2 = weightedDistributionAmount.mul(300).mul(4).div(5).div(900)
                // User 2 600 votes
                const dial3 = weightedDistributionAmount.mul(600).div(900)
                await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3, fixedDistributionAmount])

                expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(dial3)
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
                await emissionsController.connect(sa.governor.signer).addDial(newDial.address, true)

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
    describe("donate", () => {
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
    describe("distribute rewards", () => {
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
    describe("Staking contract hook", () => {
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
            await expect(tx).to.revertedWith("Must be staking contract")
        })
        it("Governor can not move voting power", async () => {
            const tx = emissionsController.connect(sa.governor.signer).moveVotingPowerHook(user1, user2, amount)
            await expect(tx).to.revertedWith("Must be staking contract")
        })
    })
    describe("add dial", () => {
        let newDial: MockRewardsDistributionRecipient
        beforeEach(async () => {
            await deployEmissionsController()

            newDial = await new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(rewardToken.address, DEAD_ADDRESS)
            dials.push(newDial)
        })
        it("governor adds new dial", async () => {
            const tx = await emissionsController.connect(sa.governor.signer).addDial(newDial.address, true)
            await expect(tx).to.emit(emissionsController, "AddedDial").withArgs(3, newDial.address)
            const savedDial = await emissionsController.dials(3)
            expect(savedDial.recipient, "recipient").to.eq(newDial.address)
            expect(savedDial.notify, "notify").to.eq(true)
            expect(savedDial.staking, "staking").to.eq(false)
        })
        it("fail to add recipient with zero address", async () => {
            const tx = emissionsController.connect(sa.governor.signer).addDial(ZERO_ADDRESS, true)
            await expect(tx).to.revertedWith("Dial address is zero")
        })
        it("fail to add existing dial", async () => {
            const tx = emissionsController.connect(sa.governor.signer).addDial(dials[0].address, true)
            await expect(tx).to.revertedWith("Dial already exists")
        })
        it("Default user fails to add new dial", async () => {
            const tx = emissionsController.addDial(newDial.address, true)
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
            expect((await emissionsController.dials(0)).disabled, "dial 1 disabled before").to.be.false
            const tx = await emissionsController.connect(sa.governor.signer).updateDial(0, true)
            await expect(tx).to.emit(emissionsController, "UpdatedDial").withArgs(0, true)
            expect((await emissionsController.dials(0)).disabled, "dial 1 disabled after").to.be.true
            await increaseTime(ONE_WEEK)

            const nextEpochEmission = await nextRewardAmount(emissionsController)
            const tx2 = await emissionsController.calculateRewards()

            const adjustedDial2 = nextEpochEmission.mul(200).div(500)
            const adjustedDial3 = nextEpochEmission.mul(300).div(500)
            await expect(tx2).to.emit(emissionsController, "PeriodRewards").withArgs([0, adjustedDial2, adjustedDial3])
        })
        it("Governor reenables dial", async () => {
            await emissionsController.connect(sa.governor.signer).updateDial(0, true)
            await increaseTime(ONE_WEEK)
            await emissionsController.calculateRewards()
            await increaseTime(ONE_WEEK.add(60))

            // Reenable dial 1
            const tx = await emissionsController.connect(sa.governor.signer).updateDial(0, false)
            await expect(tx).to.emit(emissionsController, "UpdatedDial").withArgs(0, false)
            expect((await emissionsController.dials(0)).disabled, "dial 1 reenabled after").to.be.false

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
})
