import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { StandardAccounts } from "@utils/machines";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import envSetup from "@utils/env_setup";
import { ZERO_ADDRESS } from "@utils/constants";
import * as t from "types/generated";

import shouldBehaveLikeModule from "../../shared/behaviours/Module.behaviour";

const Liquidator = artifacts.require("Liquidator");
const MockCompoundIntegration = artifacts.require("MockCompoundIntegration1");
const SavingsManager = artifacts.require("SavingsManager");
const MockERC20 = artifacts.require("MockERC20");
const MockNexus = artifacts.require("MockNexus");
const MockCurve = artifacts.require("MockCurveMetaPool");
const MockUniswap = artifacts.require("MockUniswap");

const { expect } = envSetup.configure();

contract("Liquidator", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const ctx: { module?: t.InitializableModuleInstance } = {};

    let nexus: t.MockNexusInstance;
    let liquidator: t.LiquidatorInstance;
    let bAsset: t.MockErc20Instance;
    let bAsset2: t.MockErc20Instance;
    let mUSD: t.MockErc20Instance;
    let compIntegration: t.MockCompoundIntegration1Instance;
    let compToken: t.MockErc20Instance;
    let savings: t.SavingsManagerInstance;
    let uniswap: t.MockUniswapInstance;
    let curve: t.MockCurveMetaPoolInstance;

    interface Liquidation {
        sellToken: string;
        bAsset: string;
        curvePosition: BN;
        uniswapPath?: string[];
        lastTriggered: BN;
        sellTranche: BN;
    }

    interface Balance {
        integration: BN;
        liquidator: BN;
    }

    interface Data {
        sellTokenBalance: Balance;
        savingsManagerBal: BN;
        liquidation: Liquidation;
    }

    // Real deployment steps:
    // - Deploy Liquidator & add Liquidation
    // - Add to modules
    // - Upgrade COMP
    const redeployLiquidator = async () => {
        // Fake mUSD & uniswap
        mUSD = await MockERC20.new("mStable USD", "mUSD", 18, sa.fundManager, 100000000);
        uniswap = await MockUniswap.new();

        // Set up Comp Integration
        compIntegration = await MockCompoundIntegration.new();
        bAsset = await MockERC20.new("Mock1", "MK1", 18, sa.fundManager, 100000000);
        await bAsset.transfer(uniswap.address, simpleToExactAmount(100000, 18), {
            from: sa.fundManager,
        });
        bAsset2 = await MockERC20.new("Mock2", "MK2", 18, sa.fundManager, 100000000);
        await bAsset2.transfer(uniswap.address, simpleToExactAmount(100000, 18), {
            from: sa.fundManager,
        });
        await compIntegration.initialize(
            nexus.address,
            [sa.fundManager],
            ZERO_ADDRESS,
            [bAsset.address, bAsset2.address],
            [sa.other, sa.other],
        );

        // Set up Curve
        curve = await MockCurve.new([mUSD.address, bAsset.address, bAsset2.address], mUSD.address);
        await mUSD.transfer(curve.address, simpleToExactAmount(100000, 18), {
            from: sa.fundManager,
        });

        // Create COMP token and assign, then approve the liquidator
        compToken = await MockERC20.new("Compound Gov", "COMP", 18, sa.fundManager, 100000000);
        await compIntegration.setRewardToken(compToken.address);
        await compToken.transfer(compIntegration.address, simpleToExactAmount(10, 18), {
            from: sa.fundManager,
        });

        // Add the module
        // Liquidator
        liquidator = await Liquidator.new();
        await liquidator.initialize(nexus.address, uniswap.address, curve.address, mUSD.address);
        savings = await SavingsManager.new(nexus.address, mUSD.address, sa.other, {
            from: sa.default,
        });
        await nexus.setSavingsManager(savings.address);
        await nexus.setLiquidator(liquidator.address);
    };

    before(async () => {
        nexus = await MockNexus.new(sa.governor, sa.governor, sa.dummy1);

        await redeployLiquidator();
        ctx.module = liquidator as t.InitializableModuleInstance;
    });

    describe("verifying initialization", async () => {
        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

        it("should properly store valid arguments", async () => {
            expect(await liquidator.nexus()).eq(nexus.address);
            expect(await liquidator.uniswap()).eq(uniswap.address);
            expect(await liquidator.curve()).eq(curve.address);
            expect(await liquidator.mUSD()).eq(mUSD.address);
        });
    });

    const getLiquidation = async (addr: string): Promise<Liquidation> => {
        const liquidation = await liquidator.liquidations(addr);
        return {
            sellToken: liquidation[0],
            bAsset: liquidation[1],
            curvePosition: liquidation[2],
            lastTriggered: liquidation[3],
            sellTranche: liquidation[4],
        };
    };
    const snapshotData = async (): Promise<Data> => {
        const liquidation = await getLiquidation(liquidator.address);
        const sellBalIntegration = await compToken.balanceOf(compIntegration.address);
        const sellBalLiquidator = await compToken.balanceOf(liquidator.address);
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

    context("performing basic system flow", async () => {
        describe("creating a new liquidation", () => {
            it("should set up all args", async () => {
                await liquidator.createLiquidation(
                    compIntegration.address,
                    compToken.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(1000, 18),
                    { from: sa.governor },
                );
                const liquidation = await getLiquidation(compIntegration.address);
                expect(liquidation.sellToken).eq(compToken.address);
                expect(liquidation.bAsset).eq(bAsset.address);
                expect(liquidation.curvePosition).bignumber.eq(new BN(1));
                expect(liquidation.lastTriggered).bignumber.eq(new BN(0));
                expect(liquidation.sellTranche).bignumber.eq(simpleToExactAmount(1000, 18));
            });
        });
        describe("triggering a liquidation", () => {
            it("should sell COMP for bAsset and deposit to SavingsManager", async () => {
                const before = await snapshotData();
                await compIntegration.approveRewardToken({ from: sa.governor });
                await liquidator.triggerLiquidation(compIntegration.address);
                const after = await snapshotData();
                expect(after.savingsManagerBal).bignumber.gt(before.savingsManagerBal as any);
            });
        });
    });
    context("calling constructor", () => {
        it("should fail if any inputs are null");
    });
    context("creating a new liquidation", () => {
        it("should fail if any inputs are null");
        it("should fail if uniswap path is invalid");
        it("should fail if liquidation already exists");
    });
    context("updating an existing liquidation", () => {
        describe("changing the bAsset", () => {
            it("should fail if liquidation does not exist");
            it("should fail if bAsset is null");
            it("should fail if uniswap path is invalid");
            it("should update the bAsset successfully", async () => {
                // update uniswap path, bAsset
            });
            it("should change the tranche amount");
        });
        describe("removing the liquidation altogether", () => {
            it("should fail if liquidation doesn't exist");
            it("should delete the liquidation");
        });
    });
    context("triggering a liquidation", () => {
        it("should pause liquidations if set to 0");
        it("should fail if liquidation does not exist");
        it("should fail if called within 7 days of the previous");
        it("reverts if there is nothing to sell");
        it("should sell everything if the liquidator has less balance than tranche size", async () => {
            // set tranche size to 1e30
        });
        it("sends proceeds to the SavingsManager");
    });
});
