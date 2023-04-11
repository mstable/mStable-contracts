/* eslint-disable no-await-in-loop */
import { assertBNClosePercent } from "@utils/assertions"
import { ONE_MIN, ONE_WEEK } from "@utils/constants"
import { impersonate } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { getBlockDate, getTimestamp, increaseTime } from "@utils/time"
import { expect } from "chai"
import { BigNumber, BigNumberish } from "ethers"
import { formatUnits } from "ethers/lib/utils"
import { ethers, network } from "hardhat"
import { mUSD, Token } from "tasks/utils"
import { bundleInBlock } from "tasks/utils/bundler"
import { BoostedDualVault, BoostedVault, BoostedVault__factory, DataEmitter, DataEmitter__factory } from "types/generated"

/**
 * Calculates the rewards that can be claimed after the 26 week lock period is over.
 * @param vault the vault holding the rewards
 * @param staker the account claiming the rewards
 * @returns
 */
const calcLockedRewards = async (vault: BoostedVault | BoostedDualVault, staker: string): Promise<BigNumber> => {
    // Get the staker's first and last unclaimed periods
    const unclaimedRewards = await vault.unclaimedRewards(staker)
    const firstPeriod = unclaimedRewards.first.toNumber()
    const lastPeriod = unclaimedRewards.last.toNumber()
    console.log(`first unclaimed period: ${firstPeriod}`)
    console.log(`last unclaimed period : ${lastPeriod}`)

    // Get the timestamp the staker last claimed rewards
    const lastClaim = (await vault.userClaim(staker)).toNumber()
    console.log(`Last claim            : ${new Date(lastClaim * 1000)}`)

    if (lastClaim === 0) {
        // For Feeder Pools
        // all 67% of the total rewards are locked
        // earned = total * 0.33
        // locked = total * 0.67
        // locked = earned * 0.67 / 0.33

        // For imUSD vault
        // all 80% of the total rewards are locked
        // earned = total * 0.2
        // locked = total * 0.8
        // locked = earned * 0.8 / 0.2 = earned * 4
        const earned = (await vault.earned(staker)) as BigNumber
        const locked = earned.mul(4)
        console.log(`Rewards locked        : ${formatUnits(earned)} * 4 = ${formatUnits(locked)} MTA\n`)
        return locked
    }

    let lockedRewards = BigNumber.from(0)
    for (let i = firstPeriod; i <= lastPeriod; i++) {
        const userRewards = await vault.userRewards(staker, i)
        console.log(`Period ${i} rate   : ${formatUnits(userRewards.rate)}`)
        console.log(`Period ${i} start  : ${new Date(userRewards.start.toNumber() * 1000)}`)
        console.log(`Period ${i} finish : ${new Date(userRewards.finish.toNumber() * 1000)}`)
        console.log(`Period ${i} length : ${userRewards.finish.sub(userRewards.start)} seconds`)
        const periodRewards = userRewards.finish.sub(userRewards.start).mul(userRewards.rate)
        console.log(`Period ${i} rewards: ${formatUnits(periodRewards)} MTA`)

        // Get the timestamp to calculate the rewards from
        // This is the max of the last time the staker claimed or the start of the period
        const rewardsFromTimestamp = Math.max(userRewards.start.toNumber(), lastClaim)

        const periodLockedRewards = userRewards.finish.sub(rewardsFromTimestamp).mul(userRewards.rate)
        console.log(`Period ${i} locked : ${formatUnits(periodLockedRewards)} MTA`)
        console.log(`Period ${i} claimed: ${formatUnits(periodRewards.sub(periodLockedRewards))} MTA`)

        lockedRewards = lockedRewards.add(periodLockedRewards)
    }

    console.log(`Rewards locked : ${formatUnits(lockedRewards)} MTA\n`)
    return lockedRewards
}

describe("MTA Rewards", () => {
    let dataEmitter: DataEmitter
    const runSetup = async (blockNumber: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber,
                    },
                },
            ],
        })
        const sa = await ethers.getSigners()
        dataEmitter = await new DataEmitter__factory(sa[0]).deploy()
    }

    const assertPoke = async (staker: string, token: Token, expectBalanceIncrease: boolean) => {
        const signer = await impersonate(staker)
        const vault = BoostedVault__factory.connect(token.vault, signer)

        console.log(`staker raw balance before poke: ${formatUnits(await vault.rawBalanceOf(staker))}`)
        const balanceBefore = await vault.balanceOf(staker)
        console.log(`staker balance before poke    : ${formatUnits(balanceBefore)}`)

        const unclaimedRewardsResultBefore = await vault.unclaimedRewards(staker)
        console.log(`first unclaimed period before : ${unclaimedRewardsResultBefore.first}`)
        console.log(`last unclaimed period before  : ${unclaimedRewardsResultBefore.last}`)
        console.log(`amount unclaimed before       : ${formatUnits(unclaimedRewardsResultBefore.amount)}\n`)

        await vault.pokeBoost(staker)

        console.log(`staker raw balance after poke : ${formatUnits(await vault.rawBalanceOf(staker))}`)
        const balanceAfter = await vault.balanceOf(staker)
        console.log(`staker balance after poke     : ${formatUnits(balanceAfter)}`)

        const unclaimedRewardsResultAfter = await vault.unclaimedRewards(staker)
        console.log(`first unclaimed period after  : ${unclaimedRewardsResultAfter.first}`)
        console.log(`last unclaimed period after   : ${unclaimedRewardsResultAfter.last}`)
        console.log(`amount unclaimed after        : ${formatUnits(unclaimedRewardsResultAfter.amount)}\n`)

        if (expectBalanceIncrease) {
            expect(balanceAfter, "balance after > before").to.gt(balanceBefore)
        } else {
            expect(balanceAfter, "balance after equal before").to.eq(balanceBefore)
        }
    }
    const assertClaimFail = async (staker: string, token: Token): Promise<{ expected: BigNumber; actual: BigNumber }> => {
        const signer = await impersonate(staker)
        const vault = BoostedVault__factory.connect(token.vault, signer)

        console.log(`staker raw balance before: ${formatUnits(await vault.rawBalanceOf(staker))}`)
        console.log(`staker balance before    : ${formatUnits(await vault.balanceOf(staker))}`)
        const lastClaim = (await vault.userClaim(staker)).toNumber()
        console.log(`Last claim               : ${new Date(lastClaim * 1000)}`)

        const rawTx = vault.interface.getSighash("claimRewards()")
        const { callReceipt, txReceipt } = await bundleInBlock(
            dataEmitter,
            token.vault,
            vault.interface.encodeFunctionData("unclaimedRewards", [staker]),
            vault.address,
            rawTx,
            signer,
        )

        console.log(`staker raw balance after : ${formatUnits(await vault.rawBalanceOf(staker))}`)
        console.log(`staker balance after     : ${formatUnits(await vault.balanceOf(staker))}`)

        const unclaimedRewardsResult = vault.interface.decodeFunctionResult("unclaimedRewards", callReceipt.events[0].args.data)
        const unclaimedRewards = unclaimedRewardsResult.amount

        console.log(`first unclaimed period   : ${unclaimedRewardsResult.first}`)
        console.log(`last unclaimed period    : ${unclaimedRewardsResult.last}\n`)

        let claimedRewards
        if (!txReceipt.logs[1]) {
            claimedRewards = BigNumber.from(0)
        } else {
            const event = vault.interface.parseLog(txReceipt.logs[1])
            claimedRewards = event.args.reward
        }

        console.log(`Actual claimed ${formatUnits(claimedRewards)} > expected ${formatUnits(unclaimedRewards)}\n`)
        expect(claimedRewards, "actual rewards > expected rewards").gt(unclaimedRewards)

        return {
            expected: unclaimedRewards,
            actual: claimedRewards,
        }
    }
    const assertClaim = async (staker: string, token: Token): Promise<BigNumber> => {
        const signer = await impersonate(staker)
        const vault = BoostedVault__factory.connect(token.vault, signer)

        const lockedRewards = await calcLockedRewards(vault, staker)
        const earnedRewards = await vault.earned(staker)
        console.log(`earnedRewards: ${formatUnits(earnedRewards)}`)
        console.log(`lockedRewards: ${formatUnits(lockedRewards)}`)
        console.log(`totalRewards : ${formatUnits(earnedRewards.add(lockedRewards))}\n`)

        console.log(`rewards per token before        : ${formatUnits(await vault.rewardPerToken())}`)
        const userDataBefore = await vault.userData(staker)
        console.log(`staker rewards before           : ${formatUnits(userDataBefore.rewards)}`)
        console.log(`staker rewardPerTokenPaid before: ${formatUnits(userDataBefore.rewardPerTokenPaid)}`)
        console.log(`staker raw balance before       : ${formatUnits(await vault.rawBalanceOf(staker))}`)
        const balanceBefore = await vault.balanceOf(staker)
        console.log(`staker balance before           : ${formatUnits(balanceBefore)}\n`)

        // using the following doesn't work as Ethers does not now which override to use
        // const rawTx = vault.interface.encodeFunctionData("claimReward")
        // unfortunately, Typechain doesn't allow the following
        // const rawTx = vault.interface.encodeFunctionData("claimReward()")
        // claimRewards() function signature is 0x372500ab
        const rawTx = vault.interface.getSighash("claimRewards()")
        const { callReceipt, txReceipt } = await bundleInBlock(
            dataEmitter,
            token.vault,
            vault.interface.encodeFunctionData("unclaimedRewards", [staker]),
            vault.address,
            rawTx,
            signer,
        )

        console.log(`rewards per token after        : ${formatUnits(await vault.rewardPerToken())}`)
        const userDataAfter = await vault.userData(staker)
        console.log(`staker rewards after           : ${formatUnits(userDataAfter.rewards)}`)
        console.log(`staker rewardPerTokenPaid after: ${formatUnits(userDataAfter.rewardPerTokenPaid)}`)
        const rewardPerTokenPaidDelta = userDataAfter.rewardPerTokenPaid.sub(userDataBefore.rewardPerTokenPaid)
        console.log(`staker rewardPerTokenPaid delta: ${formatUnits(rewardPerTokenPaidDelta)}`)
        console.log(`staker total rewards           : ${formatUnits(rewardPerTokenPaidDelta.mul(balanceBefore))}`)
        console.log(`staker raw balance after       : ${formatUnits(await vault.rawBalanceOf(staker))}`)
        console.log(`staker balance after           : ${formatUnits(await vault.balanceOf(staker))}\n`)

        const unclaimedRewards = vault.interface.decodeFunctionResult("unclaimedRewards", callReceipt.events[0].args.data)[0]

        let claimedRewards
        if (!txReceipt.logs[1]) {
            claimedRewards = BigNumber.from(0)
        } else {
            const event = vault.interface.parseLog(txReceipt.logs[1])
            claimedRewards = event.args.reward

            console.log(`staker rewards actually claimed       : ${formatUnits(claimedRewards)}`)
            console.log(`staker rewards expected to be claimed : ${formatUnits(unclaimedRewards)}`)
            console.log(
                `staker rewards expected missing       :  ${formatUnits(claimedRewards.sub(unclaimedRewards))} ${formatUnits(
                    claimedRewards.sub(unclaimedRewards).mul(10000).div(claimedRewards),
                    2,
                )}%\n`,
            )
        }
        expect(claimedRewards, "reward amounts equal").to.equal(unclaimedRewards)

        const postClaim = await vault.unclaimedRewards(staker)
        expect(postClaim.amount, "post claim rewards").to.equal(0)

        return claimedRewards
    }
    describe("imUSD vault", () => {
        describe.skip("testing", async () => {
            before(async () => {
                await runSetup(16993525)
            })
            // 0xb16f14896161c89ff5107965b19f79e24082f174
            const staker = "0xebdd3bbfb8085f1143233a2da39762b67a8ca270"
            it("should claim now", async () => {
                const claimedRewards = await assertClaim(staker, mUSD)
                console.log(`unclaimedRewards: ${claimedRewards}`)
                expect(claimedRewards, "claimed rewards").to.gt(0)
            })
        })
        describe("User staked then partially withdraw and claimed more than 26 weeks ago", async () => {
            // Staked 84,059.46 2021-08-08
            // Claimed 2021-11-07
            // Withdrawn 30,000 2021-11-07
            // immediate: 191.874304991927827101
            // locked   :  65.03226924415188681
            // total    :  256.906574236079713911
            const staker = "0xf56e9b3b2e17659637bfa24f05b8ba81557185ab"
            let vault: BoostedVault
            beforeEach(async () => {
                await runSetup(16993525)
                vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
            })
            it("poke does not increase boost balance", async () => {
                await assertPoke(staker, mUSD, false)
            })
            it("locked rewards is incorrect without poke as there are locked rewards since last action", async () => {
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                await vault.pokeBoost(staker)

                const lockedRewardsAfter = await calcLockedRewards(vault, staker)
                expect(lockedRewardsAfter, "locked rewards").to.gt(lockedRewardsBefore)
            })
            it("immediate rewards is correct without a poke", async () => {
                const immediateRewardsBefore = await vault.earned(staker)

                await vault.pokeBoost(staker)

                const immediateRewardsAfter = await vault.earned(staker)
                expect(immediateRewardsAfter, "immediate rewards").to.eq(immediateRewardsBefore)
            })
            it("should fail to get expected claim amount", async () => {
                const { actual: firstClaim } = await assertClaimFail(staker, mUSD)

                await increaseTime(ONE_WEEK.mul(27))
                const secondClaim = await assertClaim(staker, mUSD)

                console.log(`first claim now       : ${formatUnits(firstClaim)}`)
                console.log(`second claim 26 weeks :  ${formatUnits(secondClaim)}`)
            })
            it("should claim now after being poked", async () => {
                await assertPoke(staker, mUSD, false)
                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards").to.gt(0)

                await increaseTime(ONE_WEEK)
                const unlockedRewards = await assertClaim(staker, mUSD)
                expect(unlockedRewards, "more rewards unlocked").to.gt(0)
            })
            it("should claim in 27 weeks after being poked", async () => {
                await assertPoke(staker, mUSD, false)

                const immediateRewardsBefore = await vault.earned(staker)
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(27))

                expect(await vault.earned(staker), "no more earned rewards").to.eq(immediateRewardsBefore)
                expect(await calcLockedRewards(vault, staker), "locked rewards").to.eq(lockedRewardsBefore)

                const finalClaimedRewards = await assertClaim(staker, mUSD)
                expect(finalClaimedRewards, "final claim of rewards").to.gt(0)
                assertBNClosePercent(finalClaimedRewards, lockedRewardsBefore.add(immediateRewardsBefore), 0.0001, "locked rewards")
            })
            it("should fail to get expected claim amount after 26 weeks", async () => {
                await increaseTime(ONE_WEEK.mul(26))

                const { actual: firstClaim } = await assertClaimFail(staker, mUSD)

                // Claim more in a week
                await increaseTime(ONE_WEEK)
                const secondClaim = await assertClaim(staker, mUSD)

                // Claim more in 26 week
                await increaseTime(ONE_WEEK.mul(26))
                const thirdClaim = await assertClaim(staker, mUSD)

                await increaseTime(ONE_WEEK)
                const fourthClaim = await assertClaim(staker, mUSD)
                expect(fourthClaim, "no more rewards to claim").to.eq(0)

                console.log(`first claim now in 26 weeks : ${formatUnits(firstClaim)}`)
                console.log(`second claim 1 more week    :  ${formatUnits(secondClaim)}`)
                console.log(`third claim 26 more weeks   :  ${formatUnits(thirdClaim)}`)
                console.log(`forth claim 1 more week     :  ${formatUnits(fourthClaim)}`)
            })
        })
        describe("User staked twice after upgrade but more than 26 weeks ago", async () => {
            // Staked 2,231,086.00 2021-11-12
            // Staked 4,430,121.91 2021-11-13
            // earnedRewards:  23,529.677387507907173667
            // lockedRewards:  94,118.709550031628694668
            // totalRewards : 117,648.386937539535868335
            const staker = "0x3a3ee61f7c6e1994a2001762250a5e17b2061b6d"
            let vault: BoostedVault
            beforeEach(async () => {
                await runSetup(16993525)
                vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
            })
            it("should fail to get expected claim amount", async () => {
                const { actual } = await assertClaimFail(staker, mUSD)
                expect(actual, "claimed rewards").to.gt(0)
            })
            it("should claim now without being poked", async () => {
                const earnedImmediately = await vault.earned(staker)
                const lockedRewards = await calcLockedRewards(vault, staker)
                const totalRewards = earnedImmediately.add(lockedRewards)

                const { actual: firstClaimedRewards, expected } = await assertClaimFail(staker, mUSD)
                expect(firstClaimedRewards, "first claim").to.gte(earnedImmediately)
                await assertBNClosePercent(expected, earnedImmediately, 1, "expect from unclaimedRewards()")

                await increaseTime(ONE_WEEK)
                const secondClaimedRewards = await assertClaim(staker, mUSD)

                await increaseTime(ONE_WEEK.mul(26))
                const thirdClaimedRewards = await assertClaim(staker, mUSD)

                console.log(`claim now     : ${formatUnits(firstClaimedRewards)}`)
                console.log(`claim 1 week  :  ${formatUnits(secondClaimedRewards)}`)
                console.log(`claim 26 weeks: ${formatUnits(thirdClaimedRewards)}`)
                await assertBNClosePercent(
                    firstClaimedRewards.add(secondClaimedRewards).add(thirdClaimedRewards),
                    totalRewards,
                    0.0001,
                    "total rewards",
                )
            })
            it("should claim in 26 week without being poked", async () => {
                await increaseTime(ONE_WEEK.mul(26))

                const earnedImmediately = await vault.earned(staker)
                const lockedRewards = await calcLockedRewards(vault, staker)
                const totalRewards = earnedImmediately.add(lockedRewards)

                const { actual: firstClaimedRewards, expected } = await assertClaimFail(staker, mUSD)
                expect(firstClaimedRewards, "first claim").to.gte(earnedImmediately)
                await assertBNClosePercent(expected, earnedImmediately, 1, "expect from unclaimedRewards()")

                await increaseTime(ONE_WEEK)
                const secondClaimedRewards = await assertClaim(staker, mUSD)
                expect(secondClaimedRewards, "locked rewards are being streamed").to.gt(0)

                await increaseTime(ONE_WEEK.mul(26))
                const thirdClaimedRewards = await assertClaim(staker, mUSD)

                console.log(`claim 26 weeks : ${formatUnits(firstClaimedRewards)}`)
                console.log(`claim 27 weeks :  ${formatUnits(secondClaimedRewards)}`)
                console.log(`claim 52 weeks : ${formatUnits(thirdClaimedRewards)}`)
                await assertBNClosePercent(
                    firstClaimedRewards.add(secondClaimedRewards).add(thirdClaimedRewards),
                    totalRewards,
                    0.0001,
                    "total rewards",
                )

                await increaseTime(ONE_WEEK)
                const noMoreClaimedRewards = await assertClaim(staker, mUSD)
                expect(noMoreClaimedRewards, "no more rewards").to.eq(0)
            })
            it("should claim in 26 weeks after being poked", async () => {
                await assertPoke(staker, mUSD, false)

                const immediateRewardsBefore = await vault.earned(staker)
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(26))

                expect(await vault.earned(staker), "no more earned rewards").to.eq(immediateRewardsBefore)
                expect(await calcLockedRewards(vault, staker), "locked rewards").to.eq(lockedRewardsBefore)

                const finalClaimedRewards = await assertClaim(staker, mUSD)
                expect(finalClaimedRewards, "final claim of rewards").to.gt(0)
                await assertBNClosePercent(finalClaimedRewards, lockedRewardsBefore.add(immediateRewardsBefore), 0.0001, "locked rewards")
            })
        })
        describe("User staked twice less than 26 weeks ago, no withdraw or claims", async () => {
            // Staked 18,598.30 22022-11-15
            // Staked 115,183.94 2022-11-15
            const staker = "0xebdd3bbfb8085f1143233a2da39762b67a8ca270"
            let vault: BoostedVault
            beforeEach(async () => {
                await runSetup(16993525)
                vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
            })
            it("locked rewards is correct without a poke", async () => {
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                await vault.pokeBoost(staker)

                const lockedRewardsAfter = await calcLockedRewards(vault, staker)
                expect(lockedRewardsAfter, "locked rewards").to.eq(lockedRewardsBefore)
            })
            it("immediate rewards is correct without a poke", async () => {
                const immediateRewardsBefore = await vault.earned(staker)

                await vault.pokeBoost(staker)

                const immediateRewardsAfter = await vault.earned(staker)
                expect(immediateRewardsAfter, "immediate rewards").to.eq(immediateRewardsBefore)
            })
            it("poke does not increase boost balance", async () => {
                await assertPoke(staker, mUSD, false)
            })
            it("should claim now without being poked", async () => {
                const earnedImmediately = await vault.earned(staker)
                const lockedRewards = await calcLockedRewards(vault, staker)

                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards now").to.eq(earnedImmediately)

                await increaseTime(ONE_WEEK)
                const unlockedRewards = await assertClaim(staker, mUSD)
                expect(unlockedRewards, "no more rewards unlocked").to.eq(0)

                await increaseTime(ONE_WEEK.mul(27))

                const finalClaimedRewards = await assertClaim(staker, mUSD)
                expect(finalClaimedRewards, "final claim of rewards").to.gt(0)
                await assertBNClosePercent(finalClaimedRewards, lockedRewards, 0.0001, "locked rewards")
            })
            it.skip("should claim in 27 weeks without being poked", async () => {
                const immediateRewardsBefore = await vault.earned(staker)
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(27))

                // TODO this looks like a vault bug
                const finalClaimedRewards = await assertClaim(staker, mUSD)
                expect(finalClaimedRewards, "final claim of rewards").to.gt(0)
                await assertBNClosePercent(finalClaimedRewards, lockedRewardsBefore.add(immediateRewardsBefore), 0.0001, "locked rewards")
            })
            it("should claim now and then in 27 weeks without being poked", async () => {
                const immediateRewardsBefore = await vault.earned(staker)
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                const tx1 = await vault["claimRewards()"]()
                const receipt1 = await tx1.wait()
                const firstClaim = receipt1.events[1].args.reward

                await increaseTime(ONE_WEEK.mul(27))

                const tx2 = await vault["claimRewards()"]()
                const receipt2 = await tx2.wait()
                const secondClaim = receipt2.events[1].args.reward

                await assertBNClosePercent(
                    firstClaim.add(secondClaim),
                    lockedRewardsBefore.add(immediateRewardsBefore),
                    0.0001,
                    "locked rewards",
                )
            })
            it.skip("should claim in 27 weeks without being poked", async () => {
                const immediateRewardsBefore = await vault.earned(staker)
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(27))

                const tx = await vault["claimRewards()"]()
                const receipt = await tx.wait()
                const claimedRewards = receipt.events[1].args.reward
                console.log(`secondClaim: ${formatUnits(claimedRewards)}`)

                await assertBNClosePercent(claimedRewards, lockedRewardsBefore.add(immediateRewardsBefore), 0.0001, "locked rewards")
            })
        })
        describe("User staked 247k imUSD less than 26 weeks ago with no withdraws or claims", async () => {
            // Staked 247,258.65 2022-11-11
            const staker = "0x28d79103d8a4a9152023e7d4f5321bea78f5bd24"
            let vault: BoostedVault
            beforeEach(async () => {
                // 7 April 23
                await runSetup(16993525)
                vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
            })
            it("locked rewards is correct without poke", async () => {
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                await vault.pokeBoost(staker)

                const lockedRewardsAfter = await calcLockedRewards(vault, staker)
                expect(lockedRewardsAfter, "locked rewards").to.eq(lockedRewardsBefore)
            })
            it("immediate rewards is correct without a poke", async () => {
                const immediateRewardsBefore = await vault.earned(staker)

                await vault.pokeBoost(staker)

                const immediateRewardsAfter = await vault.earned(staker)
                expect(immediateRewardsAfter, "immediate rewards").to.eq(immediateRewardsBefore)
            })
            it("should claim now before any unlocked rewards without poked", async () => {
                const earnedImmediately = await vault.earned(staker)
                const lockedRewards = await calcLockedRewards(vault, staker)
                // const totalRewards = earnedImmediately.add(lockedRewards)

                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards now").to.eq(earnedImmediately)

                await increaseTime(ONE_WEEK)
                const unlockedRewards = await assertClaim(staker, mUSD)
                expect(unlockedRewards, "no more rewards unlocked").to.eq(0)

                await increaseTime(ONE_WEEK.mul(27))

                const finalClaimedRewards = await assertClaim(staker, mUSD)
                expect(finalClaimedRewards, "final claim of rewards").to.gt(0)
                await assertBNClosePercent(finalClaimedRewards.add(unlockedRewards), lockedRewards, 0.0001, "locked rewards")
            })
            it("should fail to calc rewards in 13 weeks when some rewards are unlock without poke", async () => {
                await increaseTime(ONE_WEEK.mul(13))

                await assertClaimFail(staker, mUSD)
            })
            it("should partially withdraw, wait 13 weeks, claim, wait 13 weeks, final claim", async () => {
                const immediateRewardsBefore = await vault.earned(staker)
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)
                console.log(`expected rewards: ${formatUnits(lockedRewardsBefore.add(immediateRewardsBefore))}`)

                await vault.withdraw(simpleToExactAmount(1000))

                await increaseTime(ONE_WEEK.mul(13))

                const claimedRewards = await assertClaim(staker, mUSD)

                await increaseTime(ONE_WEEK.mul(13))

                const finalClaimedRewards = await assertClaim(staker, mUSD)

                await assertBNClosePercent(
                    claimedRewards.add(finalClaimedRewards),
                    lockedRewardsBefore.add(immediateRewardsBefore),
                    0.0001,
                    "locked rewards",
                )
            })
            it("should claim in 26 weeks, then claim again in another 26 weeks", async () => {
                const immediateRewardsBefore = await vault.earned(staker)
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)
                const totalRewards = immediateRewardsBefore.add(lockedRewardsBefore)
                console.log(`expected rewards: ${formatUnits(lockedRewardsBefore.add(immediateRewardsBefore))}`)

                console.log(`block timestamp before: ${await getBlockDate()}`)
                await increaseTime(ONE_WEEK.mul(26))
                console.log(`block timestamp after : ${await getBlockDate()}`)

                // Only claims 1,641.153773790775655851 MTA
                // Expected
                // earnedRewards: 589.411723459431021207
                // lockedRewards: 2357.646893837724084828
                // totalRewards : 2947.058617297155106035
                const { expected, actual: firstClaim } = await assertClaimFail(staker, mUSD)
                expect(expected, "expected rewards is immediate rewards").to.eq(immediateRewardsBefore)
                expect(firstClaim, "actual rewards").to.eq("1641153819790908106629")

                await increaseTime(ONE_WEEK.mul(26))
                console.log(`block timestamp after : ${await getBlockDate()}`)

                const secondClaim = await assertClaim(staker, mUSD)
                console.log(`firstClaim : ${formatUnits(firstClaim)}`)
                console.log(`secondClaim: ${formatUnits(secondClaim)}`)
                await assertBNClosePercent(firstClaim.add(secondClaim), totalRewards, 0.0001, "total claimed rewards")
            })
            it.skip("should claim in 27 weeks without being poked", async () => {
                const immediateRewardsBefore = await vault.earned(staker)
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)
                console.log(`expected rewards: ${formatUnits(lockedRewardsBefore.add(immediateRewardsBefore))}`)

                await increaseTime(ONE_WEEK.mul(27))

                const tx = await vault["claimRewards()"]()
                const receipt = await tx.wait()
                const claimedRewards = receipt.events[1].args.reward
                console.log(`claimed rewards : ${formatUnits(claimedRewards)}`)

                await assertBNClosePercent(claimedRewards, lockedRewardsBefore.add(immediateRewardsBefore), 0.0001, "locked rewards")
            })
        })
        describe("User staked 209k imUSD more than 26 weeks ago and has staked MTA", async () => {
            // Staked 209,741.68 2021-01-20
            const staker = "0x23fce9891bcbca7bdec5262dd28c244415319a13"
            let vault: BoostedVault
            beforeEach(async () => {
                await runSetup(16993525)
                vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
            })
            it("locked rewards is correct without poke", async () => {
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                await vault.pokeBoost(staker)

                const lockedRewardsAfter = await calcLockedRewards(vault, staker)
                expect(lockedRewardsAfter, "locked rewards").to.eq(lockedRewardsBefore)
            })
            it("immediate rewards is correct without a poke", async () => {
                const immediateRewardsBefore = await vault.earned(staker)

                await vault.pokeBoost(staker)

                const immediateRewardsAfter = await vault.earned(staker)
                expect(immediateRewardsAfter, "immediate rewards").to.eq(immediateRewardsBefore)
            })
            it("should fail to get expected claim amount as boost balance is incorrect", async () => {
                const { actual } = await assertClaimFail(staker, mUSD)
                expect(actual, "claimed rewards").to.gt(0)
            })
            it("should claim now after being poked", async () => {
                await assertPoke(staker, mUSD, true)
                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards").to.gt(0)
            })
            it("should claim in 27 weeks after being poked", async () => {
                await assertPoke(staker, mUSD, true)

                const immediateRewardsBefore = await vault.earned(staker)
                const lockedRewardsBefore = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(27))

                const finalClaimedRewards = await assertClaim(staker, mUSD)
                expect(finalClaimedRewards, "final claim of rewards").to.gt(0)
                await assertBNClosePercent(finalClaimedRewards, lockedRewardsBefore.add(immediateRewardsBefore), 0.0001, "locked rewards")
            })
        })
        describe("User does not have any more locked rewards", async () => {
            // Last Withdraw of all 2022-09-12 > 26 weeks ago
            // Last claim 2023-03-28
            const staker = "0xc6bbfe0ce06f85ed6edbfd015cd5920e17b128da"
            before(async () => {
                await runSetup(16993525)
            })
            it("should not have any rewards left", async () => {
                const claimedRewards = await assertClaim(staker, mUSD)
                console.log(`unclaimedRewards: ${claimedRewards}`)
                expect(claimedRewards, "claimed rewards").to.eq(0)
            })
        })
        describe("User staked in last 26 weeks and not withdrawn or claimed", () => {
            // Staked 20.45 2023-01-05
            before(async () => {
                await runSetup(16993525)
            })
            const staker = "0xf91a9bd6e9e00de7dbc54bf86ee9c011bc74c2dd"
            it("should claim now without a poke", async () => {
                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards").to.gt(0)
            })
            it("nothing to claim in one week", async () => {
                await increaseTime(ONE_WEEK)
                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards").to.eq(0)
            })
            it("should claim after 27 weeks", async () => {
                const vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
                const lockedRewards = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(27))
                const finalClaimedRewards = await assertClaim(staker, mUSD)

                expect(lockedRewards, "locked rewards").to.eq(finalClaimedRewards)
            })
            it("should not be able to do a second claim after 27 weeks", async () => {
                await increaseTime(ONE_WEEK)
                const secondClaim = await assertClaim(staker, mUSD)
                expect(secondClaim, "second rewards claim").to.equal(0)
            })
        })
        describe("User staked over 2 years ago and not withdrawn or claimed", () => {
            // Staked 10.00 2021-01-18
            // Staked 999.96 2021-01-18
            const staker = "0x0c2ef8a1b3bc00bf676053732f31a67ebba5bd81"
            before(async () => {
                // Streaming of immediate rewards has finished
                await runSetup(16993811)
            })
            it("should fail to get expected claim amount", async () => {
                const { actual } = await assertClaimFail(staker, mUSD)
                expect(actual, "claimed rewards").to.gt(0)
            })
            it("poke user", async () => {
                await assertPoke(staker, mUSD, false)
            })
            it("should claim now after poke", async () => {
                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards").to.gt(0)
            })
            it("should claim more in one minute", async () => {
                await increaseTime(ONE_MIN)
                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards").to.gt(0)
            })
            it("should claim after 26 weeks", async () => {
                const vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
                const lockedRewards = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(26))
                const finalClaimedRewards = await assertClaim(staker, mUSD)

                expect(lockedRewards, "locked rewards").to.eq(finalClaimedRewards)
            })
            it("should not be able to do a second claim after 27 weeks", async () => {
                await increaseTime(ONE_WEEK)
                const secondClaim = await assertClaim(staker, mUSD)
                expect(secondClaim, "second rewards claim").to.equal(0)
            })
        })
        describe("User staked over 26 weeks ago, has since withdrawn all and claimed", () => {
            // Staked 2022-03-14 428,573.45
            // Staked 2022-04-05 1,384,488.46
            // Staked 2022-04-07 341,824.76
            // Withdraw partial 2022-04-15 426,863.81
            // other partial withdrawals
            // Withdraw remaining 2023-04-03 09:26 969,865.17
            // Claim 2023-04-03 09:27
            before(async () => {
                await runSetup(16987326)
            })
            const staker = "0xb86b721a167630d94a54a0899a1ed75d4135d2ca"
            it("should claim now without poke", async () => {
                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards").to.gt(0)
            })
            it("should claim in one week", async () => {
                await increaseTime(ONE_WEEK)
                const claimedRewards = await assertClaim(staker, mUSD)
                expect(claimedRewards, "claimed rewards").to.gt(0)
            })
            it("should claim after 27 weeks", async () => {
                const vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
                const lockedRewards = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(27))
                const finalClaimedRewards = await assertClaim(staker, mUSD)

                expect(lockedRewards, "locked rewards").to.eq(finalClaimedRewards)
            })
            it("should not be able to do a second claim after 27 weeks", async () => {
                await increaseTime(ONE_WEEK)
                const secondClaim = await assertClaim(staker, mUSD)
                expect(secondClaim, "second rewards claim").to.equal(0)
            })
        })
        describe("User withdraw all in the last stream but has not claimed", () => {
            // Staked 418,511.69 2021-01-23
            // Claim 2022-01-30
            // CLaim 2022-05-29
            // Withdraw 418,511.69 2023-04-05
            beforeEach(async () => {
                await runSetup(16987326)
            })
            const staker = "0x861038738e10ba2963f57612179957ec521089cd"
            it("should claim now without poke", async () => {
                const firstClaimedRewards = await assertClaim(staker, mUSD)
                expect(firstClaimedRewards, "claimed rewards").to.gt(0)

                await increaseTime(ONE_WEEK)
                const secondClaimedRewards = await assertClaim(staker, mUSD)
                expect(secondClaimedRewards, "claimed rewards").to.gt(0)

                const vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
                const lockedRewards = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(26))
                const finalClaimedRewards = await assertClaim(staker, mUSD)

                expect(lockedRewards, "locked rewards").to.eq(finalClaimedRewards)

                await increaseTime(ONE_WEEK)
                const secondClaim = await assertClaim(staker, mUSD)
                expect(secondClaim, "second rewards claim").to.equal(0)
            })
            it("should claim in 26 weeks without poke", async () => {
                const vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
                const lockedRewards = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(26))

                const earnedImmediately = await vault.earned(staker)
                expect(earnedImmediately, "some unclaimed immediate rewards").to.gt(0)

                const firstClaimedRewards = await assertClaim(staker, mUSD)

                expect(firstClaimedRewards, "claimed rewards").to.gt(0)
                expect(lockedRewards.add(earnedImmediately), "locked rewards").to.eq(firstClaimedRewards)

                await increaseTime(ONE_WEEK)
                const secondClaimedRewards = await assertClaim(staker, mUSD)
                expect(secondClaimedRewards, "no more rewards to claim").to.eq(0)
            })
        })
    })
})
