/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-plusplus */
import { Wallet } from "@ethersproject/wallet"
import { DEAD_ADDRESS, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BN, increaseTime, simpleToExactAmount } from "index"
import { MCCP24_CONFIG } from "tasks/utils/emissions-utils"
import {
    AssetProxy__factory,
    L2EmissionsController,
    L2EmissionsController__factory,
    EmissionsController,
    EmissionsController__factory,
    IRootChainManager,
    MockERC20,
    MockERC20__factory,
    MockNexus,
    MockNexus__factory,
    MockRewardsDistributionRecipient,
    MockRewardsDistributionRecipient__factory,
    MockRootChainManager__factory,
    MockStakingContract,
    MockStakingContract__factory,
    L2BridgeRecipient,
    BridgeForwarder,
    BridgeForwarder__factory,
    L2BridgeRecipient__factory,
} from "types/generated"

describe("EmissionsController Polygon Integration", async () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let staking1: MockStakingContract
    let staking2: MockStakingContract
    let rewardToken: MockERC20
    let emissionsController: EmissionsController
    let rootChainManager: IRootChainManager
    const bridgeTokenLocker = Wallet.createRandom()
    const totalRewardsSupply = simpleToExactAmount(100000000)
    const totalRewards = simpleToExactAmount(29400963)

    const deployEmissionsController = async (): Promise<void> => {
        // staking contracts
        staking1 = await new MockStakingContract__factory(sa.default.signer).deploy()
        staking2 = await new MockStakingContract__factory(sa.default.signer).deploy()

        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, totalRewardsSupply)

        // Deploy logic contract
        const emissionsControllerImpl = await new EmissionsController__factory(sa.default.signer).deploy(
            nexus.address,
            rewardToken.address,
            MCCP24_CONFIG,
        )

        // Deploy proxy and initialize
        const initializeData = await emissionsControllerImpl.interface.encodeFunctionData("initialize", [
            [],
            [],
            [],
            [staking1.address, staking2.address],
        ])
        const proxy = await new AssetProxy__factory(sa.default.signer).deploy(emissionsControllerImpl.address, DEAD_ADDRESS, initializeData)
        emissionsController = new EmissionsController__factory(sa.default.signer).attach(proxy.address)

        await rewardToken.transfer(emissionsController.address, totalRewards)

        await staking1.setGovernanceHook(emissionsController.address)
        await staking2.setGovernanceHook(emissionsController.address)

        rootChainManager = await new MockRootChainManager__factory(sa.default.signer).deploy()
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        console.log(`User 1 ${sa.dummy1.address}`)
        console.log(`User 2 ${sa.dummy2.address}`)
        console.log(`User 3 ${sa.dummy3.address}`)
    })
    describe("deploy Polygon Root Recipient", () => {
        beforeEach(async () => {
            await deployEmissionsController()
        })
        it("successful deploy", async () => {
            await new BridgeForwarder__factory(sa.default.signer).deploy(
                nexus.address,
                rewardToken.address,
                bridgeTokenLocker.address,
                rootChainManager.address,
                Wallet.createRandom().address,
            )
        })
        it("fail when zero nexus", async () => {
            const tx = new BridgeForwarder__factory(sa.default.signer).deploy(
                ZERO_ADDRESS,
                rewardToken.address,
                bridgeTokenLocker.address,
                rootChainManager.address,
                sa.dummy1.address,
            )
            await expect(tx).to.revertedWith("Nexus address is zero")
        })
        it("fail when zero rewards token", async () => {
            const tx = new BridgeForwarder__factory(sa.default.signer).deploy(
                nexus.address,
                ZERO_ADDRESS,
                bridgeTokenLocker.address,
                rootChainManager.address,
                sa.dummy1.address,
            )
            await expect(tx).to.revertedWith("Rewards token is zero")
        })
        it("fail when zero bridge token locker", async () => {
            const tx = new BridgeForwarder__factory(sa.default.signer).deploy(
                nexus.address,
                rewardToken.address,
                ZERO_ADDRESS,
                rootChainManager.address,
                sa.dummy1.address,
            )
            await expect(tx).to.revertedWith("Bridge locker is zero")
        })
        it("fail when zero root chain manager", async () => {
            const tx = new BridgeForwarder__factory(sa.default.signer).deploy(
                nexus.address,
                rewardToken.address,
                bridgeTokenLocker.address,
                ZERO_ADDRESS,
                sa.dummy1.address,
            )
            await expect(tx).to.revertedWith("RootChainManager is zero")
        })
        it("fail when zero bridge recipient", async () => {
            const tx = new BridgeForwarder__factory(sa.default.signer).deploy(
                nexus.address,
                rewardToken.address,
                bridgeTokenLocker.address,
                rootChainManager.address,
                ZERO_ADDRESS,
            )
            await expect(tx).to.revertedWith("Bridge recipient is zero")
        })
    })
    describe("distribute rewards via bridge", () => {
        const bridgeRecipient1 = Wallet.createRandom()
        const bridgeRecipient2 = Wallet.createRandom()
        let rootRecipient1: BridgeForwarder
        let rootRecipient2: BridgeForwarder
        beforeEach(async () => {
            await deployEmissionsController()

            const rootRecipient1Impl = await new BridgeForwarder__factory(sa.default.signer).deploy(
                nexus.address,
                rewardToken.address,
                rootChainManager.address,
                rootChainManager.address,
                bridgeRecipient1.address,
            )
            const data1 = rootRecipient1Impl.interface.encodeFunctionData("initialize", [emissionsController.address])
            const proxy1 = await new AssetProxy__factory(sa.default.signer).deploy(rootRecipient1Impl.address, DEAD_ADDRESS, data1)
            rootRecipient1 = new BridgeForwarder__factory(sa.default.signer).attach(proxy1.address)

            const rootRecipient2Impl = await new BridgeForwarder__factory(sa.default.signer).deploy(
                nexus.address,
                rewardToken.address,
                rootChainManager.address,
                rootChainManager.address,
                bridgeRecipient2.address,
            )
            const data2 = rootRecipient2Impl.interface.encodeFunctionData("initialize", [emissionsController.address])
            const proxy2 = await new AssetProxy__factory(sa.default.signer).deploy(rootRecipient2Impl.address, DEAD_ADDRESS, data2)
            rootRecipient2 = new BridgeForwarder__factory(sa.default.signer).attach(proxy2.address)

            await emissionsController.connect(sa.governor.signer).addDial(rootRecipient1.address, 0, true)
            await emissionsController.connect(sa.governor.signer).addDial(rootRecipient2.address, 0, true)
            await increaseTime(ONE_WEEK.mul(2))
        })
        it("to first polygon recipient", async () => {
            expect(await rewardToken.balanceOf(rootRecipient1.address), "recipient 1 balance before").to.eq(0)
            expect(await rewardToken.balanceOf(rootChainManager.address), "root chain manager balance before").to.eq(0)

            const amountRecipient1 = simpleToExactAmount(1000)
            await rewardToken.approve(emissionsController.address, amountRecipient1)
            await emissionsController.donate([0], [amountRecipient1])

            const tx = await emissionsController.distributeRewards([0])

            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(0, amountRecipient1)
            await expect(tx)
                .to.emit(rootChainManager, "DepositFor")
                .withArgs(bridgeRecipient1.address, rewardToken.address, amountRecipient1)

            expect(await rewardToken.balanceOf(rootRecipient1.address), "recipient 1 balance after").to.eq(0)
            expect(await rewardToken.balanceOf(rootChainManager.address), "root chain manager balance after").to.eq(amountRecipient1)
        })
        it("to both polygon recipients", async () => {
            expect(await rewardToken.balanceOf(rootRecipient1.address), "recipient 1 balance before").to.eq(0)
            expect(await rewardToken.balanceOf(rootRecipient2.address), "recipient 2 balance before").to.eq(0)
            expect(await rewardToken.balanceOf(rootChainManager.address), "root chain manager balance before").to.eq(0)

            const amountRecipient1 = simpleToExactAmount(1000)
            const amountRecipient2 = simpleToExactAmount(2000)
            await rewardToken.approve(emissionsController.address, amountRecipient1.add(amountRecipient2))
            await emissionsController.donate([0, 1], [amountRecipient1, amountRecipient2])

            const tx = await emissionsController.distributeRewards([0, 1])

            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(0, amountRecipient1)
            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(1, amountRecipient2)
            await expect(tx)
                .to.emit(rootChainManager, "DepositFor")
                .withArgs(bridgeRecipient1.address, rewardToken.address, amountRecipient1)
            await expect(tx)
                .to.emit(rootChainManager, "DepositFor")
                .withArgs(bridgeRecipient2.address, rewardToken.address, amountRecipient2)

            expect(await rewardToken.balanceOf(rootRecipient1.address), "recipient 1 balance after").to.eq(0)
            expect(await rewardToken.balanceOf(rootRecipient1.address), "recipient 2 balance after").to.eq(0)
            expect(await rewardToken.balanceOf(rootChainManager.address), "root chain manager balance after").to.eq(
                amountRecipient1.add(amountRecipient2),
            )
        })
        it("zero to first polygon recipient and 2000 to second", async () => {
            expect(await rewardToken.balanceOf(rootRecipient1.address), "recipient 1 balance before").to.eq(0)
            expect(await rewardToken.balanceOf(rootRecipient2.address), "recipient 2 balance before").to.eq(0)
            expect(await rewardToken.balanceOf(rootChainManager.address), "root chain manager balance before").to.eq(0)

            const amountRecipient1 = BN.from(0)
            const amountRecipient2 = simpleToExactAmount(2000)
            await rewardToken.approve(emissionsController.address, amountRecipient1.add(amountRecipient2))
            await emissionsController.donate([0, 1], [amountRecipient1, amountRecipient2])

            const tx = await emissionsController.distributeRewards([0, 1])

            await expect(tx).to.emit(emissionsController, "DistributedReward").withArgs(1, amountRecipient2)
            await expect(tx)
                .to.emit(rootChainManager, "DepositFor")
                .withArgs(bridgeRecipient2.address, rewardToken.address, amountRecipient2)

            expect(await rewardToken.balanceOf(rootRecipient1.address), "recipient 1 balance after").to.eq(0)
            expect(await rewardToken.balanceOf(rootRecipient1.address), "recipient 2 balance after").to.eq(0)
            expect(await rewardToken.balanceOf(rootChainManager.address), "root chain manager balance after").to.eq(amountRecipient2)
        })
        it("get rewards token from root recipient", async () => {
            expect(await rootRecipient1.getRewardToken()).to.eq(rewardToken.address)
        })
        context("fail to notify reward amount", () => {
            it("when not emissions controller", async () => {
                const tx = rootRecipient1.notifyRewardAmount(1)
                await expect(tx).revertedWith("Caller is not reward distributor")
            })
        })
    })
    describe("receive rewards from bridge", () => {
        let bridgedRewardToken: MockERC20
        let l2EmissionsController: L2EmissionsController
        let bridgeRecipient1: L2BridgeRecipient
        let bridgeRecipient2: L2BridgeRecipient
        let finalRecipient1: MockRewardsDistributionRecipient
        let finalRecipient2: MockRewardsDistributionRecipient
        beforeEach(async () => {
            await deployEmissionsController()

            bridgedRewardToken = await new MockERC20__factory(sa.default.signer).deploy(
                "Bridged Reward",
                "BRWD",
                18,
                sa.default.address,
                simpleToExactAmount(10000),
            )

            const l2EmissionsControllerImpl = await new L2EmissionsController__factory(sa.default.signer).deploy(
                nexus.address,
                bridgedRewardToken.address,
            )
            // Proxy
            const data = l2EmissionsControllerImpl.interface.encodeFunctionData("initialize")
            const proxy = await new AssetProxy__factory(sa.default.signer).deploy(l2EmissionsControllerImpl.address, DEAD_ADDRESS, data)
            l2EmissionsController = new L2EmissionsController__factory(sa.default.signer).attach(proxy.address)

            bridgeRecipient1 = await new L2BridgeRecipient__factory(sa.default.signer).deploy(
                bridgedRewardToken.address,
                l2EmissionsController.address,
            )
            finalRecipient1 = await new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(
                bridgedRewardToken.address,
                DEAD_ADDRESS,
            )
            bridgeRecipient2 = await new L2BridgeRecipient__factory(sa.default.signer).deploy(
                bridgedRewardToken.address,
                l2EmissionsController.address,
            )
            finalRecipient2 = await new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(
                bridgedRewardToken.address,
                DEAD_ADDRESS,
            )
            await l2EmissionsController.connect(sa.governor.signer).addRecipient(bridgeRecipient1.address, finalRecipient1.address)
            await l2EmissionsController.connect(sa.governor.signer).addRecipient(bridgeRecipient2.address, finalRecipient2.address)
        })
        describe("deploy L2BridgeRecipient should fail if zero", () => {
            it("rewards token", async () => {
                const tx = new L2BridgeRecipient__factory(sa.default.signer).deploy(ZERO_ADDRESS, l2EmissionsController.address)
                await expect(tx).to.revertedWith("Invalid Rewards token")
            })
            it("emissions controller", async () => {
                const tx = new L2BridgeRecipient__factory(sa.default.signer).deploy(bridgedRewardToken.address, ZERO_ADDRESS)
                await expect(tx).to.revertedWith("Invalid Emissions Controller")
            })
        })
        it("received rewards in both bridge recipients", async () => {
            expect(await bridgedRewardToken.balanceOf(finalRecipient1.address), "final recipient 1 bal before").to.eq(0)
            expect(await bridgedRewardToken.balanceOf(finalRecipient2.address), "final recipient 2 bal before").to.eq(0)

            const amountRecipient1 = simpleToExactAmount(1000)
            await bridgedRewardToken.transfer(bridgeRecipient1.address, amountRecipient1)

            const amountRecipient2 = simpleToExactAmount(2000)
            await bridgedRewardToken.transfer(bridgeRecipient2.address, amountRecipient2)

            const tx = await l2EmissionsController.distributeRewards([finalRecipient1.address, finalRecipient2.address])

            await expect(tx).to.emit(l2EmissionsController, "DistributedReward").withArgs(finalRecipient1.address, amountRecipient1)
            await expect(tx).to.emit(l2EmissionsController, "DistributedReward").withArgs(finalRecipient2.address, amountRecipient2)

            expect(await bridgedRewardToken.balanceOf(finalRecipient1.address), "final recipient 1 bal after").to.eq(amountRecipient1)
            expect(await bridgedRewardToken.balanceOf(finalRecipient2.address), "final recipient 2 bal after").to.eq(amountRecipient2)
        })
        it("received rewards in only one bridge recipients", async () => {
            expect(await bridgedRewardToken.balanceOf(finalRecipient1.address), "final recipient 1 bal before").to.eq(0)
            expect(await bridgedRewardToken.balanceOf(finalRecipient2.address), "final recipient 2 bal before").to.eq(0)

            const amountRecipient2 = simpleToExactAmount(2000)
            await bridgedRewardToken.transfer(bridgeRecipient2.address, amountRecipient2)

            const tx = await l2EmissionsController.distributeRewards([finalRecipient1.address, finalRecipient2.address])

            await expect(tx).to.emit(l2EmissionsController, "DistributedReward").withArgs(finalRecipient2.address, amountRecipient2)

            expect(await bridgedRewardToken.balanceOf(finalRecipient1.address), "final recipient 1 bal after").to.eq(0)
            expect(await bridgedRewardToken.balanceOf(finalRecipient2.address), "final recipient 2 bal after").to.eq(amountRecipient2)
        })
        context("fail to add recipient", () => {
            it("no bridge recipient", async () => {
                const tx = l2EmissionsController.connect(sa.governor.signer).addRecipient(ZERO_ADDRESS, sa.dummy1.address)
                await expect(tx).to.revertedWith("Bridge recipient address is zero")
            })
            it("no end recipient", async () => {
                const tx = l2EmissionsController.connect(sa.governor.signer).addRecipient(sa.dummy1.address, ZERO_ADDRESS)
                await expect(tx).to.revertedWith("End recipient address is zero")
            })
            it("mAsset already mapped", async () => {
                const tx = l2EmissionsController.connect(sa.governor.signer).addRecipient(sa.dummy2.address, finalRecipient1.address)
                await expect(tx).to.revertedWith("End recipient already mapped")
            })
        })
        it("fail to distribute to unmapped end recipient", async () => {
            const tx = l2EmissionsController.distributeRewards([sa.dummy1.address])
            await expect(tx).to.revertedWith("Unmapped recipient")
        })
    })
    context("fail to deploy bridge emissions controller when", () => {
        it("no nexus", async () => {
            const tx = new L2EmissionsController__factory(sa.default.signer).deploy(ZERO_ADDRESS, sa.dummy1.address)
            await expect(tx).to.revertedWith("Nexus address is zero")
        })
        it("no child rewards token", async () => {
            const tx = new L2EmissionsController__factory(sa.default.signer).deploy(sa.dummy1.address, ZERO_ADDRESS)
            await expect(tx).to.revertedWith("Reward token address is zero")
        })
    })
})
