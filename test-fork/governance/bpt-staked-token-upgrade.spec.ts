/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { impersonateAccount } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import * as hre from "hardhat"
import { deployStakingToken, StakedTokenDeployAddresses } from "tasks/utils/rewardsUtils"
import {
    IBalancerGauge__factory,
    IERC20,
    StakedTokenBPT,
    StakedTokenBPT__factory,
    DelayedProxyAdmin__factory,
    IERC20__factory,
    IBalancerGauge,
} from "types/generated"
import { BalConfig, UserStakingData, Account } from "types"
import { Chain } from "tasks/utils/tokens"
import { BigNumberish } from "ethers"
import { resolveAddress } from "../../tasks/utils/networkAddressFactory"

const governorAddress = resolveAddress("Governor")
const deployerAddress = resolveAddress("OperationsSigner")
const stakedTokenBptAddress = resolveAddress("StakedTokenBPT")
const mbptGaugeAddress = resolveAddress("mBPT", Chain.mainnet, "gauge")
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const mtaWhaleAddress = "0x24167305A3667023Ea565f971D72509ef758Ac78"
const mbptWhaleAddress = "0xe4b8b2Ff4E66E73A7BBc77B308a6b97AFA5aA566"

const staker1 = "0xE76Be9C1e10910d6Bc6b63D8031729747910c2f6"
const delegatorBPT = "0x32a59b87352e980dd6ab1baf462696d28e63525d"

context("StakedToken deployments and vault upgrades", () => {
    let deployer: Account
    let governor: Account
    let ethWhale: Account
    let mtaWhale: Account
    let mbptWhale: Account
    let stkBPT: StakedTokenBPT
    let mBPT: IERC20
    let MTA: IERC20
    let BAL: IERC20
    let gauge: IBalancerGauge

    const { network } = hre

    const snapConfig = async (stakedToken: StakedTokenBPT): Promise<any> => {
        const safetyData = await stakedToken.safetyData()
        return {
            name: await stakedToken.name(),
            symbol: await stakedToken.symbol(),
            decimals: await stakedToken.decimals(),
            totalSupply: await stakedToken.totalSupply(),
            rewardsDistributor: await stakedToken.rewardsDistributor(),
            nexus: await stakedToken.nexus(),
            stakingToken: await stakedToken.STAKED_TOKEN(),
            rewardToken: await stakedToken.REWARDS_TOKEN(),
            cooldown: await stakedToken.COOLDOWN_SECONDS(),
            unstake: await stakedToken.UNSTAKE_WINDOW(),
            questManager: await stakedToken.questManager(),
            hasPriceCoeff: await stakedToken.hasPriceCoeff(),
            colRatio: safetyData.collateralisationRatio,
            slashingPercentage: safetyData.slashingPercentage,

            BAL: await stakedToken.BAL(),
            balancerVault: await stakedToken.balancerVault(),
            poolId: await stakedToken.poolId(),
        }
    }

    const snapBalData = async (stakedTokenBpt: StakedTokenBPT): Promise<BalConfig> => {
        const totalSupply = await stakedTokenBpt.totalSupply()
        const pastTotalSupply = await stakedTokenBpt.getPastTotalSupply(14300000)
        const pendingBPTFees = await stakedTokenBpt.pendingBPTFees()
        const priceCoefficient = await stakedTokenBpt.priceCoefficient()
        const lastPriceUpdateTime = await stakedTokenBpt.lastPriceUpdateTime()

        const mbptBalOfStakedToken = await mBPT.balanceOf(stakedTokenBptAddress)
        const mbptBalOfGauge = await mBPT.balanceOf(resolveAddress("mBPT", Chain.mainnet, "gauge"))

        const deployerStkbptBal = await stakedTokenBpt.balanceOf("0x19f12c947d25ff8a3b748829d8001ca09a28d46d")
        const stakerBal = await stakedTokenBpt.balanceOf(staker1)
        const stakerVotes = await stakedTokenBpt.getVotes(staker1)
        const pastStakerVotes = await stakedTokenBpt.getPastVotes(staker1, 14300000)
        const delegatee = await stakedTokenBpt.delegates(delegatorBPT)

        const whitelisted1 = await stakedTokenBpt.whitelistedWrappers("0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f")
        const whitelisted2 = await stakedTokenBpt.whitelistedWrappers("0x6fce4c6cdd8c4e6c7486553d09bdd9aee61cf095")
        const whitelisted3 = await stakedTokenBpt.whitelistedWrappers("0xdae6cab9aaa893ac212a17f5100f20ed9e4effa1")
        const whitelisted4 = await stakedTokenBpt.whitelistedWrappers("0x0000000000000000000000000000000000000001")

        return {
            totalSupply,
            pastTotalSupply,
            pendingBPTFees,
            priceCoefficient,
            lastPriceUpdateTime,
            mbptBalOfStakedToken,
            mbptBalOfGauge,
            deployerStkbptBal,
            stakerBal,
            stakerVotes,
            pastStakerVotes,
            whitelisted: [whitelisted1, whitelisted2, whitelisted3, whitelisted4],
            delegatee,
        }
    }

    const snapStorage = async (address: string, max: number, offset: number): Promise<string[]> => {
        const slots: string[] = Array(max)
        for (const i of [...slots.keys()]) {
            slots[i] = await deployer.signer.provider.getStorageAt(address, i + offset)
        }
        return slots
    }

    const snapshotUserStakingData = async (user: string): Promise<UserStakingData> => {
        const scaledBalance = await stkBPT.balanceOf(user)
        const votes = await stkBPT.getVotes(user)
        const pastStakerVotes = await stkBPT.getPastVotes(staker1, 14300000)
        const earnedRewards = await stkBPT.earned(user)
        const userPriceCoeff = await stkBPT.userPriceCoeff(user)
        const rawBalance = await stkBPT.balanceData(user)

        return {
            scaledBalance,
            votes,
            pastStakerVotes,
            earnedRewards,
            userPriceCoeff,
            rawBalance,
        }
    }

    // Upgrade the staking contract
    const upgradeStkMbpt = async () => {
        const stakedBptAddresses = await deployStakingToken(
            {
                rewardsTokenSymbol: "MTA",
                stakedTokenSymbol: "mBPT",
                balTokenSymbol: "BAL",
                cooldown: ONE_WEEK.mul(3).toNumber(),
                name: "Staked Token BPT",
                symbol: "stkBPT",
            },
            deployer,
            hre,
            false,
        )
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin"), governor.signer)
        await delayedProxyAdmin
            .connect(governor.signer)
            .proposeUpgrade(stakedTokenBptAddress, stakedBptAddresses.stakedTokenImpl, stakedBptAddresses.initData)
        await increaseTime(ONE_WEEK.add(2))
        await delayedProxyAdmin.connect(governor.signer).acceptUpgradeRequest(stakedTokenBptAddress)
    }

    const setup = async (blockNumber?: BigNumberish) => {
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
        deployer = await impersonateAccount(deployerAddress)
        governor = await impersonateAccount(governorAddress)
        ethWhale = await impersonateAccount(ethWhaleAddress)
        mtaWhale = await impersonateAccount(mtaWhaleAddress)
        mbptWhale = await impersonateAccount(mbptWhaleAddress)

        mBPT = IERC20__factory.connect(resolveAddress("mBPT"), deployer.signer)
        MTA = IERC20__factory.connect(resolveAddress("MTA"), mtaWhale.signer)
        BAL = IERC20__factory.connect(resolveAddress("BAL"), deployer.signer)
        stkBPT = StakedTokenBPT__factory.connect(stakedTokenBptAddress, deployer.signer)
        gauge = IBalancerGauge__factory.connect(mbptGaugeAddress, deployer.signer)

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.signer.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(1),
        })
    }
    context("1. Upgrade", () => {
        let stakedBptAddresses: StakedTokenDeployAddresses
        let balDataBefore: BalConfig
        let staker1DataBefore: UserStakingData
        const slots = 265
        const slotOffset = 0
        let slotsBefore: string[]
        before(async () => {
            await setup(14581000)
            balDataBefore = await snapBalData(stkBPT)
            staker1DataBefore = await snapshotUserStakingData(staker1)
            slotsBefore = await snapStorage(stakedTokenBptAddress, slots, slotOffset)
        })
        it("deploy new mBPT implementation", async () => {
            // Deploy StakedTokenBPT
            stakedBptAddresses = await deployStakingToken(
                {
                    rewardsTokenSymbol: "MTA",
                    stakedTokenSymbol: "mBPT",
                    balTokenSymbol: "BAL",
                    cooldown: ONE_WEEK.mul(3).toNumber(),
                    name: "Staked Token BPT",
                    symbol: "stkBPT",
                },
                deployer,
                hre,
                false,
            )
        })
        it("upgrade proxy", async () => {
            const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin"), governor.signer)
            await delayedProxyAdmin
                .connect(governor.signer)
                .proposeUpgrade(stakedTokenBptAddress, stakedBptAddresses.stakedTokenImpl, stakedBptAddresses.initData)

            await increaseTime(ONE_WEEK.add(2))
            await delayedProxyAdmin.connect(governor.signer).acceptUpgradeRequest(stakedTokenBptAddress)
        })
        describe("post upgrade verification", () => {
            let configAfter
            let balDataAfter
            before(async () => {
                configAfter = await snapConfig(stkBPT)
                balDataAfter = await snapBalData(stkBPT)
            })
            it("storage", async () => {
                const slotsAfter = await snapStorage(stakedTokenBptAddress, slots, slotOffset)
                for (const i of slotsAfter.keys()) {
                    expect(slotsAfter[i], `slot ${i + slotOffset}`).to.eq(slotsBefore[i])
                }
            })
            it("StakedToken config", async () => {
                expect(configAfter.name, "name").eq("Staked Token BPT")
                expect(configAfter.symbol, "symbol").eq("stkBPT")
                expect(configAfter.decimals, "decimals").eq(18)
                expect(configAfter.rewardsDistributor, "rewardsDistributor").eq(resolveAddress("RewardsDistributor"))
                expect(configAfter.nexus, "nexus").eq(resolveAddress("Nexus"))
                expect(configAfter.stakingToken, "staking token symbol").eq(resolveAddress("mBPT"))
                expect(configAfter.rewardToken, "reward token symbol").eq(resolveAddress("MTA"))
                expect(configAfter.cooldown, "cooldown").eq(ONE_WEEK.mul(3))
                expect(configAfter.unstake, "unstake").eq(ONE_WEEK.mul(2))
                expect(configAfter.questManager, "questManager").eq(resolveAddress("QuestManager"))
                expect(configAfter.hasPriceCoeff, "hasPriceCoeff").eq(true)
                expect(configAfter.colRatio, "colRatio").eq(simpleToExactAmount(1))
                expect(configAfter.slashingPercentage, "slashingPercentage").eq(0)
            })
            it("StakedTokenBPT config", async () => {
                expect(configAfter.BAL, "BAL token symbol").eq(resolveAddress("BAL"))
                expect(configAfter.balancerVault, "BAL Vault").eq(resolveAddress("BalancerVault"))
                expect(configAfter.poolId, "BAL pool ID").eq(resolveAddress("BalancerStakingPoolId"))
            })
            it("stakedTokenBPT balances", async () => {
                expect(balDataAfter.totalSupply, "totalSupply").gt(0)
                expect(balDataAfter.totalSupply, "totalSupply").eq(balDataBefore.totalSupply)
                expect(balDataAfter.pastTotalSupply, "pastTotalSupply").gt(0)
                expect(balDataAfter.pastTotalSupply, "pastTotalSupply").not.eq(balDataAfter.totalSupply)
                expect(balDataAfter.pastTotalSupply, "pastTotalSupply").eq(balDataBefore.pastTotalSupply)
                expect(balDataAfter.pendingBPTFees, "pendingBPTFees").gt(0)
                expect(balDataAfter.pendingBPTFees, "pendingBPTFees").eq(balDataBefore.pendingBPTFees)
                expect(balDataAfter.priceCoefficient, "priceCoefficient").gt(0)
                expect(balDataAfter.priceCoefficient, "priceCoefficient").eq(balDataBefore.priceCoefficient)
                expect(balDataAfter.lastPriceUpdateTime, "lastPriceUpdateTime").gt(0)
                expect(balDataAfter.lastPriceUpdateTime, "lastPriceUpdateTime").eq(balDataBefore.lastPriceUpdateTime)
                expect(balDataAfter.deployerStkbptBal, "deployerStkbptBal").gt(0)
                expect(balDataAfter.deployerStkbptBal, "deployerStkbptBal").eq(balDataBefore.deployerStkbptBal)
                expect(balDataAfter.whitelisted[0], "1st whitelisted").eq(true)
                expect(balDataAfter.whitelisted[1], "2nd whitelisted").eq(true)
                expect(balDataAfter.whitelisted[2], "3rd whitelisted").eq(true)
                expect(balDataAfter.whitelisted[3], "4th whitelisted").eq(false)
                expect(balDataAfter.delegatee, "delegatee").length(42)
                expect(balDataAfter.delegatee, "delegatee").eq(balDataBefore.delegatee)
            })
            it("staker balances", async () => {
                const staker1DataAfter = await snapshotUserStakingData(staker1)
                expect(staker1DataAfter.scaledBalance, "scaledBalance > 0").gt(0)
                expect(staker1DataAfter.scaledBalance, "scaledBalance").eq(staker1DataBefore.scaledBalance)
                expect(staker1DataAfter.votes, "votes > 0").gt(0)
                expect(staker1DataAfter.votes, "votes != scaledBalance").not.eq(staker1DataAfter.scaledBalance)
                expect(staker1DataAfter.votes, "votes").eq(staker1DataBefore.votes)
                expect(staker1DataAfter.pastStakerVotes, "pastStakerVotes > 0").gt(0)
                expect(staker1DataAfter.pastStakerVotes, "pastStakerVotes != votes").not.eq(staker1DataBefore.votes)
                expect(staker1DataAfter.pastStakerVotes, "pastStakerVotes").eq(staker1DataBefore.pastStakerVotes)

                expect(staker1DataAfter.earnedRewards, "earnedRewards > 0").gt(0)
                expect(staker1DataAfter.earnedRewards, "earnedRewards").gt(staker1DataBefore.earnedRewards)
                expect(staker1DataAfter.userPriceCoeff, "userPriceCoeff > 0").gt(0)
                expect(staker1DataAfter.userPriceCoeff, "userPriceCoeff").eq(staker1DataBefore.userPriceCoeff)

                expect(staker1DataAfter.rawBalance.raw, "rawBalance.raw").eq(staker1DataBefore.rawBalance.raw)
                expect(staker1DataAfter.rawBalance.weightedTimestamp, "rawBalance.weightedTimestamp").eq(
                    staker1DataBefore.rawBalance.weightedTimestamp,
                )
                expect(staker1DataAfter.rawBalance.timeMultiplier, "rawBalance.timeMultiplier").eq(
                    staker1DataBefore.rawBalance.timeMultiplier,
                )
                expect(staker1DataAfter.rawBalance.questMultiplier, "rawBalance.questMultiplier").eq(
                    staker1DataBefore.rawBalance.questMultiplier,
                )
                expect(staker1DataAfter.rawBalance.cooldownTimestamp, "rawBalance.cooldownTimestamp").eq(
                    staker1DataBefore.rawBalance.cooldownTimestamp,
                )
                expect(staker1DataAfter.rawBalance.cooldownUnits, "rawBalance.cooldownUnits").eq(staker1DataBefore.rawBalance.cooldownUnits)
            })
            it("new StakedTokenBPT config", async () => {
                expect(await stkBPT.balancerGauge(), "balancerGauge").eq(resolveAddress("mBPT", Chain.mainnet, "gauge"))
            })
            it("mBPT balances", async () => {
                expect(balDataAfter.mbptBalOfStakedToken, "stkBPT's bal of mBPT").to.eq(0)
                expect(balDataAfter.mbptBalOfGauge, "Gauges bal of mBPT").to.eq(
                    balDataBefore.mbptBalOfGauge.add(balDataBefore.mbptBalOfStakedToken),
                )
            })
        })
    })
    describe("upgrade and withdraw", () => {
        let withdrawAmount: BigNumberish
        before(async () => {
            await setup(14612990)
            await upgradeStkMbpt()
        })
        it("withdraw", async () => {
            const gaugeMbptBefore = await mBPT.balanceOf(mbptGaugeAddress)

            // Withdraw mBPT so it can be staked again after upgrade
            withdrawAmount = simpleToExactAmount(1000)
            // Need to add fees to the withdraw amount for the cooldown
            await stkBPT.connect(mbptWhale.signer).startCooldown(withdrawAmount.add(simpleToExactAmount(75)))
            await increaseTime(ONE_DAY.mul(22))

            const tx = await stkBPT.connect(mbptWhale.signer).withdraw(withdrawAmount, mbptWhale.address, false, true)

            await expect(tx).to.emit(stkBPT, "Withdraw").withArgs(mbptWhale.address, mbptWhale.address, withdrawAmount)
            await expect(tx).to.emit(mBPT, "Transfer").withArgs(mbptGaugeAddress, stkBPT.address, withdrawAmount)
            await expect(tx).to.emit(mBPT, "Transfer").withArgs(stkBPT.address, mbptWhale.address, withdrawAmount)

            expect(await mBPT.balanceOf(mbptGaugeAddress), "gauge's mBPT bal after").to.eq(gaugeMbptBefore.sub(withdrawAmount))
            expect(await mBPT.balanceOf(stakedTokenBptAddress), "stkBPT's mBPT bal after").to.eq(0)
            expect(await mBPT.balanceOf(mbptWhale.address), "staker's mBPT bal after").to.eq(withdrawAmount)
        })
        it("convert fees to MTA", async () => {
            const mtaBalBefore = await MTA.balanceOf(stkBPT.address)
            expect(mtaBalBefore, "stkBPT's MTA bal before").to.gt(0)
            const tx = await stkBPT.connect(deployer.signer).convertFees()

            await expect(tx).to.emit(stkBPT, "FeesConverted")

            expect(await MTA.balanceOf(stkBPT.address), "stkBPT's MTA bal after").to.gt(mtaBalBefore)
        })
        it("fetch latest price coefficient", async () => {
            const priceCoefficientBefore = await stkBPT.priceCoefficient()

            const tx = stkBPT.connect(deployer.signer).fetchPriceCoefficient()

            await expect(tx).to.revertedWith("< 5% diff")
            expect(await stkBPT.priceCoefficient(), "priceCoefficient after").to.eq(priceCoefficientBefore)
        })
        it("delegate", async () => {
            const delegateBefore = await stkBPT.delegates(staker1)
            const staker = await impersonateAccount(staker1)
            const tx = await stkBPT.connect(staker.signer).delegate(mbptWhaleAddress)

            await expect(tx).to.emit(stkBPT, "DelegateChanged").withArgs(staker1, staker1, mbptWhaleAddress)

            const delegateAfter = await stkBPT.delegates(staker1)
            expect(delegateAfter).to.eq(mbptWhaleAddress)
            expect(delegateAfter).not.eq(delegateBefore)
        })
    })
    describe("withdraw, upgrade and stake", () => {
        let stakedAmount: BigNumberish
        before(async () => {
            await setup(14612990)

            // Withdraw mBPT so it can be staked again after upgrade
            const mbptBal = (await stkBPT.rawBalanceOf(mbptWhaleAddress))[0]
            await stkBPT.connect(mbptWhale.signer).startCooldown(mbptBal)
            await increaseTime(ONE_DAY.mul(22))
            await stkBPT.connect(mbptWhale.signer).withdraw(mbptBal, mbptWhale.address, true, true)

            // the amount withdraw is less fees so is smaller than the raw stkBPT balance
            stakedAmount = await mBPT.balanceOf(mbptWhale.address)
            await mBPT.connect(mbptWhale.signer).approve(stkBPT.address, stakedAmount)

            await upgradeStkMbpt()
        })
        it("staking", async () => {
            const gaugeMbptBefore = await mBPT.balanceOf(mbptGaugeAddress)
            expect(gaugeMbptBefore).to.gt(0)

            const tx = await stkBPT.connect(mbptWhale.signer)["stake(uint256)"](stakedAmount)

            await expect(tx).to.emit(stkBPT, "Staked").withArgs(mbptWhale.address, stakedAmount, ZERO_ADDRESS)
            await expect(tx).to.emit(mBPT, "Transfer").withArgs(mbptWhale.address, stkBPT.address, stakedAmount)
            await expect(tx).to.emit(mBPT, "Transfer").withArgs(stkBPT.address, mbptGaugeAddress, stakedAmount)

            expect(await mBPT.balanceOf(mbptGaugeAddress), "gauge's mBPT bal after").to.eq(gaugeMbptBefore.add(stakedAmount))
            expect(await mBPT.balanceOf(stakedTokenBptAddress), "stkBPT's mBPT bal after").to.eq(0)
            expect(await mBPT.balanceOf(mbptWhale.address), "staker's mBPT bal after").to.eq(0)
        })
        it("set BAL recipient", async () => {
            const tx = await stkBPT.connect(governor.signer).setBalRecipient(deployer.address)

            await expect(tx).to.emit(stkBPT, "BalRecipientChanged").withArgs(deployer.address)
        })
        it("claim BAL rewards", async () => {
            expect(await BAL.balanceOf(deployer.address), "deployer's BAL rewards before").to.eq(0)
            expect(await BAL.balanceOf(stkBPT.address), "stkmBPT's BAL rewards before").to.eq(0)
            await increaseTime(ONE_WEEK.mul(2))

            await gauge.claim_rewards(stkBPT.address)

            // TODO work out how to distribute BAL via the Gauge
            // expect(await BAL.balanceOf(deployer.address), "deployer BAL rewards after").to.gt(0)
            expect(await BAL.balanceOf(stkBPT.address), "stkmBPT's BAL rewards after").to.eq(0)
        })
    })
    describe("fail to", () => {
        before(async () => {
            await setup(14612990)
            await upgradeStkMbpt()
        })
        it("stake zero amount", async () => {
            const tx = stkBPT.connect(mbptWhale.signer)["stake(uint256)"](0)

            await expect(tx).to.revertedWith("INVALID_ZERO_AMOUNT")
        })
    })
})
