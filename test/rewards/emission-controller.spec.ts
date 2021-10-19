/* eslint-disable no-await-in-loop */
/* eslint-disable no-plusplus */
import { DEAD_ADDRESS, ONE_WEEK } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ethers } from "hardhat"
import { increaseTime, simpleToExactAmount } from "index"
import {
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

describe("EmissionsController", async () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let staking1: MockStakingContract
    let staking2: MockStakingContract
    let rewardToken: MockERC20
    let dials: MockRewardsDistributionRecipient[]
    let emissionsController: EmissionsController
    const totalRewardsSupply = simpleToExactAmount(100000000)
    const totalRewards = simpleToExactAmount(40000000)
    const weeklyRewards = totalRewards.div(312)

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

        emissionsController = await new EmissionsController__factory(sa.default.signer).deploy(
            nexus.address,
            [staking1.address, staking2.address],
            rewardToken.address,
            totalRewards,
        )
        await staking1.setGovernanceHook(emissionsController.address)
        await staking2.setGovernanceHook(emissionsController.address)
        const dialAddresses = dials.map((dial) => dial.address)
        await rewardToken.approve(emissionsController.address, totalRewardsSupply)
        await emissionsController.initialize(dialAddresses, [true, true, false])
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        console.log(`User 1 ${sa.dummy1.address}`)
        console.log(`User 2 ${sa.dummy2.address}`)
        console.log(`User 3 ${sa.dummy3.address}`)
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
            await increaseTime(ONE_WEEK.mul(2))

            // Dial's rewards balances
            expect((await emissionsController.dials(0)).balance, "dial 1 balance before").to.eq(0)
            expect((await emissionsController.dials(1)).balance, "dial 2 balance before").to.eq(0)
            expect((await emissionsController.dials(2)).balance, "dial 3 balance before").to.eq(0)

            // User voting power
            expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes before").to.eq(simpleToExactAmount(300))
            expect(await emissionsController.callStatic.getVotes(sa.dummy2.address), "User 2 votes before").to.eq(simpleToExactAmount(600))
            expect(await emissionsController.callStatic.getVotes(sa.dummy3.address), "User 3 votes before").to.eq(simpleToExactAmount(300))
        })
        context("change voting weights", () => {
            context("first voting period", () => {
                it("User 1 all votes to dial 1", async () => {
                    // User 1 gives all 300 votes to dial 1
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 10000 }])

                    const tx = await emissionsController.calculateRewards()

                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([weeklyRewards, 0, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(weeklyRewards)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                it("User 1 all votes to dial 1, User 2 all votes to dial 2", async () => {
                    // User 1 gives all 300 votes to dial 1
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 10000 }])
                    // User 2 gives all 600 votes to dial 2
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 1, weight: 10000 }])

                    const tx = await emissionsController.calculateRewards()

                    // User 1 has 300 of the 900 votes (1/3)
                    const dial1 = weeklyRewards.div(3)
                    // User 2 has 600 of the 900 votes (2/3)
                    const dial2 = weeklyRewards.mul(2).div(3)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                it("User 1 50/50 votes to dial 1 & 2, User 2 50/50 votes to dial 1 & 2", async () => {
                    // User 1 splits their 300 votes with 50% to dial 1 and 50% to dial 2
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 5000 },
                        { dialId: 1, weight: 5000 },
                    ])
                    // User 2 splits their 600 votes with 50% to dial 1 and 50% to dial 2
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([
                        { dialId: 0, weight: 5000 },
                        { dialId: 1, weight: 5000 },
                    ])

                    const tx = await emissionsController.calculateRewards()

                    // User 1 and 2 split their votes 50/50
                    const dial1 = weeklyRewards.div(2)
                    const dial2 = weeklyRewards.div(2)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                it("User 1 20/80 votes to dial 1 & 2, User 2 all votes to dial 3", async () => {
                    // User 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 2000 },
                        { dialId: 1, weight: 8000 },
                    ])
                    // User 2 gives all 600 votes to dial 3
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 2, weight: 10000 }])

                    const tx = await emissionsController.calculateRewards()

                    // User 1 20% of 300 votes
                    const dial1 = weeklyRewards.mul(300).div(5).div(900)
                    // User 1 80% of 300 votes
                    const dial2 = weeklyRewards.mul(300).mul(4).div(5).div(900)
                    // User 2 600 votes
                    const dial3 = weeklyRewards.mul(600).div(900)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(dial2)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(dial3)
                })
            })
            context("second voting period", () => {
                // Users previous votes
                // User 1 300 20% dial 1, 80% dial 2
                // User 2 600 100% dial 3
                const balDial1Before = weeklyRewards.mul(300).div(5).div(900)
                const balDial2Before = weeklyRewards.mul(300).mul(4).div(5).div(900)
                const balDial3Before = weeklyRewards.mul(600).div(900)
                beforeEach(async () => {
                    // User 1 splits their 300 votes with 20% to dial 1 and 80% to dial 2
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 2000 },
                        { dialId: 1, weight: 8000 },
                    ])
                    // User 2 gives all 600 votes to dial 2
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 2, weight: 10000 }])

                    await emissionsController.calculateRewards()
                    await increaseTime(ONE_WEEK)
                })
                it("User 1 changes weights to 80/20 dial 1 & 2", async () => {
                    // User 1 splits their 300 votes with 80% to dial 1 and 20% to dial 2
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                        { dialId: 0, weight: 8000 },
                        { dialId: 1, weight: 2000 },
                    ])

                    const tx = await emissionsController.calculateRewards()

                    // User 1 80% of 300 votes
                    const dial1 = weeklyRewards.mul((300 * 4) / 5).div(900)
                    // User 1 20% of 300 votes
                    const dial2 = weeklyRewards.mul(300 / 5).div(900)
                    // User 2 600 votes
                    const dial3 = weeklyRewards.mul(600).div(900)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 1 removes 20% to dial 1", async () => {
                    // User gives 80% of their 300 votes to dial 2. The remaining 20% is not allocated
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 1, weight: 8000 }])

                    const tx = await emissionsController.calculateRewards()

                    // Total votes is 900 - 20% * 300 = 900 - 60 = 840
                    // User 1 80% of 300 votes
                    const dial2 = weeklyRewards.mul((300 * 4) / 5).div(840)
                    // User 2 600 votes
                    const dial3 = weeklyRewards.mul(600).div(840)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 1 changes all to dial 3", async () => {
                    // User 1 gives all 300 votes to dial 3
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 2, weight: 10000 }])

                    const tx = await emissionsController.calculateRewards()

                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([0, 0, weeklyRewards])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(weeklyRewards))
                })
                it("User 3 all weight on dial 1", async () => {
                    expect(await emissionsController.totalDialVotes(), "total vote before").to.eq(simpleToExactAmount(900, 4))
                    // User 3 gives all 300 votes to dial 1
                    await emissionsController.connect(sa.dummy3.signer).setVoterDialWeights([{ dialId: 0, weight: 10000 }])
                    expect(await emissionsController.totalDialVotes(), "total vote after").to.eq(simpleToExactAmount(1200, 4))

                    const tx = await emissionsController.calculateRewards()

                    // User 1 20% of 300 votes + User 3 300 votes
                    const dial1 = weeklyRewards.mul(300 + 300 / 5).div(1200)
                    // User 1 80% of 300 votes
                    const dial2 = weeklyRewards.mul((300 * 4) / 5).div(1200)
                    // User 2 600 votes
                    const dial3 = weeklyRewards.mul(600).div(1200)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 3 all weight on dial 2", async () => {
                    expect(await emissionsController.totalDialVotes(), "total vote before").to.eq(simpleToExactAmount(900, 4))
                    // User 3 gives all 300 votes to dial 2
                    await emissionsController.connect(sa.dummy3.signer).setVoterDialWeights([{ dialId: 1, weight: 10000 }])
                    expect(await emissionsController.totalDialVotes(), "total vote after").to.eq(simpleToExactAmount(1200, 4))

                    const tx = await emissionsController.calculateRewards()

                    // User 1 20% of 300 votes + User 3 300 votes
                    const dial1 = weeklyRewards.mul(300 / 5).div(1200)
                    // User 1 80% of 300 votes, User 3 300 votes
                    const dial2 = weeklyRewards.mul(300 + (300 * 4) / 5).div(1200)
                    // User 2 600 votes
                    const dial3 = weeklyRewards.mul(600).div(1200)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, dial3])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before.add(dial3))
                })
                it("User 2 removes all votes to dial 3", async () => {
                    // User 2 removes all 600 votes from dial 3
                    await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([])

                    const tx = await emissionsController.calculateRewards()

                    // User 1 20% of 300 votes
                    const dial1 = weeklyRewards.mul(300 / 5).div(300)
                    // User 1 80% of 300 votes
                    const dial2 = weeklyRewards.mul((300 * 4) / 5).div(300)
                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, dial2, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(balDial1Before.add(dial1))
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(balDial2Before.add(dial2))
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(balDial3Before)
                })
            })
        })
        context("Change voting power", () => {
            context("first voting period", () => {
                it("User 3 increases voting power before setting weights", async () => {
                    expect(await emissionsController.callStatic.getVotes(sa.dummy3.address), "User 3 votes before").to.eq(
                        simpleToExactAmount(300),
                    )

                    await staking1.setVotes(sa.dummy3.address, simpleToExactAmount(400))

                    expect(await emissionsController.callStatic.getVotes(sa.dummy3.address), "User 3 votes after").to.eq(
                        simpleToExactAmount(400),
                    )
                })
                it("User 1 increases voting power to dial 1", async () => {
                    // User 1 gives all 300 votes to dial 1
                    await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 10000 }])

                    // User 1 increases votes from 300 to 400 by increasing staking 2 from 200 to 300
                    await staking2.setVotes(sa.dummy1.address, simpleToExactAmount(300))
                    expect(await emissionsController.callStatic.getVotes(sa.dummy1.address), "User 1 votes after").to.eq(
                        simpleToExactAmount(400),
                    )

                    const tx = await emissionsController.calculateRewards()

                    await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([weeklyRewards, 0, 0])

                    expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(weeklyRewards)
                    expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                    expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                })
                context("User 1 votes to dial 1, User 2 votes to dial 2", () => {
                    beforeEach(async () => {
                        // User 1 gives all 300 votes to dial 1
                        await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([{ dialId: 0, weight: 10000 }])
                        // User 2 gives all 600 votes to dial 2
                        await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([{ dialId: 1, weight: 10000 }])
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

                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 300 of the 1500 votes (1/5)
                        const dial1 = weeklyRewards.div(5)
                        // User 2 has 1200 of the 1500 votes (4/5)
                        const dial2 = weeklyRewards.mul(4).div(5)
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

                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 300 of the 600 votes (1/2)
                        const dial1 = weeklyRewards.div(2)
                        // User 2 has 300 of the 600 votes (1/2)
                        const dial2 = weeklyRewards.div(2)
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

                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 300 of the 300 votes
                        const dial1 = weeklyRewards
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

                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 900 of the 900 votes
                        const dial1 = weeklyRewards
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

                        const tx = await emissionsController.calculateRewards()

                        // User 1 has 300 of the 300 votes
                        const dial1 = weeklyRewards
                        await expect(tx).to.emit(emissionsController, "PeriodRewards").withArgs([dial1, 0, 0])

                        expect((await emissionsController.dials(0)).balance, "dial 1 balance after").to.eq(dial1)
                        expect((await emissionsController.dials(1)).balance, "dial 2 balance after").to.eq(0)
                        expect((await emissionsController.dials(2)).balance, "dial 3 balance after").to.eq(0)
                    })
                })
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
            await staking1.setVotes(sa.dummy1.address, user1Staking1Votes)
            await staking2.setVotes(sa.dummy1.address, user1Staking2Votes)
            await staking1.setVotes(sa.dummy2.address, user2Staking1Votes)
            await staking1.setVotes(sa.dummy3.address, user3Staking1Votes)
            await increaseTime(ONE_WEEK.mul(2))
        })
        context("User 1 80/20 votes to dial 1 & 2, User 2 50/50 votes to dial 2 & 3", () => {
            // 80% of User 1's 300 votes
            const dial1 = weeklyRewards.mul((300 * 4) / 5).div(900)
            // 20% of User 1's 300 votes + 50% of User 2's 600 votes
            const dial2 = weeklyRewards.mul(300 / 5 + 600 / 2).div(900)
            // 50% of User 2's 600 votes
            const dial3 = weeklyRewards.mul(600 / 2).div(900)
            beforeEach(async () => {
                // User 1 splits their 300 votes with 80% to dial 1 and 20% to dial 2
                await emissionsController.connect(sa.dummy1.signer).setVoterDialWeights([
                    { dialId: 0, weight: 8000 },
                    { dialId: 1, weight: 2000 },
                ])
                // User 2 splits their 600 votes with 50% to dial 1 and 50% to dial 2
                await emissionsController.connect(sa.dummy2.signer).setVoterDialWeights([
                    { dialId: 1, weight: 5000 },
                    { dialId: 2, weight: 5000 },
                ])
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
            it("all dials in reserve order", async () => {
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
    describe("add dial", () => {})
    describe("update dial", () => {})
})