import { impersonateAccount } from "@utils/fork"
import { ethers, network } from "hardhat"
import { Account } from "@utils/machines"
import { deployContract } from "tasks/utils/deploy-utils"
import { aave, stkAave, DAI, mBTC, mUSD, USDC, USDT, WBTC, COMP, GUSD } from "tasks/utils/tokens"
import {
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20,
    ERC20__factory,
    IAaveIncentivesController,
    IAaveIncentivesController__factory,
    Liquidator,
    Liquidator__factory,
} from "types/generated"
import { AaveStakedTokenV2 } from "types/generated/AaveStakedTokenV2"
import { AaveStakedTokenV2__factory } from "types/generated/factories/AaveStakedTokenV2__factory"
import { expect } from "chai"
import { BN, simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { increaseTime } from "@utils/time"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"

// Addresses for signers
const opsAddress = "0xb81473f20818225302b8fffb905b53d58a793d84"
const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
const delayedAdminAddress = "0x5c8eb57b44c1c6391fc7a8a0cf44d26896f92386"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const stkAaveWhaleAddress = "0xdb5AA12AD695Ef2a28C6CdB69f2BB04BEd20a48e"

const liquidatorAddress = "0xe595D67181D701A5356e010D9a58EB9A341f1DbD"
const aaveMusdIntegrationAddress = "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E"
const aaveMbtcIntegrationAddress = "0xC9451a4483d1752a3E9A3f5D6b1C7A6c34621fC6"
const compoundIntegrationAddress = "0xD55684f4369040C12262949Ff78299f2BC9dB735"
const nexusAddress = "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3"
const uniswapRouterV2Address = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
const uniswapEthToken = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const aaveIncentivesControllerAddress = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5"

const aTokens = [USDT.liquidityProvider, DAI.liquidityProvider]

context("Liquidator", () => {
    let ops: Account
    let governor: Account
    let stkAaveWhale: Account
    let ethWhale: Account
    let delayedProxyAdmin: DelayedProxyAdmin
    let aaveIncentivesController: IAaveIncentivesController
    let aaveToken: ERC20
    let aaveStakedToken: AaveStakedTokenV2
    let compToken: ERC20

    async function runSetup(blockNumber: number) {
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
        ops = await impersonateAccount(opsAddress)
        stkAaveWhale = await impersonateAccount(stkAaveWhaleAddress)
        governor = await impersonateAccount(governorAddress)
        ethWhale = await impersonateAccount(ethWhaleAddress)

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.signer.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(10),
        })

        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, governor.signer)
        aaveIncentivesController = IAaveIncentivesController__factory.connect(aaveIncentivesControllerAddress, ops.signer)
        aaveToken = ERC20__factory.connect(aave.address, ops.signer)
        aaveStakedToken = AaveStakedTokenV2__factory.connect(stkAave.address, stkAaveWhale.signer)
        compToken = ERC20__factory.connect(COMP.address, ops.signer)
    }

    it("Test connectivity", async () => {
        const currentBlock = await ethers.provider.getBlockNumber()
        console.log(`Current block ${currentBlock}`)
    })
    context.skip("Staked Aave rewards", () => {
        before("reset block number", async () => {
            await runSetup(12493000)
        })
        context("claim Aave rewards from stkAave", () => {
            before(async () => {
                const coolDownStartTimestamp = await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress)
                const coolDownStart = new Date(coolDownStartTimestamp.mul(1000).toNumber())
                console.log(`stkAave whale cool down start timestamp ${coolDownStartTimestamp}, ${coolDownStart}`)

                const currentBlock = await ops.signer.provider.getBlock("latest")
                const currentBlockDate = new Date(currentBlock.timestamp * 1000)
                console.log(`Current block ${currentBlock.number}, timestamp ${currentBlock.timestamp}, ${currentBlockDate}`)
            })
            after(async () => {
                const coolDownStartTimestamp = await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress)
                const coolDownStart = new Date(coolDownStartTimestamp.mul(1000).toNumber())
                console.log(`stkAave whale cool down start timestamp ${coolDownStartTimestamp}, ${coolDownStart}`)

                const currentBlock = await ops.signer.provider.getBlock("latest")
                const currentBlockDate = new Date(currentBlock.timestamp * 1000)
                console.log(`Current block ${currentBlock.number}, timestamp ${currentBlock.timestamp}, ${currentBlockDate}`)
            })
            it("Fail to claim more Aave than total rewards", async () => {
                const unclaimedRewards = await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress)
                const totalRewards = await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress)
                console.log(`Rewards unclaimed ${formatUnits(unclaimedRewards)}, total ${formatUnits(totalRewards)}`)
                expect(unclaimedRewards, "unclaimed rewards <= total rewards").to.lte(totalRewards)

                const tx = aaveStakedToken.claimRewards(stkAaveWhaleAddress, totalRewards.add(simpleToExactAmount(1)))

                await expect(tx).to.revertedWith("INVALID_AMOUNT")
                expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress)).to.eq(totalRewards)
            })
            it("Succeed to claim > claimable rewards < total rewards", async () => {
                const aaveBalanceBefore = await aaveToken.balanceOf(stkAaveWhaleAddress)
                const unclaimedRewards = await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress)
                const totalRewards = await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress)
                const newUnclaimedAmount = simpleToExactAmount(100)
                const claimAmount = totalRewards.sub(newUnclaimedAmount)
                console.log(
                    `Rewards unclaimed ${formatUnits(unclaimedRewards)}, total ${formatUnits(totalRewards)}, claim amount ${formatUnits(
                        claimAmount,
                    )}, new unclaimed amount ${formatUnits(newUnclaimedAmount)}`,
                )
                expect(claimAmount, "claim amount > rewards unclaimed").to.gt(unclaimedRewards)
                expect(claimAmount, "claim amount < rewards total").to.lt(totalRewards)
                expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0)

                const tx = await aaveStakedToken.claimRewards(stkAaveWhaleAddress, claimAmount)
                const receipt = await tx.wait()

                expect(await aaveToken.balanceOf(stkAaveWhaleAddress), "aave tokens = before balance + claim amount").to.eq(
                    aaveBalanceBefore.add(claimAmount),
                )
                expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "new unclaimed rewards").to.eq(newUnclaimedAmount)
                const totalRewardsAfter = await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress)
                expect(totalRewardsAfter, "total rewards = total before - claim amount").to.eq(totalRewards.sub(claimAmount))
                expect(totalRewardsAfter, "total rewards = new unclaimed amount").to.eq(newUnclaimedAmount)
                expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0)
            })
            it("Succeed to claim all total rewards", async () => {
                const aaveBalanceBefore = await aaveToken.balanceOf(stkAaveWhaleAddress)
                const unclaimedRewards = await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress)
                const totalRewards = await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress)
                console.log(`Rewards unclaimed ${formatUnits(unclaimedRewards)}, total ${formatUnits(totalRewards)}`)
                expect(unclaimedRewards).to.eq(totalRewards)

                await aaveStakedToken.claimRewards(stkAaveWhaleAddress, totalRewards)

                expect(await aaveToken.balanceOf(stkAaveWhaleAddress), "aave tokens = before balance + claim amount").to.eq(
                    aaveBalanceBefore.add(totalRewards),
                )
                expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no more unclaimed rewards").to.eq(0)
                expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no more total rewards").to.eq(0)
                expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0)
            })
            // TODO why is no Aave accrued?
            it("Waiting a week does not accrue more Aave rewards", async () => {
                expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), ">90k stkAave").to.gt(simpleToExactAmount(90000))
                await increaseTime(ONE_WEEK)
                expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0)
            })
            context.skip("redeem stkAave", () => {
                let stkAaveAmount: BN
                const remainingStakeAmount = simpleToExactAmount(10)
                const remainingStakeAmount2 = simpleToExactAmount(2)
                before(async () => {
                    stkAaveAmount = await aaveStakedToken.balanceOf(stkAaveWhaleAddress)
                })
                it("Fail to redeem remaining stkAave before cool down", async () => {
                    expect(stkAaveAmount, "some stkAave before").to.gt(0)
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                    expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0)
                    const tx = aaveStakedToken.redeem(stkAave.address, stkAaveAmount)
                    await expect(tx).to.revertedWith("UNSTAKE_WINDOW_FINISHED")
                })
                it("Activate cool down", async () => {
                    const tx = await aaveStakedToken.cooldown()
                    const receipt = await tx.wait()
                    const coolDownBlock = await ops.signer.provider.getBlock(receipt.blockNumber)
                    expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down activated").to.eq(
                        coolDownBlock.timestamp,
                    )
                    expect(await aaveStakedToken.COOLDOWN_SECONDS(), "Cool down is 10 days in seconds").to.eq(10 * 24 * 60 * 60)
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                })
                it("Fail to redeem staked Aave after 9 day from cool down", async () => {
                    // increment 9 days
                    const nineDays = ONE_DAY.mul(9)
                    await increaseTime(nineDays)
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                    const currentBlock = await ops.signer.provider.getBlock("latest")
                    const coolDownStartTimestamp = await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress)
                    const coolDownSeconds = await aaveStakedToken.COOLDOWN_SECONDS()
                    expect(currentBlock.timestamp, "block time < cool down start + cool down seconds").to.lt(
                        coolDownStartTimestamp.add(coolDownSeconds),
                    )
                    expect(currentBlock.timestamp, "Current timestamp is 9 days since cool down start").to.eq(
                        coolDownStartTimestamp.add(nineDays),
                    )
                    const tx = aaveStakedToken.redeem(stkAaveWhaleAddress, stkAaveAmount)
                    await expect(tx).to.revertedWith("INSUFFICIENT_COOLDOWN")
                })
                it("Can redeem staked Aave after 11 days from cool down", async () => {
                    // previously moved 9 days ahead so need to move 1 day to get to 10 days
                    await increaseTime(ONE_DAY)
                    const aaveBalanceBefore = await aaveToken.balanceOf(stkAaveWhaleAddress)
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                    const redeemAmount = stkAaveAmount.sub(remainingStakeAmount)
                    await aaveStakedToken.redeem(stkAaveWhaleAddress, redeemAmount)
                    expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), "stkAave after = remaining amount").to.eq(
                        remainingStakeAmount,
                    )
                    expect(await aaveToken.balanceOf(stkAaveWhaleAddress), "Aave after = before + redeem amount").to.eq(
                        aaveBalanceBefore.add(redeemAmount),
                    )
                })
                it("Can redeem more Aave in 2 day unstaked window", async () => {
                    await increaseTime(ONE_DAY)
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                    const redeemAmount = remainingStakeAmount.sub(remainingStakeAmount2)
                    await aaveStakedToken.redeem(stkAaveWhaleAddress, redeemAmount)
                    expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress)).to.eq(remainingStakeAmount2)
                })
                it("Failed to redeem remaining stkAave after 2 day unstake window", async () => {
                    // unstake window is 2 days
                    await increaseTime(ONE_DAY.mul(2))
                    const tx = aaveStakedToken.redeem(stkAave.address, remainingStakeAmount2)
                    await expect(tx).to.revertedWith("UNSTAKE_WINDOW_FINISHED")
                    expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress)).to.eq(remainingStakeAmount2)
                })
            })
            context.skip("stake Aave", () => {
                const stakeAmount = simpleToExactAmount(95000)
                it("stake some Aave", async () => {
                    const aaveBalanceBefore = await aaveToken.balanceOf(stkAaveWhaleAddress)
                    const stkAaveBalanceBefore = await aaveStakedToken.balanceOf(stkAaveWhaleAddress)
                    console.log(`Before stake: ${formatUnits(aaveBalanceBefore)} Aave, ${formatUnits(stkAaveBalanceBefore)} stkAave`)
                    await aaveToken.connect(stkAaveWhale.signer).approve(stkAave.address, stakeAmount)
                    await aaveStakedToken.stake(stkAaveWhaleAddress, stakeAmount)
                    expect(await aaveToken.balanceOf(stkAaveWhaleAddress), "aave balance after = before - staked Aave amount").to.eq(
                        aaveBalanceBefore.sub(stakeAmount),
                    )
                    expect(
                        await aaveStakedToken.balanceOf(stkAaveWhaleAddress),
                        "stkAave balance = before balance + staked Aave amount",
                    ).to.eq(stkAaveBalanceBefore.add(stakeAmount))
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                    expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0)
                })
                it("Waiting 10 weeks does to accrue Aave rewards", async () => {
                    expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), ">90k stkAave").to.gte(stakeAmount)
                    // increment 2 weeks
                    await increaseTime(ONE_WEEK.mul(10))
                    // TODO what aren't Aave rewards accrued for staking? Maybe an Aave accrual tx needs to be run.
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                    expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0)
                })
                it("Activate cool down", async () => {
                    const tx = await aaveStakedToken.cooldown()
                    const receipt = await tx.wait()
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                    const coolDownBlock = await ops.signer.provider.getBlock(receipt.blockNumber)
                    expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down activated").to.eq(
                        coolDownBlock.timestamp,
                    )
                    expect(await aaveStakedToken.COOLDOWN_SECONDS(), "Cool down is 10 days in seconds").to.eq(10 * 24 * 60 * 60)
                })
                it("Can not redeem staked Aave after 1 day from cool down", async () => {
                    // increment 1 day
                    await increaseTime(ONE_DAY)
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                    const currentBlock = await ops.signer.provider.getBlock("latest")
                    const coolDownStartTimestamp = await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress)
                    const coolDownSeconds = await aaveStakedToken.COOLDOWN_SECONDS()
                    expect(currentBlock.timestamp, "block time < cool down start + cool down seconds").to.lt(
                        coolDownStartTimestamp.add(coolDownSeconds),
                    )
                    expect(currentBlock.timestamp, "Current timestamp is 1 day since cool down start").to.eq(
                        coolDownStartTimestamp.add(ONE_DAY),
                    )
                    const tx = aaveStakedToken.redeem(stkAaveWhaleAddress, stakeAmount)
                    await expect(tx).to.revertedWith("INSUFFICIENT_COOLDOWN")
                })
                it("Can over redeem staked Aave after 11 days from cool down", async () => {
                    // previously moved 1 day ahead so need to move 10 days to get to 11 days
                    await increaseTime(ONE_DAY.mul(10))
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                    // Redeem 10 times the balance of the stkAave
                    await aaveStakedToken.redeem(stkAaveWhaleAddress, stakeAmount.mul(10))
                })
            })
            context.skip("Claim more rewards from Aave incentives", () => {
                const firstClaimAmount = simpleToExactAmount(2)
                const secondClaimAmount = simpleToExactAmount(4)
                let firstCoolDownAmount: BN
                it("Claim incentives rewards", async () => {
                    const stkAaveBalanceBefore = await aaveStakedToken.balanceOf(stkAaveWhaleAddress)

                    const unclaimedRewardsBefore = await aaveIncentivesController.getUserUnclaimedRewards(stkAaveWhaleAddress)
                    const rewardsBalanceBefore = await aaveIncentivesController.getRewardsBalance(aTokens, stkAaveWhaleAddress)
                    expect(unclaimedRewardsBefore, "unclaimed rewards = total rewards").to.eq(rewardsBalanceBefore)
                    console.log(`aaveIncentivesController.unclaimedRewardsBefore ${formatUnits(unclaimedRewardsBefore)}`)
                    console.log(`aaveIncentivesController.rewardsBalanceBefore ${formatUnits(rewardsBalanceBefore)}`)

                    await aaveIncentivesController.connect(stkAaveWhale.signer).claimRewards(aTokens, firstClaimAmount, stkAaveWhaleAddress)

                    firstCoolDownAmount = stkAaveBalanceBefore.add(firstClaimAmount)
                    expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), "stkAave after = before + claim amount").to.eq(
                        firstCoolDownAmount,
                    )
                    expect(
                        await aaveIncentivesController.getUserUnclaimedRewards(stkAaveWhaleAddress),
                        "unclaimed after = total rewards before - claim amount",
                    ).to.eq(rewardsBalanceBefore.sub(firstClaimAmount))
                    expect(
                        await aaveIncentivesController.getRewardsBalance(aTokens, stkAaveWhaleAddress),
                        "total rewards after = total rewards before - claim amount",
                    ).to.eq(rewardsBalanceBefore.sub(firstClaimAmount))

                    // No Aave rewards have been accrued yet for the stkAave
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "stkAave unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "stkAave total rewards").to.eq(0)
                })
                it("Waiting 1 week does to accrue Aave rewards", async () => {
                    // increment 2 weeks
                    await increaseTime(ONE_WEEK)
                    // TODO what aren't Aave rewards accrued for staking? Maybe an Aave accrual tx needs to be run.
                    expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0)
                    expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0)
                })
                it("Activate cool down", async () => {
                    const tx = await aaveStakedToken.cooldown()
                    const receipt = await tx.wait()
                    const coolDownBlock = await ops.signer.provider.getBlock(receipt.blockNumber)
                    expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down activated").to.eq(
                        coolDownBlock.timestamp,
                    )
                    expect(await aaveStakedToken.COOLDOWN_SECONDS(), "Cool down is 10 days in seconds").to.eq(10 * 24 * 60 * 60)
                })
                it("Claim more stkAave from incentives controller", async () => {
                    const stkAaveBalanceBefore = await aaveStakedToken.balanceOf(stkAaveWhaleAddress)

                    // increment 8 days
                    await increaseTime(ONE_DAY.mul(8))
                    const tx = await aaveIncentivesController
                        .connect(stkAaveWhale.signer)
                        .claimRewards(aTokens, secondClaimAmount, stkAaveWhaleAddress)

                    expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), "stkAave after = before + second claim amount").to.eq(
                        stkAaveBalanceBefore.add(secondClaimAmount),
                    )
                    const receipt = await tx.wait()
                    const coolDownBlock = await ops.signer.provider.getBlock(receipt.blockNumber)
                    // stkAave already cooled = first cool down amount * seconds passed / cool down seconds
                    const stkAaveAlreadyCooled = firstCoolDownAmount.mul(8).div(10)
                    // seconds already cooled of new amount = stkAave already cooled / (first cool down amount + second claim amount) * cool down seconds
                    const secondsAlreadyCooled = stkAaveAlreadyCooled
                        .mul(10 * 24 * 60 * 60)
                        .div(firstCoolDownAmount.add(secondClaimAmount))
                        .add(1)

                    // new cool down start = now - seconds already cooled off
                    expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "new weight average cool down timestamp").to.eq(
                        BN.from(coolDownBlock.timestamp).sub(secondsAlreadyCooled),
                    )
                })
                it("Fail to redeem staked Aave after 11 days from first cool down", async () => {
                    await increaseTime(ONE_DAY.mul(3))
                    const tx = aaveStakedToken.redeem(stkAaveWhaleAddress, firstClaimAmount.add(secondClaimAmount))
                    await expect(tx).to.revertedWith("INSUFFICIENT_COOLDOWN")
                })
                it("Successfully redeem Aave after 5 more days", async () => {
                    await increaseTime(ONE_DAY.mul(5))
                    await aaveStakedToken.redeem(stkAaveWhaleAddress, firstClaimAmount.add(secondClaimAmount))
                    expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down timestamp reset").to.eq(0)
                })
                it("Successfully claim more incentives after unstake window", async () => {
                    await increaseTime(ONE_DAY.mul(3))

                    await aaveIncentivesController.connect(stkAaveWhale.signer).claimRewards(aTokens, firstClaimAmount, stkAaveWhaleAddress)

                    expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), "some stkAave exists").to.gt(0)
                    expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress)).to.eq(0)
                })
            })
        })
    })
    context("Aave liquidation", () => {
        let liquidator: Liquidator
        before("reset block number", async () => {
            await runSetup(12510100)
        })
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAave.address,
                aave.address,
                uniswapRouterV2Address,
                COMP.address,
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade")
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data)
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
            expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress)
            expect(await liquidator.uniswap(), "Uniswap address").to.eq(uniswapRouterV2Address)
        })
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    aave.address,
                    USDC.address,
                    [aave.address, uniswapEthToken, USDC.address],
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
        })
        it("Added liquidation for mBTC Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMbtcIntegrationAddress,
                    aave.address,
                    WBTC.address,
                    [aave.address, uniswapEthToken, WBTC.address],
                    0,
                    simpleToExactAmount(2, WBTC.decimals - 3),
                    mBTC.address,
                    true,
                )
        })
        it("Added liquidation for GUSD Feeder Pool Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    GUSD.integrator,
                    aave.address,
                    GUSD.address,
                    [aave.address, uniswapEthToken, GUSD.address],
                    0,
                    simpleToExactAmount(50, GUSD.decimals),
                    ZERO_ADDRESS,
                    true,
                )
        })
        it("Claim stkAave from each integration contract", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress)
            await liquidator.claimStakedAave()
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave increased").gt(aaveBalanceBefore)
        })
        it("Fail to claim stkAave again before liquidation", async () => {
            const tx = liquidator.claimStakedAave()
            await expect(tx).revertedWith("Last claim cooldown not ended")
        })
        it("trigger liquidation of Aave after 11 days", async () => {
            await increaseTime(ONE_DAY.mul(11))
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has some stkAave before").gt(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave before").eq(0)

            await liquidator.triggerLiquidationAave()

            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has no stkAave after").eq(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave after").eq(0)
        })
        it("Fail to trigger liquidation of Aave again", async () => {
            const tx = liquidator.triggerLiquidationAave()
            await expect(tx).revertedWith("Must claim before liquidation")
        })
    })
    context("Aave liquidation", () => {
        let liquidator: Liquidator
        before("reset block number", async () => {
            await runSetup(12510100)
        })
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAave.address,
                aave.address,
                uniswapRouterV2Address,
                COMP.address,
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade")
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data)
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
        })
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    aave.address,
                    USDC.address,
                    [aave.address, uniswapEthToken, USDC.address],
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
        })
        it("Claim stkAave from each integration contract", async () => {
            const totalAaveClaimedBefore = await liquidator.totalAaveBalance()
            expect(totalAaveClaimedBefore, "totalAaveBalance before").to.eq(0)
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress)

            await liquidator.claimStakedAave()

            const liquidatorStkAaveBalance = await aaveStakedToken.balanceOf(liquidatorAddress)
            expect(liquidatorStkAaveBalance, "Liquidator's stkAave increased").gt(aaveBalanceBefore)
            expect(await liquidator.totalAaveBalance(), "totalAaveBalance after").to.eq(liquidatorStkAaveBalance)
        })
        it("Fail to claim stkAave during cool down period", async () => {
            const tx = liquidator.claimStakedAave()
            await expect(tx).revertedWith("Last claim cooldown not ended")
        })
        it("Fail to claim stkAave during unstake period", async () => {
            // Move time past the 10 day cooldown period
            await increaseTime(ONE_DAY.mul(10).add(60))
            const tx = liquidator.claimStakedAave()
            await expect(tx).revertedWith("Must liquidate last claim")
        })
        it("Fail to trigger liquidation of Aave after cooldown and unstake periods", async () => {
            // Move time past the 2 day unstake period
            await increaseTime(ONE_DAY.mul(3))
            const tx = liquidator.triggerLiquidationAave()
            await expect(tx).revertedWith("UNSTAKE_WINDOW_FINISHED")
        })
        it("Claim stkAave again after unstake period", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress)
            await liquidator.claimStakedAave()
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave does not increased").gt(aaveBalanceBefore)
        })
        it("trigger liquidation of Aave after 11 days", async () => {
            await increaseTime(ONE_DAY.mul(11))
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has some stkAave before").gt(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave before").eq(0)

            await liquidator.triggerLiquidationAave()

            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has no stkAave after").eq(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave after").eq(0)
        })
    })
    context("Compound liquidation", () => {
        let liquidator: Liquidator
        before("reset block number", async () => {
            await runSetup(12500000)
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
        })
        it("Read functions before upgrade", async () => {
            expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress)
            expect(await liquidator.uniswap(), "Uniswap address").to.eq(uniswapRouterV2Address)
        })
        it("Liquidate COMP before upgrade", async () => {
            await increaseTime(ONE_WEEK)
            const compBalanceBefore = await compToken.balanceOf(liquidatorAddress)
            await liquidator.triggerLiquidation(compoundIntegrationAddress)
            expect(await compToken.balanceOf(liquidatorAddress), "Less COMP").lt(compBalanceBefore)
        })
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAave.address,
                aave.address,
                uniswapRouterV2Address,
                COMP.address,
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade")
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data)
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)

            // Public immutable values
            expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress)
            expect(await liquidator.uniswap(), "Uniswap address").to.eq(uniswapRouterV2Address)
            expect(await liquidator.aaveToken(), "Aave address").to.eq(aave.address)
            expect(await liquidator.stkAave(), "Staked Aave address").to.eq(stkAave.address)
        })
        it("Added liquidation for mUSD Compound integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    compoundIntegrationAddress,
                    COMP.address,
                    USDC.address,
                    [COMP.address, uniswapEthToken, USDC.address],
                    simpleToExactAmount(20000, USDC.decimals),
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    false,
                )
        })
        it("Liquidate COMP after upgrade", async () => {
            await increaseTime(ONE_WEEK)
            const compBalanceBefore = await compToken.balanceOf(liquidatorAddress)
            await liquidator.triggerLiquidation(compoundIntegrationAddress)
            expect(await compToken.balanceOf(liquidatorAddress), "Less COMP").lt(compBalanceBefore)
        })
    })
    context("Negative tests", () => {
        let liquidator: Liquidator
        before("reset block number", async () => {
            await runSetup(12500000)
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)

            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAave.address,
                aave.address,
                uniswapRouterV2Address,
                COMP.address,
            ])

            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade")
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data)
            await increaseTime(ONE_WEEK.add(60))
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
        })
        it("Fail to call upgrade again", async () => {
            const tx = liquidator.upgrade()
            await expect(tx).revertedWith("SafeERC20: approve from non-zero to non-zero allowance")
        })
        it("short Uniswap path", async () => {
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    aave.address,
                    USDC.address,
                    [aave.address],
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
            await expect(tx).revertedWith("Invalid inputs")
        })
        it("reversed Uniswap path", async () => {
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    aave.address,
                    USDC.address,
                    [USDC.address, uniswapEthToken, aave.address],
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
            await expect(tx).revertedWith("Invalid uniswap path")
        })
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    aave.address,
                    USDC.address,
                    [aave.address, uniswapEthToken, USDC.address],
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
        })
        it("Fail to add duplicate liquidation", async () => {
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    aave.address,
                    USDC.address,
                    [aave.address, uniswapEthToken, USDC.address],
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
            await expect(tx).revertedWith("Liquidation already exists")
        })
    })
})
