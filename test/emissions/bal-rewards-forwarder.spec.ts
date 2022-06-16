import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount } from "@utils/math"
import { MassetMachine, StandardAccounts } from "@utils/machines"

import {
    MockNexus__factory,
    MockNexus,
    BalRewardsForwarder,
    BalRewardsForwarder__factory,
    MockChildChainStreamer,
    MockChildChainStreamer__factory,
    MockERC20,
} from "types/generated"
import { MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"
import { Wallet } from "@ethersproject/wallet"
import { Account } from "types/common"

describe("BalRewardsForwarder", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let nexus: MockNexus
    let rewardsToken: MockERC20
    let endRecipientAddress: string
    let owner: Account
    let emissionsController: Account
    let forwarder: BalRewardsForwarder
    let streamer: MockChildChainStreamer

    /*
        Test Data
        mAssets: mUSD and mBTC with 18 decimals
     */
    const setup = async (): Promise<void> => {
        // Deploy mock Nexus
        nexus = await new MockNexus__factory(sa.default.signer).deploy(
            sa.governor.address,
            sa.mockSavingsManager.address,
            sa.mockInterestValidator.address,
        )

        rewardsToken = await mAssetMachine.loadBassetProxy("Rewards Token", "RWD", 18)
        owner = sa.dummy1
        emissionsController = sa.dummy2
        streamer = await new MockChildChainStreamer__factory(sa.default.signer).deploy()
        endRecipientAddress = streamer.address

        // Deploy RevenueForwarder
        forwarder = await new BalRewardsForwarder__factory(owner.signer).deploy(nexus.address, rewardsToken.address)
        await forwarder.initialize(emissionsController.address, endRecipientAddress)

        await rewardsToken.transfer(emissionsController.address, simpleToExactAmount(10000))
        await rewardsToken.connect(emissionsController.signer).approve(forwarder.address, MAX_UINT256)
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        await setup()
    })

    describe("creating new instance", () => {
        it("should have immutable variables set", async () => {
            expect(await forwarder.nexus(), "Nexus").eq(nexus.address)
            expect(await forwarder.REWARDS_TOKEN(), "rewards token").eq(rewardsToken.address)
            expect(await forwarder.getRewardToken(), "rewards token").eq(rewardsToken.address)
            expect(await forwarder.rewardsDistributor(), "Emissions controller").eq(emissionsController.address)
            expect(await forwarder.endRecipient(), "End recipient").eq(endRecipientAddress)
        })
        describe("it should fail if zero", () => {
            it("nexus", async () => {
                const tx = new BalRewardsForwarder__factory(sa.default.signer).deploy(ZERO_ADDRESS, rewardsToken.address)
                await expect(tx).to.revertedWith("Nexus address is zero")
            })
            it("rewards token", async () => {
                const tx = new BalRewardsForwarder__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS)
                await expect(tx).to.revertedWith("Rewards token is zero")
            })
            it("End recipient", async () => {
                const newForwarder = await new BalRewardsForwarder__factory(sa.default.signer).deploy(nexus.address, rewardsToken.address)
                const tx = newForwarder.initialize(emissionsController.address, ZERO_ADDRESS)
                await expect(tx).to.revertedWith("Recipient address is zero")
            })
        })
    })
    describe("notify reward amount", () => {
        it("should transfer rewards to forwarder", async () => {
            const endRecipientBalBefore = await rewardsToken.balanceOf(endRecipientAddress)
            const notificationAmount = simpleToExactAmount(100, 18)

            // Simulate the emissions controller calling the forwarder
            await rewardsToken.transfer(forwarder.address, notificationAmount)
            const tx = await forwarder.connect(emissionsController.signer).notifyRewardAmount(notificationAmount)

            await expect(tx).to.emit(forwarder, "RewardsReceived").withArgs(notificationAmount)

            // check output balances: mAsset sender/recipient
            expect(await rewardsToken.balanceOf(endRecipientAddress), "end recipient bal after").eq(
                endRecipientBalBefore.add(notificationAmount),
            )
        })
        describe("should fail if", () => {
            it("not emissions controller", async () => {
                const tx = forwarder.notifyRewardAmount(simpleToExactAmount(1))
                await expect(tx).to.be.revertedWith("Caller is not reward distributor")
            })
        })
    })
    describe("setEndRecipient", () => {
        const newEndRecipientAddress = Wallet.createRandom().address
        it("owner should set new end recipient", async () => {
            expect(await forwarder.endRecipient(), "end recipient before").to.eq(endRecipientAddress)

            const tx = await forwarder.connect(owner.signer).setEndRecipient(newEndRecipientAddress)

            await expect(tx).to.emit(forwarder, "RecipientChanged").withArgs(newEndRecipientAddress)
            expect(await forwarder.endRecipient(), "end recipient after").to.eq(newEndRecipientAddress)
        })
        it("governor should fail to set new end recipient", async () => {
            const tx = forwarder.connect(sa.governor.signer).setEndRecipient(newEndRecipientAddress)

            await expect(tx).to.revertedWith("Ownable: caller is not the owner")
        })
        it("owner should fail to set same end recipient", async () => {
            const currentEndRecipient = await forwarder.endRecipient()

            const tx = forwarder.connect(owner.signer).setEndRecipient(currentEndRecipient)

            await expect(tx).to.revertedWith("Same end recipient")
        })
    })
})
