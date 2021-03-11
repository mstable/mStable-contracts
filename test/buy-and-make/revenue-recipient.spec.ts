import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount } from "@utils/math"
import { MassetMachine, StandardAccounts } from "@utils/machines"

import {
    MockBPool__factory,
    RevenueRecipient__factory,
    MockBPool,
    RevenueRecipient,
    MockERC20,
    MockNexus__factory,
    MockNexus,
} from "types/generated"
import { MAX_UINT256 } from "@utils/constants"

describe("Masset", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let nexus: MockNexus
    let revenueRecipient: RevenueRecipient
    let mXYZ: MockERC20
    let bPool: MockBPool

    const runSetup = async (): Promise<void> => {
        mXYZ = await mAssetMachine.loadBassetProxy("mStable XYZ", "mXYZ", 18)

        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, sa.mockSavingsManager.address)
        bPool = await new MockBPool__factory(sa.default.signer).deploy(simpleToExactAmount(1, 17), [mXYZ.address], "Mock mBPT", "mBPT")
        revenueRecipient = await new RevenueRecipient__factory(sa.default.signer).deploy(
            nexus.address,
            bPool.address,
            [mXYZ.address],
            [simpleToExactAmount(99, 15)],
        )
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        await runSetup()
    })

    describe("creating new instance", () => {
        it("should have constructor args set", async () => {
            const arg0 = await revenueRecipient.nexus()
            const arg1 = await revenueRecipient.mBPT()
            const arg2 = await revenueRecipient.minOut(mXYZ.address)
            expect(arg0).eq(nexus.address)
            expect(arg1).eq(bPool.address)
            expect(arg2).eq(simpleToExactAmount(99, 15))
        })
        it("should give bPool permission to spend mAssets", async () => {
            const allowance = await mXYZ.allowance(revenueRecipient.address, bPool.address)
            expect(allowance).eq(MAX_UINT256)
        })
    })
    describe("notification of revenue", () => {
        it("should take funds and deposit to bPool", async () => {
            const senderBalBefore = await mXYZ.balanceOf(sa.default.address)
            const bPoolBalBefore = await mXYZ.balanceOf(bPool.address)
            const revenueRecipientBalBefore = await bPool.balanceOf(revenueRecipient.address)
            const bPoolSupplyBefore = await bPool.totalSupply()
            const notificationAmount = simpleToExactAmount(100, 18)
            // approve
            await mXYZ.approve(revenueRecipient.address, notificationAmount)
            // call
            const tx = revenueRecipient.notifyRedistributionAmount(mXYZ.address, notificationAmount)
            await expect(tx)
                .to.emit(revenueRecipient, "RevenueReceived")
                .withArgs(mXYZ.address, notificationAmount, notificationAmount.div(10))

            const senderBalAfter = await mXYZ.balanceOf(sa.default.address)
            const bPoolBalAfter = await mXYZ.balanceOf(bPool.address)
            const revenueRecipientBalAfter = await bPool.balanceOf(revenueRecipient.address)
            const bPoolSupplyAfter = await bPool.totalSupply()
            // check output balances
            // 1. mAsset sender/recipient
            expect(senderBalAfter).eq(senderBalBefore.sub(notificationAmount))
            expect(bPoolBalAfter).eq(bPoolBalBefore.add(notificationAmount))
            // 2. bPool sender/receipient
            expect(revenueRecipientBalAfter).eq(revenueRecipientBalBefore.add(notificationAmount.div(10)))
            expect(bPoolSupplyAfter).eq(bPoolSupplyBefore.add(notificationAmount.div(10)))
            // check for event emission
        })
        describe("should fail if", () => {
            it("mAsset does not exist (no approval for bPool)", async () => {
                const mZZZ = await mAssetMachine.loadBassetProxy("mStable ZZZ", "mZZZ", 18)
                await mZZZ.approve(revenueRecipient.address, simpleToExactAmount(100, 18))
                await expect(revenueRecipient.notifyRedistributionAmount(mZZZ.address, simpleToExactAmount(100, 18))).to.be.revertedWith(
                    "Invalid token",
                )
            })
            it("approval is not given from sender", async () => {
                await expect(revenueRecipient.notifyRedistributionAmount(mXYZ.address, simpleToExactAmount(100, 18))).to.be.revertedWith(
                    "ERC20: transfer amount exceeds allowance",
                )
            })
            it("sender has insufficient balance", async () => {
                await mXYZ.transfer(sa.dummy1.address, simpleToExactAmount(1, 18))
                await mXYZ.connect(sa.dummy1.signer).approve(revenueRecipient.address, simpleToExactAmount(100))
                await expect(
                    revenueRecipient.connect(sa.dummy1.signer).notifyRedistributionAmount(mXYZ.address, simpleToExactAmount(2, 18)),
                ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
            })
            it("bPool returns less than minimum", async () => {
                const notificationAmount = simpleToExactAmount(100, 18)
                await mXYZ.approve(revenueRecipient.address, notificationAmount)
                await revenueRecipient.connect(sa.governor.signer).updateAmountOut(mXYZ.address, simpleToExactAmount(1, 18))
                await expect(revenueRecipient.notifyRedistributionAmount(mXYZ.address, simpleToExactAmount(2, 18))).to.be.revertedWith(
                    "Invalid output amount",
                )
            })
        })
    })
    describe("testing asset management", () => {
        describe("approving assets", () => {
            it("should approve assets for spending", async () => {
                const mZZZ = await mAssetMachine.loadBassetProxy("mStable ZZZ", "mZZZ", 18)
                expect(await mZZZ.allowance(revenueRecipient.address, bPool.address)).eq(0)
                await revenueRecipient.connect(sa.governor.signer).approveAsset(mZZZ.address)
                expect(await mZZZ.allowance(revenueRecipient.address, bPool.address)).eq(MAX_UINT256)
            })
            it("should only allow gov to call", async () => {
                const mZZZ = await mAssetMachine.loadBassetProxy("mStable ZZZ", "mZZZ", 18)
                await expect(revenueRecipient.connect(sa.default.signer).approveAsset(mZZZ.address)).to.be.revertedWith("Only governor")
            })
        })
        describe("setting min output amounts", () => {
            it("should set min output amounts", async () => {
                expect(await revenueRecipient.minOut(mXYZ.address)).eq(simpleToExactAmount(1, 18))
                await revenueRecipient.connect(sa.governor.signer).updateAmountOut(mXYZ.address, simpleToExactAmount(3, 12))
                expect(await revenueRecipient.minOut(mXYZ.address)).eq(simpleToExactAmount(3, 12))
            })
            it("should only allow gov to call", async () => {
                await expect(
                    revenueRecipient.connect(sa.default.signer).updateAmountOut(mXYZ.address, simpleToExactAmount(3, 12)),
                ).to.be.revertedWith("Only governor")
            })
        })
        describe("migrating BPT", () => {
            it("should transfer all BPT balance to recipient", async () => {
                const balBefore = await bPool.balanceOf(revenueRecipient.address)
                expect(balBefore).gt(0)
                await revenueRecipient.connect(sa.governor.signer).migrateBPT(sa.dummy4.address)
                const balAfter = await bPool.balanceOf(revenueRecipient.address)
                expect(balAfter).eq(0)
                const recipientBal = await bPool.balanceOf(sa.dummy4.address)
                expect(recipientBal).eq(balBefore)
            })
            it("should only allow gov to call", async () => {
                await expect(revenueRecipient.connect(sa.default.signer).migrateBPT(sa.dummy4.address)).to.be.revertedWith("Only governor")
            })
        })
    })
})
