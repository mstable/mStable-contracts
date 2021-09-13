import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"
import { formatUnits } from "@ethersproject/units"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { assertBNClose } from "@utils/assertions"
import { impersonate } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime, getTimestamp } from "@utils/time"
import { expect } from "chai"
import { Signer } from "ethers"
import * as hre from "hardhat"
import { deployStakingToken, StakedTokenData, StakedTokenDeployAddresses } from "tasks/utils/rewardsUtils"
import { arrayify, formatBytes32String, solidityKeccak256 } from "ethers/lib/utils"
import {
    IERC20,
    IERC20__factory,
    StakedTokenBPT,
    StakedTokenMTA,
    QuestManager,
    SignatureVerifier,
    PlatformTokenVendorFactory,
    BoostDirectorV2,
    BoostDirectorV2__factory,
    PlatformTokenVendorFactory__factory,
    SignatureVerifier__factory,
    QuestManager__factory,
    StakedTokenMTA__factory,
    StakedTokenBPT__factory,
    DelayedProxyAdmin__factory,
    IMStableVoterProxy__factory,
    StakedToken,
} from "types/generated"
import { RewardsDistributorEth__factory } from "types/generated/factories/RewardsDistributorEth__factory"
import { Account, QuestType, QuestStatus, BalConfig, UserStakingData } from "types"
import { getChain, getChainAddress, resolveAddress } from "../../tasks/utils/networkAddressFactory"

const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const mStableVoterProxy = "0x10d96b1fd46ce7ce092aa905274b8ed9d4585a6e"
const sharedBadgerGov = "0xca045cc466f14c33a516d98abcab5c55c2f5112c"
const badgerHarvester = "0x872213e29c85d7e30f1c8202fc47ed1ec124bb1d"
const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84"

const staker1 = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const staker2 = "0x0fc4b69958cb2fa320a96d54168b89953a953fbf"

const vaultAddresses = [
    "0xAdeeDD3e5768F7882572Ad91065f93BA88343C99",
    "0xF38522f63f40f9Dd81aBAfD2B8EFc2EC958a3016",
    "0x78BefCa7de27d07DC6e71da295Cc2946681A6c7B",
    "0x760ea8CfDcC4e78d8b9cA3088ECD460246DC0731",
    "0xF65D53AA6e2E4A5f4F026e73cb3e22C22D75E35C",
    "0x0997dDdc038c8A958a3A3d00425C16f8ECa87deb",
    "0xD124B55f70D374F58455c8AEdf308E52Cf2A6207",
]

interface StakedTokenDeployment {
    stakedTokenBPT: StakedTokenBPT
    stakedTokenMTA: StakedTokenMTA
    questManager: QuestManager
    signatureVerifier: SignatureVerifier
    platformTokenVendorFactory: PlatformTokenVendorFactory
    mta: IERC20
    bpt: IERC20
    boostDirector: BoostDirectorV2
}

// 1. Deploy core stkMTA, BPT variant & QuestManager
// 2. Gov TX's
//     1. Add StakingTokens to BoostDirector & QuestManager
//     2. Add Quest to QuestManager
//     3. Add small amt of rewards to get cogs turning
// 3. Vault contract upgrades
//     1. Upgrade
//     2. Verify balance retrieval and boosting (same on all accs)
// 4. Testing
//     1. Stake
//     2. Complete quests
//     3. Enter cooldown
//     4. Boost
// 5. Add rewards for pools
//     1. 32.5k for stkMTA, 20k for stkMBPT
// 6. Gov tx: Expire old Staking contract
context("StakedToken deployments and vault upgrades", () => {
    let deployer: Signer
    let governor: Signer
    let ethWhale: Signer
    let questSigner: SignerWithAddress

    const { network } = hre

    let deployedContracts: StakedTokenDeployment

    const snapConfig = async (stakedToken: StakedToken): Promise<any> => {
        const safetyData = await stakedToken.safetyData()
        return {
            name: await stakedToken.name(),
            symbol: await stakedToken.symbol(),
            decimals: await stakedToken.decimals(),
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
        }
    }

    const snapBalData = async (stakedTokenBpt: StakedTokenBPT): Promise<BalConfig> => {
        const balRecipient = await stakedTokenBpt.balRecipient()
        const keeper = await stakedTokenBpt.keeper()
        const pendingBPTFees = await stakedTokenBpt.pendingBPTFees()
        const priceCoefficient = await stakedTokenBpt.priceCoefficient()
        const lastPriceUpdateTime = await stakedTokenBpt.lastPriceUpdateTime()
        return {
            balRecipient,
            keeper,
            pendingBPTFees,
            priceCoefficient,
            lastPriceUpdateTime,
        }
    }

    const snapshotUserStakingData = async (
        stakedToken: StakedToken,
        questManager: QuestManager,
        rewardToken: IERC20,
        user: string,
        skipBalData = false,
    ): Promise<UserStakingData> => {
        const stakedBalance = await stakedToken.balanceOf(user)
        const votes = await stakedToken.getVotes(user)
        const earnedRewards = await stakedToken.earned(user)
        const rewardsBalance = await rewardToken.balanceOf(user)
        const userBalances = await stakedToken.balanceData(user)
        const userPriceCoeff = await stakedToken.userPriceCoeff(user)
        const questBalance = await questManager.balanceData(user)

        return {
            stakedBalance,
            votes,
            earnedRewards,
            rewardsBalance,
            userBalances,
            userPriceCoeff,
            questBalance,
            balData: skipBalData ? null : await snapBalData(stakedToken as StakedTokenBPT),
        }
    }

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 13198333,
                    },
                },
            ],
        })
        deployer = await impersonate(deployerAddress)
        governor = await impersonate(governorAddress)
        ethWhale = await impersonate(ethWhaleAddress)

        const { ethers } = hre
        ;[questSigner] = await ethers.getSigners()

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(1),
        })

        await increaseTime(ONE_DAY.mul(6))
    })
    context("1. Deploying", () => {
        it("deploys the contracts", async () => {
            // Deploy StakedTokenMTA
            const stakedTokenMTA = await deployStakingToken(
                {
                    rewardsTokenSymbol: "MTA",
                    stakedTokenSymbol: "MTA",
                    cooldown: ONE_WEEK.mul(3).toNumber(),
                    unstakeWindow: ONE_WEEK.mul(2).toNumber(),
                    name: "StakedTokenMTA",
                    symbol: "stkMTA",
                },
                { signer: deployer, address: deployerAddress },
                hre,
                undefined,
                questSigner.address,
            )

            // Deploy StakedTokenBPT
            const stakedTokenBPT = await deployStakingToken(
                {
                    rewardsTokenSymbol: "MTA",
                    stakedTokenSymbol: "BPT",
                    balTokenSymbol: "BAL",
                    cooldown: ONE_WEEK.mul(3).toNumber(),
                    unstakeWindow: ONE_WEEK.mul(2).toNumber(),
                    name: "StakedTokenBPT",
                    symbol: "stkBPT",
                },
                { signer: deployer, address: deployerAddress },
                hre,
                stakedTokenMTA,
                questSigner.address,
            )

            deployedContracts = {
                stakedTokenBPT: StakedTokenBPT__factory.connect(stakedTokenBPT.stakedToken, deployer),
                stakedTokenMTA: StakedTokenMTA__factory.connect(stakedTokenMTA.stakedToken, deployer),
                questManager: QuestManager__factory.connect(stakedTokenMTA.questManager, deployer),
                signatureVerifier: SignatureVerifier__factory.connect(stakedTokenMTA.signatureVerifier, deployer),
                platformTokenVendorFactory: PlatformTokenVendorFactory__factory.connect(
                    stakedTokenMTA.platformTokenVendorFactory,
                    deployer,
                ),
                mta: IERC20__factory.connect(resolveAddress("MTA", 0), deployer),
                bpt: IERC20__factory.connect(resolveAddress("BPT", 0), deployer),
                boostDirector: BoostDirectorV2__factory.connect(resolveAddress("BoostDirector", 0), governor),
            }
        })
        it("verifies stakedTokenMTA config", async () => {
            const config = await snapConfig(deployedContracts.stakedTokenMTA)
            expect(config.name).eq("StakedTokenMTA")
            expect(config.symbol).eq("stkMTA")
            expect(config.decimals).eq(18)
            expect(config.rewardsDistributor).eq(resolveAddress("RewardsDistributor", 0))
            expect(config.nexus).eq(resolveAddress("Nexus", 0))
            expect(config.stakingToken).eq(resolveAddress("MTA", 0))
            expect(config.rewardToken).eq(resolveAddress("MTA", 0))
            expect(config.cooldown).eq(ONE_WEEK.mul(3))
            expect(config.unstake).eq(ONE_WEEK.mul(2))
            expect(config.questManager).eq(deployedContracts.questManager.address)
            expect(config.hasPriceCoeff).eq(false)
            expect(config.colRatio).eq(simpleToExactAmount(1))
            expect(config.slashingPercentage).eq(0)
        })
        it("verifies stakedTokenBPT config", async () => {
            const config = await snapConfig(deployedContracts.stakedTokenBPT)
            expect(config.name).eq("StakedTokenBPT")
            expect(config.symbol).eq("stkBPT")
            expect(config.decimals).eq(18)
            expect(config.rewardsDistributor).eq(resolveAddress("RewardsDistributor", 0))
            expect(config.nexus).eq(resolveAddress("Nexus", 0))
            expect(config.stakingToken).eq(resolveAddress("BPT", 0))
            expect(config.rewardToken).eq(resolveAddress("MTA", 0))
            expect(config.cooldown).eq(ONE_WEEK.mul(3))
            expect(config.unstake).eq(ONE_WEEK.mul(2))
            expect(config.questManager).eq(deployedContracts.questManager.address)
            expect(config.hasPriceCoeff).eq(true)
            expect(config.colRatio).eq(simpleToExactAmount(1))
            expect(config.slashingPercentage).eq(0)
            const data = await snapBalData(deployedContracts.stakedTokenBPT)
            expect(await deployedContracts.stakedTokenBPT.BAL()).eq(resolveAddress("BAL", 0))
            expect(await deployedContracts.stakedTokenBPT.balancerVault()).eq(resolveAddress("BalancerVault", 0))
            expect(await deployedContracts.stakedTokenBPT.poolId()).eq(resolveAddress("BalancerStakingPoolId", 0))
            expect(data.balRecipient).eq(resolveAddress("FundManager", 0))
            expect(data.keeper).eq(ZERO_ADDRESS)
            expect(data.pendingBPTFees).eq(0)
            expect(data.priceCoefficient).eq(42550)
            expect(data.lastPriceUpdateTime).eq(0)
        })
        it("verifies questManager config", async () => {
            const seasonEpoch = await deployedContracts.questManager.seasonEpoch()
            const startTime = await deployedContracts.questManager.startTime()
            const questMaster = await deployedContracts.questManager.questMaster()
            const nexus = await deployedContracts.questManager.nexus()

            expect(seasonEpoch).eq(0)
            expect(startTime).gt(1631197683)
            expect(questMaster).eq(resolveAddress("QuestMaster", 0))
            expect(nexus).eq(resolveAddress("Nexus", 0))
        })
    })
    context("2. Sending Gov Tx's", () => {
        it("adds StakingTokens to BoostDirector and QuestManager", async () => {
            // 1. BoostDirector
            await deployedContracts.boostDirector.connect(governor).addStakedToken(deployedContracts.stakedTokenMTA.address)
            await deployedContracts.boostDirector.connect(governor).addStakedToken(deployedContracts.stakedTokenBPT.address)

            // 2. QuestManager
            await deployedContracts.questManager.connect(governor).addStakedToken(deployedContracts.stakedTokenMTA.address)
            await deployedContracts.questManager.connect(governor).addStakedToken(deployedContracts.stakedTokenBPT.address)
        })
        it("adds initial quest to QuestManager", async () => {
            const currentTime = await getTimestamp()
            await deployedContracts.questManager.connect(governor).addQuest(QuestType.PERMANENT, 10, currentTime.add(ONE_WEEK).add(2))
            await deployedContracts.questManager.connect(governor).addQuest(QuestType.SEASONAL, 25, currentTime.add(ONE_WEEK).add(2))
        })
        it("adds small amount of rewards to both reward contracts", async () => {
            const fundManager = await impersonate(resolveAddress("FundManager", 0))
            const rewardsDistributor = RewardsDistributorEth__factory.connect(resolveAddress("RewardsDistributor", 0), fundManager)
            await rewardsDistributor
                .connect(fundManager)
                .distributeRewards(
                    [deployedContracts.stakedTokenMTA.address, deployedContracts.stakedTokenBPT.address],
                    [simpleToExactAmount(1), simpleToExactAmount(1)],
                )
        })
        it("whitelists Badger voterproxy", async () => {
            await deployedContracts.stakedTokenMTA.connect(governor).whitelistWrapper(mStableVoterProxy)
        })
    })
    context("3. Vault upgrades", () => {
        it("should upgrade all vaults", async () => {
            const proxyAdmin = await DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin", 0), governor)
            await Promise.all(vaultAddresses.map((v) => proxyAdmin.acceptUpgradeRequest(v)))
        })
        it("should verify the vault upgrades have executed succesfully and all behaviour is in tact")
    })

    const signUserQuests = async (user: string, questIds: number[], signer: SignerWithAddress): Promise<string> => {
        console.log("x")
        const messageHash = solidityKeccak256(["address", "uint256[]"], [user, questIds])
        console.log("x")
        const signature = await signer.signMessage(arrayify(messageHash))
        return signature
    }
    // deployer transfers 50k MTA to Staker1 & 100k to Staker2
    // staker1 stakes in both
    // staker2 stakes in MTA
    context("4. Beta testing", () => {
        let staker1signer: Signer
        const staker1bpt = simpleToExactAmount(3000)
        let staker2signer: Signer
        it("tops up users with MTA", async () => {
            await deployedContracts.mta.transfer(staker1, simpleToExactAmount(50000))
            await deployedContracts.mta.transfer(staker2, simpleToExactAmount(100000))

            staker1signer = await impersonate(staker1)
            staker2signer = await impersonate(staker2)
        })
        it("allows basic staking on StakedTokenBPT", async () => {
            await deployedContracts.bpt.connect(staker1signer).approve(deployedContracts.stakedTokenBPT.address, staker1bpt)
            await deployedContracts.stakedTokenBPT
                .connect(staker1signer)
                ["stake(uint256,address)"](staker1bpt, resolveAddress("ProtocolDAO"))
        })
        it("allows basic staking on StakedTokenMTA", async () => {
            await deployedContracts.mta.connect(staker1signer).approve(deployedContracts.stakedTokenMTA.address, simpleToExactAmount(50000))
            await deployedContracts.stakedTokenMTA.connect(staker1signer)["stake(uint256)"](simpleToExactAmount(50000))

            await deployedContracts.mta
                .connect(staker2signer)
                .approve(deployedContracts.stakedTokenMTA.address, simpleToExactAmount(100000))
            await deployedContracts.stakedTokenMTA.connect(staker2signer)["stake(uint256)"](simpleToExactAmount(100000))
        })
        it("allows fetching and setting of the priceCoefficinet", async () => {
            const priceCoeff = await deployedContracts.stakedTokenBPT.getProspectivePriceCoefficient()
            assertBNClose(priceCoeff, BN.from(42000), 1000)
            await expect(deployedContracts.stakedTokenBPT.connect(governor).fetchPriceCoefficient()).to.be.revertedWith("Must be > 5% diff")
        })
        it("should allow users to complete quests", async () => {
            const balBefore = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                true,
            )
            const signature = await signUserQuests(staker1, [0], questSigner)
            await deployedContracts.questManager.completeUserQuests(staker1, [0], signature)

            const balAfter = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                true,
            )
            expect(balAfter.questBalance.permMultiplier).eq(10)
            expect(balAfter.questBalance.lastAction).eq(0)
            expect(balAfter.earnedRewards).gt(0)
            expect(balAfter.stakedBalance).eq(balBefore.stakedBalance.mul(110).div(100))
            expect(balAfter.votes).eq(balAfter.stakedBalance)
            expect(await deployedContracts.questManager.hasCompleted(staker1, 0)).eq(true)
        })
        // staker 1 just call staticBalance on the boost director
        // staker 2 poke boost on the gusd fPool and check the multiplier
        // staker 3 (no stake) poke boost and see it go to 0 multiplier
        it("should fetch the correct balances from the BoostDirector", async () => {
            // TODO
        })
        // staker 1 withdraws from BPT
        // staker 2 withdraws from MTA
        // TODO - add light balance verification here
        it("should allow users to enter cooldown and withdraw", async () => {
            await deployedContracts.stakedTokenBPT.connect(staker1signer).startCooldown(staker1bpt)
            await deployedContracts.stakedTokenMTA.connect(staker2signer).startCooldown(simpleToExactAmount(50000))

            await increaseTime(ONE_WEEK.mul(3).add(1))

            await deployedContracts.stakedTokenBPT.connect(staker1signer).withdraw(staker1bpt, staker1, true, true)
            await deployedContracts.stakedTokenMTA.connect(staker2signer).withdraw(simpleToExactAmount(40000), staker2, false, true)
        })
        it("should allow recycling of BPT redemption fees", async () => {
            const fees = await deployedContracts.stakedTokenBPT.pendingBPTFees()
            expect(fees).gt(simpleToExactAmount(150))

            await deployedContracts.stakedTokenBPT.connect(governor).convertFees()

            expect(await deployedContracts.stakedTokenBPT.pendingAdditionalReward()).gt(600)

            const priceCoeff = await deployedContracts.stakedTokenBPT.getProspectivePriceCoefficient()
            console.log(priceCoeff.toString())
            expect(priceCoeff).lt(await deployedContracts.stakedTokenBPT.priceCoefficient())
        })
        it("should allow immediate upgrades of staking tokens", async () => {
            // TODO:
            //  - get impl addr from ProxyAdmin and check
            //  - Propose it again through the ProxyAdmin
        })
        it("should allow proposal of upgrades for questManager", async () => {
            // TODO:
            //  - get impl addr from DelayedProxyAdmin and check
            //  - Propose it again through the DelayedProxyAdmin
        })
    })
    context("5. Finalise", () => {
        it("should add all launch rewards", async () => {
            // TODO:
            //  - Add the rewards to each thing
        })
        it("should expire the old staking contract", async () => {
            // TODO
            //  - Expire old staking contract
            //  - Check that it's possible to exit
        })
    })
    context("6. Test Badger migration", () => {
        it("should allow badger to stake in new contract", async () => {
            // TODO:
            // 1. it should fail to change addr unless exited
            // 2. Exit from old (exit)
            // 3. Update address ()
            // 4. fail when calling harvestMta or increaseLockAmount/length
            // 5. call createLock
            // 6. Check output
        })
    })
})
