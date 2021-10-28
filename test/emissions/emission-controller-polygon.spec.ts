/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-plusplus */
import { Wallet } from "@ethersproject/wallet"
import { DEAD_ADDRESS, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BN, deployContract, increaseTime, simpleToExactAmount } from "index"
import { deployPolygonChildRecipient, deployPolygonRootRecipient } from "tasks/utils/rewardsUtils"
import {
    AssetProxy__factory,
    ChildEmissionsController,
    ChildEmissionsController__factory,
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
    PolygonChildRecipient,
    PolygonRootRecipient,
    PolygonRootRecipient__factory,
} from "types/generated"

describe("EmissionsController Polygon Integration", async () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let staking1: MockStakingContract
    let staking2: MockStakingContract
    let rewardToken: MockERC20
    let emissionsController: EmissionsController
    let rootChainManager: IRootChainManager
    const totalRewardsSupply = simpleToExactAmount(100000000)
    const totalRewards = simpleToExactAmount(40000000)

    const deployEmissionsController = async (): Promise<void> => {
        // staking contracts
        staking1 = await new MockStakingContract__factory(sa.default.signer).deploy()
        staking2 = await new MockStakingContract__factory(sa.default.signer).deploy()

        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, totalRewardsSupply)

        // Deploy logic contract
        const emissionsControllerImpl = await new EmissionsController__factory(sa.default.signer).deploy(
            nexus.address,
            [staking1.address, staking2.address],
            rewardToken.address,
        )

        // Deploy proxy and initialize
        const data = emissionsControllerImpl.interface.encodeFunctionData("initialize", [[], []])
        const proxy = await deployContract(new AssetProxy__factory(sa.default.signer), "AssetProxy", [
            emissionsControllerImpl.address,
            DEAD_ADDRESS,
            data,
        ])
        emissionsController = new EmissionsController__factory(sa.default.signer).attach(proxy.address)

        // Transfer MTA to the Emissions Controller
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
            await deployPolygonRootRecipient(
                sa.default.signer,
                nexus.address,
                rewardToken.address,
                rootChainManager.address,
                Wallet.createRandom().address,
                emissionsController.address,
            )
        })
        it("fail when zero nexus", async () => {
            const tx = new PolygonRootRecipient__factory(sa.default.signer).deploy(
                ZERO_ADDRESS,
                rewardToken.address,
                rootChainManager.address,
                sa.dummy1.address,
            )
            await expect(tx).to.revertedWith("Nexus address is zero")
        })
        it("fail when zero rewards token", async () => {
            const tx = new PolygonRootRecipient__factory(sa.default.signer).deploy(
                nexus.address,
                ZERO_ADDRESS,
                rootChainManager.address,
                sa.dummy1.address,
            )
            await expect(tx).to.revertedWith("Rewards token is zero")
        })
        it("fail when zero root chain manager", async () => {
            const tx = new PolygonRootRecipient__factory(sa.default.signer).deploy(
                nexus.address,
                rewardToken.address,
                ZERO_ADDRESS,
                sa.dummy1.address,
            )
            await expect(tx).to.revertedWith("RootChainManager is zero")
        })
        it("fail when zero child recipient", async () => {
            const tx = new PolygonRootRecipient__factory(sa.default.signer).deploy(
                nexus.address,
                rewardToken.address,
                rootChainManager.address,
                ZERO_ADDRESS,
            )
            await expect(tx).to.revertedWith("ChildRecipient is zero")
        })
    })
    describe("distribute rewards via bridge", () => {
        const childRecipient1 = Wallet.createRandom()
        const childRecipient2 = Wallet.createRandom()
        let rootRecipient1: PolygonRootRecipient
        let rootRecipient2: PolygonRootRecipient
        beforeEach(async () => {
            await deployEmissionsController()

            rootRecipient1 = await deployPolygonRootRecipient(
                sa.default.signer,
                nexus.address,
                rewardToken.address,
                rootChainManager.address,
                childRecipient1.address,
                emissionsController.address,
            )

            rootRecipient2 = await deployPolygonRootRecipient(
                sa.default.signer,
                nexus.address,
                rewardToken.address,
                rootChainManager.address,
                childRecipient2.address,
                emissionsController.address,
            )

            await emissionsController.connect(sa.governor.signer).addDial(rootRecipient1.address, true)
            await emissionsController.connect(sa.governor.signer).addDial(rootRecipient2.address, true)
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
                .withArgs(childRecipient1.address, rewardToken.address, amountRecipient1)

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
                .withArgs(childRecipient1.address, rewardToken.address, amountRecipient1)
            await expect(tx)
                .to.emit(rootChainManager, "DepositFor")
                .withArgs(childRecipient2.address, rewardToken.address, amountRecipient2)

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
                .withArgs(childRecipient2.address, rewardToken.address, amountRecipient2)

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
        let childEmissionsController: ChildEmissionsController
        let childRecipient1: PolygonChildRecipient
        let childRecipient2: PolygonChildRecipient
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

            const childEmissionsControllerImpl = await deployContract<ChildEmissionsController>(
                new ChildEmissionsController__factory(sa.default.signer),
                "ChildEmissionsController",
                [nexus.address, bridgedRewardToken.address],
            )
            // Proxy
            const data = childEmissionsControllerImpl.interface.encodeFunctionData("initialize")
            const proxy = await deployContract(new AssetProxy__factory(sa.default.signer), "AssetProxy", [
                childEmissionsControllerImpl.address,
                DEAD_ADDRESS,
                data,
            ])
            childEmissionsController = new ChildEmissionsController__factory(sa.default.signer).attach(proxy.address)

            childRecipient1 = await deployPolygonChildRecipient(
                sa.default.signer,
                bridgedRewardToken.address,
                childEmissionsController.address,
            )
            finalRecipient1 = await new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(
                bridgedRewardToken.address,
                DEAD_ADDRESS,
            )
            childRecipient2 = await deployPolygonChildRecipient(
                sa.default.signer,
                bridgedRewardToken.address,
                childEmissionsController.address,
            )
            finalRecipient2 = await new MockRewardsDistributionRecipient__factory(sa.default.signer).deploy(
                bridgedRewardToken.address,
                DEAD_ADDRESS,
            )
            await childEmissionsController.connect(sa.governor.signer).addRecipient(childRecipient1.address, finalRecipient1.address)
            await childEmissionsController.connect(sa.governor.signer).addRecipient(childRecipient2.address, finalRecipient2.address)
        })
        it("received rewards in both child recipients", async () => {
            expect(await bridgedRewardToken.balanceOf(finalRecipient1.address), "final recipient 1 bal before").to.eq(0)
            expect(await bridgedRewardToken.balanceOf(finalRecipient2.address), "final recipient 2 bal before").to.eq(0)

            const amountRecipient1 = simpleToExactAmount(1000)
            await bridgedRewardToken.transfer(childRecipient1.address, amountRecipient1)

            const amountRecipient2 = simpleToExactAmount(2000)
            await bridgedRewardToken.transfer(childRecipient2.address, amountRecipient2)

            const tx = await childEmissionsController.distributeRewards([finalRecipient1.address, finalRecipient2.address])

            await expect(tx).to.emit(childEmissionsController, "DistributedReward").withArgs(finalRecipient1.address, amountRecipient1)
            await expect(tx).to.emit(childEmissionsController, "DistributedReward").withArgs(finalRecipient2.address, amountRecipient2)

            expect(await bridgedRewardToken.balanceOf(finalRecipient1.address), "final recipient 1 bal after").to.eq(amountRecipient1)
            expect(await bridgedRewardToken.balanceOf(finalRecipient2.address), "final recipient 2 bal after").to.eq(amountRecipient2)
        })
        context("fail to add recipient", () => {
            it("no child recipient", async () => {
                const tx = childEmissionsController.connect(sa.governor.signer).addRecipient(ZERO_ADDRESS, sa.dummy1.address)
                await expect(tx).to.revertedWith("Child recipient address is zero")
            })
            it("no end recipient", async () => {
                const tx = childEmissionsController.connect(sa.governor.signer).addRecipient(sa.dummy1.address, ZERO_ADDRESS)
                await expect(tx).to.revertedWith("End recipient address is zero")
            })
        })
        it("fail to distribute to unmapped end recipient", async () => {
            const tx = childEmissionsController.distributeRewards([sa.dummy1.address])
            await expect(tx).to.revertedWith("Unmapped recipient")
        })
    })
    context("fail to deploy child emissions controller when", () => {
        it("no nexus", async () => {
            const tx = new ChildEmissionsController__factory(sa.default.signer).deploy(ZERO_ADDRESS, sa.dummy1.address)
            await expect(tx).to.revertedWith("Nexus address is zero")
        })
        it("no child rewards token", async () => {
            const tx = new ChildEmissionsController__factory(sa.default.signer).deploy(sa.dummy1.address, ZERO_ADDRESS)
            await expect(tx).to.revertedWith("Reward token address is zero")
        })
    })
})
