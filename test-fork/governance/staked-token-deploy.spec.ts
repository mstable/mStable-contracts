/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS, DEAD_ADDRESS } from "@utils/constants"
import { assertBNClose, assertBNClosePercent } from "@utils/assertions"
import { impersonate, impersonateAccount } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime, getTimestamp } from "@utils/time"
import { expect } from "chai"
import { BigNumberish, Signer, utils } from "ethers"
import * as hre from "hardhat"
import { deployStakingToken, StakedTokenDeployAddresses } from "tasks/utils/rewardsUtils"
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
    InstantProxyAdmin__factory,
    DelayedProxyAdmin,
    InstantProxyAdmin,
    IMStableVoterProxy__factory,
    IncentivisedVotingLockup__factory,
    BoostedVault__factory,
    StakedToken,
    BoostedDualVault__factory,
} from "types/generated"
import { RewardsDistributorEth__factory } from "types/generated/factories/RewardsDistributorEth__factory"
import { QuestType, BalConfig, UserStakingData, Account } from "types"
import { Chain } from "tasks/utils/tokens"
import { signUserQuests } from "tasks/utils/quest-utils"
import { getSigner } from "tasks/utils/signerFactory"
import { getChainAddress, resolveAddress } from "../../tasks/utils/networkAddressFactory"

const governorAddress = resolveAddress("Governor")
const deployerAddress = resolveAddress("OperationsSigner")
const mStableVoterProxy = resolveAddress("VoterProxy")
const sharedBadgerGov = resolveAddress("BadgerSafe")
const questSignerAddress = resolveAddress("QuestSigner")
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

const staker1 = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const staker2 = "0x0fc4b69958cb2fa320a96d54168b89953a953fbf"
const staker3 = "0x25953c127efd1e15f4d2be82b753d49b12d626d7"

const vaultAddresses = [
    resolveAddress("mUSD", Chain.mainnet, "vault"),
    resolveAddress("mBTC", Chain.mainnet, "vault"),
    resolveAddress("GUSD", Chain.mainnet, "vault"),
    resolveAddress("BUSD", Chain.mainnet, "vault"),
    resolveAddress("HBTC", Chain.mainnet, "vault"),
    resolveAddress("TBTC", Chain.mainnet, "vault"),
    resolveAddress("alUSD", Chain.mainnet, "vault"),
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
    proxyAdmin: InstantProxyAdmin
    delayedProxyAdmin: DelayedProxyAdmin
}

// 1. Deploy core stkMTA, mBPT variant & QuestManager
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
    let deployer: Account
    let governor: Signer
    let ethWhale: Signer
    let questSigner: Signer

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
        const scaledBalance = await stakedToken.balanceOf(user)
        const votes = await stakedToken.getVotes(user)
        const earnedRewards = await stakedToken.earned(user)
        const rewardTokenBalance = await rewardToken.balanceOf(user)
        const rawBalance = await stakedToken.balanceData(user)
        const userPriceCoeff = await stakedToken.userPriceCoeff(user)
        const questBalance = await questManager.balanceData(user)

        return {
            scaledBalance,
            votes,
            earnedRewards,
            rewardTokenBalance,
            rawBalance,
            numCheckpoints: 0,
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
                        // blockNumber: 13198333,
                    },
                },
            ],
        })
        deployer = await impersonateAccount(deployerAddress)
        governor = await impersonate(governorAddress)
        ethWhale = await impersonate(ethWhaleAddress)

        // Need to export DEFENDER_API_KEY and DEFENDER_API_SECRET for the quest Relay account
        questSigner = await getSigner(hre)

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(1),
        })

        await increaseTime(ONE_DAY.mul(6))
    })
    context("1. Deploying", () => {
        it.skip("deploys the contracts", async () => {
            // Deploy StakedTokenMTA
            let stakedTokenAddresses: StakedTokenDeployAddresses = {
                proxyAdminAddress: getChainAddress("ProxyAdmin", Chain.mainnet),
                questManager: getChainAddress("QuestManager", Chain.mainnet),
                signatureVerifier: getChainAddress("SignatureVerifier", Chain.mainnet),
                platformTokenVendorFactory: getChainAddress("PlatformTokenVendorFactory", Chain.mainnet),
                stakedToken: getChainAddress("StakedTokenMTA", Chain.mainnet),
            }

            if (!stakedTokenAddresses.questManager || !stakedTokenAddresses.stakedToken) {
                stakedTokenAddresses = await deployStakingToken(
                    {
                        rewardsTokenSymbol: "MTA",
                        stakedTokenSymbol: "MTA",
                        cooldown: ONE_WEEK.mul(3).toNumber(),
                        unstakeWindow: ONE_WEEK.mul(2).toNumber(),
                        name: "Staked Token MTA",
                        symbol: "stkMTA",
                    },
                    deployer,
                    hre,
                    false,
                    undefined,
                    questSignerAddress,
                )
            }

            // Deploy StakedTokenBPT
            let stakedTokenBPTAddress = getChainAddress("StakedTokenBPT", Chain.mainnet)
            if (!stakedTokenBPTAddress) {
                const stakedTokenBPT = await deployStakingToken(
                    {
                        rewardsTokenSymbol: "MTA",
                        stakedTokenSymbol: "mBPT",
                        balTokenSymbol: "BAL",
                        cooldown: ONE_WEEK.mul(3).toNumber(),
                        unstakeWindow: ONE_WEEK.mul(2).toNumber(),
                        name: "Staked Token BPT",
                        symbol: "stkBPT",
                    },
                    deployer,
                    hre,
                    false,
                    stakedTokenAddresses,
                    questSignerAddress,
                )
                stakedTokenBPTAddress = stakedTokenBPT.stakedToken
            }

            deployedContracts = {
                stakedTokenBPT: StakedTokenBPT__factory.connect(stakedTokenBPTAddress, deployer.signer),
                stakedTokenMTA: StakedTokenMTA__factory.connect(stakedTokenAddresses.stakedToken, deployer.signer),
                questManager: QuestManager__factory.connect(stakedTokenAddresses.questManager, deployer.signer),
                signatureVerifier: SignatureVerifier__factory.connect(stakedTokenAddresses.signatureVerifier, deployer.signer),
                platformTokenVendorFactory: PlatformTokenVendorFactory__factory.connect(
                    stakedTokenAddresses.platformTokenVendorFactory,
                    deployer.signer,
                ),
                mta: IERC20__factory.connect(resolveAddress("MTA"), deployer.signer),
                bpt: IERC20__factory.connect(resolveAddress("mBPT"), deployer.signer),
                boostDirector: BoostDirectorV2__factory.connect(resolveAddress("BoostDirector"), governor),
                proxyAdmin: InstantProxyAdmin__factory.connect(stakedTokenAddresses.proxyAdminAddress, governor),
                delayedProxyAdmin: DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin"), governor),
            }
        })
        it("upgrade proxies", async () => {
            deployedContracts = {
                stakedTokenBPT: StakedTokenBPT__factory.connect(resolveAddress("StakedTokenBPT"), deployer.signer),
                stakedTokenMTA: StakedTokenMTA__factory.connect(resolveAddress("StakedTokenMTA"), deployer.signer),
                questManager: QuestManager__factory.connect(resolveAddress("QuestManager"), deployer.signer),
                signatureVerifier: SignatureVerifier__factory.connect(resolveAddress("SignatureVerifier"), deployer.signer),
                platformTokenVendorFactory: PlatformTokenVendorFactory__factory.connect(
                    resolveAddress("PlatformTokenVendorFactory"),
                    deployer.signer,
                ),
                mta: IERC20__factory.connect(resolveAddress("MTA"), deployer.signer),
                bpt: IERC20__factory.connect(resolveAddress("mBPT"), deployer.signer),
                boostDirector: BoostDirectorV2__factory.connect(resolveAddress("BoostDirector"), governor),
                proxyAdmin: InstantProxyAdmin__factory.connect(resolveAddress("ProxyAdmin"), governor),
                delayedProxyAdmin: DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin"), governor),
            }

            await deployedContracts.proxyAdmin
                .connect(governor)
                .upgrade(deployedContracts.stakedTokenMTA.address, "0xCE1dA6331B07037E7e3a7B713f7Fd2C4F0A17A96")
            await deployedContracts.proxyAdmin
                .connect(governor)
                .upgrade(deployedContracts.stakedTokenBPT.address, "0x24083ee3919421E7477FF7A0b4b550EcE0e5d87E")
        })
        it("verifies stakedTokenMTA config", async () => {
            const config = await snapConfig(deployedContracts.stakedTokenMTA)
            expect(config.name, "name").eq("Staked MTA")
            expect(config.symbol, "symbol").eq("stkMTA")
            expect(config.decimals, "decimals").eq(18)
            expect(config.rewardsDistributor, "rewardsDistributor").eq(resolveAddress("RewardsDistributor"))
            expect(config.nexus, "nexus").eq(resolveAddress("Nexus"))
            expect(config.stakingToken, "staking token symbol").eq(resolveAddress("MTA"))
            expect(config.rewardToken, "reward token symbol").eq(resolveAddress("MTA"))
            expect(config.cooldown, "cooldown").eq(ONE_WEEK.mul(3))
            expect(config.unstake, "unstake").eq(ONE_WEEK.mul(2))
            expect(config.questManager, "questManager").eq(deployedContracts.questManager.address)
            expect(config.hasPriceCoeff, "hasPriceCoeff").eq(false)
            expect(config.colRatio, "colRatio").eq(simpleToExactAmount(1))
            expect(config.slashingPercentage, "slashingPercentage").eq(0)
        })
        it("verifies stakedTokenBPT config", async () => {
            const config = await snapConfig(deployedContracts.stakedTokenBPT)
            expect(config.name, "name").eq("Staked Token BPT")
            expect(config.symbol, "symbol").eq("stkBPT")
            expect(config.decimals, "decimals").eq(18)
            expect(config.rewardsDistributor, "rewardsDistributor").eq(resolveAddress("RewardsDistributor"))
            expect(config.nexus, "nexus").eq(resolveAddress("Nexus"))
            expect(config.stakingToken, "staking token symbol").eq(resolveAddress("mBPT"))
            expect(config.rewardToken, "reward token symbol").eq(resolveAddress("MTA"))
            expect(config.cooldown, "cooldown").eq(ONE_WEEK.mul(3))
            expect(config.unstake, "unstake").eq(ONE_WEEK.mul(2))
            expect(config.questManager, "questManager").eq(deployedContracts.questManager.address)
            expect(config.hasPriceCoeff, "hasPriceCoeff").eq(true)
            expect(config.colRatio, "colRatio").eq(simpleToExactAmount(1))
            expect(config.slashingPercentage, "slashingPercentage").eq(0)
            const data = await snapBalData(deployedContracts.stakedTokenBPT)
            expect(await deployedContracts.stakedTokenBPT.BAL(), "BAL token symbol").eq(resolveAddress("BAL"))
            expect(await deployedContracts.stakedTokenBPT.balancerVault(), "BAL Vault").eq(resolveAddress("BalancerVault"))
            expect(await deployedContracts.stakedTokenBPT.poolId(), "BAL pool ID").eq(resolveAddress("BalancerStakingPoolId"))
            expect(data.balRecipient).eq(resolveAddress("FundManager"))
            expect(data.keeper, "keep").eq(ZERO_ADDRESS)
            expect(data.pendingBPTFees, "pendingBPTFees").eq(0)
            expect(data.priceCoefficient, "priceCoefficient").eq(42550)
            expect(data.lastPriceUpdateTime, "lastPriceUpdateTime").eq(0)
        })
        it("verifies questManager config", async () => {
            const seasonEpoch = await deployedContracts.questManager.seasonEpoch()
            const startTime = await deployedContracts.questManager.startTime()
            const questMaster = await deployedContracts.questManager.questMaster()
            const nexus = await deployedContracts.questManager.nexus()

            expect(seasonEpoch, "seasonEpoch").eq(0)
            expect(startTime, "startTime").gt(1631197683)
            expect(questMaster, "questMaster").eq(resolveAddress("QuestMaster"))
            expect(nexus, "nexus").eq(resolveAddress("Nexus"))
        })
    })
    context("2. Sending Gov Tx's", () => {
        it.skip("adds StakingTokens to BoostDirector and QuestManager", async () => {
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
            const fundManager = await impersonate(resolveAddress("OperationsSigner"))
            const rewardsDistributor = RewardsDistributorEth__factory.connect(resolveAddress("RewardsDistributor"), fundManager)
            await rewardsDistributor
                .connect(fundManager)
                .distributeRewards(
                    [deployedContracts.stakedTokenMTA.address, deployedContracts.stakedTokenBPT.address],
                    [simpleToExactAmount(1), simpleToExactAmount(1)],
                )
        })
        it.skip("whitelists Badger voterproxy", async () => {
            await deployedContracts.stakedTokenMTA.connect(governor).whitelistWrapper(mStableVoterProxy)
        })
    })
    context("3. Vault upgrades", () => {
        it.skip("should upgrade all vaults", async () => {
            const proxyAdmin = await DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin"), governor)
            await Promise.all(vaultAddresses.map((v) => proxyAdmin.acceptUpgradeRequest(v)))
        })
        it("should verify the vault upgrades have executed successfully and all behaviour is in tact", async () => {
            const nexusAddress = resolveAddress("Nexus")
            const boostDirectorAddress = resolveAddress("BoostDirector")
            const rewardTokenAddress = resolveAddress("MTA")

            for (const vault of vaults) {
                const vaultProxyAddress = resolveAddress(vault.underlyingTokenSymbol, Chain.mainnet, "vault")
                const proxy = BoostedDualVault__factory.connect(vaultProxyAddress, deployer.signer)

                console.log(`About to verify the ${vault.underlyingTokenSymbol} vault`)

                if (vault.underlyingTokenSymbol !== "mUSD") {
                    expect(await proxy.name(), `${vault.underlyingTokenSymbol} vault name`).to.eq(vault.name)
                    expect(await proxy.symbol(), `${vault.underlyingTokenSymbol} vault symbol`).to.eq(vault.symbol)
                    expect(await proxy.decimals(), `${vault.underlyingTokenSymbol} decimals`).to.eq(18)
                }
                expect(await proxy.nexus(), `${vault.underlyingTokenSymbol} vault nexus`).to.eq(nexusAddress)
                expect(await proxy.boostDirector(), `${vault.underlyingTokenSymbol} vault boost director`).to.eq(boostDirectorAddress)
                expect(await proxy.getRewardToken(), `${vault.underlyingTokenSymbol} vault reward token`).to.eq(rewardTokenAddress)
                expect(await proxy.priceCoeff(), `${vault.underlyingTokenSymbol} vault priceCoeff`).to.eq(
                    vault.priceCoeff ? vault.priceCoeff : simpleToExactAmount(1),
                )
                if (vault.underlyingTokenSymbol === "alUSD") {
                    expect(await proxy.getPlatformToken(), `${vault.underlyingTokenSymbol} vault platform token`).to.eq(
                        resolveAddress(vault.platformToken),
                    )
                }
                // expect(await proxy.balanceOf(vault.userBal.user), `${vault.underlyingTokenSymbol} vault user balance`).to.gt(
                //     vault.userBal.balance,
                // )
                expect(await proxy.totalSupply(), `${vault.underlyingTokenSymbol} vault total supply`).to.gt(0)
            }
        })
    })

    // deployer transfers 50k MTA to Staker1 & 100k to Staker2
    // staker1 stakes in both
    // staker2 stakes in MTA
    context("4. Beta testing", () => {
        let staker1signer: Signer
        const staker1bpt = simpleToExactAmount(2000)
        let staker2signer: Signer
        before(async () => {
            // tops up users with MTA
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
        it("allows staker 1 staking on StakedTokenMTA", async () => {
            const startingRawBal = BN.from("200016043320105818350") // a bit over 200 MTA
            const stakeAmount = simpleToExactAmount(50000)
            const balBefore = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                true,
            )
            expect(balBefore.questBalance.permMultiplier, "perm multiplier after").eq(25)
            expect(balBefore.questBalance.seasonMultiplier, "season multiplier after").eq(0)
            expect(balBefore.rawBalance.raw, "raw bal after").eq(startingRawBal)
            expect(balBefore.scaledBalance, "scaled bal after").eq(startingRawBal.mul(125).div(100))
            expect(balBefore.votes, "votes after").eq(0)

            await deployedContracts.mta.connect(staker1signer).approve(deployedContracts.stakedTokenMTA.address, stakeAmount)
            await deployedContracts.stakedTokenMTA.connect(staker1signer)["stake(uint256)"](stakeAmount)

            const balAfter = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                true,
            )
            expect(balAfter.questBalance.permMultiplier, "perm multiplier after").eq(25)
            expect(balAfter.questBalance.seasonMultiplier, "season multiplier after").eq(0)
            expect(balAfter.rawBalance.raw, "raw bal after").eq(startingRawBal.add(stakeAmount))
            expect(balAfter.scaledBalance, "scaled bal after").eq(balAfter.rawBalance.raw.mul(125).div(100))
            expect(balAfter.votes, "votes after").eq(0)
        })
        it("allows staker 2 staking on StakedTokenMTA", async () => {
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
            const signature = await signUserQuests(staker1, [1], questSigner)
            await deployedContracts.questManager.completeUserQuests(staker1, [1], signature)

            const balAfter = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                true,
            )
            expect(balAfter.questBalance.permMultiplier, "perm multiplier after").eq(25 + 10)
            expect(balAfter.questBalance.seasonMultiplier, "season multiplier after").eq(0)
            expect(balAfter.questBalance.lastAction, "last action after").eq(0)
            expect(balAfter.earnedRewards, "earned rewards after").gt(0)
            expect(balAfter.rawBalance.raw, "raw bal after").eq(balBefore.rawBalance.raw)
            expect(balAfter.scaledBalance, "scaled bal after").eq(balBefore.rawBalance.raw.mul(135).div(100))
            expect(balAfter.votes, "votes after").eq(0)
            expect(await deployedContracts.questManager.hasCompleted(staker1, 1), "has completed after").eq(true)
        })
        const calcBoost = (raw: BN, vMTA: BN, priceCoefficient = simpleToExactAmount(1)): BN => {
            const maxVMTA = simpleToExactAmount(600000, 18)
            const maxBoost = simpleToExactAmount(3, 18)
            const minBoost = simpleToExactAmount(1, 18)
            const floor = simpleToExactAmount(98, 16)
            const coeff = BN.from(9)
            // min(m, max(d, (d * 0.95) + c * min(vMTA, f) / USD^b))
            const scaledBalance = raw.mul(priceCoefficient).div(simpleToExactAmount(1, 18))

            if (scaledBalance.lt(simpleToExactAmount(1, 18))) return simpleToExactAmount(1)

            let denom = parseFloat(utils.formatUnits(scaledBalance))
            denom **= 0.75
            const flooredMTA = vMTA.gt(maxVMTA) ? maxVMTA : vMTA
            let rhs = floor.add(flooredMTA.mul(coeff).div(10).mul(simpleToExactAmount(1)).div(simpleToExactAmount(denom)))
            rhs = rhs.gt(minBoost) ? rhs : minBoost
            return rhs.gt(maxBoost) ? maxBoost : rhs
        }
        it("should fetch the correct balances from the BoostDirector", async () => {
            // staker 1 just call staticBalance on the boost director
            await deployedContracts.boostDirector.whitelistVaults([deployerAddress])
            const bal1 = await deployedContracts.boostDirector.connect(deployer.signer).callStatic.getBalance(staker1)
            const staker1bal1 = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                true,
            )
            const staker1bal2 = await snapshotUserStakingData(
                deployedContracts.stakedTokenBPT,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                true,
            )
            expect(bal1).eq(staker1bal1.scaledBalance.add(staker1bal2.scaledBalance).div(12))

            // staker 2 poke boost on the gusd fPool and check the multiplier
            const gusdVaultAddress = resolveAddress("GUSD", Chain.mainnet, "vault")
            const gusdPool = BoostedVault__factory.connect(gusdVaultAddress, staker2signer)
            const boost2 = await gusdPool.getBoost(staker2)
            const rawBal2 = await gusdPool.rawBalanceOf(staker2)
            await gusdPool.pokeBoost(staker2)
            const boost2after = await gusdPool.getBoost(staker2)
            expect(boost2after).not.eq(boost2)
            assertBNClosePercent(boost2after, calcBoost(rawBal2, simpleToExactAmount(100000).div(12)), "0.001")

            // staker 3 (no stake) poke boost and see it go to 0 multiplier
            const mbtcVaultAddress = resolveAddress("mBTC", Chain.mainnet, "vault")
            const btcPool = BoostedVault__factory.connect(mbtcVaultAddress, staker2signer)
            const boost3 = await btcPool.getBoost(staker3)
            await btcPool.pokeBoost(staker3)
            const boost3after = await btcPool.getBoost(staker3)
            expect(boost3).gt(simpleToExactAmount(2))
            expect(boost3after).eq(simpleToExactAmount(1))
        })
        // staker 1 withdraws from BPT
        // staker 2 withdraws from MTA
        it("should allow users to enter cooldown and withdraw", async () => {
            const staker1balbefore = await snapshotUserStakingData(
                deployedContracts.stakedTokenBPT,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                false,
            )
            const staker2balbefore = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker2,
                true,
            )
            await deployedContracts.stakedTokenBPT.connect(staker1signer).startCooldown(staker1balbefore.rawBalance.raw)
            await deployedContracts.stakedTokenMTA.connect(staker2signer).startCooldown(simpleToExactAmount(50000))

            const staker1balmid = await snapshotUserStakingData(
                deployedContracts.stakedTokenBPT,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                false,
            )
            const staker2balmid = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker2,
                true,
            )

            expect(staker1balmid.scaledBalance).eq(0)
            expect(staker1balmid.rawBalance.raw).eq(0)
            expect(staker1balmid.rawBalance.cooldownUnits).eq(staker1balbefore.rawBalance.raw)

            expect(staker2balmid.scaledBalance).eq(staker2balbefore.scaledBalance.div(2))
            expect(staker2balmid.rawBalance.raw).eq(simpleToExactAmount(50000))
            expect(staker2balmid.rawBalance.cooldownUnits).eq(simpleToExactAmount(50000))

            await increaseTime(ONE_WEEK.mul(3).add(1))

            await deployedContracts.stakedTokenBPT.connect(staker1signer).withdraw(staker1balbefore.rawBalance.raw, staker1, true, true)
            await deployedContracts.stakedTokenMTA.connect(staker2signer).withdraw(simpleToExactAmount(40000), staker2, false, true)
            const staker1balend = await snapshotUserStakingData(
                deployedContracts.stakedTokenBPT,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker1,
                false,
            )
            const staker2balend = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                staker2,
                true,
            )

            expect(staker1balend.scaledBalance).eq(0)
            expect(staker1balend.rawBalance.raw).eq(0)
            expect(staker1balend.rawBalance.cooldownUnits).eq(0)

            assertBNClosePercent(staker2balend.scaledBalance, BN.from("57000009920800000000000"), "0.001")
            assertBNClosePercent(staker2balend.rawBalance.raw, BN.from("57000009920800000000000"), "0.001")
            expect(staker2balend.rawBalance.cooldownUnits).eq(0)
            expect(staker2balend.rawBalance.cooldownTimestamp).eq(0)
        })
        it("should allow recycling of mBPT redemption fees", async () => {
            const fees = await deployedContracts.stakedTokenBPT.pendingBPTFees()
            expect(fees).gt(simpleToExactAmount(150))

            await deployedContracts.stakedTokenBPT.connect(governor).convertFees()

            expect(await deployedContracts.stakedTokenBPT.pendingAdditionalReward()).gt(simpleToExactAmount(600))

            const priceCoeff = await deployedContracts.stakedTokenBPT.getProspectivePriceCoefficient()
            console.log(priceCoeff.toString())
            expect(priceCoeff).lt(await deployedContracts.stakedTokenBPT.priceCoefficient())
        })
        it("should allow immediate upgrades of staking tokens", async () => {
            //  - get impl addr from ProxyAdmin and check (this verifies that its owned by ProxyAdmin)
            expect(await deployedContracts.proxyAdmin.getProxyAdmin(deployedContracts.stakedTokenMTA.address)).eq(
                deployedContracts.proxyAdmin.address,
            )
            expect(await deployedContracts.proxyAdmin.getProxyAdmin(deployedContracts.stakedTokenBPT.address)).eq(
                deployedContracts.proxyAdmin.address,
            )
            //  - Propose it again through the ProxyAdmin
            await deployedContracts.proxyAdmin.changeProxyAdmin(deployedContracts.stakedTokenMTA.address, DEAD_ADDRESS)
        })
        it("should allow proposal of upgrades for questManager", async () => {
            //  - get impl addr from DelayedProxyAdmin and check (this verifies that its owned by DelayedProxyAdmin)
            expect(await deployedContracts.delayedProxyAdmin.getProxyAdmin(deployedContracts.questManager.address)).eq(
                deployedContracts.delayedProxyAdmin.address,
            )
            //  - Propose it again through the DelayedProxyAdmin
            await deployedContracts.delayedProxyAdmin
                .connect(governor)
                .proposeUpgrade(deployedContracts.questManager.address, DEAD_ADDRESS, "0x")
        })
    })
    context("5. Finalise", () => {
        it("should add all launch rewards", async () => {
            //  - Add the rewards (32.5k, 20k) to each stakedtoken
            const fundManager = await impersonate(resolveAddress("OperationsSigner"))
            const rewardsDistributor = RewardsDistributorEth__factory.connect(resolveAddress("RewardsDistributor"), fundManager)
            await rewardsDistributor
                .connect(fundManager)
                .distributeRewards(
                    [deployedContracts.stakedTokenMTA.address, deployedContracts.stakedTokenBPT.address],
                    [simpleToExactAmount(32500), simpleToExactAmount(20000)],
                )
        })
        it("should expire the old staking contract", async () => {
            //  - Expire old staking contract
            const mtaVaultAddress = resolveAddress("MTA", Chain.mainnet, "vault")
            const votingLockup = IncentivisedVotingLockup__factory.connect(mtaVaultAddress, governor)
            await votingLockup.expireContract()
            //  - Check that it's possible to exit for all users
            expect(await votingLockup.expired()).eq(true)

            const activeUser = await impersonate("0xd4e692eb01861f2bc0534b9a1afd840719648c49")
            await votingLockup.connect(activeUser).exit()
        })
    })
    context("6. Test Badger migration", () => {
        it("should allow badger to stake in new contract", async () => {
            const badgerGovSigner = await impersonate(sharedBadgerGov)
            const voterProxy = IMStableVoterProxy__factory.connect(mStableVoterProxy, badgerGovSigner)
            // 1. it should fail to change addr unless exited - this can be skipped as bias is now 0
            // await expect(voterProxy.changeLockAddress(deployedContracts.stakedTokenMTA.address)).to.be.revertedWith("Active lockup")
            // 2. Exit from old (exit)
            await voterProxy.connect(governor).exitLock()
            // 3. Update address ()
            await voterProxy.changeLockAddress(deployedContracts.stakedTokenMTA.address)
            // 4. fail when calling harvestMta or increaseLockAmount/length
            await expect(voterProxy.connect(governor).harvestMta()).to.be.revertedWith("Nothing to increase")
            await expect(voterProxy.extendLock(BN.from(5000000))).to.be.reverted
            // 5. call createLock
            await voterProxy.createLock(BN.from(5000000))
            // 6. Check output
            const userData = await snapshotUserStakingData(
                deployedContracts.stakedTokenMTA,
                deployedContracts.questManager,
                deployedContracts.mta,
                voterProxy.address,
                true,
            )
            expect(userData.rawBalance.raw).gt(simpleToExactAmount(500000))
        })
    })
})

interface UserBalance {
    user: string
    balance: BigNumberish
}
interface VaultData {
    underlyingTokenSymbol: string
    stakingTokenType: "savings" | "feederPool"
    priceCoeff?: BN
    platformToken?: string
    name: string
    symbol: string
    userBal: UserBalance
}

const btcPriceCoeff = simpleToExactAmount(48000)
const vaults: VaultData[] = [
    {
        underlyingTokenSymbol: "mBTC",
        stakingTokenType: "savings",
        priceCoeff: btcPriceCoeff.div(10),
        name: "imBTC Vault",
        symbol: "v-imBTC",
        userBal: {
            user: "0x25953c127efd1e15f4d2be82b753d49b12d626d7",
            balance: simpleToExactAmount(172),
        },
    },
    {
        underlyingTokenSymbol: "GUSD",
        stakingTokenType: "feederPool",
        name: "mUSD/GUSD fPool Vault",
        symbol: "v-fPmUSD/GUSD",
        userBal: {
            user: "0xf794CF2d946BC6eE6eD905F47db211EBd451Aa5F",
            balance: simpleToExactAmount(425000),
        },
    },
    {
        underlyingTokenSymbol: "BUSD",
        stakingTokenType: "feederPool",
        name: "mUSD/BUSD fPool Vault",
        symbol: "v-fPmUSD/BUSD",
        userBal: {
            user: "0xc09111f9d094d07fc013fd45c4081510ca4275cf",
            balance: simpleToExactAmount(1400000),
        },
    },
    {
        underlyingTokenSymbol: "HBTC",
        stakingTokenType: "feederPool",
        priceCoeff: btcPriceCoeff,
        name: "mBTC/HBTC fPool Vault",
        symbol: "v-fPmBTC/HBTC",
        userBal: {
            user: "0x8d0f5678557192e23d1da1c689e40f25c063eaa5",
            balance: simpleToExactAmount(2.4),
        },
    },
    {
        underlyingTokenSymbol: "TBTC",
        stakingTokenType: "feederPool",
        priceCoeff: btcPriceCoeff,
        name: "mBTC/TBTC fPool Vault",
        symbol: "v-fPmBTC/TBTC",
        userBal: {
            user: "0x8d0f5678557192e23d1da1c689e40f25c063eaa5",
            balance: simpleToExactAmount(6.5),
        },
    },
    {
        underlyingTokenSymbol: "alUSD",
        stakingTokenType: "feederPool",
        name: "mUSD/alUSD fPool Vault",
        symbol: "v-fPmUSD/alUSD",
        platformToken: "ALCX",
        userBal: {
            user: "0x97020c9ec66e0f59231918b1d2f167a66026aff2",
            balance: simpleToExactAmount(1200000),
        },
    },
    {
        underlyingTokenSymbol: "mUSD",
        stakingTokenType: "savings",
        priceCoeff: simpleToExactAmount(1, 17),
        name: "imUSD Vault",
        symbol: "v-imUSD",
        userBal: {
            user: "0x7606ccf1c5f2a908423eb8dd2fa5d82a12255700",
            balance: simpleToExactAmount(68000),
        },
    },
]
