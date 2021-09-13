import { expect } from "chai"
import { ethers } from "hardhat"

import { BN, simpleToExactAmount } from "@utils/math"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { ONE_HOUR, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import {
    AssetProxy__factory,
    MockERC20,
    MockERC20__factory,
    MockMasset,
    MockMasset__factory,
    MockNexus,
    SavingsContract__factory,
    SavingsManager,
    MockUniswap__factory,
    SavingsManager__factory,
    MockUniswap,
    MockNexus__factory,
    ImmutableModule,
    MockTrigger__factory,
    MockAaveIncentivesController,
    PAaveIntegration,
    PAaveIntegration__factory,
    MockAaveIncentivesController__factory,
    PLiquidator__factory,
    PLiquidator,
} from "types/generated"
import { increaseTime } from "@utils/time"
import { shouldBehaveLikeModule, IModuleBehaviourContext } from "../shared/Module.behaviour"

describe("Liquidator", () => {
    let sa: StandardAccounts
    const ctx: Partial<IModuleBehaviourContext> = {}

    let mockAAVE: string
    let pTokens: string[]
    let bAssets: MockERC20[]
    let nexus: MockNexus
    let liquidator: PLiquidator
    let bAsset: MockERC20
    let bAsset2: MockERC20
    let mUSD: MockMasset
    let paaveIntegration: PAaveIntegration
    let rewardsToken: MockERC20
    let savings: SavingsManager
    let uniswap: MockUniswap
    let incentivesController: MockAaveIncentivesController

    interface Liquidation {
        sellToken: string
        bAsset: string
        uniswapPath?: string[]
        lastTriggered: BN
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
        rewardsToken = await new MockERC20__factory(sa.default.signer).deploy("RWD", "RWD", 18, sa.fundManager.address, 100000000)
        incentivesController = await new MockAaveIncentivesController__factory(sa.default.signer).deploy(rewardsToken.address)
        await rewardsToken.connect(sa.fundManager.signer).transfer(incentivesController.address, simpleToExactAmount(1, 21))
        paaveIntegration = await new PAaveIntegration__factory(sa.default.signer).deploy(
            nexus.address,
            mUSD.address,
            mockAAVE,
            rewardsToken.address,
            incentivesController.address,
        )
        await paaveIntegration.initialize(
            bAssets.map((b) => b.address),
            pTokens,
        )
        // Add the module
        // Liquidator
        const impl = await new PLiquidator__factory(sa.default.signer).deploy(nexus.address, uniswap.address, mUSD.address)
        const proxy = await new AssetProxy__factory(sa.default.signer).deploy(impl.address, sa.other.address, "0x")
        liquidator = await PLiquidator__factory.connect(proxy.address, sa.default.signer)

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

    const getLiquidation = async (addr: string): Promise<Liquidation> => {
        const liquidation = await liquidator.liquidations(addr)
        const minReturn = await liquidator.minReturn(addr)
        return {
            sellToken: liquidation[0],
            bAsset: liquidation[1],
            lastTriggered: liquidation[2],
            minReturn,
        }
    }
    const snapshotData = async (): Promise<Data> => {
        const liquidation = await getLiquidation(liquidator.address)
        const sellBalIntegration = await rewardsToken.balanceOf(paaveIntegration.address)
        const sellBalLiquidator = await rewardsToken.balanceOf(liquidator.address)
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
        const massetDetails = await mAssetMachine.deployMasset(true)
        mockAAVE = massetDetails.aavePlatformAddress
        bAssets = massetDetails.bAssets
        pTokens = massetDetails.pTokens
        sa = mAssetMachine.sa
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, sa.governor.address, sa.dummy1.address)

        await redeployLiquidator()

        ctx.sa = sa
        ctx.module = liquidator as ImmutableModule
    })

    describe("verifying initialization", async () => {
        shouldBehaveLikeModule(ctx as Required<typeof ctx>)

        it("should properly store valid arguments", async () => {
            expect(await liquidator.nexus()).eq(nexus.address)
            expect(await liquidator.quickSwap()).eq(uniswap.address)
            expect(await liquidator.mUSD()).eq(mUSD.address)
        })
    })

    context("claiming rewards from incentivesController", () => {
        it("should use all pToken addresses and claim rewards", async () => {
            const balBefore = await rewardsToken.balanceOf(paaveIntegration.address)
            const tx = paaveIntegration.claimRewards()
            await expect(tx).to.emit(paaveIntegration, "RewardsClaimed").withArgs(pTokens, simpleToExactAmount(1, 20))

            const balAfter = await rewardsToken.balanceOf(paaveIntegration.address)
            expect(balAfter).eq(balBefore.add(simpleToExactAmount(1, 20)))
        })
    })

    context("performing basic system flow", async () => {
        describe("creating a new liquidation", () => {
            it("should set up all args", async () => {
                await liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        paaveIntegration.address,
                        rewardsToken.address,
                        bAsset.address,
                        [rewardsToken.address, ZERO_ADDRESS, bAsset.address],
                        simpleToExactAmount(70, 18),
                    )
                const liquidation = await getLiquidation(paaveIntegration.address)
                expect(liquidation.sellToken).eq(rewardsToken.address)
                expect(liquidation.bAsset).eq(bAsset.address)
                expect(liquidation.lastTriggered).eq(BN.from(0))
                expect(liquidation.minReturn).eq(simpleToExactAmount(70, 18))
            })
        })
        describe("triggering a liquidation", () => {
            it("should sell COMP for bAsset and deposit to SavingsManager", async () => {
                const before = await snapshotData()
                await paaveIntegration.connect(sa.governor.signer).approveRewardToken()
                await paaveIntegration.claimRewards()
                await liquidator.triggerLiquidation(paaveIntegration.address)
                const after = await snapshotData()
                expect(after.savingsManagerBal).gt(before.savingsManagerBal)
            })
        })
    })
    context("calling constructor", () => {
        it("should fail if any inputs are null", async () => {
            const factory = await new PLiquidator__factory(sa.default.signer)
            await expect(factory.deploy(ZERO_ADDRESS, uniswap.address, mUSD.address)).to.be.revertedWith("Nexus address is zero")
            await expect(factory.deploy(nexus.address, ZERO_ADDRESS, mUSD.address)).to.be.revertedWith("Invalid quickSwap address")
            await expect(factory.deploy(nexus.address, uniswap.address, ZERO_ADDRESS)).to.be.revertedWith("Invalid mUSD address")
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
                        rewardsToken.address,
                        bAsset.address,
                        [rewardsToken.address, ZERO_ADDRESS, bAsset.address],
                        simpleToExactAmount(70, 18),
                    ),
            ).to.be.revertedWith("Invalid inputs")
        })
        it("should fail if uniswap path is invalid", async () => {
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        paaveIntegration.address,
                        rewardsToken.address,
                        bAsset.address,
                        [rewardsToken.address, ZERO_ADDRESS, bAsset2.address],
                        simpleToExactAmount(70, 18),
                    ),
            ).to.be.revertedWith("Invalid uniswap path")

            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        paaveIntegration.address,
                        rewardsToken.address,
                        bAsset.address,
                        [rewardsToken.address, ZERO_ADDRESS],
                        simpleToExactAmount(70, 18),
                    ),
            ).to.be.revertedWith("Invalid uniswap path")
        })
        it("should fail if liquidation already exists", async () => {
            await liquidator
                .connect(sa.governor.signer)
                .createLiquidation(
                    paaveIntegration.address,
                    rewardsToken.address,
                    bAsset.address,
                    [rewardsToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(70, 18),
                )
            const liquidation = await getLiquidation(paaveIntegration.address)
            expect(liquidation.sellToken).eq(rewardsToken.address)
            expect(liquidation.bAsset).eq(bAsset.address)
            expect(liquidation.lastTriggered).eq(BN.from(0))
            expect(liquidation.minReturn).eq(simpleToExactAmount(70, 18))
            await expect(
                liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(
                        paaveIntegration.address,
                        rewardsToken.address,
                        bAsset.address,
                        [rewardsToken.address, ZERO_ADDRESS, bAsset.address],
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
                    paaveIntegration.address,
                    rewardsToken.address,
                    bAsset.address,
                    [rewardsToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(70, 18),
                )
        })
        describe("changing the bAsset", () => {
            it("should fail if liquidation does not exist", async () => {
                await expect(
                    liquidator.connect(sa.governor.signer).updateBasset(sa.dummy2.address, bAsset.address, [], simpleToExactAmount(70, 18)),
                ).to.be.revertedWith("Liquidation does not exist")
            })
            it("should fail if bAsset is null", async () => {
                await expect(
                    liquidator
                        .connect(sa.governor.signer)
                        .updateBasset(paaveIntegration.address, ZERO_ADDRESS, [], simpleToExactAmount(70, 18)),
                ).to.be.revertedWith("Invalid bAsset")
            })
            it("should fail if uniswap path is invalid", async () => {
                await expect(
                    liquidator
                        .connect(sa.governor.signer)
                        .updateBasset(paaveIntegration.address, bAsset.address, [bAsset2.address], simpleToExactAmount(70, 18)),
                ).to.be.revertedWith("Invalid uniswap path")
            })
            it("should update the bAsset successfully", async () => {
                // update uniswap path, bAsset, tranch amount
                const tx = liquidator
                    .connect(sa.governor.signer)
                    .updateBasset(
                        paaveIntegration.address,
                        bAsset2.address,
                        [rewardsToken.address, ZERO_ADDRESS, bAsset2.address],
                        simpleToExactAmount(70, 18),
                    )
                await expect(tx).to.emit(liquidator, "LiquidationModified").withArgs(paaveIntegration.address)
                const liquidation = await getLiquidation(paaveIntegration.address)
                expect(liquidation.sellToken).eq(rewardsToken.address)
                expect(liquidation.bAsset).eq(bAsset2.address)
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
                const tx = liquidator.connect(sa.governor.signer).deleteLiquidation(paaveIntegration.address)
                await expect(tx).to.emit(liquidator, "LiquidationEnded").withArgs(paaveIntegration.address)
                const oldLiq = await getLiquidation(paaveIntegration.address)
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
                    paaveIntegration.address,
                    rewardsToken.address,
                    bAsset.address,
                    [rewardsToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(70, 18),
                )
            await paaveIntegration.connect(sa.governor.signer).approveRewardToken()
        })
        it("should fail if called via contract", async () => {
            const mock = await new MockTrigger__factory(sa.default.signer).deploy()
            await expect(mock.trigger(liquidator.address, paaveIntegration.address)).to.be.revertedWith("Must be EOA")
        })
        it("should fail if liquidation does not exist", async () => {
            await expect(liquidator.triggerLiquidation(sa.dummy2.address)).to.be.revertedWith("Liquidation does not exist")
        })
        it("should fail if Uniswap price is below the floor", async () => {
            await paaveIntegration.claimRewards()
            await uniswap.setRatio(69)
            await expect(liquidator.triggerLiquidation(paaveIntegration.address)).to.be.revertedWith("UNI: Output amount not enough")
            await uniswap.setRatio(71)
            await liquidator.triggerLiquidation(paaveIntegration.address)
        })
        it("should fail if mUSD price is below the floor", async () => {
            await paaveIntegration.claimRewards()
            await mUSD.setRatio(simpleToExactAmount(8, 17))
            await expect(liquidator.triggerLiquidation(paaveIntegration.address)).to.be.revertedWith("MINT: Output amount not enough")
            await mUSD.setRatio(simpleToExactAmount(96, 16))
            await liquidator.triggerLiquidation(paaveIntegration.address)
        })
        it("should fail if called within 7 days of the previous", async () => {
            await paaveIntegration.claimRewards()
            await liquidator.triggerLiquidation(paaveIntegration.address)
            await increaseTime(ONE_HOUR.mul(20))
            await paaveIntegration.claimRewards()
            await expect(liquidator.triggerLiquidation(paaveIntegration.address)).to.be.revertedWith("Must wait for interval")
            await increaseTime(ONE_HOUR.mul(3))
            await liquidator.triggerLiquidation(paaveIntegration.address)
        })
    })
})
