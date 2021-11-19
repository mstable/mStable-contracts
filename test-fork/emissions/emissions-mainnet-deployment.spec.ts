import { network } from "hardhat"
import * as hre from "hardhat"

import { impersonate, impersonateAccount } from "@utils/fork"
import { Signer, Wallet } from "ethers"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { deployBridgeForwarder, deployEmissionsController } from "tasks/utils/emissions-utils"
import { expect } from "chai"
import { BN, simpleToExactAmount } from "@utils/math"
import { currentWeekEpoch, increaseTime, increaseTimeTo } from "@utils/time"
import { MAX_UINT256, ONE_WEEK } from "@utils/constants"
import { assertBNClose } from "@utils/assertions"
import { GUSD, HBTC, mBTC, MTA, mUSD } from "tasks/utils/tokens"
import {
    BridgeForwarder,
    EmissionsController,
    IERC20,
    IERC20__factory,
    InitializableRewardsDistributionRecipient__factory,
    IRootChainManager__factory,
} from "types/generated"
import { Account } from "types/common"

const staker1VotingPower = BN.from("44461750008245826445414")

context("Fork test Emissions Controller on mainnet", () => {
    let ops: Signer
    let governor: Signer
    let staker1: Account
    let staker2: Account
    let staker3: Account
    let treasury: Account
    let emissionsController: EmissionsController
    let mta: IERC20
    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 13636458,
                    },
                },
            ],
        })
        ops = await impersonate(resolveAddress("OperationsSigner"))
        governor = await impersonate(resolveAddress("Governor"))
        // 43,700 stkMTA, boosted to 44,461.750008245826445414 voting power
        staker1 = await impersonateAccount("0x8d0f5678557192e23d1da1c689e40f25c063eaa5")
        // 27,527.5 stkMTA not boosted
        staker2 = await impersonateAccount("0xa22fe318725a3858cf5ea4349802537798f0081a")
        staker3 = await impersonateAccount("0x530deFD6c816809F54F6CfA6FE873646F6EcF930") // 82,538.415914215331337512 stkBPT
        treasury = await impersonateAccount("0x3dd46846eed8d147841ae162c8425c08bd8e1b41")

        mta = IERC20__factory.connect(MTA.address, treasury.signer)
    })
    describe("Deploy contracts", () => {
        it("Emissions Controller", async () => {
            emissionsController = await deployEmissionsController(ops, hre)

            expect(await emissionsController.getDialRecipient(0), "dial 0 Staked MTA").to.eq("0x8f2326316eC696F6d023E37A9931c2b2C177a3D7")
            expect(await emissionsController.getDialRecipient(1), "dial 1 Staked mBPT").to.eq("0xeFbe22085D9f29863Cfb77EEd16d3cC0D927b011")
            expect(await emissionsController.getDialRecipient(2), "dial 2 mUSD Vault").to.eq("0x78BefCa7de27d07DC6e71da295Cc2946681A6c7B")
            expect(await emissionsController.getDialRecipient(3), "dial 3 mBTC Vault").to.eq("0xF38522f63f40f9Dd81aBAfD2B8EFc2EC958a3016")
            expect(await emissionsController.getDialRecipient(4), "dial 4 GUSD Vault").to.eq("0xAdeeDD3e5768F7882572Ad91065f93BA88343C99")
            expect(await emissionsController.getDialRecipient(5), "dial 5 BUSD Vault").to.eq("0xD124B55f70D374F58455c8AEdf308E52Cf2A6207")
            expect(await emissionsController.getDialRecipient(6), "dial 6 alUSD Vault").to.eq("0x0997dDdc038c8A958a3A3d00425C16f8ECa87deb")
            expect(await emissionsController.getDialRecipient(7), "dial 7 tBTCv2 Vault").to.eq("0x97E2a2F97A2E9a4cFB462a49Ab7c8D205aBB9ed9")
            expect(await emissionsController.getDialRecipient(8), "dial 8 HBTC Vault").to.eq("0xF65D53AA6e2E4A5f4F026e73cb3e22C22D75E35C")
            expect(await emissionsController.getDialRecipient(9), "dial 9 VisorRouter Vault").to.eq(
                "0xF3f4F4e17cC65BDC36A36fDa5283F8D8020Ad0a4",
            )

            const dial0Data = await emissionsController.dials(0)
            expect(dial0Data.recipient, "dial 0 recipient").to.eq("0x8f2326316eC696F6d023E37A9931c2b2C177a3D7")
            expect(dial0Data.cap, "dial 0 cap").to.eq(10)
            expect(dial0Data.notify, "dial 0 notify").to.eq(true)

            const dial2Data = await emissionsController.dials(2)
            expect(dial2Data.recipient, "dial 2 recipient").to.eq("0x78BefCa7de27d07DC6e71da295Cc2946681A6c7B")
            expect(dial2Data.cap, "dial 2 cap").to.eq(0)
            expect(dial2Data.notify, "dial 2 notify").to.eq(true)

            const dial9Data = await emissionsController.dials(9)
            expect(dial9Data.recipient, "dial 9 recipient").to.eq("0xF3f4F4e17cC65BDC36A36fDa5283F8D8020Ad0a4")
            expect(dial9Data.cap, "dial 9 cap").to.eq(0)
            expect(dial9Data.notify, "dial 9 notify").to.eq(false)

            expect(await emissionsController.stakingContracts(0), "first staking contract").to.eq(
                "0x8f2326316eC696F6d023E37A9931c2b2C177a3D7",
            )
            expect(await emissionsController.stakingContracts(1), "second staking contract").to.eq(
                "0xeFbe22085D9f29863Cfb77EEd16d3cC0D927b011",
            )
        })
        context("Deploy bridgeForwarder", () => {
            before(async () => {
                emissionsController = await deployEmissionsController(ops, hre)
            })
            it("Polygon mUSD Vault bridgeForwarder", async () => {
                const bridgeRecipient = Wallet.createRandom()
                const bridgeForwarder = await deployBridgeForwarder(ops, hre, bridgeRecipient.address, emissionsController.address)

                expect(await bridgeForwarder.BRIDGE_RECIPIENT(), "Bridge Recipient").to.eq(bridgeRecipient.address)
                expect(await bridgeForwarder.rewardsDistributor(), "Emissions Controller").to.eq(emissionsController.address)
                expect(await bridgeForwarder.BRIDGE_TOKEN_LOCKER(), "Bridge token locker").to.eq(
                    "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf",
                )
                expect(await bridgeForwarder.ROOT_CHAIN_MANAGER(), "RootChainMananger").to.eq("0xA0c68C638235ee32657e8f720a23ceC1bFc77C77")
                expect(await bridgeForwarder.REWARDS_TOKEN(), "MTA").to.eq(MTA.address)
                expect(await mta.allowance(bridgeForwarder.address, "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf")).to.eq(MAX_UINT256)

                await emissionsController.connect(governor).addDial(bridgeForwarder.address, 0, true)
            })
        })
    })
    describe("Set vote weights", () => {
        before(async () => {
            emissionsController = await deployEmissionsController(ops, hre)
        })
        it("staker 1", async () => {
            expect(await emissionsController.callStatic.getVotes(staker1.address), "staker 1 total voting power").to.eq(staker1VotingPower)
            const tx = await emissionsController.connect(staker1.signer).setVoterDialWeights([
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
            const dialData = await emissionsController.dials(0)
        })
        it("staker 2", async () => {
            expect(await emissionsController.callStatic.getVotes(staker2.address), "staker 2 total voting power").to.eq(
                simpleToExactAmount(27527.5),
            )
            const tx = await emissionsController.connect(staker2.signer).setVoterDialWeights([
                {
                    dialId: 2,
                    weight: 200, // 100%
                },
            ])
            await expect(tx).to.emit(emissionsController, "PreferencesChanged")
        })
        it("staker 3", async () => {
            expect(await emissionsController.callStatic.getVotes(staker3.address), "staker 3 total voting power").to.eq(
                "82538415914215331337512",
            )
            const tx = await emissionsController.connect(staker3.signer).setVoterDialWeights([
                {
                    dialId: 1,
                    weight: 100, // 100%
                },
            ])
            await expect(tx).to.emit(emissionsController, "PreferencesChanged")
        })
    })
    describe("calculate rewards", () => {
        before(async () => {
            // increase time to 2 December 2021, Thursday 08:00 UTC
            await increaseTimeTo(1638439200)
            emissionsController = await deployEmissionsController(ops, hre)
            await emissionsController.connect(staker1.signer).setVoterDialWeights([
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
        })
        it("immediately", async () => {
            const tx = emissionsController.calculateRewards()
            await expect(tx).to.revertedWith("Must wait for new period")
        })
        it("after 2 weeks", async () => {
            await increaseTime(ONE_WEEK.mul(2))
            const currentEpochIndex = await currentWeekEpoch()
            const totalRewardsExpected = await emissionsController.topLineEmission(currentEpochIndex)
            expect(totalRewardsExpected, "First distribution rewards").to.gt(simpleToExactAmount(165000)).lt(simpleToExactAmount(166000))

            const tx = await emissionsController.calculateRewards()

            const receipt = await tx.wait()
            const distributionAmounts: BN[] = receipt.events[0].args.amounts
            console.log(distributionAmounts)

            await expect(tx).to.emit(emissionsController, "PeriodRewards")

            const totalREwardsActual = distributionAmounts.reduce((prev, curr) => prev.add(curr), BN.from(0))
            // expect(totalREwardsActual, "total rewards").to.eq(totalRewardsExpected)
            assertBNClose(totalREwardsActual, totalRewardsExpected, 2, "total rewards")

            expect(distributionAmounts, "number of dials").to.lengthOf(10)
            // Dial over cap so get 10% of the distribution
            const dial1AmountExpected = totalRewardsExpected.mul(10).div(100)
            assertBNClose(distributionAmounts[1], dial1AmountExpected, 100, "dial 1 amount")

            // remaining rewards to be distributed after dials over cap have got their distribution
            const remainingRewards = totalRewardsExpected.sub(dial1AmountExpected)
            // Total votes = 90 - 15 = 75
            assertBNClose(distributionAmounts[0], remainingRewards.mul(5).div(75), 100, "dial 0 amount")
            expect(distributionAmounts[2], "dial 2 amount").to.eq(0)
            assertBNClose(distributionAmounts[3], remainingRewards.mul(50).div(75), 100, "dial 3 amount")
            assertBNClose(distributionAmounts[4], remainingRewards.mul(20).div(75), 100, "dial 4 amount")
            expect(distributionAmounts[5], "dial 5 amount").to.eq(0)
            expect(distributionAmounts[9], "dial 9 amount").to.eq(0)
        })
    })
    describe("distribute rewards", () => {
        let bridgeForwarder: BridgeForwarder
        const setRewardsDistribution = async (recipientAddress: string) => {
            const recipient = InitializableRewardsDistributionRecipient__factory.connect(recipientAddress, governor)
            await recipient.setRewardsDistribution(emissionsController.address)
        }
        const bridgeAmount = simpleToExactAmount(10000)

        before(async () => {
            emissionsController = await deployEmissionsController(ops, hre)
            const bridgeRecipient = Wallet.createRandom()
            bridgeForwarder = await deployBridgeForwarder(ops, hre, bridgeRecipient.address, emissionsController.address)
            await emissionsController.connect(governor).addDial(bridgeForwarder.address, 0, true)

            await mta.approve(emissionsController.address, simpleToExactAmount(100000))
            await emissionsController
                .connect(treasury.signer)
                .donate(
                    [0, 1, 2, 3, 8, 9, 10],
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
            await setRewardsDistribution(HBTC.vault)
        })
        it("distribute rewards to staking contracts", async () => {
            const tx = await emissionsController.distributeRewards([0, 1])
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(0, simpleToExactAmount(100))
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(1, simpleToExactAmount(1000))
        })
        it("distribute rewards to vaults", async () => {
            const tx = await emissionsController.distributeRewards([2, 3, 4, 8])
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(2, simpleToExactAmount(2000))
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(3, simpleToExactAmount(3000))
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(8, simpleToExactAmount(8000))
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
            const tx = await emissionsController.distributeRewards([10])

            // Check events
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(10, bridgeAmount)
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
    describe("Buy back MTA using mUSD and mBTC revenue", () => {})
})
