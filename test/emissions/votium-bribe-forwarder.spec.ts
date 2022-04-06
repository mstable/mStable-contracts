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
    MockVotiumBribe,
    MockVotiumBribe__factory,
    VotiumBribeForwarder,
    VotiumBribeForwarder__factory,
} from "types/generated"

export const hashFn = (str: string): string => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(str))
const PROPOSAL = hashFn("QmZpsJAvbKEY9YKFCZBUzzSMC5Y9vfy6QPA4HoXGsiLUyg")

describe("VotiumBribeForwarder", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let nexus: MockNexus
    let rewardsToken: MockERC20
    let owner: Account
    let emissionsController: Account
    let forwarder: VotiumBribeForwarder
    let votiumBribe: MockVotiumBribe

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
        // Deploy mock VotiumBribe
        votiumBribe = await new MockVotiumBribe__factory(sa.default.signer).deploy()

        rewardsToken = await mAssetMachine.loadBassetProxy("Rewards Token", "RWD", 18)
        owner = sa.default
        emissionsController = sa.dummy2

        // Deploy VotiumBribeForwarder
        forwarder = await new VotiumBribeForwarder__factory(owner.signer).deploy(nexus.address, rewardsToken.address, votiumBribe.address)

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
            expect(await forwarder.VOTIUM_BRIBE(), "votium bribe contract").eq(votiumBribe.address)
        })
        describe("it should fail if zero", () => {
            it("nexus", async () => {
                const tx = new VotiumBribeForwarder__factory(sa.default.signer).deploy(
                    ZERO_ADDRESS,
                    rewardsToken.address,
                    votiumBribe.address,
                )
                await expect(tx).to.revertedWith("Nexus address is zero")
            })
            it("rewards token", async () => {
                const tx = new VotiumBribeForwarder__factory(sa.default.signer).deploy(nexus.address, ZERO_ADDRESS, votiumBribe.address)
                await expect(tx).to.revertedWith("Invalid Rewards token")
            })
            it("Votium bribe ", async () => {
                const tx = new VotiumBribeForwarder__factory(sa.default.signer).deploy(nexus.address, rewardsToken.address, ZERO_ADDRESS)
                await expect(tx).to.revertedWith("Invalid VotiumBribe contract")
            })
        })
    })
    describe("deposit Bribe", () => {
        it("should transfer rewards to forwarder", async () => {
            const endRecipientBalBefore = await rewardsToken.balanceOf(votiumBribe.address)
            const amount = simpleToExactAmount(100, 18)

            // Simulate the emissions controller calling the forwarder
            await rewardsToken.transfer(forwarder.address, amount)

            const tx = await forwarder.connect(sa.governor.signer).depositBribe(amount, PROPOSAL)
            // Bribed(_token, bribeTotal, _proposal, _choiceIndex)
            await expect(tx).to.emit(votiumBribe, "Bribed")

            // check output balances: mAsset sender/recipient
            expect(await rewardsToken.balanceOf(votiumBribe.address), "end recipient balance after").eq(endRecipientBalBefore.add(amount))
        })
        describe("should fail if", () => {
            it("amount is zero", async () => {
                const tx = forwarder.connect(sa.governor.signer).depositBribe(simpleToExactAmount(0), PROPOSAL)
                await expect(tx).to.be.revertedWith("Invalid amount")
            })
            it("balance is insufficient", async () => {
                const balance = await rewardsToken.balanceOf(forwarder.address)
                const tx = forwarder.connect(sa.governor.signer).depositBribe(simpleToExactAmount(balance.add(1)), PROPOSAL)
                await expect(tx).to.be.revertedWith("Insufficient rewards")
            })
            it("non governor or keeper", async () => {
                const tx = forwarder.depositBribe(simpleToExactAmount(0), PROPOSAL)
                await expect(tx).to.be.revertedWith("Only keeper or governor")
            })
        })
    })
    describe("updates choice index", () => {
        it("keeper should set new choice index", async () => {
            // Given a default choice index
            const newChoiceIndex = 1
            const choiceIndexBefore = await forwarder.choiceIndex()

            // When the value is updated
            await forwarder.connect(sa.governor.signer).updateChoiceIndex(newChoiceIndex)

            // Then
            const choiceIndexAfter = await forwarder.connect(sa.governor.signer).choiceIndex()
            expect(choiceIndexBefore, "choice index changed").to.not.eq(choiceIndexAfter)
            expect(choiceIndexAfter, "choice index expected value").to.eq(newChoiceIndex)
        })
        describe("should fail if", () => {
            it("non governor or keeper", async () => {
                const tx = forwarder.depositBribe(simpleToExactAmount(0), PROPOSAL)
                await expect(tx).to.be.revertedWith("Only keeper or governor")
            })
        })
    })
})
