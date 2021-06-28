"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const math_1 = require("@utils/math");
const machines_1 = require("@utils/machines");
const constants_1 = require("@utils/constants");
const generated_1 = require("types/generated");
const time_1 = require("@utils/time");
const Module_behaviour_1 = require("../shared/Module.behaviour");
describe("Liquidator", () => {
    let sa;
    const ctx = {};
    let mockAAVE;
    let pTokens;
    let bAssets;
    let nexus;
    let liquidator;
    let bAsset;
    let bAsset2;
    let mUSD;
    let paaveIntegration;
    let rewardsToken;
    let savings;
    let uniswap;
    let incentivesController;
    // Real deployment steps:
    // - Deploy Liquidator & add Liquidation
    // - Add to modules
    // - Upgrade COMP
    const redeployLiquidator = async () => {
        // Fake mUSD & uniswap
        mUSD = await new generated_1.MockMasset__factory(sa.default.signer).deploy("mStable USD", "mUSD", 18, sa.fundManager.address, 100000000);
        uniswap = await new generated_1.MockUniswap__factory(sa.default.signer).deploy();
        // Set up Comp Integration
        bAsset = await new generated_1.MockERC20__factory(sa.default.signer).deploy("Mock1", "MK1", 18, sa.fundManager.address, 100000000);
        await bAsset.connect(sa.fundManager.signer).transfer(uniswap.address, math_1.simpleToExactAmount(100000, 18));
        bAsset2 = await new generated_1.MockERC20__factory(sa.default.signer).deploy("Mock2", "MK2", 18, sa.fundManager.address, 100000000);
        await bAsset2.connect(sa.fundManager.signer).transfer(uniswap.address, math_1.simpleToExactAmount(100000, 18));
        rewardsToken = await new generated_1.MockERC20__factory(sa.default.signer).deploy("RWD", "RWD", 18, sa.fundManager.address, 100000000);
        incentivesController = await new generated_1.MockAaveIncentivesController__factory(sa.default.signer).deploy(rewardsToken.address);
        await rewardsToken.connect(sa.fundManager.signer).transfer(incentivesController.address, math_1.simpleToExactAmount(1, 21));
        paaveIntegration = await new generated_1.PAaveIntegration__factory(sa.default.signer).deploy(nexus.address, mUSD.address, mockAAVE, rewardsToken.address, incentivesController.address);
        await paaveIntegration.initialize(bAssets.map((b) => b.address), pTokens);
        // Add the module
        // Liquidator
        const impl = await new generated_1.PLiquidator__factory(sa.default.signer).deploy(nexus.address, uniswap.address, mUSD.address);
        const proxy = await new generated_1.AssetProxy__factory(sa.default.signer).deploy(impl.address, sa.other.address, "0x");
        liquidator = await generated_1.PLiquidator__factory.connect(proxy.address, sa.default.signer);
        const save = await new generated_1.SavingsContract__factory(sa.default.signer).deploy(nexus.address, mUSD.address);
        await save.initialize(sa.default.address, "Savings Credit", "imUSD");
        savings = await new generated_1.SavingsManager__factory(sa.default.signer).deploy(nexus.address, mUSD.address, save.address, math_1.simpleToExactAmount(1, 18), constants_1.ONE_WEEK);
        await nexus.setSavingsManager(savings.address);
        await nexus.setLiquidator(liquidator.address);
    };
    const getLiquidation = async (addr) => {
        const liquidation = await liquidator.liquidations(addr);
        const minReturn = await liquidator.minReturn(addr);
        return {
            sellToken: liquidation[0],
            bAsset: liquidation[1],
            lastTriggered: liquidation[2],
            minReturn,
        };
    };
    const snapshotData = async () => {
        const liquidation = await getLiquidation(liquidator.address);
        const sellBalIntegration = await rewardsToken.balanceOf(paaveIntegration.address);
        const sellBalLiquidator = await rewardsToken.balanceOf(liquidator.address);
        const savingsManagerBal = await mUSD.balanceOf(savings.address);
        return {
            sellTokenBalance: {
                integration: sellBalIntegration,
                liquidator: sellBalLiquidator,
            },
            savingsManagerBal,
            liquidation,
        };
    };
    before(async () => {
        const accounts = await hardhat_1.ethers.getSigners();
        const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
        const massetDetails = await mAssetMachine.deployMasset(true);
        mockAAVE = massetDetails.aavePlatformAddress;
        bAssets = massetDetails.bAssets;
        pTokens = massetDetails.pTokens;
        sa = mAssetMachine.sa;
        nexus = await new generated_1.MockNexus__factory(sa.default.signer).deploy(sa.governor.address, sa.governor.address, sa.dummy1.address);
        await redeployLiquidator();
        ctx.sa = sa;
        ctx.module = liquidator;
    });
    describe("verifying initialization", async () => {
        Module_behaviour_1.shouldBehaveLikeModule(ctx);
        it("should properly store valid arguments", async () => {
            chai_1.expect(await liquidator.nexus()).eq(nexus.address);
            chai_1.expect(await liquidator.quickSwap()).eq(uniswap.address);
            chai_1.expect(await liquidator.mUSD()).eq(mUSD.address);
        });
    });
    context("claiming rewards from incentivesController", () => {
        it("should use all pToken addresses and claim rewards", async () => {
            const balBefore = await rewardsToken.balanceOf(paaveIntegration.address);
            const tx = paaveIntegration.claimRewards();
            await chai_1.expect(tx)
                .to.emit(paaveIntegration, "RewardsClaimed")
                .withArgs(pTokens, math_1.simpleToExactAmount(1, 20));
            const balAfter = await rewardsToken.balanceOf(paaveIntegration.address);
            chai_1.expect(balAfter).eq(balBefore.add(math_1.simpleToExactAmount(1, 20)));
        });
    });
    context("performing basic system flow", async () => {
        describe("creating a new liquidation", () => {
            it("should set up all args", async () => {
                await liquidator
                    .connect(sa.governor.signer)
                    .createLiquidation(paaveIntegration.address, rewardsToken.address, bAsset.address, [rewardsToken.address, constants_1.ZERO_ADDRESS, bAsset.address], math_1.simpleToExactAmount(70, 18));
                const liquidation = await getLiquidation(paaveIntegration.address);
                chai_1.expect(liquidation.sellToken).eq(rewardsToken.address);
                chai_1.expect(liquidation.bAsset).eq(bAsset.address);
                chai_1.expect(liquidation.lastTriggered).eq(math_1.BN.from(0));
                chai_1.expect(liquidation.minReturn).eq(math_1.simpleToExactAmount(70, 18));
            });
        });
        describe("triggering a liquidation", () => {
            it("should sell COMP for bAsset and deposit to SavingsManager", async () => {
                const before = await snapshotData();
                await paaveIntegration.connect(sa.governor.signer).approveRewardToken();
                await paaveIntegration.claimRewards();
                await liquidator.triggerLiquidation(paaveIntegration.address);
                const after = await snapshotData();
                chai_1.expect(after.savingsManagerBal).gt(before.savingsManagerBal);
            });
        });
    });
    context("calling constructor", () => {
        it("should fail if any inputs are null", async () => {
            const factory = await new generated_1.PLiquidator__factory(sa.default.signer);
            await chai_1.expect(factory.deploy(constants_1.ZERO_ADDRESS, uniswap.address, mUSD.address)).to.be.revertedWith("Nexus address is zero");
            await chai_1.expect(factory.deploy(nexus.address, constants_1.ZERO_ADDRESS, mUSD.address)).to.be.revertedWith("Invalid quickSwap address");
            await chai_1.expect(factory.deploy(nexus.address, uniswap.address, constants_1.ZERO_ADDRESS)).to.be.revertedWith("Invalid mUSD address");
        });
    });
    context("creating a new liquidation", () => {
        before(async () => {
            await redeployLiquidator();
        });
        it("should fail if any inputs are null", async () => {
            await chai_1.expect(liquidator
                .connect(sa.governor.signer)
                .createLiquidation(constants_1.ZERO_ADDRESS, rewardsToken.address, bAsset.address, [rewardsToken.address, constants_1.ZERO_ADDRESS, bAsset.address], math_1.simpleToExactAmount(70, 18))).to.be.revertedWith("Invalid inputs");
        });
        it("should fail if uniswap path is invalid", async () => {
            await chai_1.expect(liquidator
                .connect(sa.governor.signer)
                .createLiquidation(paaveIntegration.address, rewardsToken.address, bAsset.address, [rewardsToken.address, constants_1.ZERO_ADDRESS, bAsset2.address], math_1.simpleToExactAmount(70, 18))).to.be.revertedWith("Invalid uniswap path");
            await chai_1.expect(liquidator
                .connect(sa.governor.signer)
                .createLiquidation(paaveIntegration.address, rewardsToken.address, bAsset.address, [rewardsToken.address, constants_1.ZERO_ADDRESS], math_1.simpleToExactAmount(70, 18))).to.be.revertedWith("Invalid uniswap path");
        });
        it("should fail if liquidation already exists", async () => {
            await liquidator
                .connect(sa.governor.signer)
                .createLiquidation(paaveIntegration.address, rewardsToken.address, bAsset.address, [rewardsToken.address, constants_1.ZERO_ADDRESS, bAsset.address], math_1.simpleToExactAmount(70, 18));
            const liquidation = await getLiquidation(paaveIntegration.address);
            chai_1.expect(liquidation.sellToken).eq(rewardsToken.address);
            chai_1.expect(liquidation.bAsset).eq(bAsset.address);
            chai_1.expect(liquidation.lastTriggered).eq(math_1.BN.from(0));
            chai_1.expect(liquidation.minReturn).eq(math_1.simpleToExactAmount(70, 18));
            await chai_1.expect(liquidator
                .connect(sa.governor.signer)
                .createLiquidation(paaveIntegration.address, rewardsToken.address, bAsset.address, [rewardsToken.address, constants_1.ZERO_ADDRESS, bAsset.address], math_1.simpleToExactAmount(70, 18))).to.be.revertedWith("Liquidation exists for this bAsset");
        });
    });
    context("updating an existing liquidation", () => {
        beforeEach(async () => {
            await redeployLiquidator();
            await liquidator
                .connect(sa.governor.signer)
                .createLiquidation(paaveIntegration.address, rewardsToken.address, bAsset.address, [rewardsToken.address, constants_1.ZERO_ADDRESS, bAsset.address], math_1.simpleToExactAmount(70, 18));
        });
        describe("changing the bAsset", () => {
            it("should fail if liquidation does not exist", async () => {
                await chai_1.expect(liquidator.connect(sa.governor.signer).updateBasset(sa.dummy2.address, bAsset.address, [], math_1.simpleToExactAmount(70, 18))).to.be.revertedWith("Liquidation does not exist");
            });
            it("should fail if bAsset is null", async () => {
                await chai_1.expect(liquidator
                    .connect(sa.governor.signer)
                    .updateBasset(paaveIntegration.address, constants_1.ZERO_ADDRESS, [], math_1.simpleToExactAmount(70, 18))).to.be.revertedWith("Invalid bAsset");
            });
            it("should fail if uniswap path is invalid", async () => {
                await chai_1.expect(liquidator
                    .connect(sa.governor.signer)
                    .updateBasset(paaveIntegration.address, bAsset.address, [bAsset2.address], math_1.simpleToExactAmount(70, 18))).to.be.revertedWith("Invalid uniswap path");
            });
            it("should update the bAsset successfully", async () => {
                // update uniswap path, bAsset, tranch amount
                const tx = liquidator
                    .connect(sa.governor.signer)
                    .updateBasset(paaveIntegration.address, bAsset2.address, [rewardsToken.address, constants_1.ZERO_ADDRESS, bAsset2.address], math_1.simpleToExactAmount(70, 18));
                await chai_1.expect(tx)
                    .to.emit(liquidator, "LiquidationModified")
                    .withArgs(paaveIntegration.address);
                const liquidation = await getLiquidation(paaveIntegration.address);
                chai_1.expect(liquidation.sellToken).eq(rewardsToken.address);
                chai_1.expect(liquidation.bAsset).eq(bAsset2.address);
            });
        });
        describe("removing the liquidation altogether", () => {
            it("should fail if liquidation doesn't exist", async () => {
                await chai_1.expect(liquidator.connect(sa.governor.signer).deleteLiquidation(sa.dummy2.address)).to.be.revertedWith("Liquidation does not exist");
            });
            it("should delete the liquidation", async () => {
                // update uniswap path, bAsset, tranch amount
                const tx = liquidator.connect(sa.governor.signer).deleteLiquidation(paaveIntegration.address);
                await chai_1.expect(tx)
                    .to.emit(liquidator, "LiquidationEnded")
                    .withArgs(paaveIntegration.address);
                const oldLiq = await getLiquidation(paaveIntegration.address);
                chai_1.expect(oldLiq.bAsset).eq("0x0000000000000000000000000000000000000000");
            });
        });
    });
    context("triggering a liquidation", () => {
        beforeEach(async () => {
            await redeployLiquidator();
            await liquidator
                .connect(sa.governor.signer)
                .createLiquidation(paaveIntegration.address, rewardsToken.address, bAsset.address, [rewardsToken.address, constants_1.ZERO_ADDRESS, bAsset.address], math_1.simpleToExactAmount(70, 18));
            await paaveIntegration.connect(sa.governor.signer).approveRewardToken();
        });
        it("should fail if called via contract", async () => {
            const mock = await new generated_1.MockTrigger__factory(sa.default.signer).deploy();
            await chai_1.expect(mock.trigger(liquidator.address, paaveIntegration.address)).to.be.revertedWith("Must be EOA");
        });
        it("should fail if liquidation does not exist", async () => {
            await chai_1.expect(liquidator.triggerLiquidation(sa.dummy2.address)).to.be.revertedWith("Liquidation does not exist");
        });
        it("should fail if Uniswap price is below the floor", async () => {
            await paaveIntegration.claimRewards();
            await uniswap.setRatio(69);
            await chai_1.expect(liquidator.triggerLiquidation(paaveIntegration.address)).to.be.revertedWith("UNI: Output amount not enough");
            await uniswap.setRatio(71);
            await liquidator.triggerLiquidation(paaveIntegration.address);
        });
        it("should fail if mUSD price is below the floor", async () => {
            await paaveIntegration.claimRewards();
            await mUSD.setRatio(math_1.simpleToExactAmount(8, 17));
            await chai_1.expect(liquidator.triggerLiquidation(paaveIntegration.address)).to.be.revertedWith("MINT: Output amount not enough");
            await mUSD.setRatio(math_1.simpleToExactAmount(96, 16));
            await liquidator.triggerLiquidation(paaveIntegration.address);
        });
        it("should fail if called within 7 days of the previous", async () => {
            await paaveIntegration.claimRewards();
            await liquidator.triggerLiquidation(paaveIntegration.address);
            await time_1.increaseTime(constants_1.ONE_HOUR.mul(20));
            await paaveIntegration.claimRewards();
            await chai_1.expect(liquidator.triggerLiquidation(paaveIntegration.address)).to.be.revertedWith("Must wait for interval");
            await time_1.increaseTime(constants_1.ONE_HOUR.mul(3));
            await liquidator.triggerLiquidation(paaveIntegration.address);
        });
    });
});
//# sourceMappingURL=pliquidator.spec.js.map