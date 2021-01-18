import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts } from "@utils/machines";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import envSetup from "@utils/env_setup";
import { ZERO_ADDRESS, ONE_WEEK, ONE_DAY } from "@utils/constants";
import * as t from "types/generated";

import shouldBehaveLikeModule from "../../shared/behaviours/Module.behaviour";

const MockTrigger = artifacts.require("MockTrigger");
const Liquidator = artifacts.require("Liquidator");
const MockCompoundIntegration = artifacts.require("MockCompoundIntegration1");
const SavingsManager = artifacts.require("SavingsManager");
const SavingsContract = artifacts.require("SavingsContract");
const MockERC20 = artifacts.require("MockERC20");
const MockMasset = artifacts.require("MockMasset");
const MockNexus = artifacts.require("MockNexus");
const MockCurve = artifacts.require("MockCurveMetaPool");
const MockUniswap = artifacts.require("MockUniswap");
const MockProxy = artifacts.require("MockProxy");

const { expect } = envSetup.configure();

contract("Liquidator", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const ctx: { module?: t.ModuleInstance } = {};

    let nexus: t.MockNexusInstance;
    let liquidator: t.LiquidatorInstance;
    let bAsset: t.MockERC20Instance;
    let bAsset2: t.MockERC20Instance;
    let mUSD: t.MockMassetInstance;
    let compIntegration: t.MockCompoundIntegration1Instance;
    let compToken: t.MockERC20Instance;
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
        minReturn: BN;
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
        mUSD = await MockMasset.new("mStable USD", "mUSD", 18, sa.fundManager, 100000000);
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
        const proxy = await MockProxy.new();
        const impl = await Liquidator.new();

        const data: string = impl.contract.methods
            .initialize(nexus.address, uniswap.address, curve.address, mUSD.address)
            .encodeABI();
        await proxy.methods["initialize(address,address,bytes)"](impl.address, sa.other, data);
        liquidator = await Liquidator.at(proxy.address);

        const save = await SavingsContract.new();
        await save.initialize(nexus.address, sa.default, mUSD.address, "Savings Credit", "imUSD");

        savings = await SavingsManager.new(nexus.address, mUSD.address, save.address, {
            from: sa.default,
        });
        await nexus.setSavingsManager(savings.address);
        await nexus.setLiquidator(liquidator.address);
    };

    before(async () => {
        nexus = await MockNexus.new(sa.governor, sa.governor, sa.dummy1);

        await redeployLiquidator();
        ctx.module = (liquidator as any) as t.ModuleInstance;
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
        const minReturn = await liquidator.minReturn(addr);
        return {
            sellToken: liquidation[0],
            bAsset: liquidation[1],
            curvePosition: liquidation[2],
            lastTriggered: liquidation[3],
            sellTranche: liquidation[4],
            minReturn,
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
                    simpleToExactAmount(70, 18),
                    { from: sa.governor },
                );
                const liquidation = await getLiquidation(compIntegration.address);
                expect(liquidation.sellToken).eq(compToken.address);
                expect(liquidation.bAsset).eq(bAsset.address);
                expect(liquidation.curvePosition).bignumber.eq(new BN(1));
                expect(liquidation.lastTriggered).bignumber.eq(new BN(0));
                expect(liquidation.sellTranche).bignumber.eq(simpleToExactAmount(1000, 18));
                expect(liquidation.minReturn).bignumber.eq(simpleToExactAmount(70, 18));
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
        it("should fail if any inputs are null", async () => {
            const lq = await Liquidator.new();
            await expectRevert(
                lq.initialize(ZERO_ADDRESS, uniswap.address, curve.address, mUSD.address),
                "Nexus address is zero",
            );
            await expectRevert(
                lq.initialize(nexus.address, ZERO_ADDRESS, curve.address, mUSD.address),
                "Invalid uniswap address",
            );
            await expectRevert(
                lq.initialize(nexus.address, uniswap.address, ZERO_ADDRESS, mUSD.address),
                "Invalid curve address",
            );
            await expectRevert(
                lq.initialize(nexus.address, uniswap.address, curve.address, ZERO_ADDRESS),
                "Invalid mUSD address",
            );
        });
    });
    context("creating a new liquidation", () => {
        before(async () => {
            await redeployLiquidator();
        });
        it("should fail if any inputs are null", async () => {
            await expectRevert(
                liquidator.createLiquidation(
                    ZERO_ADDRESS,
                    compToken.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(1, 18),
                    simpleToExactAmount(70, 18),
                    { from: sa.governor },
                ),
                "Invalid inputs",
            );
        });
        it("should fail if uniswap path is invalid", async () => {
            await expectRevert(
                liquidator.createLiquidation(
                    compIntegration.address,
                    compToken.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS, bAsset2.address],
                    simpleToExactAmount(1, 18),
                    simpleToExactAmount(70, 18),
                    { from: sa.governor },
                ),
                "Invalid uniswap path",
            );

            await expectRevert(
                liquidator.createLiquidation(
                    compIntegration.address,
                    compToken.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS],
                    simpleToExactAmount(1, 18),
                    simpleToExactAmount(70, 18),
                    { from: sa.governor },
                ),
                "Invalid uniswap path",
            );
        });
        it("should fail if liquidation already exists", async () => {
            await liquidator.createLiquidation(
                compIntegration.address,
                compToken.address,
                bAsset.address,
                1,
                [compToken.address, ZERO_ADDRESS, bAsset.address],
                simpleToExactAmount(1000, 18),
                simpleToExactAmount(70, 18),
                { from: sa.governor },
            );
            const liquidation = await getLiquidation(compIntegration.address);
            expect(liquidation.sellToken).eq(compToken.address);
            expect(liquidation.bAsset).eq(bAsset.address);
            expect(liquidation.curvePosition).bignumber.eq(new BN(1));
            expect(liquidation.lastTriggered).bignumber.eq(new BN(0));
            expect(liquidation.sellTranche).bignumber.eq(simpleToExactAmount(1000, 18));
            expect(liquidation.minReturn).bignumber.eq(simpleToExactAmount(70, 18));
            await expectRevert(
                liquidator.createLiquidation(
                    compIntegration.address,
                    compToken.address,
                    bAsset.address,
                    1,
                    [compToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(1000, 18),
                    simpleToExactAmount(70, 18),
                    { from: sa.governor },
                ),
                "Liquidation exists for this bAsset",
            );
        });
    });
    context("updating an existing liquidation", () => {
        beforeEach(async () => {
            await redeployLiquidator();
            await liquidator.createLiquidation(
                compIntegration.address,
                compToken.address,
                bAsset.address,
                1,
                [compToken.address, ZERO_ADDRESS, bAsset.address],
                simpleToExactAmount(1000, 18),
                simpleToExactAmount(70, 18),
                { from: sa.governor },
            );
        });
        describe("changing the bAsset", () => {
            it("should fail if liquidation does not exist", async () => {
                await expectRevert(
                    liquidator.updateBasset(
                        sa.dummy2,
                        bAsset.address,
                        1,
                        [],
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                        {
                            from: sa.governor,
                        },
                    ),
                    "Liquidation does not exist",
                );
            });
            it("should fail if bAsset is null", async () => {
                await expectRevert(
                    liquidator.updateBasset(
                        compIntegration.address,
                        ZERO_ADDRESS,
                        1,
                        [],
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                        {
                            from: sa.governor,
                        },
                    ),
                    "Invalid bAsset",
                );
            });
            it("should fail if uniswap path is invalid", async () => {
                await expectRevert(
                    liquidator.updateBasset(
                        compIntegration.address,
                        bAsset.address,
                        1,
                        [bAsset2.address],
                        simpleToExactAmount(1, 18),
                        simpleToExactAmount(70, 18),
                        {
                            from: sa.governor,
                        },
                    ),
                    "Invalid uniswap path",
                );
            });
            it("should update the bAsset successfully", async () => {
                // update uniswap path, bAsset, tranch amount
                const tx = await liquidator.updateBasset(
                    compIntegration.address,
                    bAsset2.address,
                    2,
                    [compToken.address, ZERO_ADDRESS, bAsset2.address],
                    simpleToExactAmount(123, 18),
                    simpleToExactAmount(70, 18),
                    { from: sa.governor },
                );
                expectEvent(tx.receipt, "LiquidationModified", {
                    integration: compIntegration.address,
                });
                const liquidation = await getLiquidation(compIntegration.address);
                expect(liquidation.sellToken).eq(compToken.address);
                expect(liquidation.bAsset).eq(bAsset2.address);
                expect(liquidation.curvePosition).bignumber.eq(new BN(2));
                expect(liquidation.sellTranche).bignumber.eq(simpleToExactAmount(123, 18));
            });
        });
        describe("removing the liquidation altogether", () => {
            it("should fail if liquidation doesn't exist", async () => {
                await expectRevert(
                    liquidator.deleteLiquidation(sa.dummy2, {
                        from: sa.governor,
                    }),
                    "Liquidation does not exist",
                );
            });
            it("should delete the liquidation", async () => {
                // update uniswap path, bAsset, tranch amount
                const tx = await liquidator.deleteLiquidation(compIntegration.address, {
                    from: sa.governor,
                });
                expectEvent(tx.receipt, "LiquidationEnded", {
                    integration: compIntegration.address,
                });
                const oldLiq = await getLiquidation(compIntegration.address);
                expect(oldLiq.bAsset).eq("0x0000000000000000000000000000000000000000");
                expect(oldLiq.curvePosition).bignumber.eq(new BN(0));
            });
        });
    });
    context("triggering a liquidation", () => {
        beforeEach(async () => {
            await redeployLiquidator();
            await liquidator.createLiquidation(
                compIntegration.address,
                compToken.address,
                bAsset.address,
                1,
                [compToken.address, ZERO_ADDRESS, bAsset.address],
                simpleToExactAmount(1000, 18),
                simpleToExactAmount(70, 18),
                { from: sa.governor },
            );
            await compIntegration.approveRewardToken({ from: sa.governor });
        });
        it("should fail if called via contract", async () => {
            const mock = await MockTrigger.new();
            await expectRevert(
                mock.trigger(liquidator.address, compIntegration.address),
                "Must be EOA",
            );
        });
        it("should fail if liquidation does not exist", async () => {
            await expectRevert(
                liquidator.triggerLiquidation(sa.dummy2),
                "Liquidation does not exist",
            );
        });
        it("should fail if Uniswap price is below the floor", async () => {
            await uniswap.setRatio(69);
            await expectRevert(
                liquidator.triggerLiquidation(compIntegration.address),
                "UNI: Output amount not enough",
            );
            await uniswap.setRatio(71);
            await liquidator.triggerLiquidation(compIntegration.address);
        });

        it("should fail if Curve price is below the floor", async () => {
            await curve.setRatio(simpleToExactAmount(9, 17));
            await expectRevert(
                liquidator.triggerLiquidation(compIntegration.address),
                "CRV: Output amount not enough",
            );
            await curve.setRatio(simpleToExactAmount(96, 16));
            await liquidator.triggerLiquidation(compIntegration.address);
        });
        it("should sell everything if the liquidator has less balance than tranche size", async () => {
            const s0 = await snapshotData();
            await liquidator.updateBasset(
                compIntegration.address,
                bAsset.address,
                1,
                [compToken.address, ZERO_ADDRESS, bAsset.address],
                simpleToExactAmount(1, 30),
                simpleToExactAmount(70, 18),
                { from: sa.governor },
            );
            // set tranche size to 1e30
            await liquidator.triggerLiquidation(compIntegration.address);

            const s1 = await snapshotData();
            // 10 COMP liquidated for > 1000 mUSD
            expect(s1.savingsManagerBal.sub(s0.savingsManagerBal)).bignumber.gt(
                simpleToExactAmount(1000, 18),
            );

            await time.increase(ONE_WEEK.addn(1));
            await expectRevert(
                liquidator.triggerLiquidation(compIntegration.address),
                "No sell tokens to liquidate",
            );
        });
        it("should pause liquidations if set to 0", async () => {
            await liquidator.updateBasset(
                compIntegration.address,
                bAsset.address,
                1,
                [compToken.address, ZERO_ADDRESS, bAsset.address],
                new BN(0),
                simpleToExactAmount(70, 18),
                { from: sa.governor },
            );
            await expectRevert(
                liquidator.triggerLiquidation(compIntegration.address),
                "Liquidation has been paused",
            );
        });
        it("should fail if called within 7 days of the previous", async () => {
            await liquidator.triggerLiquidation(compIntegration.address);
            await time.increase(ONE_DAY.muln(5));
            await expectRevert(
                liquidator.triggerLiquidation(compIntegration.address),
                "Must wait for interval",
            );
            await time.increase(ONE_DAY.muln(3));
            await liquidator.triggerLiquidation(compIntegration.address);
        });
    });
});
