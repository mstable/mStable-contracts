import { network } from "hardhat"
import * as hre from "hardhat"

import { impersonate, impersonateAccount } from "@utils/fork"
import { Signer, Wallet } from "ethers"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { deployBasicForwarder, deployBridgeForwarder, deployEmissionsController, deployRevenueBuyBack } from "tasks/utils/emissions-utils"
import { expect } from "chai"
import { BN, simpleToExactAmount } from "@utils/math"
import { currentWeekEpoch, increaseTime } from "@utils/time"
import { MAX_UINT256, ONE_HOUR, ONE_WEEK } from "@utils/constants"
import { assertBNClose } from "@utils/assertions"
import { alUSD, BUSD, Chain, DAI, FEI, GUSD, HBTC, mBTC, MTA, mUSD, RAI, TBTCv2, USDC, WBTC } from "tasks/utils/tokens"
import {
    BridgeForwarder,
    EmissionsController,
    IERC20,
    IERC20__factory,
    InitializableRewardsDistributionRecipient__factory,
    IUniswapV3Quoter__factory,
    Nexus,
    Nexus__factory,
    RevenueBuyBack,
    SavingsManager,
    SavingsManager__factory,
} from "types/generated"
import { Account } from "types/common"
import { encodeUniswapPath } from "@utils/peripheral/uniswap"
import { btcFormatter, usdFormatter } from "tasks/utils/quantity-formatters"
import { keccak256 } from "@ethersproject/keccak256"
import { toUtf8Bytes } from "ethers/lib/utils"

const voter1VotingPower = BN.from("44461750008245826445414")
const voter2VotingPower = simpleToExactAmount(27527.5)
const voter3VotingPower = BN.from("78211723319712171214037")

const keeperKey = keccak256(toUtf8Bytes("Keeper"))

context("Fork test Emissions Controller on mainnet", () => {
    let ops: Signer
    let governor: Signer
    let voter1: Account
    let voter2: Account
    let voter3: Account
    let treasury: Account
    let emissionsController: EmissionsController
    let nexus: Nexus
    let mta: IERC20

    const setRewardsDistribution = async (recipientAddress: string) => {
        const recipient = InitializableRewardsDistributionRecipient__factory.connect(recipientAddress, governor)
        await recipient.setRewardsDistribution(emissionsController.address)
    }

    const setup = async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 13719000,
                    },
                },
            ],
        })
        ops = await impersonate(resolveAddress("OperationsSigner"))
        governor = await impersonate(resolveAddress("Governor"))
        // 43,700 stkMTA, boosted to 44,461.750008245826445414 voting power
        voter1 = await impersonateAccount("0x8d0f5678557192e23d1da1c689e40f25c063eaa5")
        // 27,527.5 stkMTA not boosted
        voter2 = await impersonateAccount("0xa22fe318725a3858cf5ea4349802537798f0081a")
        voter3 = await impersonateAccount("0x530deFD6c816809F54F6CfA6FE873646F6EcF930") // 82,538.415914215331337512 stkBPT
        treasury = await impersonateAccount("0x3dd46846eed8d147841ae162c8425c08bd8e1b41")

        nexus = Nexus__factory.connect(resolveAddress("Nexus"), governor)
        mta = IERC20__factory.connect(MTA.address, treasury.signer)
    }

    describe("Deploy contracts", () => {
        it("Emissions Controller", async () => {
            await setup()
            emissionsController = await deployEmissionsController(ops, hre)

            expect(await emissionsController.getDialRecipient(0), "dial 0 Staked MTA").to.eq("0x8f2326316eC696F6d023E37A9931c2b2C177a3D7")
            expect(await emissionsController.getDialRecipient(1), "dial 1 Staked mBPT").to.eq("0xeFbe22085D9f29863Cfb77EEd16d3cC0D927b011")
            expect(await emissionsController.getDialRecipient(2), "dial 2 mUSD Vault").to.eq("0x78BefCa7de27d07DC6e71da295Cc2946681A6c7B")
            expect(await emissionsController.getDialRecipient(3), "dial 3 mBTC Vault").to.eq("0xF38522f63f40f9Dd81aBAfD2B8EFc2EC958a3016")
            expect(await emissionsController.getDialRecipient(4), "dial 4 GUSD Vault").to.eq("0xAdeeDD3e5768F7882572Ad91065f93BA88343C99")
            expect(await emissionsController.getDialRecipient(5), "dial 5 BUSD Vault").to.eq("0xD124B55f70D374F58455c8AEdf308E52Cf2A6207")
            expect(await emissionsController.getDialRecipient(6), "dial 6 alUSD Vault").to.eq("0x0997dDdc038c8A958a3A3d00425C16f8ECa87deb")
            expect(await emissionsController.getDialRecipient(7), "dial 7 RAI Vault").to.eq("0xF93e0ddE0F7C48108abbD880DB7697A86169f13b")
            expect(await emissionsController.getDialRecipient(8), "dial 8 FEI Vault").to.eq("0xD24099Eb4CD604198071958655E4f2D263a5539B")
            expect(await emissionsController.getDialRecipient(9), "dial 9 HBTC Vault").to.eq("0xF65D53AA6e2E4A5f4F026e73cb3e22C22D75E35C")
            expect(await emissionsController.getDialRecipient(10), "dial 10 tBTCv2 Vault").to.eq(
                "0x97E2a2F97A2E9a4cFB462a49Ab7c8D205aBB9ed9",
            )

            const dial0Data = await emissionsController.dials(0)
            expect(dial0Data.recipient, "dial 0 recipient").to.eq("0x8f2326316eC696F6d023E37A9931c2b2C177a3D7")
            expect(dial0Data.cap, "dial 0 cap").to.eq(10)
            expect(dial0Data.notify, "dial 0 notify").to.eq(true)

            const dial2Data = await emissionsController.dials(2)
            expect(dial2Data.recipient, "dial 2 recipient").to.eq("0x78BefCa7de27d07DC6e71da295Cc2946681A6c7B")
            expect(dial2Data.cap, "dial 2 cap").to.eq(0)
            expect(dial2Data.notify, "dial 2 notify").to.eq(true)

            const dial9Data = await emissionsController.dials(10)
            expect(dial9Data.recipient, "dial 10 recipient").to.eq("0x97E2a2F97A2E9a4cFB462a49Ab7c8D205aBB9ed9")
            expect(dial9Data.cap, "dial 10 cap").to.eq(0)
            expect(dial9Data.notify, "dial 10 notify").to.eq(true)

            expect(await emissionsController.stakingContracts(0), "first staking contract").to.eq(
                "0x8f2326316eC696F6d023E37A9931c2b2C177a3D7",
            )
            expect(await emissionsController.stakingContracts(1), "second staking contract").to.eq(
                "0xeFbe22085D9f29863Cfb77EEd16d3cC0D927b011",
            )
        })
        it("Deploy BasicRewardsForwarder for Visor Finance Dial", async () => {
            emissionsController = await deployEmissionsController(ops, hre)
            const visorFinanceDial = await deployBasicForwarder(ops, emissionsController.address, "VisorRouter", hre)
            expect(await visorFinanceDial.REWARDS_TOKEN(), "MTA").to.eq(MTA.address)
            expect(await visorFinanceDial.rewardsDistributor(), "Emissions Controller").to.eq(emissionsController.address)
            expect(await visorFinanceDial.endRecipient(), "Visor Finance Router").to.eq("0xF3f4F4e17cC65BDC36A36fDa5283F8D8020Ad0a4")

            const tx = await emissionsController.connect(governor).addDial(visorFinanceDial.address, 0, true)
            await expect(tx).to.emit(emissionsController, "AddedDial").withArgs(11, visorFinanceDial.address)

            expect(await emissionsController.getDialRecipient(11), "dial 11 VisorRouter Vault").to.eq(visorFinanceDial.address)

            const dial9Data = await emissionsController.dials(11)
            expect(dial9Data.recipient, "dial 10 recipient").to.eq(visorFinanceDial.address)
            expect(dial9Data.cap, "dial 10 cap").to.eq(0)
            expect(dial9Data.notify, "dial 10 notify").to.eq(true)
        })
        it("Deploy bridgeForwarder for Polygon mUSD Vault", async () => {
            emissionsController = await deployEmissionsController(ops, hre)
            const bridgeRecipient = Wallet.createRandom()
            const bridgeForwarder = await deployBridgeForwarder(ops, hre, bridgeRecipient.address, emissionsController.address)

            expect(await bridgeForwarder.BRIDGE_RECIPIENT(), "Bridge Recipient").to.eq(bridgeRecipient.address)
            expect(await bridgeForwarder.rewardsDistributor(), "Emissions Controller").to.eq(emissionsController.address)
            expect(await bridgeForwarder.BRIDGE_TOKEN_LOCKER(), "Bridge token locker").to.eq("0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf")
            expect(await bridgeForwarder.ROOT_CHAIN_MANAGER(), "RootChainMananger").to.eq("0xA0c68C638235ee32657e8f720a23ceC1bFc77C77")
            expect(await bridgeForwarder.REWARDS_TOKEN(), "MTA").to.eq(MTA.address)
            expect(await mta.allowance(bridgeForwarder.address, "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf")).to.eq(MAX_UINT256)

            const tx = await emissionsController.connect(governor).addDial(bridgeForwarder.address, 0, true)

            await expect(tx).to.emit(emissionsController, "AddedDial").withArgs(11, bridgeForwarder.address)

            expect(await emissionsController.getDialRecipient(11), "dial 10 Bridge Forwarder").to.eq(bridgeForwarder.address)
        })
    })
    describe("Set vote weights", () => {
        before(async () => {
            await setup()
            emissionsController = await deployEmissionsController(ops, hre)
        })
        it("voter 1", async () => {
            expect(await emissionsController.callStatic.getVotes(voter1.address), "voter 1 total voting power").to.eq(voter1VotingPower)
            const tx = await emissionsController.connect(voter1.signer).setVoterDialWeights([
                {
                    dialId: 0,
                    weight: 120, // 60%
                },
                {
                    dialId: 1,
                    weight: 80, // 40%
                },
            ])
            await expect(tx).to.emit(emissionsController, "PreferencesChanged")

            const dialVotes = await emissionsController.getDialVotes()
            expect(dialVotes[0], "dial 1 votes").to.eq(voter1VotingPower.mul(6).div(10))
            expect(dialVotes[1], "dial 2 votes").to.eq(voter1VotingPower.mul(4).div(10))
            expect(dialVotes[2], "dial 3 votes").to.eq(0)
            expect(dialVotes[9], "dial 10 votes").to.eq(0)
        })
        it("voter 2", async () => {
            expect(await emissionsController.callStatic.getVotes(voter2.address), "voter 2 total voting power").to.eq(voter2VotingPower)
            const tx = await emissionsController.connect(voter2.signer).setVoterDialWeights([
                {
                    dialId: 2,
                    weight: 200, // 100%
                },
            ])
            await expect(tx).to.emit(emissionsController, "PreferencesChanged")

            const dialVotes = await emissionsController.getDialVotes()
            expect(dialVotes[0], "dial 1 votes").to.eq(voter1VotingPower.mul(6).div(10))
            expect(dialVotes[1], "dial 2 votes").to.eq(voter1VotingPower.mul(4).div(10))
            expect(dialVotes[2], "dial 3 votes").to.eq(voter2VotingPower)
            expect(dialVotes[9], "dial 10 votes").to.eq(0)
        })
        it("voter 3", async () => {
            expect(await emissionsController.callStatic.getVotes(voter3.address), "voter 3 total voting power").to.eq(voter3VotingPower)
            const tx = await emissionsController.connect(voter3.signer).setVoterDialWeights([
                {
                    dialId: 1,
                    weight: 200, // 100%
                },
            ])
            await expect(tx).to.emit(emissionsController, "PreferencesChanged")

            const dialVotes = await emissionsController.getDialVotes()
            expect(dialVotes[0], "dial 1 votes").to.eq(voter1VotingPower.mul(6).div(10))
            expect(dialVotes[1], "dial 2 votes").to.eq(voter1VotingPower.mul(4).div(10).add(voter3VotingPower))
            expect(dialVotes[2], "dial 3 votes").to.eq(voter2VotingPower)
            expect(dialVotes[9], "dial 10 votes").to.eq(0)
        })
    })
    describe("calculate rewards", () => {
        before(async () => {
            await setup()
            await nexus.proposeModule(keeperKey, resolveAddress("OperationsSigner"))

            // increase time to 2 December 2021, Thursday 08:00 UTC
            // await increaseTimeTo(1638439200)
            emissionsController = await deployEmissionsController(ops, hre)

            const visorFinanceDial = await deployBasicForwarder(ops, emissionsController.address, "VisorRouter", hre)
            await emissionsController.connect(governor).addDial(visorFinanceDial.address, 0, true)

            // Polygon mUSD Vault
            const mUSDBridgeRecipientAddress = resolveAddress("mUSD", Chain.polygon, "bridgeRecipient")
            const mUSDBridgeForwarder = await deployBridgeForwarder(ops, hre, mUSDBridgeRecipientAddress, emissionsController.address)
            await emissionsController.connect(governor).addDial(mUSDBridgeForwarder.address, 0, true)
            // Polygon FRAX Farm
            const fraxBridgeRecipientAddress = resolveAddress("FRAX", Chain.polygon, "bridgeRecipient")
            const fraxBridgeForwarder = await deployBridgeForwarder(ops, hre, fraxBridgeRecipientAddress, emissionsController.address)
            await emissionsController.connect(governor).addDial(fraxBridgeForwarder.address, 0, true)
            // Polygon Balancer Pool
            const balBridgeRecipientAddress = resolveAddress("BAL", Chain.polygon, "bridgeRecipient")
            const balancerBridgeForwarder = await deployBridgeForwarder(ops, hre, balBridgeRecipientAddress, emissionsController.address)
            await emissionsController.connect(governor).addDial(balancerBridgeForwarder.address, 0, true)

            // Treasury DAO dial
            const treasuryDial = await deployBasicForwarder(ops, emissionsController.address, "mStableDAO", hre, "mStableDAO")
            await emissionsController.connect(governor).addDial(treasuryDial.address, 0, true)

            await mta.connect(treasury.signer).transfer(emissionsController.address, simpleToExactAmount(1000000))

            await setRewardsDistribution(resolveAddress("StakedTokenMTA"))
            await setRewardsDistribution(resolveAddress("StakedTokenBPT"))
            await setRewardsDistribution(mUSD.vault)
            await setRewardsDistribution(mBTC.vault)
            await setRewardsDistribution(GUSD.vault)
            await setRewardsDistribution(BUSD.vault)
            await setRewardsDistribution(alUSD.vault)
            await setRewardsDistribution(RAI.vault)
            await setRewardsDistribution(FEI.vault)
            await setRewardsDistribution(HBTC.vault)
            await setRewardsDistribution(TBTCv2.vault)

            await emissionsController.connect(voter1.signer).setVoterDialWeights([
                {
                    dialId: 0,
                    weight: 10, // 5% which is under the 10% cap
                },
                {
                    dialId: 1,
                    weight: 30, // 15% but will be capped at 10%
                },
                {
                    dialId: 3,
                    weight: 100, // 50%
                },
                {
                    dialId: 4,
                    weight: 40, // 20% so 10% is unallocated
                },
            ])
            await emissionsController.connect(voter2.signer).setVoterDialWeights([
                {
                    dialId: 5,
                    weight: 40, // 20%
                },
                {
                    dialId: 6,
                    weight: 40, // 20%
                },
                {
                    dialId: 7,
                    weight: 40, // 20%
                },
                {
                    dialId: 8,
                    weight: 40, // 20%
                },
                {
                    dialId: 9,
                    weight: 40, // 20%
                },
            ])
            await emissionsController.connect(voter2.signer).setVoterDialWeights([
                {
                    dialId: 10,
                    weight: 40, // 20%
                },
                {
                    dialId: 11,
                    weight: 40, // 20%
                },
                {
                    dialId: 12,
                    weight: 40, // 20%
                },
                {
                    dialId: 13,
                    weight: 40, // 20%
                },
                {
                    dialId: 14,
                    weight: 30, // 15%
                },
                {
                    dialId: 15,
                    weight: 10, // 5%
                },
            ])

            await increaseTime(ONE_WEEK.add(ONE_HOUR))
            await nexus.acceptProposedModule(keeperKey)
        })
        it("immediately", async () => {
            const tx = emissionsController.calculateRewards()
            await expect(tx).to.revertedWith("Must wait for new period")
        })
        it("after 2 weeks", async () => {
            await increaseTime(ONE_WEEK)

            const currentEpochIndex = await currentWeekEpoch()
            const totalRewardsExpected = await emissionsController.topLineEmission(currentEpochIndex)
            expect(totalRewardsExpected, "First distribution rewards").to.gt(simpleToExactAmount(165000)).lt(simpleToExactAmount(166000))

            const tx = await emissionsController.calculateRewards()

            const weightedVotes = await emissionsController.getDialVotes()
            const totalWeightedVotes = weightedVotes.reduce((prev, curr) => prev.add(curr), BN.from(0))

            const receipt = await tx.wait()
            const distributionAmounts: BN[] = receipt.events[0].args.amounts
            console.log(distributionAmounts)

            await expect(tx).to.emit(emissionsController, "PeriodRewards")

            expect(distributionAmounts, "number of dials").to.lengthOf(16)
            const totalRewardsActual = distributionAmounts.reduce((prev, curr) => prev.add(curr), BN.from(0))
            assertBNClose(totalRewardsActual, totalRewardsExpected, 10, "total rewards")

            distributionAmounts.forEach((disAmount, i) => {
                assertBNClose(disAmount, totalRewardsExpected.mul(weightedVotes[i]).div(totalWeightedVotes), 10, `dial i amount`)
            })
            expect(distributionAmounts[2], "dial 2 amount").to.eq(0)
        })
        it("distribute rewards", async () => {
            const tx = await emissionsController.distributeRewards([...Array(15).keys()])
            await expect(tx).to.emit(emissionsController, "DistributedReward")
        })
    })
    describe("distribute rewards", () => {
        let bridgeForwarder: BridgeForwarder
        const bridgeAmount = simpleToExactAmount(10000)

        before(async () => {
            await setup()
            emissionsController = await deployEmissionsController(ops, hre)

            await nexus.proposeModule(keeperKey, resolveAddress("OperationsSigner"))

            const visorFinanceDial = await deployBasicForwarder(ops, emissionsController.address, "VisorRouter", hre)
            await emissionsController.connect(governor).addDial(visorFinanceDial.address, 0, true)
            const bridgeRecipient = Wallet.createRandom()
            bridgeForwarder = await deployBridgeForwarder(ops, hre, bridgeRecipient.address, emissionsController.address)
            await emissionsController.connect(governor).addDial(bridgeForwarder.address, 0, true)

            await mta.approve(emissionsController.address, simpleToExactAmount(100000))
            await emissionsController
                .connect(treasury.signer)
                .donate(
                    [0, 1, 2, 3, 10, 11, 12],
                    [
                        simpleToExactAmount(100),
                        simpleToExactAmount(1000),
                        simpleToExactAmount(2000),
                        simpleToExactAmount(3000),
                        simpleToExactAmount(8000),
                        simpleToExactAmount(9000),
                        bridgeAmount,
                    ],
                )

            await setRewardsDistribution(resolveAddress("StakedTokenMTA"))
            await setRewardsDistribution(resolveAddress("StakedTokenBPT"))
            await setRewardsDistribution(mUSD.vault)
            await setRewardsDistribution(mBTC.vault)
            await setRewardsDistribution(GUSD.vault)
            await setRewardsDistribution(RAI.vault)
            await setRewardsDistribution(HBTC.vault)
            await setRewardsDistribution(TBTCv2.vault)

            await increaseTime(ONE_WEEK.add(ONE_HOUR))
            await nexus.acceptProposedModule(keeperKey)
        })
        it("distribute rewards to staking contracts", async () => {
            const tx = await emissionsController.distributeRewards([0, 1])
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(0, simpleToExactAmount(100))
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(1, simpleToExactAmount(1000))
        })
        it("distribute rewards to vaults", async () => {
            const tx = await emissionsController.distributeRewards([2, 3, 4, 10])
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(2, simpleToExactAmount(2000))
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(3, simpleToExactAmount(3000))
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(10, simpleToExactAmount(8000))
        })
        it("distribute rewards to bridge forwarder", async () => {
            const bridgeTokenLockerAddress = resolveAddress("PolygonPoSBridge")
            const mtaECBalanceBefore = await mta.balanceOf(emissionsController.address)
            const mtaBridgeBalanceBefore = await mta.balanceOf(bridgeTokenLockerAddress)
            expect(await mta.allowance(bridgeForwarder.address, bridgeTokenLockerAddress), "bridge forwarder MTA allowance").to.eq(
                MAX_UINT256,
            )
            expect(await mta.balanceOf(bridgeForwarder.address), "bridge forwarder MAT bal before").to.eq(0)

            // Distribute rewards
            const tx = await emissionsController.distributeRewards([12])

            // Check events
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(12, bridgeAmount)
            await expect(tx).to.emit(bridgeForwarder, "Forwarded").withArgs(bridgeAmount)

            // Check MTA balances
            expect(await mta.balanceOf(emissionsController.address), "emissions controller MTA bal after").to.eq(
                mtaECBalanceBefore.sub(bridgeAmount),
            )
            expect(await mta.balanceOf(bridgeTokenLockerAddress), "bridge token locker MTA bal after").to.eq(
                mtaBridgeBalanceBefore.add(bridgeAmount),
            )
            expect(await mta.balanceOf(bridgeForwarder.address), "bridge forwarder MAT bal after").to.eq(0)
        })
    })
    describe("Buy back MTA using mUSD and mBTC revenue", () => {
        let revenueBuyBack: RevenueBuyBack
        let savingsManager: SavingsManager
        let mtaToken: IERC20
        const uniswapEthToken = resolveAddress("UniswapEthToken")
        const musdUniswapPath = encodeUniswapPath([USDC.address, uniswapEthToken, MTA.address], [3000, 3000])
        // const mbtcUniswapPath = encodeUniswapPath([WBTC.address, uniswapEthToken, MTA.address], [3000, 3000])
        const mbtcUniswapPath = encodeUniswapPath([WBTC.address, uniswapEthToken, DAI.address, MTA.address], [3000, 3000, 3000])

        // mUSD using the USDC ETH MTA path
        // mUSD 21,053.556530642849297881
        // USDC 21,057.018162
        // MTA  11,189.215231409728410490
        // 11,189e18 MTA / 21,057e6 USDC = 1.88e-12 MTA/USDC * 1e18 = 1.88e6
        // 21,057e6 USDC / 11,189e18 MTA = 0.531e12 USDC/MTA * 1e18 = 53e28

        // mBTC using the WBTC ETH MTA path
        // mBTC 0.041549293921291504
        // WBTC 0.04147372
        // MTA 1,853.249858943570063685
        // 1,853e18 MTA / 0.04147372e8 WBTC = 2.2378e-5 * 1e18 = 2.2378e13
        // 0.04147372e8 WBTC / 1,853e18 MTA = 44685e10 * 1e18 = 4.46e14 * 1e18 = 4.46e32 = 446e30

        before(async () => {
            await setup()
            await nexus.proposeModule(keeperKey, resolveAddress("OperationsSigner"))

            emissionsController = await deployEmissionsController(ops, hre)
            mtaToken = IERC20__factory.connect(MTA.address, ops)
            revenueBuyBack = await deployRevenueBuyBack(ops, hre, emissionsController.address)

            await increaseTime(ONE_WEEK.add(ONE_HOUR))
            await nexus.acceptProposedModule(keeperKey)
        })
        it("check Uniswap USDC to MTA price", async () => {
            const uniswapQuoterAddress = resolveAddress("UniswapQuoterV3")
            const uniswapQuoter = IUniswapV3Quoter__factory.connect(uniswapQuoterAddress, ops)
            const mtaAmount = await uniswapQuoter.callStatic.quoteExactInput(
                musdUniswapPath.encoded,
                simpleToExactAmount(10000, USDC.decimals),
            )
            console.log(`${usdFormatter(mtaAmount)} MTA (${usdFormatter(mtaAmount.div(10000))} USDC/MTA)`)
        })
        it("check Uniswap WBTC to MTA price", async () => {
            const uniswapQuoterAddress = resolveAddress("UniswapQuoterV3")
            const uniswapQuoter = IUniswapV3Quoter__factory.connect(uniswapQuoterAddress, ops)
            const wbtcMtaPrice = await uniswapQuoter.callStatic.quoteExactInput(
                mbtcUniswapPath.encoded,
                simpleToExactAmount(0.05, WBTC.decimals),
            )
            console.log(`${btcFormatter(wbtcMtaPrice)} MTA (${usdFormatter(wbtcMtaPrice.div(2))} WBTC/MTA)`)
        })
        it("Post deploy checks", async () => {
            expect(await revenueBuyBack.REWARDS_TOKEN()).to.eq(MTA.address)
            expect(await revenueBuyBack.EMISSIONS_CONTROLLER()).to.eq(emissionsController.address)
        })
        describe("fail to buy rewards from", () => {
            before(async () => {
                await revenueBuyBack
                    .connect(governor)
                    .setMassetConfig(
                        mUSD.address,
                        USDC.address,
                        simpleToExactAmount(98, 4),
                        simpleToExactAmount(5, 29),
                        musdUniswapPath.encoded,
                    )
                await revenueBuyBack
                    .connect(governor)
                    .setMassetConfig(
                        mBTC.address,
                        WBTC.address,
                        simpleToExactAmount(98, 6),
                        simpleToExactAmount(3, 32),
                        mbtcUniswapPath.encoded,
                    )
                savingsManager = SavingsManager__factory.connect(resolveAddress("SavingsManager"), governor)
            })
            context("mUSD", () => {
                before(async () => {
                    await savingsManager.setRevenueRecipient(mUSD.address, revenueBuyBack.address)
                    await savingsManager.distributeUnallocatedInterest(mUSD.address)
                })
                it("as minMasset2BassetPrice is too high", async () => {
                    await revenueBuyBack.connect(governor).setMassetConfig(
                        mUSD.address,
                        USDC.address,
                        simpleToExactAmount(102, 4), // min 1.02 USDC from 1 MTA
                        simpleToExactAmount(8, 29),
                        musdUniswapPath.encoded,
                    )
                    const tx = revenueBuyBack.buyBackRewards([mUSD.address])
                    await expect(tx).to.revertedWith("bAsset qty < min qty")
                    expect(await mtaToken.balanceOf(revenueBuyBack.address), "RevenueBuyBack MTA bal after").to.eq(0)
                })
                it("as minBasset2RewardsPrice is too high", async () => {
                    await revenueBuyBack.connect(governor).setMassetConfig(
                        mUSD.address,
                        USDC.address,
                        simpleToExactAmount(98, 4),
                        simpleToExactAmount(66, 28), // min 0.66 USDC for 1 MTA to 30 decimal places
                        musdUniswapPath.encoded,
                    )
                    const tx = revenueBuyBack.buyBackRewards([mUSD.address])
                    await expect(tx).to.revertedWith("Too little received")
                    expect(await mtaToken.balanceOf(revenueBuyBack.address), "RevenueBuyBack MTA bal after").to.eq(0)
                })
            })
            context("mBTC", () => {
                before(async () => {
                    await savingsManager.setRevenueRecipient(mBTC.address, revenueBuyBack.address)
                    await savingsManager.distributeUnallocatedInterest(mBTC.address)
                })
                it("as minMasset2BassetPrice is too high", async () => {
                    await revenueBuyBack.connect(governor).setMassetConfig(
                        mBTC.address,
                        WBTC.address,
                        simpleToExactAmount(101, 6), // 1.01
                        simpleToExactAmount(50, 13),
                        mbtcUniswapPath.encoded,
                    )
                    const tx = revenueBuyBack.buyBackRewards([mBTC.address])
                    await expect(tx).to.revertedWith("bAsset qty < min qty")
                    expect(await mtaToken.balanceOf(revenueBuyBack.address), "RevenueBuyBack MTA bal after").to.eq(0)
                })
                it("as minBasset2RewardsPrice is too high", async () => {
                    await revenueBuyBack.connect(governor).setMassetConfig(
                        mBTC.address,
                        WBTC.address,
                        simpleToExactAmount(98, 6),
                        simpleToExactAmount(46, 31), // 446e30
                        mbtcUniswapPath.encoded,
                    )
                    const tx = revenueBuyBack.buyBackRewards([mBTC.address])
                    await expect(tx).to.revertedWith("Too little received")
                    expect(await mtaToken.balanceOf(revenueBuyBack.address), "RevenueBuyBack MTA bal after").to.eq(0)
                })
            })
        })
        describe("buy rewards from", () => {
            before(async () => {
                await revenueBuyBack
                    .connect(governor)
                    .setMassetConfig(
                        mUSD.address,
                        USDC.address,
                        simpleToExactAmount(98, 4),
                        simpleToExactAmount(5, 29),
                        musdUniswapPath.encoded,
                    )
                await revenueBuyBack
                    .connect(governor)
                    .setMassetConfig(
                        mBTC.address,
                        WBTC.address,
                        simpleToExactAmount(98, 6),
                        simpleToExactAmount(3, 32),
                        mbtcUniswapPath.encoded,
                    )

                savingsManager = SavingsManager__factory.connect(resolveAddress("SavingsManager"), governor)
                await savingsManager.setRevenueRecipient(mUSD.address, revenueBuyBack.address)
                await savingsManager.setRevenueRecipient(mBTC.address, revenueBuyBack.address)
            })
            it("buy rewards from mUSD", async () => {
                const tx = await savingsManager.distributeUnallocatedInterest(mUSD.address)
                await expect(tx).to.emit(revenueBuyBack, "RevenueReceived")

                const tx2 = await revenueBuyBack.buyBackRewards([mUSD.address])
                await expect(tx2).to.emit(revenueBuyBack, "BuyBackRewards")
                expect(await mtaToken.balanceOf(revenueBuyBack.address), "RevenueBuyBack MTA bal after").to.gt(0)
            })
            it("buy rewards from mBTC", async () => {
                const tx = await savingsManager.distributeUnallocatedInterest(mBTC.address)
                await expect(tx).to.emit(revenueBuyBack, "RevenueReceived")

                const tx2 = await revenueBuyBack.buyBackRewards([mBTC.address])
                await expect(tx2).to.emit(revenueBuyBack, "BuyBackRewards")
                expect(await mtaToken.balanceOf(revenueBuyBack.address), "RevenueBuyBack MTA bal after").to.gt(0)
            })
        })
    })
})
