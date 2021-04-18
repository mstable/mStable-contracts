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
import { MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"

describe("RevenueRecipient", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let nexus: MockNexus
    let revenueRecipient: RevenueRecipient
    let mXYZ: MockERC20
    let BAL: MockERC20
    let bPool: MockBPool

    const runSetup = async (): Promise<void> => {
        mXYZ = await mAssetMachine.loadBassetProxy("mStable XYZ", "mXYZ", 18)
        BAL = await mAssetMachine.loadBassetProxy("Balance Gov Token", "BAL", 18)

        nexus = await new MockNexus__factory(sa.default.signer).deploy(
            sa.governor.address,
            sa.mockSavingsManager.address,
            sa.mockInterestValidator.address,
        )
        bPool = await new MockBPool__factory(sa.default.signer).deploy(simpleToExactAmount(1, 17), [mXYZ.address], "Mock mBPT", "mBPT")
        revenueRecipient = await new RevenueRecipient__factory(sa.default.signer).deploy(
            nexus.address,
            bPool.address,
            BAL.address,
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
            const arg2 = await revenueRecipient.BAL()
            const arg3 = await revenueRecipient.minOut(mXYZ.address)
            expect(arg0).eq(nexus.address)
            expect(arg1).eq(bPool.address)
            expect(arg2).eq(BAL.address)
            expect(arg3).eq(simpleToExactAmount(99, 15))
        })
        it("should give bPool permission to spend mAssets", async () => {
            const allowance = await mXYZ.allowance(revenueRecipient.address, bPool.address)
            expect(allowance).eq(MAX_UINT256)
        })
    })
    describe("notification of revenue", () => {
        it("should simply transfer from the sender", async () => {
            const senderBalBefore = await mXYZ.balanceOf(sa.default.address)
            const revenueRecipientBalBefore = await mXYZ.balanceOf(revenueRecipient.address)
            const notificationAmount = simpleToExactAmount(100, 18)
            // approve
            await mXYZ.approve(revenueRecipient.address, notificationAmount)
            // call
            const tx = revenueRecipient.notifyRedistributionAmount(mXYZ.address, notificationAmount)
            await expect(tx).to.emit(revenueRecipient, "RevenueReceived").withArgs(mXYZ.address, notificationAmount)

            const senderBalAfter = await mXYZ.balanceOf(sa.default.address)
            const revenueRecipientBalAfter = await mXYZ.balanceOf(revenueRecipient.address)
            // check output balances: mAsset sender/recipient
            expect(senderBalAfter).eq(senderBalBefore.sub(notificationAmount))
            expect(revenueRecipientBalAfter).eq(revenueRecipientBalBefore.add(notificationAmount))
        })
        describe("it should fail if", () => {
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
        })
    })
    describe("depositing revenue to pool", () => {
        it("should deposit 50% of funds to bPool", async () => {
            const rawBalBefore = await mXYZ.balanceOf(revenueRecipient.address)
            expect(rawBalBefore).eq(simpleToExactAmount(100))
            const bPoolBalBefore = await mXYZ.balanceOf(bPool.address)
            const revenueRecipientBalBefore = await bPool.balanceOf(revenueRecipient.address)
            const bPoolSupplyBefore = await bPool.totalSupply()

            // call
            const tx = revenueRecipient.depositToPool([mXYZ.address], [simpleToExactAmount(5, 17)])
            const expectedDeposit = rawBalBefore.div(2)
            await expect(tx).to.emit(revenueRecipient, "RevenueDeposited").withArgs(mXYZ.address, expectedDeposit, expectedDeposit.div(10))

            const rawBalAfter = await mXYZ.balanceOf(revenueRecipient.address)
            const bPoolBalAfter = await mXYZ.balanceOf(bPool.address)
            const revenueRecipientBalAfter = await bPool.balanceOf(revenueRecipient.address)
            const bPoolSupplyAfter = await bPool.totalSupply()
            // check output balances
            // 1. mAsset sender/recipient
            expect(rawBalAfter).eq(rawBalBefore.div(2))
            expect(bPoolBalAfter).eq(bPoolBalBefore.add(expectedDeposit))
            // 2. bPool sender/receipient
            expect(revenueRecipientBalAfter).eq(revenueRecipientBalBefore.add(expectedDeposit.div(10)))
            expect(bPoolSupplyAfter).eq(bPoolSupplyBefore.add(expectedDeposit.div(10)))
            // check for event emission
        })
        it("should deposit 100% of funds to bPool", async () => {
            const rawBalBefore = await mXYZ.balanceOf(revenueRecipient.address)
            expect(rawBalBefore).eq(simpleToExactAmount(50))
            const bPoolBalBefore = await mXYZ.balanceOf(bPool.address)
            const revenueRecipientBalBefore = await bPool.balanceOf(revenueRecipient.address)
            const bPoolSupplyBefore = await bPool.totalSupply()

            // call
            const tx = revenueRecipient.depositToPool([mXYZ.address], [simpleToExactAmount(1)])
            await expect(tx).to.emit(revenueRecipient, "RevenueDeposited").withArgs(mXYZ.address, rawBalBefore, rawBalBefore.div(10))

            const rawBalAfter = await mXYZ.balanceOf(revenueRecipient.address)
            const bPoolBalAfter = await mXYZ.balanceOf(bPool.address)
            const revenueRecipientBalAfter = await bPool.balanceOf(revenueRecipient.address)
            const bPoolSupplyAfter = await bPool.totalSupply()
            // check output balances
            // 1. mAsset sender/recipient
            expect(rawBalAfter).eq(0)
            expect(bPoolBalAfter).eq(bPoolBalBefore.add(rawBalBefore))
            // 2. bPool sender/receipient
            expect(revenueRecipientBalAfter).eq(revenueRecipientBalBefore.add(rawBalBefore.div(10)))
            expect(bPoolSupplyAfter).eq(bPoolSupplyBefore.add(rawBalBefore.div(10)))
            // check for event emission
        })
        describe("should fail if", () => {
            it("invalid arrays are passed", async () => {
                await expect(
                    revenueRecipient.depositToPool([mXYZ.address], [simpleToExactAmount(1), simpleToExactAmount(1)]),
                ).to.be.revertedWith("Invalid args")
            })
            it("pct is < 0.1 or > 100", async () => {
                await expect(revenueRecipient.depositToPool([mXYZ.address], [simpleToExactAmount(101, 16)])).to.be.revertedWith(
                    "Invalid pct",
                )
                await expect(revenueRecipient.depositToPool([mXYZ.address], [simpleToExactAmount(9, 14)])).to.be.revertedWith("Invalid pct")
            })
            it("asset does not have minOut", async () => {
                const mZZZ = await mAssetMachine.loadBassetProxy("mStable ZZZ", "mZZZ", 18)
                await expect(revenueRecipient.depositToPool([mZZZ.address], [simpleToExactAmount(8, 17)])).to.be.revertedWith(
                    "Invalid minout",
                )
            })
            it("mAsset does not exist (no approval for bPool)", async () => {
                const mZZZ = await mAssetMachine.loadBassetProxy("mStable ZZZ", "mZZZ", 18)
                await mZZZ.approve(revenueRecipient.address, simpleToExactAmount(100, 18))
                await revenueRecipient.connect(sa.governor.signer).updateAmountOut(mZZZ.address, simpleToExactAmount(1))
                await expect(revenueRecipient.depositToPool([mZZZ.address], [simpleToExactAmount(1, 18)])).to.be.revertedWith(
                    "Invalid token",
                )
            })
            it("bPool returns less than minimum", async () => {
                const notificationAmount = simpleToExactAmount(100, 18)
                await mXYZ.transfer(revenueRecipient.address, notificationAmount)
                await revenueRecipient.connect(sa.governor.signer).updateAmountOut(mXYZ.address, simpleToExactAmount(1, 18))
                await expect(revenueRecipient.depositToPool([mXYZ.address], [simpleToExactAmount(1)])).to.be.revertedWith(
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
        describe("migrating BAL & BPT", () => {
            before(async () => {
                await BAL.transfer(revenueRecipient.address, simpleToExactAmount(1))
            })
            it("should transfer all BAL & BPT balance to recipient", async () => {
                const bptBalBefore = await bPool.balanceOf(revenueRecipient.address)
                expect(bptBalBefore).gt(0)
                const balBalBefore = await BAL.balanceOf(revenueRecipient.address)
                expect(balBalBefore).eq(simpleToExactAmount(1))

                await revenueRecipient.connect(sa.governor.signer).migrate(sa.dummy4.address)

                const bptBalAfter = await bPool.balanceOf(revenueRecipient.address)
                expect(bptBalAfter).eq(0)
                const balBalAfter = await BAL.balanceOf(revenueRecipient.address)
                expect(balBalAfter).eq(0)

                const recipientBptBal = await bPool.balanceOf(sa.dummy4.address)
                expect(recipientBptBal).eq(bptBalBefore)
                const recipientBalBal = await BAL.balanceOf(sa.dummy4.address)
                expect(recipientBalBal).eq(simpleToExactAmount(1))
            })
            it("should only allow gov to call", async () => {
                await expect(revenueRecipient.connect(sa.default.signer).migrate(sa.dummy4.address)).to.be.revertedWith("Only governor")
            })
        })
        describe("reinvesting BAL", () => {
            let weth: MockERC20
            let bPool2: MockBPool
            beforeEach(async () => {
                mXYZ = await mAssetMachine.loadBassetProxy("mStable XYZ", "mXYZ", 18)
                weth = await mAssetMachine.loadBassetProxy("mStable ZZZ", "weth", 18)

                // bPool takes weth and mXYZ and gives out mBPT
                bPool = await new MockBPool__factory(sa.default.signer).deploy(
                    simpleToExactAmount(1, 17),
                    [mXYZ.address, weth.address],
                    "Mock mBPT",
                    "mBPT",
                )
                // bPool2 takes in BAL and returns weth
                bPool2 = await new MockBPool__factory(sa.default.signer).deploy(
                    simpleToExactAmount(1, 18),
                    [weth.address, BAL.address],
                    "Mock BPT",
                    "BPT",
                )
                await weth.transfer(bPool2.address, simpleToExactAmount(100))

                revenueRecipient = await new RevenueRecipient__factory(sa.default.signer).deploy(
                    nexus.address,
                    bPool.address,
                    BAL.address,
                    [mXYZ.address, weth.address],
                    [simpleToExactAmount(99, 15), simpleToExactAmount(99, 15)],
                )
                await BAL.transfer(revenueRecipient.address, simpleToExactAmount(100))
            })
            it("should reinvest any BAL accrued", async () => {
                // BAL goes into bPool2
                // weth comes out from bPool2 at 1:1
                // weth goes into bPool at 1:10
                const rawBalBefore = await BAL.balanceOf(revenueRecipient.address)
                expect(rawBalBefore).eq(simpleToExactAmount(100))
                const bPoolBalBefore = await weth.balanceOf(bPool.address)
                const revenueRecipientBalBefore = await bPool.balanceOf(revenueRecipient.address)
                const bPoolSupplyBefore = await bPool.totalSupply()
                const expectedWeth = simpleToExactAmount(100)

                // call
                const tx = revenueRecipient
                    .connect(sa.governor.signer)
                    .reinvestBAL(bPool2.address, weth.address, simpleToExactAmount(99), simpleToExactAmount(1), simpleToExactAmount(1))
                await expect(tx).to.emit(revenueRecipient, "RevenueDeposited").withArgs(weth.address, expectedWeth, expectedWeth.div(10))

                const rawBalAfter = await BAL.balanceOf(revenueRecipient.address)
                const bPoolBalAfter = await weth.balanceOf(bPool.address)
                const revenueRecipientBalAfter = await bPool.balanceOf(revenueRecipient.address)
                const bPoolSupplyAfter = await bPool.totalSupply()
                // check output balances
                // 1. mAsset sender/recipient
                expect(rawBalAfter).eq(0)
                expect(bPoolBalAfter).eq(bPoolBalBefore.add(expectedWeth))
                // 2. bPool sender/receipient
                expect(revenueRecipientBalAfter).eq(revenueRecipientBalBefore.add(expectedWeth.div(10)))
                expect(bPoolSupplyAfter).eq(bPoolSupplyBefore.add(expectedWeth.div(10)))
            })

            describe("should fail if", () => {
                it("asset does not have minOut", async () => {
                    const mZZZ = await mAssetMachine.loadBassetProxy("mStable ZZZ", "mZZZ", 18)
                    await expect(
                        revenueRecipient
                            .connect(sa.governor.signer)
                            .reinvestBAL(
                                bPool2.address,
                                mZZZ.address,
                                simpleToExactAmount(99),
                                simpleToExactAmount(1),
                                simpleToExactAmount(1),
                            ),
                    ).to.be.revertedWith("Invalid output")
                })
                it("pct is < 0.1 or > 100", async () => {
                    await expect(
                        revenueRecipient
                            .connect(sa.governor.signer)
                            .reinvestBAL(
                                bPool2.address,
                                weth.address,
                                simpleToExactAmount(99),
                                simpleToExactAmount(101, 16),
                                simpleToExactAmount(101, 16),
                            ),
                    ).to.be.revertedWith("Invalid pct")
                    await expect(
                        revenueRecipient
                            .connect(sa.governor.signer)
                            .reinvestBAL(
                                bPool2.address,
                                weth.address,
                                simpleToExactAmount(99),
                                simpleToExactAmount(1),
                                simpleToExactAmount(9, 14),
                            ),
                    ).to.be.revertedWith("Invalid pct")
                })
                it("output is not supported by pool", async () => {
                    await expect(
                        revenueRecipient
                            .connect(sa.governor.signer)
                            .reinvestBAL(
                                bPool2.address,
                                mXYZ.address,
                                simpleToExactAmount(1),
                                simpleToExactAmount(1),
                                simpleToExactAmount(1),
                            ),
                    ).to.be.revertedWith("Invalid token")
                })
                it("bPool returns less than minimum", async () => {
                    await expect(
                        revenueRecipient
                            .connect(sa.governor.signer)
                            .reinvestBAL(
                                bPool2.address,
                                weth.address,
                                simpleToExactAmount(101),
                                simpleToExactAmount(1),
                                simpleToExactAmount(1),
                            ),
                    ).to.be.revertedWith("Invalid output amount")
                })
                it("bPool returns less than minimum", async () => {
                    await revenueRecipient.connect(sa.governor.signer).updateAmountOut(weth.address, simpleToExactAmount(1, 18))
                    await expect(
                        revenueRecipient
                            .connect(sa.governor.signer)
                            .reinvestBAL(
                                bPool2.address,
                                weth.address,
                                simpleToExactAmount(99),
                                simpleToExactAmount(1),
                                simpleToExactAmount(1),
                            ),
                    ).to.be.revertedWith("Invalid output amount")
                })
                it("not called by governor", async () => {
                    await expect(
                        revenueRecipient.connect(sa.default.signer).reinvestBAL(ZERO_ADDRESS, ZERO_ADDRESS, 0, 0, 0),
                    ).to.be.revertedWith("Only governor")
                })
            })
        })
    })
})
