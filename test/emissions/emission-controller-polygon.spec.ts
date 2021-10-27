/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-plusplus */
import { Wallet } from "@ethersproject/wallet"
import { DEAD_ADDRESS, ONE_WEEK } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { Signer } from "ethers"
import { ethers } from "hardhat"
import { BN, deployContract, increaseTime, simpleToExactAmount } from "index"
import {
    AssetProxy__factory,
    EmissionsController,
    EmissionsController__factory,
    IRootChainManager,
    MockERC20,
    MockERC20__factory,
    MockNexus,
    MockNexus__factory,
    MockRootChainManager__factory,
    MockStakingContract,
    MockStakingContract__factory,
    PolygonRootRecipient,
    PolygonRootRecipient__factory,
} from "types/generated"

const deployPolygonRootRecipient = async (
    signer: Signer,
    nexusAddress: string,
    rewardTokenAddress: string,
    rootChainManagerAddress: string,
    childRecipient1Address: string,
    emissionsController: string,
) => {
    const impl = await deployContract(new PolygonRootRecipient__factory(signer), "PolygonRootRecipient", [
        nexusAddress,
        rewardTokenAddress,
        rootChainManagerAddress,
        childRecipient1Address,
    ])

    // Proxy
    const data = impl.interface.encodeFunctionData("initialize", [emissionsController])
    const proxy = await deployContract(new AssetProxy__factory(signer), "AssetProxy", [impl.address, DEAD_ADDRESS, data])

    const rootRecipient = new PolygonRootRecipient__factory(signer).attach(proxy.address)

    return rootRecipient
}

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
    const childRecipient1 = Wallet.createRandom()
    const childRecipient2 = Wallet.createRandom()

    const deployEmissionsController = async (): Promise<void> => {
        // staking contracts
        staking1 = await new MockStakingContract__factory(sa.default.signer).deploy()
        staking2 = await new MockStakingContract__factory(sa.default.signer).deploy()

        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, sa.default.address, totalRewardsSupply)

        emissionsController = await new EmissionsController__factory(sa.default.signer).deploy(
            nexus.address,
            [staking1.address, staking2.address],
            rewardToken.address,
            totalRewards,
        )
        await staking1.setGovernanceHook(emissionsController.address)
        await staking2.setGovernanceHook(emissionsController.address)
        await rewardToken.approve(emissionsController.address, totalRewardsSupply)
        await emissionsController.initialize([], [])

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
                childRecipient1.address,
                emissionsController.address,
            )
        })
    })
    describe("distribute rewards", () => {
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
    })
})
