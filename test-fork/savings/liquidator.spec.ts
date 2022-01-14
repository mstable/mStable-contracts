/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { impersonateAccount } from "@utils/fork"
import { ethers, network } from "hardhat"
import { Account } from "types"
import { deployContract } from "tasks/utils/deploy-utils"
import { AAVE, stkAAVE, DAI, mBTC, mUSD, USDC, USDT, WBTC, COMP, GUSD, BUSD, CREAM, cyMUSD, RAI } from "tasks/utils/tokens"
import {
    CompoundIntegration__factory,
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20,
    ERC20__factory,
    FeederPool,
    FeederPool__factory,
    IAaveIncentivesController,
    IAaveIncentivesController__factory,
    IUniswapV3Quoter,
    IUniswapV3Quoter__factory,
    Liquidator,
    Liquidator__factory,
} from "types/generated"
import { AaveStakedTokenV2 } from "types/generated/AaveStakedTokenV2"
import { AaveStakedTokenV2__factory } from "types/generated/factories/AaveStakedTokenV2__factory"
import { expect } from "chai"
import { BN, simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { increaseTime } from "@utils/time"
import { ONE_DAY, ONE_HOUR, ONE_MIN, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { encodeUniswapPath } from "@utils/peripheral/uniswap"
import { resolveAddress } from "tasks/utils/networkAddressFactory"

// Addresses for signers
const governorAddress = resolveAddress("Governor")
const delayedAdminAddress = "0x5c8eb57b44c1c6391fc7a8a0cf44d26896f92386"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const stkAaveWhaleAddress = "0xdb5AA12AD695Ef2a28C6CdB69f2BB04BEd20a48e"
const musdWhaleAddress = "0x9b0c19000a8631c1f555bb365bDE308384E4f2Ff"

const liquidatorAddress = resolveAddress("Liquidator")
const aaveMusdIntegrationAddress = "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E"
const aaveMbtcIntegrationAddress = "0xC9451a4483d1752a3E9A3f5D6b1C7A6c34621fC6"
const compoundIntegrationAddress = "0xD55684f4369040C12262949Ff78299f2BC9dB735"
const nexusAddress = "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3"
const uniswapRouterV3Address = "0xE592427A0AEce92De3Edee1F18E0157C05861564"
const uniswapQuoterV3Address = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"
const uniswapEthToken = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const aaveIncentivesControllerAddress = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5"

const gusdIronBankIntegrationAddress = "0xaF007D4ec9a13116035a2131EA1C9bc0B751E3cf"
const busdIronBankIntegrationAddress = "0x2A15794575e754244F9C0A15F504607c201f8AfD"

const aTokens = [USDT.liquidityProvider, DAI.liquidityProvider]

const uniswapCompUsdcPaths = encodeUniswapPath([COMP.address, uniswapEthToken, USDC.address], [3000, 3000])
const uniswapAaveUsdcPath = encodeUniswapPath([AAVE.address, uniswapEthToken, USDC.address], [3000, 3000])
const uniswapAaveWbtcPath = encodeUniswapPath([AAVE.address, uniswapEthToken, WBTC.address], [3000, 3000])
const uniswapAaveGusdPath = encodeUniswapPath([AAVE.address, uniswapEthToken, GUSD.address], [3000, 3000])

context("Liquidator forked network tests", () => {
    let ops: Account
    let governor: Account
    let stkAaveWhale: Account
    let ethWhale: Account
    let musdWhale: Account
    let delayedProxyAdmin: DelayedProxyAdmin
    let aaveIncentivesController: IAaveIncentivesController
    let aaveToken: ERC20
    let aaveStakedToken: AaveStakedTokenV2
    let compToken: ERC20
    let creamToken: ERC20
    let musdToken: ERC20
    let uniswapQuoter: IUniswapV3Quoter

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
        ops = await impersonateAccount(resolveAddress("OperationsSigner"))
        stkAaveWhale = await impersonateAccount(stkAaveWhaleAddress)
        governor = await impersonateAccount(governorAddress)
        ethWhale = await impersonateAccount(ethWhaleAddress)
        musdWhale = await impersonateAccount(musdWhaleAddress)

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.signer.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(5),
        })

        delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, governor.signer)
        aaveIncentivesController = IAaveIncentivesController__factory.connect(aaveIncentivesControllerAddress, ops.signer)
        uniswapQuoter = IUniswapV3Quoter__factory.connect(uniswapQuoterV3Address, ops.signer)
        aaveToken = ERC20__factory.connect(AAVE.address, ops.signer)
        aaveStakedToken = AaveStakedTokenV2__factory.connect(stkAAVE.address, stkAaveWhale.signer)
        compToken = ERC20__factory.connect(COMP.address, ops.signer)
        creamToken = ERC20__factory.connect(CREAM.address, ops.signer)
        musdToken = ERC20__factory.connect(mUSD.address, ops.signer)
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
                    const tx = aaveStakedToken.redeem(stkAAVE.address, stkAaveAmount)
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
                    const tx = aaveStakedToken.redeem(stkAAVE.address, remainingStakeAmount2)
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
                    await aaveToken.connect(stkAaveWhale.signer).approve(stkAAVE.address, stakeAmount)
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
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
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
            expect(await liquidator.uniswapRouter(), "Uniswap address").to.eq(uniswapRouterV3Address)
            expect(await liquidator.uniswapQuoter(), "Uniswap address").to.eq(uniswapQuoterV3Address)
            expect(await liquidator.aaveToken(), "Aave address").to.eq(AAVE.address)
            expect(await liquidator.stkAave(), "Staked Aave address").to.eq(stkAAVE.address)
            expect(await liquidator.compToken(), "COMP address").to.eq(COMP.address)
        })
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encoded,
                    uniswapAaveUsdcPath.encodedReversed,
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
                    AAVE.address,
                    WBTC.address,
                    uniswapAaveWbtcPath.encoded,
                    uniswapAaveWbtcPath.encodedReversed,
                    0,
                    simpleToExactAmount(2, WBTC.decimals - 3),
                    mBTC.address,
                    true,
                )
        })
        it.skip("Added liquidation for GUSD Feeder Pool Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    GUSD.integrator,
                    AAVE.address,
                    GUSD.address,
                    uniswapAaveGusdPath.encoded,
                    uniswapAaveGusdPath.encodedReversed,
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
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
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
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encoded,
                    uniswapAaveUsdcPath.encodedReversed,
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
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave has increased").gt(aaveBalanceBefore)
        })
        it("trigger liquidation of Aave after 11 days", async () => {
            await increaseTime(ONE_DAY.mul(11))
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has some stkAave before").gt(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave before").eq(0)

            await liquidator.triggerLiquidationAave()

            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has no stkAave after").eq(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave after").eq(0)
        })
        it("Claim stkAave after liquidation", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress)
            await liquidator.claimStakedAave()
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave increased").gt(aaveBalanceBefore)
        })
    })
    context("Compound liquidation", () => {
        let liquidator: Liquidator
        before("reset block number", async () => {
            await runSetup(12545500)
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
        })
        it("Read functions before upgrade", async () => {
            expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress)
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
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
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
            expect(await liquidator.uniswapRouter(), "Uniswap address").to.eq(uniswapRouterV3Address)
            expect(await liquidator.uniswapQuoter(), "Uniswap address").to.eq(uniswapQuoterV3Address)
            expect(await liquidator.aaveToken(), "Aave address").to.eq(AAVE.address)
            expect(await liquidator.stkAave(), "Staked Aave address").to.eq(stkAAVE.address)
            expect(await liquidator.compToken(), "COMP address").to.eq(COMP.address)
        })
        it("Added liquidation for mUSD Compound integration", async () => {
            const data = liquidator.interface.encodeFunctionData("createLiquidation", [
                compoundIntegrationAddress,
                COMP.address,
                USDC.address,
                uniswapCompUsdcPaths.encoded,
                uniswapCompUsdcPaths.encodedReversed,
                simpleToExactAmount(20000, USDC.decimals),
                simpleToExactAmount(100, USDC.decimals),
                mUSD.address,
                false,
            ])
            console.log(`createLiquidation data for COMP: ${data}`)
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    compoundIntegrationAddress,
                    COMP.address,
                    USDC.address,
                    uniswapCompUsdcPaths.encoded,
                    uniswapCompUsdcPaths.encodedReversed,
                    simpleToExactAmount(20000, USDC.decimals),
                    simpleToExactAmount(100, USDC.decimals),
                    mUSD.address,
                    false,
                )
        })
        it("Uniswap quoteExactOutputSingle for COMP to ETH", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutputSingle(
                COMP.address,
                uniswapEthToken,
                3000,
                simpleToExactAmount(8),
                0,
            )
            expect(expectedSwapInput).to.gt(simpleToExactAmount(40))
            expect(expectedSwapInput).to.lt(simpleToExactAmount(60))
        })
        it("Uniswap quoteExactOutputSingle for ETH to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutputSingle(
                uniswapEthToken,
                USDC.address,
                3000,
                simpleToExactAmount(20000, USDC.decimals),
                0,
            )
            expect(expectedSwapInput).to.gt(simpleToExactAmount(7))
            expect(expectedSwapInput).to.lt(simpleToExactAmount(8))
        })
        it("Uniswap quoteExactInput for COMP to ETH", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactInput(
                encodeUniswapPath([COMP.address, uniswapEthToken], [3000]).encoded,
                simpleToExactAmount(50),
            )
            console.log(`50 COMP input to swap for ${formatUnits(expectedSwapInput)} ETH`)
            expect(expectedSwapInput).to.gt(simpleToExactAmount(7))
            expect(expectedSwapInput).to.lt(simpleToExactAmount(9))
        })
        it("Uniswap quoteExactInput for ETH to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactInput(
                encodeUniswapPath([uniswapEthToken, USDC.address], [3000]).encoded,
                simpleToExactAmount(8),
            )
            console.log(`8 WETH input to swap for ${formatUnits(expectedSwapInput)} USDC`)
            expect(expectedSwapInput, "output > 19k USDC").to.gt(simpleToExactAmount(19000, USDC.decimals))
            expect(expectedSwapInput, "output < 22k USDC").to.lt(simpleToExactAmount(22000, USDC.decimals))
        })
        it("Uniswap quoteExactOutput for COMP to ETH", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutput(
                encodeUniswapPath([uniswapEthToken, COMP.address], [3000]).encoded,
                simpleToExactAmount(8),
            )
            console.log(`${(formatUnits(expectedSwapInput), COMP.decimals)} COMP input to swap for 8 ETH`)
            expect(expectedSwapInput, "input > 40 COMP").to.gt(simpleToExactAmount(40))
            expect(expectedSwapInput, "input < 60 COMP").to.lt(simpleToExactAmount(60))
        })
        it("Uniswap quoteExactOutput for ETH to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutput(
                encodeUniswapPath([USDC.address, uniswapEthToken], [3000]).encoded,
                simpleToExactAmount(20000, USDC.decimals),
            )
            expect(expectedSwapInput, "input > 7 WETH").to.gt(simpleToExactAmount(7))
            expect(expectedSwapInput, "input < 8 WETH").to.lt(simpleToExactAmount(8))
        })
        it("Uniswap quoteExactOutput for COMP to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutput(
                encodeUniswapPath([USDC.address, uniswapEthToken, COMP.address], [3000, 3000]).encoded,
                simpleToExactAmount(20000, USDC.decimals),
            )
            expect(expectedSwapInput, "input > 40 COMP").to.gt(simpleToExactAmount(40))
            expect(expectedSwapInput, "input < 60 COMP").to.lt(simpleToExactAmount(60))
        })
        it("Liquidate COMP after upgrade", async () => {
            await increaseTime(ONE_WEEK)
            const compBalanceBefore = await compToken.balanceOf(liquidatorAddress)

            await liquidator.triggerLiquidation(compoundIntegrationAddress)

            expect(await compToken.balanceOf(liquidatorAddress), "Less COMP").lt(compBalanceBefore)
        })
    })
    context("Iron Bank CREAM liquidation", () => {
        let liquidator: Liquidator
        let gusdFp: FeederPool
        let busdFp: FeederPool
        before("reset block number", async () => {
            await runSetup(12540000)
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
            gusdFp = FeederPool__factory.connect(GUSD.feederPool, governor.signer)
            busdFp = FeederPool__factory.connect(BUSD.feederPool, governor.signer)
        })
        it("migrate mUSD to Iron Bank for the GUSD Feeder Pool", async () => {
            // Before migrate checks
            const musdInGusdBefore = await musdToken.balanceOf(GUSD.feederPool)
            expect(musdInGusdBefore, "Some mUSD in GUSD FP before").to.gt(0)
            expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "no mUSD in Iron Bank integration before").to.eq(0)
            const musdInIronBankBefore = await musdToken.balanceOf(cyMUSD.address)
            console.log(
                `mUSD in Iron Bank ${formatUnits(musdInIronBankBefore)} and GUSD Feeder Pool ${formatUnits(musdInGusdBefore)} before`,
            )

            await gusdFp.migrateBassets([mUSD.address], gusdIronBankIntegrationAddress)

            // After migrate checks
            const musdInIronBankIntegrationAfter = await musdToken.balanceOf(gusdIronBankIntegrationAddress)
            console.log(`mUSD in Iron Bank ${formatUnits(musdInIronBankIntegrationAfter)} after`)
            expect(await musdToken.balanceOf(GUSD.feederPool), "no mUSD in GUSD FP after").to.eq(0)
            expect(await musdToken.balanceOf(cyMUSD.address), "no more mUSD in Iron Bank after").to.eq(musdInIronBankBefore)
            expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "mUSD moved to Iron Bank integration after").to.eq(
                musdInGusdBefore,
            )
        })
        it("Swap mUSD for GUSD", async () => {
            const musdInIronBankBefore = await musdToken.balanceOf(cyMUSD.address)
            const musdInIntegrationBefore = await musdToken.balanceOf(gusdIronBankIntegrationAddress)

            const swapInput = simpleToExactAmount(1000)
            await musdToken.connect(musdWhale.signer).approve(gusdFp.address, swapInput)
            await gusdFp.connect(musdWhale.signer).swap(mUSD.address, GUSD.address, swapInput, 0, ops.address)

            expect(await musdToken.balanceOf(cyMUSD.address), "more mUSD in Iron Bank after").to.gt(musdInIronBankBefore)
            expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "less mUSD in Integration after").to.lt(
                musdInIntegrationBefore,
            )
        })
        it("migrate mUSD to Iron Bank for the BUSD Feeder Pool", async () => {
            const musdBalanceBefore = await musdToken.balanceOf(BUSD.feederPool)
            expect(musdBalanceBefore).to.gt(0)
            await busdFp.migrateBassets([mUSD.address], busdIronBankIntegrationAddress)
            expect(await musdToken.balanceOf(BUSD.feederPool)).to.eq(0)
        })
        it("Governor approves the liquidator to transfer CREAM from integration contracts", async () => {
            const gusdIronBankIntegration = CompoundIntegration__factory.connect(gusdIronBankIntegrationAddress, governor.signer)
            await gusdIronBankIntegration.approveRewardToken()

            const busdIronBankIntegration = CompoundIntegration__factory.connect(busdIronBankIntegrationAddress, governor.signer)
            await busdIronBankIntegration.approveRewardToken()
        })
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deployContract<Liquidator>(new Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
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
            expect(await liquidator.uniswapRouter(), "Uniswap address").to.eq(uniswapRouterV3Address)
            expect(await liquidator.uniswapQuoter(), "Uniswap address").to.eq(uniswapQuoterV3Address)
            expect(await liquidator.aaveToken(), "AAVE address").to.eq(AAVE.address)
            expect(await liquidator.stkAave(), "Staked Aave address").to.eq(stkAAVE.address)
            expect(await liquidator.compToken(), "COMP address").to.eq(COMP.address)
        })
        it("Added liquidation of CREAM from GUSD and BUSD Feeder Pool integrations to Iron Bank", async () => {
            let uniswapPathCreamGusd = encodeUniswapPath([CREAM.address, uniswapEthToken, GUSD.address], [3000, 3000])
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    gusdIronBankIntegrationAddress,
                    CREAM.address,
                    GUSD.address,
                    uniswapPathCreamGusd.encoded,
                    uniswapPathCreamGusd.encodedReversed,
                    0,
                    simpleToExactAmount(50, GUSD.decimals),
                    ZERO_ADDRESS,
                    false,
                )

            uniswapPathCreamGusd = encodeUniswapPath([CREAM.address, uniswapEthToken, BUSD.address], [3000, 3000])
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    busdIronBankIntegrationAddress,
                    CREAM.address,
                    BUSD.address,
                    uniswapPathCreamGusd.encoded,
                    uniswapPathCreamGusd.encodedReversed,
                    0,
                    simpleToExactAmount(50, BUSD.decimals),
                    ZERO_ADDRESS,
                    false,
                )
        })
        it.skip("Liquidate CREAM after upgrade for GUSD", async () => {
            await increaseTime(ONE_WEEK)
            const creamBalanceBefore = await creamToken.balanceOf(liquidatorAddress)
            await liquidator.triggerLiquidation(gusdIronBankIntegrationAddress)
            expect(await creamToken.balanceOf(liquidatorAddress), "Less CREAM").lt(creamBalanceBefore)
        })
        it.skip("Liquidate CREAM after upgrade for BUSD", async () => {
            const creamBalanceBefore = await creamToken.balanceOf(liquidatorAddress)
            await liquidator.triggerLiquidation(busdIronBankIntegrationAddress)
            expect(await creamToken.balanceOf(liquidatorAddress), "Less CREAM").lt(creamBalanceBefore)
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
                stkAAVE.address,
                AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
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
            const path = encodeUniswapPath([AAVE.address], [])
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    AAVE.address,
                    USDC.address,
                    path.encoded,
                    path.encodedReversed,
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
            await expect(tx).revertedWith("Uniswap path too short")
        })
        it("reversed Uniswap path", async () => {
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(
                    aaveMusdIntegrationAddress,
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encodedReversed,
                    uniswapAaveUsdcPath.encoded,
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
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encoded,
                    uniswapAaveUsdcPath.encodedReversed,
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
                    AAVE.address,
                    USDC.address,
                    uniswapAaveUsdcPath.encoded,
                    uniswapAaveUsdcPath.encodedReversed,
                    0,
                    simpleToExactAmount(50, USDC.decimals),
                    mUSD.address,
                    true,
                )
            await expect(tx).revertedWith("Liquidation already exists")
        })
    })
    context.skip("Aave incentives controller", () => {
        let aaveMusdIntegration: Account
        let aaveIncentives: IAaveIncentivesController
        let accruedDaiBal: BN
        let accruedUsdtBal: BN

        const forkBlockNumber = 12735307
        const expectedAccruedDai = simpleToExactAmount(179)
        const expectedAccruedUsdt = simpleToExactAmount(195)
        beforeEach("reset block number", async () => {
            await runSetup(forkBlockNumber)

            aaveMusdIntegration = await impersonateAccount(aaveMusdIntegrationAddress)
            // Give the Integration contract 10 Ether
            await network.provider.request({
                method: "hardhat_setBalance",
                params: [aaveMusdIntegrationAddress, simpleToExactAmount(10).toHexString()],
            })

            const aaveIncentivesControllerProxyAddress = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5"
            aaveIncentives = IAaveIncentivesController__factory.connect(aaveIncentivesControllerProxyAddress, aaveMusdIntegration.signer)

            expect(await aaveStakedToken.balanceOf(aaveMusdIntegrationAddress), "stkAAVE in integration before").to.eq(0)

            accruedDaiBal = await aaveIncentives.getRewardsBalance([DAI.liquidityProvider], aaveMusdIntegrationAddress)
            // console.log(`Accrued stkAAVE from DAI ${accruedDaiBal}`)
            expect(accruedDaiBal, "accrued stkAAVE from DAI before").to.be.gt(expectedAccruedDai)

            accruedUsdtBal = await aaveIncentives.getRewardsBalance([USDT.liquidityProvider], aaveMusdIntegrationAddress)
            // console.log(`Accrued stkAAVE from USDT ${accruedUsdtBal}`)
            expect(accruedUsdtBal, "accrued stkAAVE from USDT before").to.be.gt(expectedAccruedUsdt)
        })
        it("Unclaimed user rewards", async () => {
            const oneDay = ONE_DAY.toNumber()
            const testData: { desc: string; blockNumber: number }[] = [
                { desc: "just after claim", blockNumber: forkBlockNumber + 1 },
                { desc: "just before claim", blockNumber: forkBlockNumber },
                { desc: "1 minute before claim", blockNumber: forkBlockNumber - ONE_MIN.toNumber() },
                { desc: "1 hour before claim", blockNumber: forkBlockNumber - ONE_HOUR.toNumber() },
                { desc: "1 day before claim", blockNumber: forkBlockNumber - oneDay },
                { desc: "2 days before claim", blockNumber: forkBlockNumber - oneDay * 2 },
                { desc: "3 days before claim", blockNumber: forkBlockNumber - oneDay * 3 },
                { desc: "4 days before claim", blockNumber: forkBlockNumber - oneDay * 4 },
                { desc: "4.5 days before claim", blockNumber: forkBlockNumber - oneDay * 4.5 },
                // { desc: "5 days before claim", blockNumber: forkBlockNumber - oneDay * 5 },
                // { desc: "1 week ago", blockNumber: forkBlockNumber - oneDay * 7 },
            ]
            console.log(`Test, Unclaimed Rewards, Claimed, Total`)
            for (const test of testData) {
                const unclaimedRewards = await aaveIncentives.getUserUnclaimedRewards(aaveMusdIntegrationAddress, {
                    blockTag: test.blockNumber,
                })
                const rewardBalance = await aaveIncentives.getRewardsBalance(
                    [DAI.liquidityProvider, USDT.liquidityProvider],
                    aaveMusdIntegrationAddress,
                    {
                        blockTag: test.blockNumber,
                    },
                )
                console.log(
                    `${test.desc.padEnd(16)}, ${formatUnits(unclaimedRewards)}, ${formatUnits(rewardBalance)}, ${formatUnits(
                        unclaimedRewards.add(rewardBalance),
                    )}`,
                )
            }
        })
        it("integration contract claims DAI", async () => {
            await aaveIncentives.claimRewards([DAI.liquidityProvider], simpleToExactAmount(1000), aaveMusdIntegrationAddress)

            expect(
                await aaveIncentives.getRewardsBalance([DAI.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from DAI after",
            ).to.be.lt(simpleToExactAmount(0.001))
            expect(await aaveStakedToken.balanceOf(aaveMusdIntegrationAddress), "stkAAVE in integration after").to.gt(expectedAccruedDai)

            expect(
                await aaveIncentives.getRewardsBalance([USDT.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from USDT after",
            ).to.be.gt(expectedAccruedUsdt)
        })
        it("integration contract claims USDT", async () => {
            await aaveIncentives.claimRewards([USDT.liquidityProvider], simpleToExactAmount(1000), aaveMusdIntegrationAddress)

            expect(
                await aaveIncentives.getRewardsBalance([USDT.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from USDT after",
            ).to.be.lt(simpleToExactAmount(0.001))
            expect(await aaveStakedToken.balanceOf(aaveMusdIntegrationAddress), "stkAAVE in integration after").to.gt(accruedUsdtBal)

            expect(
                await aaveIncentives.getRewardsBalance([DAI.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from DAI after",
            ).to.be.gt(expectedAccruedDai)
        })
        it("integration contract claims DAI and USDT separately", async () => {
            // Claim from DAI
            await aaveIncentives.claimRewards([DAI.liquidityProvider], simpleToExactAmount(1000), aaveMusdIntegrationAddress)

            expect(await aaveStakedToken.balanceOf(aaveMusdIntegrationAddress), "stkAAVE in integration after DAI").to.gt(
                expectedAccruedDai,
            )
            expect(
                await aaveIncentives.getRewardsBalance([DAI.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from DAI after",
            ).to.be.lt(simpleToExactAmount(0.001))

            expect(
                await aaveIncentives.getRewardsBalance([USDT.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from USDT after DAI claim",
            ).to.be.gt(expectedAccruedUsdt)

            // Claim from USDT
            await aaveIncentives.claimRewards([USDT.liquidityProvider], simpleToExactAmount(1000), aaveMusdIntegrationAddress)

            expect(
                await aaveIncentives.getRewardsBalance([USDT.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from USDT after",
            ).to.be.lt(simpleToExactAmount(0.001))

            expect(await aaveStakedToken.balanceOf(aaveMusdIntegrationAddress), "stkAAVE in integration after").to.gt(
                expectedAccruedDai.add(expectedAccruedUsdt),
            )
        })
        it("integration contract claims USDT and DAI separately", async () => {
            // Claim from USDT
            await aaveIncentives.claimRewards([USDT.liquidityProvider], simpleToExactAmount(1000), aaveMusdIntegrationAddress)

            expect(await aaveStakedToken.balanceOf(aaveMusdIntegrationAddress), "stkAAVE in integration after USDT").to.gt(
                expectedAccruedUsdt,
            )
            expect(
                await aaveIncentives.getRewardsBalance([USDT.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from USDT after",
            ).to.be.lt(simpleToExactAmount(0.001))

            expect(
                await aaveIncentives.getRewardsBalance([DAI.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from DAI after USDT claim",
            ).to.be.gt(expectedAccruedDai)

            // Claim from DAI
            await aaveIncentives.claimRewards([DAI.liquidityProvider], simpleToExactAmount(1000), aaveMusdIntegrationAddress)

            expect(
                await aaveIncentives.getRewardsBalance([DAI.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from DAI after",
            ).to.be.lt(simpleToExactAmount(0.001))

            expect(await aaveStakedToken.balanceOf(aaveMusdIntegrationAddress), "stkAAVE in integration after").to.gt(
                expectedAccruedDai.add(expectedAccruedUsdt),
            )
        })
        it("integration contract claims USDT and DAI together", async () => {
            const accruedDaiUsdtBal = await aaveIncentives.getRewardsBalance(
                [USDT.liquidityProvider, DAI.liquidityProvider],
                aaveMusdIntegrationAddress,
            )
            expect(accruedDaiUsdtBal, "accrued stkAAVE from USDT and DAI before").to.be.gt(expectedAccruedDai.add(expectedAccruedUsdt))

            expect(await aaveStakedToken.balanceOf(aaveMusdIntegrationAddress), "stkAAVE in integration before").to.eq(0)

            // Claim from USDT and DAI
            await aaveIncentives.claimRewards(
                [USDT.liquidityProvider, DAI.liquidityProvider],
                simpleToExactAmount(1000, DAI.decimals),
                aaveMusdIntegrationAddress,
            )

            expect(
                await aaveIncentives.getRewardsBalance([DAI.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from DAI after",
            ).to.be.lt(simpleToExactAmount(0.001))
            expect(
                await aaveIncentives.getRewardsBalance([USDT.liquidityProvider], aaveMusdIntegrationAddress),
                "accrued stkAAVE from USDT after",
            ).to.be.lt(simpleToExactAmount(0.001))
            expect(await aaveStakedToken.balanceOf(aaveMusdIntegrationAddress), "stkAAVE in integration after").to.gt(
                expectedAccruedDai.add(expectedAccruedUsdt),
            )
        })
    })
    context.only("Aave liquidation of new Feeder Pools", () => {
        let liquidator: Liquidator

        const uniswapAaveBusdPath = encodeUniswapPath([AAVE.address, uniswapEthToken, BUSD.address], [3000, 10000])
        const uniswapAaveRaiPath = encodeUniswapPath([AAVE.address, uniswapEthToken, RAI.address], [3000, 3000])
        before("reset block number", async () => {
            await runSetup(14000900)
            liquidator = Liquidator__factory.connect(liquidatorAddress, ops.signer)
        })
        it("Added liquidation for BUSD Feeder Pool Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    BUSD.integrator,
                    AAVE.address,
                    BUSD.address,
                    uniswapAaveBusdPath.encoded,
                    uniswapAaveBusdPath.encodedReversed,
                    0,
                    simpleToExactAmount(120, BUSD.decimals),
                    ZERO_ADDRESS,
                    true,
                )
            console.log(`AAVE > BUSD ${uniswapAaveBusdPath.encoded}`)
            console.log(`Reversed    ${uniswapAaveBusdPath.encodedReversed}`)
        })
        it("Added liquidation for RAI Feeder Pool Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(
                    RAI.integrator,
                    AAVE.address,
                    RAI.address,
                    uniswapAaveRaiPath.encoded,
                    uniswapAaveRaiPath.encodedReversed,
                    0,
                    simpleToExactAmount(40, RAI.decimals),
                    ZERO_ADDRESS,
                    true,
                )
            console.log(`AAVE > RAI ${uniswapAaveRaiPath.encoded}`)
            console.log(`Reversed   ${uniswapAaveRaiPath.encodedReversed}`)
        })
        it("trigger liquidation of Aave after 11 days", async () => {
            await increaseTime(ONE_DAY.mul(11))
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has some stkAave before").gt(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave before").lte(1)

            await liquidator.triggerLiquidationAave()

            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has no stkAave after").eq(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave after").lte(1)
        })
        it("Claim stkAave for new integration contracts", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress)
            await liquidator.claimStakedAave()
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave increased").gt(aaveBalanceBefore)
        })
        it("trigger liquidation including new integration contracts for the first time", async () => {
            await increaseTime(ONE_DAY.mul(11))
            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has some stkAave before").gt(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave before").lte(1)

            await liquidator.triggerLiquidationAave()

            expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has no stkAave after").eq(0)
            expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave after").lte(1)
        })
    })
})
