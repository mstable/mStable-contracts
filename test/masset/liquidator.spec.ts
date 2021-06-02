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
    MockRewardToken,
    MockCurveMetaPool__factory,
    Liquidator__factory,
    SavingsManager__factory,
    MockCurveMetaPool,
    MockRewardToken__factory,
    MockNexus__factory,
    ImmutableModule,
    MockTrigger__factory,
    MockUniswapV3,
    MockUniswapV3__factory,
} from "types/generated"
import { increaseTime } from "@utils/time"
import { EncodedPaths, encodeUniswapPath } from "@utils/peripheral/uniswap"
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
    let aaveToken: MockERC20
    let stkAaveToken: MockERC20
    let savings: SavingsManager
    let uniswap: MockUniswapV3
    let uniswapPaths: EncodedPaths
    let curve: MockCurveMetaPool

    interface Liquidation {
        sellToken: string
        bAsset: string
        uniswapPath?: string
        lastTriggered: BN
        trancheAmount: BN
        minReturn: BN
        mAsset: string
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
        // Fake mUSD
        mUSD = await new MockMasset__factory(sa.default.signer).deploy("mStable USD", "mUSD", 18, sa.fundManager.address, 100000000)
        // Set up Comp Integration
        bAsset = await new MockERC20__factory(sa.default.signer).deploy("Mock1", "MK1", 18, sa.fundManager.address, 100000000)
        bAsset2 = await new MockERC20__factory(sa.default.signer).deploy("Mock2", "MK2", 18, sa.fundManager.address, 100000000)
        compIntegration = await new MockRewardToken__factory(sa.default.signer).deploy(nexus.address)
        // Set up Curve
        curve = await new MockCurveMetaPool__factory(sa.default.signer).deploy(
            [mUSD.address, bAsset.address, bAsset2.address],
            mUSD.address,
        )
        await mUSD.connect(sa.fundManager.signer).transfer(curve.address, simpleToExactAmount(100000, 18))

        // Create COMP token and assign, then approve the liquidator
        compToken = await new MockERC20__factory(sa.default.signer).deploy("Compound Gov", "COMP", 18, sa.fundManager.address, 100000000)
        aaveToken = await new MockERC20__factory(sa.default.signer).deploy("Aave Gov", "AAVE", 18, sa.fundManager.address, 100000000)
        stkAaveToken = await new MockERC20__factory(sa.default.signer).deploy(
            "Staked Aave",
            "stkAAVE",
            18,
            sa.fundManager.address,
            100000000,
        )
        await compIntegration.setRewardToken(compToken.address)
        await compToken.connect(sa.fundManager.signer).transfer(compIntegration.address, simpleToExactAmount(10, 18))

        // Mocked Uniswap V3
        uniswap = await new MockUniswapV3__factory(sa.default.signer).deploy()
        await bAsset.connect(sa.fundManager.signer).transfer(uniswap.address, simpleToExactAmount(100000, 18))
        await bAsset2.connect(sa.fundManager.signer).transfer(uniswap.address, simpleToExactAmount(100000, 18))
        // Add COMP to bAsset exchange rates
        await uniswap.setRate(compToken.address, bAsset.address, simpleToExactAmount(400, 18))
        await uniswap.setRate(compToken.address, bAsset2.address, simpleToExactAmount(404, 18))
        uniswapPaths = encodeUniswapPath([compToken.address, DEAD_ADDRESS, bAsset.address], [3000, 3000])

        // Add the module
        // Liquidator
        const impl = await new Liquidator__factory(sa.default.signer).deploy(
            nexus.address,
            stkAaveToken.address,
            aaveToken.address,
            uniswap.address,
            uniswap.address,
            compToken.address,
        )
        const data: string = impl.interface.encodeFunctionData("upgrade")
        const proxy = await new AssetProxy__factory(sa.default.signer).deploy(impl.address, sa.other.address, data)
        liquidator = await Liquidator__factory.connect(proxy.address, sa.default.signer)

        const save = await new SavingsContract__factory(sa.default.signer).deploy(nexus.address, mUSD.address)
        await save.initialize(sa.default.address, "Savings Credit", "imUSD")
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

    const snapshotData = async (): Promise<Data> => {
        const liquidation = await liquidator.liquidations(liquidator.address)
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
            expect(await liquidator.nexus(), "nexus").eq(nexus.address)
            expect(await liquidator.uniswapRouter(), "Uniswap Router").eq(uniswap.address)
            expect(await liquidator.uniswapQuoter(), "Uniswap Quoter").eq(uniswap.address)
            expect(await liquidator.stkAave(), "stkAave").eq(stkAaveToken.address)
            expect(await liquidator.aaveToken(), "aaveToken").eq(aaveToken.address)
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
                        uniswapPaths.encoded,
                        uniswapPaths.encodedReversed,
                        simpleToExactAmount(1000, 18),
                        simpleToExactAmount(70, 18),
                        mUSD.address,
                        false,
                    )
                const liquidation = await liquidator.liquidations(compIntegration.address)
                expect(liquidation.sellToken, "sellToken").eq(compToken.address)
                expect(liquidation.bAsset, "bAsset").eq(bAsset.address)
                expect(liquidation.lastTriggered, "lastTriggered").eq(BN.from(0))
                expect(liquidation.trancheAmount, "trancheAmount").eq(simpleToExactAmount(1000, 18))
                expect(liquidation.minReturn, "minReturn").eq(simpleToExactAmount(70, 18))
                expect(liquidation.mAsset, "mAsset").eq(mUSD.address)
                expect(liquidation.aaveBalance, "aaveBalance").eq(0)
            })
        })
        describe("triggering a liquidation", () => {
            it("should sell COMP for bAsset and deposit to SavingsManager", async () => {
                const savingsManagerBalBefore = await mUSD.balanceOf(savings.address)
                await compIntegration.connect(sa.governor.signer).approveRewardToken()
                await liquidator.triggerLiquidation(compIntegration.address)
                expect(await mUSD.balanceOf(savings.address), "Savings Manager mUSD bal increased").gt(savingsManagerBalBefore)
            })
        })
    })
    context("calling constructor", () => {
        it("should fail if any inputs are null", async () => {
            await expect(
                new Liquidator__factory(sa.default.signer).deploy(
                    nexus.address,
                    ZERO_ADDRESS,
                    aaveToken.address,
                    uniswap.address,
                    uniswap.address,
                    compToken.address,
                ),
            ).to.be.revertedWith("Invalid stkAAVE address")
            await expect(
                new Liquidator__factory(sa.default.signer).deploy(
                    nexus.address,
                    stkAaveToken.address,
                    ZERO_ADDRESS,
                    uniswap.address,
                    uniswap.address,
                    compToken.address,
                ),
            ).to.be.revertedWith("Invalid AAVE address")
            await expect(
                new Liquidator__factory(sa.default.signer).deploy(
                    nexus.address,
                    stkAaveToken.address,
                    aaveToken.address,
                    ZERO_ADDRESS,
                    uniswap.address,
                    compToken.address,
                ),
            ).to.be.revertedWith("Invalid Uniswap Router address")
            await expect(
                new Liquidator__factory(sa.default.signer).deploy(
                    nexus.address,
                    stkAaveToken.address,
                    aaveToken.address,
                    uniswap.address,
                    ZERO_ADDRESS,
                    compToken.address,
                ),
            ).to.be.revertedWith("Invalid Uniswap Quoter address")
            await expect(
                new Liquidator__factory(sa.default.signer).deploy(
                    nexus.address,
                    stkAaveToken.address,
                    aaveToken.address,
                    uniswap.address,
                    uniswap.address,
                    ZERO_ADDRESS,
                ),
            ).to.be.revertedWith("Invalid COMP address")
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
                        uniswapPaths.encoded,
                        uniswapPaths.encodedReversed,
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                        mUSD.address,
                        false,
                    ),
            ).to.be.revertedWith("Invalid inputs")
        })
        it("should fail if uniswap path is invalid", async () => {
            let invalidPath = encodeUniswapPath([compToken.address, DEAD_ADDRESS, bAsset2.address], [3000, 3000])
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        compIntegration.address,
                        compToken.address,
                        bAsset.address,
                        invalidPath.encoded,
                        invalidPath.encodedReversed,
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                        mUSD.address,
                        false,
                    ),
            ).to.be.revertedWith("Invalid uniswap path")
            invalidPath = encodeUniswapPath([compToken.address, ZERO_ADDRESS], [3000])
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        compIntegration.address,
                        compToken.address,
                        bAsset.address,
                        invalidPath.encoded,
                        invalidPath.encodedReversed,
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                        mUSD.address,
                        false,
                    ),
            ).to.be.revertedWith("Invalid uniswap path")
        })
        it("should fail if uniswap reverse path is invalid", async () => {
            let invalidPath = encodeUniswapPath([compToken.address, DEAD_ADDRESS, bAsset2.address], [3000, 3000])
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        compIntegration.address,
                        compToken.address,
                        bAsset.address,
                        uniswapPaths.encoded,
                        invalidPath.encodedReversed,
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                        mUSD.address,
                        false,
                    ),
            ).to.be.revertedWith("Invalid uniswap path reversed")
            invalidPath = encodeUniswapPath([compToken.address, ZERO_ADDRESS], [3000])
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        compIntegration.address,
                        compToken.address,
                        bAsset.address,
                        uniswapPaths.encoded,
                        invalidPath.encodedReversed,
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                        mUSD.address,
                        false,
                    ),
            ).to.be.revertedWith("Invalid uniswap path reversed")
        })
        it("should fail if liquidation already exists", async () => {
            await liquidator
                .connect(sa.governor.signer)
                .createLiquidation(
                    compIntegration.address,
                    compToken.address,
                    bAsset.address,
                    uniswapPaths.encoded,
                    uniswapPaths.encodedReversed,
                    simpleToExactAmount(1000, 18),
                    simpleToExactAmount(70, 18),
                    mUSD.address,
                    false,
                )
            const liquidation = await liquidator.liquidations(compIntegration.address)
            expect(liquidation.sellToken).eq(compToken.address)
            expect(liquidation.bAsset).eq(bAsset.address)
            expect(liquidation.lastTriggered).eq(BN.from(0))
            expect(liquidation.trancheAmount).eq(simpleToExactAmount(1000, 18))
            expect(liquidation.minReturn).eq(simpleToExactAmount(70, 18))
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        compIntegration.address,
                        compToken.address,
                        bAsset.address,
                        uniswapPaths.encoded,
                        uniswapPaths.encodedReversed,
                        simpleToExactAmount(1000, 18),
                        simpleToExactAmount(70, 18),
                        mUSD.address,
                        false,
                    ),
            ).to.be.revertedWith("Liquidation already exists")
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
                    uniswapPaths.encoded,
                    uniswapPaths.encodedReversed,
                    simpleToExactAmount(1000, 18),
                    simpleToExactAmount(70, 18),
                    mUSD.address,
                    false,
                )
        })
        describe("changing the bAsset", () => {
            it("should fail if liquidation does not exist", async () => {
                await expect(
                    liquidator
                        .connect(sa.governor.signer)
                        .updateBasset(
                            sa.dummy2.address,
                            bAsset.address,
                            uniswapPaths.encoded,
                            uniswapPaths.encodedReversed,
                            simpleToExactAmount(1, 18),
                            simpleToExactAmount(70, 18),
                        ),
                ).to.be.revertedWith("Liquidation does not exist")
            })
            it("should fail if bAsset is null", async () => {
                await expect(
                    liquidator
                        .connect(sa.governor.signer)
                        .updateBasset(
                            compIntegration.address,
                            ZERO_ADDRESS,
                            uniswapPaths.encoded,
                            uniswapPaths.encodedReversed,
                            simpleToExactAmount(1, 18),
                            simpleToExactAmount(70, 18),
                        ),
                ).to.be.revertedWith("Invalid bAsset")
            })
            it("should fail if uniswap path is invalid", async () => {
                const invalidPath = encodeUniswapPath([bAsset2.address], [])
                await expect(
                    liquidator
                        .connect(sa.governor.signer)
                        .updateBasset(
                            compIntegration.address,
                            bAsset.address,
                            invalidPath.encoded,
                            invalidPath.encodedReversed,
                            simpleToExactAmount(1, 18),
                            simpleToExactAmount(70, 18),
                        ),
                ).to.be.revertedWith("Uniswap path too short")
            })
            it("should update the bAsset successfully", async () => {
                const validPath = encodeUniswapPath([compToken.address, DEAD_ADDRESS, bAsset2.address], [3000, 3000])
                // update uniswap path, bAsset, tranch amount
                const tx = liquidator
                    .connect(sa.governor.signer)
                    .updateBasset(
                        compIntegration.address,
                        bAsset2.address,
                        validPath.encoded,
                        validPath.encodedReversed,
                        simpleToExactAmount(123, 18),
                        simpleToExactAmount(70, 18),
                    )
                await expect(tx).to.emit(liquidator, "LiquidationModified").withArgs(compIntegration.address)
                const liquidation = await liquidator.liquidations(compIntegration.address)
                expect(liquidation.sellToken).eq(compToken.address)
                expect(liquidation.bAsset).eq(bAsset2.address)
                expect(liquidation.trancheAmount).eq(simpleToExactAmount(123, 18))
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
                const oldLiq = await liquidator.liquidations(compIntegration.address)
                expect(oldLiq.bAsset).eq("0x0000000000000000000000000000000000000000")
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
                    uniswapPaths.encoded,
                    uniswapPaths.encodedReversed,
                    simpleToExactAmount(1000, 18),
                    simpleToExactAmount(70, 18),
                    mUSD.address,
                    false,
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
            await uniswap.setRate(compToken.address, bAsset.address, simpleToExactAmount(69))
            await expect(liquidator.triggerLiquidation(compIntegration.address)).to.be.revertedWith("Too little received")
            await uniswap.setRate(compToken.address, bAsset.address, simpleToExactAmount(71))
            await liquidator.triggerLiquidation(compIntegration.address)
        })
        it("should sell everything if the liquidator has less balance than tranche size", async () => {
            const s0 = await snapshotData()
            await liquidator
                .connect(sa.governor.signer)
                .updateBasset(
                    compIntegration.address,
                    bAsset.address,
                    uniswapPaths.encoded,
                    uniswapPaths.encodedReversed,
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
                    uniswapPaths.encoded,
                    uniswapPaths.encodedReversed,
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
