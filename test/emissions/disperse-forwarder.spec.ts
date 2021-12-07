import { MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import { Account } from "types/common"
import {
    MockERC20,
    MockNexus,
    MockNexus__factory,
    MockDisperse,
    MockDisperse__factory,
    DisperseForwarder,
    DisperseForwarder__factory,
} from "types/generated"

describe("DisperseForwarder", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let nexus: MockNexus
    let rewardsToken: MockERC20
    let owner: Account
    let emissionsController: Account
    let forwarder: DisperseForwarder
    let disperse: MockDisperse

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
        // Deploy mock Disperse
        disperse = await new MockDisperse__factory(sa.default.signer).deploy()

        rewardsToken = await mAssetMachine.loadBassetProxy("Rewards Token", "RWD", 18)
        owner = sa.default
        emissionsController = sa.dummy2

        // Deploy DisperseForwarder
        forwarder = await new DisperseForwarder__factory(owner.signer).deploy(nexus.address, rewardsToken.address, disperse.address)

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
            expect(await forwarder.DISPERSE(), "disperse contract").eq(disperse.address)
        })
        describe("it should fail if zero", () => {
            it("nexus", async () => {
                const tx = new DisperseForwarder__factory(sa.default.signer).deploy(ZERO_ADDRESS, rewardsToken.address, disperse.address)
                await expect(tx).to.revertedWith("Nexus address is zero")
            })
            it("rewards token", async () => {
                const tx = new DisperseForwarder__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS, disperse.address)
                await expect(tx).to.revertedWith("Invalid Rewards token")
            })
            it("disperse contract ", async () => {
                const tx = new DisperseForwarder__factory(sa.default.signer).deploy(nexus.address, rewardsToken.address, ZERO_ADDRESS)
                await expect(tx).to.revertedWith("Invalid Disperse contract")
            })
        })
    })
    describe("disperse token", () => {
        it("should transfer rewards to forwarder", async () => {
            const recipients = [disperse.address]
            const values = [simpleToExactAmount(100, 18)]

            const endRecipientBalBefore = await rewardsToken.balanceOf(disperse.address)
            const amount = simpleToExactAmount(100, 18)
            // Simulate the emissions controller calling the forwarder
            await rewardsToken.transfer(forwarder.address, amount)

            await forwarder.connect(sa.governor.signer).disperseToken(recipients, values)

            // check output balances: mAsset sender/recipient
            expect(await rewardsToken.balanceOf(disperse.address), "end recipient balance after").eq(endRecipientBalBefore.add(amount))
        })
        describe("should fail if", () => {
            it("recipients and values do not match", async () => {
                const recipients = [disperse.address]
                const tx = forwarder.connect(sa.governor.signer).disperseToken(recipients, [])
                await expect(tx).to.be.revertedWith("array mismatch")
            })
            it("balance is insufficient", async () => {
                const balance = await rewardsToken.balanceOf(forwarder.address)
                const tx = forwarder.connect(sa.governor.signer).disperseToken([disperse.address, disperse.address], [balance, 1])
                await expect(tx).to.be.revertedWith("Insufficient rewards")
            })
            it("non governor or keeper", async () => {
                const recipients = [disperse.address]
                const values = [simpleToExactAmount(100, 18)]
                const tx = forwarder.disperseToken(recipients, values)
                await expect(tx).to.be.revertedWith("Only keeper or governor")
            })
        })
    })
})
