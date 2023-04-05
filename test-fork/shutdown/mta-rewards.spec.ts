/* eslint-disable no-await-in-loop */
import { ONE_WEEK } from "@utils/constants"
import { impersonate } from "@utils/fork"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { BigNumber, BigNumberish } from "ethers"
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
    console.log(`last unclaimed period: ${lastPeriod}`)

    // Get the timestamp the staker last claimed rewards
    const lastClaim = (await vault.userClaim(staker)).toNumber()
    console.log(`Last claim: ${new Date(lastClaim * 1000)}`)

    let lockedRewards = BigNumber.from(0)
    for (let i = firstPeriod; i <= lastPeriod; i++) {
        const userRewards = await vault.userRewards(staker, i)
        console.log(`Period ${i} rate: ${userRewards.rate}`)
        console.log(`Period ${i} start: ${new Date(userRewards.start.toNumber() * 1000)}`)
        console.log(`Period ${i} finish: ${new Date(userRewards.finish.toNumber() * 1000)}`)

        // Get the timestamp to calculate the rewards from
        // This is the max of the last time the staker claimed or the start of the period
        const rewardsFromTimestamp = Math.max(userRewards.start.toNumber(), lastClaim)

        lockedRewards = lockedRewards.add(userRewards.rate.mul(userRewards.finish.sub(rewardsFromTimestamp)))
    }
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

    const assetClaim = async (staker: string, token: Token): Promise<BigNumberish> => {
        const signer = await impersonate(staker)
        const vault = BoostedVault__factory.connect(token.vault, signer)

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

        const unclaimedRewards = vault.interface.decodeFunctionResult("unclaimedRewards", callReceipt.events[0].args.data)[0]

        let claimedRewards
        if (!txReceipt.logs[1]) {
            claimedRewards = 0
        } else {
            const event = vault.interface.parseLog(txReceipt.logs[1])
            claimedRewards = event.args.reward
        }
        // const claimedRewards = txReceipt.events[1].args.reward
        expect(claimedRewards, "reward amounts equal").to.equal(unclaimedRewards)

        const postClaim = await vault.unclaimedRewards(staker)
        expect(postClaim.amount, "post claim rewards").to.equal(0)

        return unclaimedRewards
    }
    describe("imUSD vault", () => {
        describe("testing", async () => {
            before(async () => {
                await runSetup(16980500)
                // Move to after streaming of the last immediate rewards has finished
                await increaseTime(ONE_WEEK)
            })
            const staker = "0xf91a9bd6e9e00de7dbc54bf86ee9c011bc74c2dd"
            it("should claim now", async () => {
                const unclaimedRewards = await assetClaim(staker, mUSD)
                console.log(`unclaimedRewards: ${unclaimedRewards}`)
                expect(unclaimedRewards, "claimed rewards").to.gt(0)
            })
        })
        describe("User does not have any more locked rewards", async () => {
            before(async () => {
                await runSetup(16980500)
                // Move to after streaming of the last immediate rewards has finished
                await increaseTime(ONE_WEEK)
            })
            const staker = "0xc6bbfe0ce06f85ed6edbfd015cd5920e17b128da"
            it("should not be able to claim now", async () => {
                const unclaimedRewards = await assetClaim(staker, mUSD)
                console.log(`unclaimedRewards: ${unclaimedRewards}`)
                expect(unclaimedRewards, "claimed rewards").to.eq(0)
            })
        })
        describe("User staked in last 26 weeks and not withdrawn or claimed", () => {
            before(async () => {
                await runSetup(16980500)
                // Move to after streaming of the last immediate rewards has finished
                await increaseTime(ONE_WEEK)
            })
            const staker = "0xf91a9bd6e9e00de7dbc54bf86ee9c011bc74c2dd"
            it("should claim now", async () => {
                const unclaimedRewards = await assetClaim(staker, mUSD)
                expect(unclaimedRewards, "claimed rewards").to.gt(0)
            })
            it("nothing to claim in one week", async () => {
                await increaseTime(ONE_WEEK)
                const unclaimedRewards = await assetClaim(staker, mUSD)
                expect(unclaimedRewards, "claimed rewards").to.eq(0)
            })
            it("should claim after 27 weeks", async () => {
                const vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
                const lockedRewards = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(27))
                const finalClaimedRewards = await assetClaim(staker, mUSD)

                expect(lockedRewards, "locked rewards").to.eq(finalClaimedRewards)
            })
            it("should not be able to do a second claim after 27 weeks", async () => {
                await increaseTime(ONE_WEEK)
                const secondClaim = await assetClaim(staker, mUSD)
                expect(secondClaim, "second rewards claim").to.equal(0)
            })
        })
        describe("User staked over 26 weeks and not withdrawn or claimed", () => {
            before(async () => {
                await runSetup(16980500)
                // Move to after streaming of the last immediate rewards has finished
                await increaseTime(ONE_WEEK)
            })
            const staker = "0x0c2ef8a1b3bc00bf676053732f31a67ebba5bd81"
            it("should claim now", async () => {
                // await assetClaim("0xf91a9bd6e9e00de7dbc54bf86ee9c011bc74c2dd", mUSD)
                const unclaimedRewards = await assetClaim(staker, mUSD)
                expect(unclaimedRewards, "claimed rewards").to.gt(0)
                // Actual   30.460605355391996289
                // Actual 2 30.460605414489873001
                // Expected 23.252102475199431989
            })
            it("should claim in one week", async () => {
                await increaseTime(ONE_WEEK)
                const unclaimedRewards = await assetClaim(staker, mUSD)
                expect(unclaimedRewards, "claimed rewards").to.gt(0)
            })
            it("should claim after 27 weeks", async () => {
                const vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
                const lockedRewards = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(27))
                const finalClaimedRewards = await assetClaim(staker, mUSD)

                expect(lockedRewards, "locked rewards").to.eq(finalClaimedRewards)
            })
            it("should not be able to do a second claim after 27 weeks", async () => {
                await increaseTime(ONE_WEEK)
                const secondClaim = await assetClaim(staker, mUSD)
                expect(secondClaim, "second rewards claim").to.equal(0)
            })
        })

        describe("User staked over 26 weeks ago, has since withdrawn all and claimed", () => {
            before(async () => {
                await runSetup(16980500)
                // Move to after streaming of the last immediate rewards has finished
                await increaseTime(ONE_WEEK)
            })
            const staker = "0xb86b721a167630d94a54a0899a1ed75d4135d2ca"
            it("should claim now", async () => {
                const unclaimedRewards = await assetClaim(staker, mUSD)
                expect(unclaimedRewards, "claimed rewards").to.gt(0)
            })
            it("should claim in one week", async () => {
                await increaseTime(ONE_WEEK)
                const unclaimedRewards = await assetClaim(staker, mUSD)
                expect(unclaimedRewards, "claimed rewards").to.gt(0)
            })
            it("should claim after 27 weeks", async () => {
                const vault = BoostedVault__factory.connect(mUSD.vault, await impersonate(staker))
                const lockedRewards = await calcLockedRewards(vault, staker)

                await increaseTime(ONE_WEEK.mul(27))
                const finalClaimedRewards = await assetClaim(staker, mUSD)

                expect(lockedRewards, "locked rewards").to.eq(finalClaimedRewards)
            })
            it("should not be able to do a second claim after 27 weeks", async () => {
                await increaseTime(ONE_WEEK)
                const secondClaim = await assetClaim(staker, mUSD)
                expect(secondClaim, "second rewards claim").to.equal(0)
            })
        })
    })
})
