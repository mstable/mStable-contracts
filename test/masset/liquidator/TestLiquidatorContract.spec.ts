import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine, MassetMachine } from "@utils/machines";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import { ZERO_ADDRESS, MAX_UINT256, ONE_WEEK } from "@utils/constants";
import { keccak256 } from "web3-utils";

import shouldBehaveLikeModule from "../../shared/behaviours/Module.behaviour";

const Liquidator = artifacts.require("Liquidator");
const MockCompoundIntegration = artifacts.require("MockCompoundIntegration1");
const MockERC20 = artifacts.require("MockERC20");
const MockCToken = artifacts.require("MockCToken");
const MockUniswap = artifacts.require("MockUniswap");

const { expect } = envSetup.configure();

contract("Liquidator", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const ctx: { module?: t.InitializableModuleInstance } = {};
    let systemMachine: SystemMachine;

    let liquidator: t.LiquidatorInstance;
    let bAsset: t.MockErc20Instance;
    let cToken: t.MockCTokenInstance;
    let compIntegration: t.MockCompoundIntegration1Instance;
    let compToken: t.MockErc20Instance;

    enum LendingPlatform {
        Null,
        Compound,
        Aave,
    }

    interface Liquidation {
        platform: LendingPlatform;
        sellToken: string;
        bAsset: string;
        pToken: string;
        uniswapPath?: string[];
        collectUnits: BN;
        lastTriggered: BN;
        sellTranche: BN;
    }

    interface Balance {
        integration: BN;
        liquidator: BN;
    }

    interface Data {
        sellTokenBalance: Balance;
        pTokenBalance: Balance;
        liquidation: Liquidation;
    }

    // Real deployment steps:
    // - Deploy Liquidator & add Liquidation
    // - Add to modules
    // - Upgrade COMP
    const redeployLiquidator = async () => {
        // Fake uniswap
        const uniswap = await MockUniswap.new();

        // Liquidator
        liquidator = await Liquidator.new();
        await liquidator.initialize(systemMachine.nexus.address, uniswap.address);

        // Set up Comp Integration
        compIntegration = await MockCompoundIntegration.new();
        bAsset = await MockERC20.new("Mock1", "MK1", 18, sa.fundManager, 100000000);
        await bAsset.transfer(uniswap.address, simpleToExactAmount(100000, 18), {
            from: sa.fundManager,
        });
        cToken = await MockCToken.new(bAsset.address);
        await compIntegration.initialize(
            systemMachine.nexus.address,
            [sa.fundManager],
            ZERO_ADDRESS,
            [bAsset.address],
            [cToken.address],
        );

        // Create COMP token and assign, then approve the liquidator
        compToken = await MockERC20.new("Compound Gov", "COMP", 18, sa.fundManager, 100000000);
        await compIntegration.setRewardToken(compToken.address);
        await compToken.transfer(compIntegration.address, simpleToExactAmount(10, 18), {
            from: sa.fundManager,
        });

        // Add the module
        await systemMachine.nexus.proposeModule(keccak256("Liquidator"), liquidator.address, {
            from: sa.governor,
        });
        await time.increase(ONE_WEEK.addn(1));
        await systemMachine.nexus.acceptProposedModule(keccak256("Liquidator"), {
            from: sa.governor,
        });
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);

        await redeployLiquidator();
        ctx.module = liquidator as t.InitializableModuleInstance;
    });

    describe("verifying initialization", async () => {
        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

        it("should properly store valid arguments", async () => {
            expect(await liquidator.nexus()).eq(systemMachine.nexus.address);
            // todo - other params
        });
    });

    const getLiquidation = async (addr: string): Promise<Liquidation> => {
        const liquidation = await liquidator.liquidations(addr);
        return {
            platform: liquidation[0].toNumber() as LendingPlatform,
            sellToken: liquidation[1],
            bAsset: liquidation[2],
            pToken: liquidation[3],
            collectUnits: liquidation[4],
            lastTriggered: liquidation[5],
            sellTranche: liquidation[6],
        };
    };
    const snapshotData = async (): Promise<Data> => {
        const liquidation = await getLiquidation(liquidator.address);
        const sellBalIntegration = await compToken.balanceOf(compIntegration.address);
        const sellBalLiquidator = await compToken.balanceOf(liquidator.address);
        const pTokenBalIntegration = await cToken.balanceOf(compIntegration.address);
        const pTokenBalLiquidator = await cToken.balanceOf(liquidator.address);
        return {
            sellTokenBalance: {
                integration: sellBalIntegration,
                liquidator: sellBalLiquidator,
            },
            pTokenBalance: {
                integration: pTokenBalIntegration,
                liquidator: pTokenBalLiquidator,
            },
            liquidation,
        };
    };

    context("performing basic system flow", async () => {
        describe("creating a new liquidation", () => {
            it("should set up all args", async () => {
                await liquidator.createLiquidation(
                    compIntegration.address,
                    LendingPlatform.Compound,
                    compToken.address,
                    bAsset.address,
                    [compToken.address, ZERO_ADDRESS, bAsset.address],
                    simpleToExactAmount(1000, 18),
                    { from: sa.governor },
                );
                const liquidation = await getLiquidation(compIntegration.address);
                expect(liquidation.sellToken).eq(compToken.address);
                expect(liquidation.bAsset).eq(bAsset.address);
                expect(liquidation.pToken).eq(cToken.address);
                expect(liquidation.collectUnits).bignumber.eq(new BN(0));
                expect(liquidation.lastTriggered).bignumber.eq(new BN(0));
                expect(liquidation.sellTranche).bignumber.eq(simpleToExactAmount(1000, 18));
            });
        });
        describe("triggering a liquidation", () => {
            it("should sell COMP for bAsset and deposit to Compound", async () => {
                const before = await snapshotData();
                await compIntegration.approveRewardToken({ from: sa.governor });
                await liquidator.triggerLiquidation(compIntegration.address);
                const after = await snapshotData();
                expect(after.pTokenBalance.liquidator).bignumber.gt(
                    before.pTokenBalance.liquidator as any,
                );
            });
        });
        describe("collecting pTokens", () => {
            it("should sell COMP for bAsset and deposit to Compound", async () => {
                const before = await snapshotData();

                await bAsset.transfer(compIntegration.address, simpleToExactAmount(10, 18), {
                    from: sa.fundManager,
                });
                await compIntegration.deposit(bAsset.address, simpleToExactAmount(10, 18), false, {
                    from: sa.fundManager,
                });

                const after = await snapshotData();
                expect(after.pTokenBalance.liquidator).bignumber.lt(
                    before.pTokenBalance.liquidator as any,
                );
            });
        });
    });
    context("creating a new liquidation", () => {
        it("should fail if any inputs are null");
        it("should fail if uniswap path is invalid");
        it("should fail if bAsset does not correspond to pToken");
        it("should only support Compound");
        it("should fail if liquidation already exists");
    });
    context("updating an existing liquidation", () => {
        describe("changing the bAsset", () => {
            it("should fail if liquidation does not exist");
            it("should fail if bAsset is null");
            it("should fail if uniswap path is invalid");
            it("should fail if bAsset does not correspond to pToken");
            it("should update the bAsset successfully", async () => {
                // move old tokens to the integration
                // update uniswap path, bAsset and pToken
            });
        });
        describe("changing the tranche amount", () => {
            it("should fail if liquidation doesn't exist");
            it("should change the tranche amount");
            it("should pause liquidations if set to 0");
        });
        describe("removing the liquidation altogether", () => {
            it("should fail if liquidation doesn't exist");
            it("should deposit any remainder to the platform and delete the liquidation");
        });
    });
    context("triggering a liquidation", () => {
        it("should fail if liquidation does not exist");
        it("should fail if called within 24h of the previous");
        it("reverts if there is nothing to sell");
        it("should sell everything if the liquidator has less balance than tranche size", async () => {
            // set tranche size to 1e30
        });
        it("should revert if the liquidation is Aave market");
    });
    context("calling collect", () => {
        it("does nothing if the caller is not an active liquidation");
        it("does nothing if there is nothing left to collect");
    });
});
