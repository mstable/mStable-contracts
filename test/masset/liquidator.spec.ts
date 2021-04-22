import { expect } from "chai"
import { ethers } from "hardhat"

import { BN, simpleToExactAmount } from "@utils/math"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { DEAD_ADDRESS, ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import {
    AssetProxy__factory,
    MockERC20,
    MockERC20__factory,
    MockMasset,
    MockMasset__factory,
    MockNexus,
    SavingsContract__factory,
    Liquidator,
    SavingsManager,
    MockUniswap__factory,
    MockRewardToken,
    MockCurveMetaPool__factory,
    Liquidator__factory,
    SavingsManager__factory,
    MockCurveMetaPool,
    MockUniswap,
    MockRewardToken__factory,
    MockNexus__factory,
    ImmutableModule,
    MockTrigger__factory,
} from "types/generated"
import { increaseTime } from "@utils/time"
import { shouldBehaveLikeModule, IModuleBehaviourContext } from "../shared/Module.behaviour"

describe("Liquidator", () => {
    let sa: StandardAccounts
    const ctx: Partial<IModuleBehaviourContext> = {}

    let nexus: MockNexus
    let liquidator: Liquidator
    let bAsset: MockERC20
    let bAsset2: MockERC20
    let mUSD: MockMasset
    let compIntegration: MockRewardToken
    let compToken: MockERC20
    let savings: SavingsManager
    let uniswap: MockUniswap
    let curve: MockCurveMetaPool

    interface Liquidation {
        sellToken: string
        bAsset: string
        curvePosition: BN
        uniswapPath?: string[]
        lastTriggered: BN
        sellTranche: BN
        minReturn: BN
    }

    interface Balance {
        integration: BN
        liquidator: BN
    }

    interface Data {
        sellTokenBalance: Balance
        savingsManagerBal: BN
        liquidation: Liquidation
    }

    // Real deployment steps:
    // - Deploy Liquidator & add Liquidation
    // - Add to modules
    // - Upgrade COMP
    const redeployLiquidator = async () => {
        // Fake mUSD & uniswap
        mUSD = await new MockMasset__factory(sa.default.signer).deploy("mStable USD", "mUSD", 18, sa.fundManager.address, 100000000)
        uniswap = await new MockUniswap__factory(sa.default.signer).deploy()
        // Set up Comp Integration
        bAsset = await new MockERC20__factory(sa.default.signer).deploy("Mock1", "MK1", 18, sa.fundManager.address, 100000000)
        await bAsset.connect(sa.fundManager.signer).transfer(uniswap.address, simpleToExactAmount(100000, 18))
        bAsset2 = await new MockERC20__factory(sa.default.signer).deploy("Mock2", "MK2", 18, sa.fundManager.address, 100000000)
        await bAsset2.connect(sa.fundManager.signer).transfer(uniswap.address, simpleToExactAmount(100000, 18))
        compIntegration = await new MockRewardToken__factory(sa.default.signer).deploy(nexus.address)
        // Set up Curve
        curve = await new MockCurveMetaPool__factory(sa.default.signer).deploy(
            [mUSD.address, bAsset.address, bAsset2.address],
            mUSD.address,
        )
        await mUSD.connect(sa.fundManager.signer).transfer(curve.address, simpleToExactAmount(100000, 18))
        // Create COMP token and assign, then approve the liquidator
        compToken = await new MockERC20__factory(sa.default.signer).deploy("Compound Gov", "COMP", 18, sa.fundManager.address, 100000000)
        await compIntegration.setRewardToken(compToken.address)
        await compToken.connect(sa.fundManager.signer).transfer(compIntegration.address, simpleToExactAmount(10, 18))
        // Add the module
        // Liquidator
        const impl = await new Liquidator__factory(sa.default.signer).deploy(nexus.address)
        const data: string = impl.interface.encodeFunctionData("initialize", [uniswap.address, curve.address, mUSD.address])
        const proxy = await new AssetProxy__factory(sa.default.signer).deploy(impl.address, sa.other.address, data)
        liquidator = await Liquidator__factory.connect(proxy.address, sa.default.signer)

        const save = await new SavingsContract__factory(sa.default.signer).deploy(nexus.address, mUSD.address)
        await save.initialize(sa.default.address, "Savings Credit", "imUSD", DEAD_ADDRESS)
        savings = await new SavingsManager__factory(sa.default.signer).deploy(
            nexus.address,
            mUSD.address,
            save.address,
            simpleToExactAmount(1, 18),
            ONE_WEEK,
        )
        await nexus.setSavingsManager(savings.address)
        await nexus.setLiquidator(liquidator.address)
    }

    const getLiquidation = async (addr: string): Promise<Liquidation> => {
        const liquidation = await liquidator.liquidations(addr)
        const minReturn = await liquidator.minReturn(addr)
        return {
            sellToken: liquidation[0],
            bAsset: liquidation[1],
            curvePosition: liquidation[2],
            lastTriggered: liquidation[3],
            sellTranche: liquidation[4],
            minReturn,
        }
    }
    const snapshotData = async (): Promise<Data> => {
        const liquidation = await getLiquidation(liquidator.address)
        const sellBalIntegration = await compToken.balanceOf(compIntegration.address)
        const sellBalLiquidator = await compToken.balanceOf(liquidator.address)
        const savingsManagerBal = await mUSD.balanceOf(savings.address)
        return {
            sellTokenBalance: {
                integration: sellBalIntegration,
                liquidator: sellBalLiquidator,
            },
            savingsManagerBal,
            liquidation,
        }
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, sa.governor.address, sa.dummy1.address)

        await redeployLiquidator()

        ctx.sa = sa
        ctx.module = (liquidator as any) as ImmutableModule
    })

    describe("verifying initialization", async () => {
        shouldBehaveLikeModule(ctx as Required<typeof ctx>)

        it("should properly store valid arguments", async () => {
            expect(await liquidator.nexus()).eq(nexus.address)
            expect(await liquidator.uniswap()).eq(uniswap.address)
            expect(await liquidator.curve()).eq(curve.address)
            expect(await liquidator.mUSD()).eq(mUSD.address)
        })
    })

    context("performing basic system flow", async () => {
        describe("creating a new liquidation", () => {
            it("should set up all args", async () => {
                await liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        compIntegration.address,
                        compToken.address,
                        bAsset.address,
                        1,
                        [compToken.address, ZERO_ADDRESS, bAsset.address],
                        simpleToExactAmount(1000, 18),
                        simpleToExactAmount(70, 18),
                    )
                const liquidation = await getLiquidation(compIntegration.address)
                expect(liquidation.sellToken).eq(compToken.address)
                expect(liquidation.bAsset).eq(bAsset.address)
                expect(liquidation.curvePosition).eq(BN.from(1))
                expect(liquidation.lastTriggered).eq(BN.from(0))
                expect(liquidation.sellTranche).eq(simpleToExactAmount(1000, 18))
                expect(liquidation.minReturn).eq(simpleToExactAmount(70, 18))
            })
        })
        describe("triggering a liquidation", () => {
            it("should sell COMP for bAsset and deposit to SavingsManager", async () => {
                const before = await snapshotData()
                await compIntegration.connect(sa.governor.signer).connect(sa.governor.signer).approveRewardToken()
                await liquidator.triggerLiquidation(compIntegration.address)
                const after = await snapshotData()
                expect(after.savingsManagerBal).gt(before.savingsManagerBal as any)
            })
        })
    })
    context("calling constructor", () => {
        it("should fail if any inputs are null", async () => {
            const lq = await new Liquidator__factory(sa.default.signer).deploy(nexus.address)
            await expect(lq.initialize(ZERO_ADDRESS, curve.address, mUSD.address)).to.be.revertedWith("Invalid uniswap address")
            await expect(lq.initialize(uniswap.address, ZERO_ADDRESS, mUSD.address)).to.be.revertedWith("Invalid curve address")
            await expect(lq.initialize(uniswap.address, curve.address, ZERO_ADDRESS)).to.be.revertedWith("Invalid mUSD address")
        })
    })
    context("creating a new liquidation", () => {
        before(async () => {
            await redeployLiquidator()
        })
        it("should fail if any inputs are null", async () => {
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        ZERO_ADDRESS,
                        compToken.address,
                        bAsset.address,
                        1,
                        [compToken.address, ZERO_ADDRESS, bAsset.address],
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                    ),
            ).to.be.revertedWith("Invalid inputs")
        })
        it("should fail if uniswap path is invalid", async () => {
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        compIntegration.address,
                        compToken.address,
                        bAsset.address,
                        1,
                        [compToken.address, ZERO_ADDRESS, bAsset2.address],
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                    ),
            ).to.be.revertedWith("Invalid uniswap path")

            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        compIntegration.address,
                        compToken.address,
                        bAsset.address,
                        1,
                        [compToken.address, ZERO_ADDRESS],
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                    ),
            ).to.be.revertedWith("Invalid uniswap path")
        })
        it("should fail if liquidation already exists", async () => {
            await liquidator
                .connect(sa.governor.signer)
                .createLiquidation(
                    compIntegration.address,
                    compToken.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(1000, 18),
                    simpleToExactAmount(70, 18),
                )
            const liquidation = await getLiquidation(compIntegration.address)
            expect(liquidation.sellToken).eq(compToken.address)
            expect(liquidation.bAsset).eq(bAsset.address)
            expect(liquidation.curvePosition).eq(BN.from(1))
            expect(liquidation.lastTriggered).eq(BN.from(0))
            expect(liquidation.sellTranche).eq(simpleToExactAmount(1000, 18))
            expect(liquidation.minReturn).eq(simpleToExactAmount(70, 18))
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        compIntegration.address,
                        compToken.address,
                        bAsset.address,
                        1,
                        [compToken.address, ZERO_ADDRESS, bAsset.address],
                        simpleToExactAmount(1000, 18),
                        simpleToExactAmount(70, 18),
                    ),
            ).to.be.revertedWith("Liquidation exists for this bAsset")
        })
    })
    context("updating an existing liquidation", () => {
        beforeEach(async () => {
            await redeployLiquidator()
            await liquidator
                .connect(sa.governor.signer)
                .createLiquidation(
                    compIntegration.address,
                    compToken.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(1000, 18),
                    simpleToExactAmount(70, 18),
                )
        })
        describe("changing the bAsset", () => {
            it("should fail if liquidation does not exist", async () => {
                await expect(
                    liquidator
                        .connect(sa.governor.signer)
                        .updateBasset(sa.dummy2.address, bAsset.address, 1, [], simpleToExactAmount(1, 18), simpleToExactAmount(70, 18)),
                ).to.be.revertedWith("Liquidation does not exist")
            })
            it("should fail if bAsset is null", async () => {
                await expect(
                    liquidator
                        .connect(sa.governor.signer)
                        .updateBasset(
                            compIntegration.address,
                            ZERO_ADDRESS,
                            1,
                            [],
                            simpleToExactAmount(1, 18),
                            simpleToExactAmount(70, 18),
                        ),
                ).to.be.revertedWith("Invalid bAsset")
            })
            it("should fail if uniswap path is invalid", async () => {
                await expect(
                    liquidator
                        .connect(sa.governor.signer)
                        .updateBasset(
                            compIntegration.address,
                            bAsset.address,
                            1,
                            [bAsset2.address],
                            simpleToExactAmount(1, 18),
                            simpleToExactAmount(70, 18),
                        ),
                ).to.be.revertedWith("Invalid uniswap path")
            })
            it("should update the bAsset successfully", async () => {
                // update uniswap path, bAsset, tranch amount
                const tx = liquidator
                    .connect(sa.governor.signer)
                    .updateBasset(
                        compIntegration.address,
                        bAsset2.address,
                        2,
                        [compToken.address, ZERO_ADDRESS, bAsset2.address],
                        simpleToExactAmount(123, 18),
                        simpleToExactAmount(70, 18),
                    )
                await expect(tx).to.emit(liquidator, "LiquidationModified").withArgs(compIntegration.address)
                const liquidation = await getLiquidation(compIntegration.address)
                expect(liquidation.sellToken).eq(compToken.address)
                expect(liquidation.bAsset).eq(bAsset2.address)
                expect(liquidation.curvePosition).eq(BN.from(2))
                expect(liquidation.sellTranche).eq(simpleToExactAmount(123, 18))
            })
        })
        describe("removing the liquidation altogether", () => {
            it("should fail if liquidation doesn't exist", async () => {
                await expect(liquidator.connect(sa.governor.signer).deleteLiquidation(sa.dummy2.address)).to.be.revertedWith(
                    "Liquidation does not exist",
                )
            })
            it("should delete the liquidation", async () => {
                // update uniswap path, bAsset, tranch amount
                const tx = liquidator.connect(sa.governor.signer).deleteLiquidation(compIntegration.address)
                await expect(tx).to.emit(liquidator, "LiquidationEnded").withArgs(compIntegration.address)
                const oldLiq = await getLiquidation(compIntegration.address)
                expect(oldLiq.bAsset).eq("0x0000000000000000000000000000000000000000")
                expect(oldLiq.curvePosition).eq(BN.from(0))
            })
        })
    })
    context("triggering a liquidation", () => {
        beforeEach(async () => {
            await redeployLiquidator()
            await liquidator
                .connect(sa.governor.signer)
                .createLiquidation(
                    compIntegration.address,
                    compToken.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(1000, 18),
                    simpleToExactAmount(70, 18),
                )
            await compIntegration.connect(sa.governor.signer).approveRewardToken()
        })
        it("should fail if called via contract", async () => {
            const mock = await new MockTrigger__factory(sa.default.signer).deploy()
            await expect(mock.trigger(liquidator.address, compIntegration.address)).to.be.revertedWith("Must be EOA")
        })
        it("should fail if liquidation does not exist", async () => {
            await expect(liquidator.triggerLiquidation(sa.dummy2.address)).to.be.revertedWith("Liquidation does not exist")
        })
        it("should fail if Uniswap price is below the floor", async () => {
            await uniswap.setRatio(69)
            await expect(liquidator.triggerLiquidation(compIntegration.address)).to.be.revertedWith("UNI: Output amount not enough")
            await uniswap.setRatio(71)
            await liquidator.triggerLiquidation(compIntegration.address)
        })

        it("should fail if Curve price is below the floor", async () => {
            await curve.setRatio(simpleToExactAmount(9, 17))
            await expect(liquidator.triggerLiquidation(compIntegration.address)).to.be.revertedWith("CRV: Output amount not enough")
            await curve.setRatio(simpleToExactAmount(96, 16))
            await liquidator.triggerLiquidation(compIntegration.address)
        })
        it("should sell everything if the liquidator has less balance than tranche size", async () => {
            const s0 = await snapshotData()
            await liquidator
                .connect(sa.governor.signer)
                .updateBasset(
                    compIntegration.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(1, 30),
                    simpleToExactAmount(70, 18),
                )
            // set tranche size to 1e30
            await liquidator.triggerLiquidation(compIntegration.address)

            const s1 = await snapshotData()
            // 10 COMP liquidated for > 1000 mUSD
            expect(s1.savingsManagerBal.sub(s0.savingsManagerBal)).gt(simpleToExactAmount(1000, 18))

            await increaseTime(ONE_WEEK.add(1))
            await expect(liquidator.triggerLiquidation(compIntegration.address)).to.be.revertedWith("No sell tokens to liquidate")
        })
        it("should pause liquidations if set to 0", async () => {
            await liquidator
                .connect(sa.governor.signer)
                .updateBasset(
                    compIntegration.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS, bAsset.address],
                    BN.from(0),
                    simpleToExactAmount(70, 18),
                )
            await expect(liquidator.triggerLiquidation(compIntegration.address)).to.be.revertedWith("Liquidation has been paused")
        })
        it("should fail if called within 7 days of the previous", async () => {
            await liquidator.triggerLiquidation(compIntegration.address)
            await increaseTime(ONE_DAY.mul(5))
            await expect(liquidator.triggerLiquidation(compIntegration.address)).to.be.revertedWith("Must wait for interval")
            await increaseTime(ONE_DAY.mul(3))
            await liquidator.triggerLiquidation(compIntegration.address)
        })
    })
})
