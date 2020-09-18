import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import { ZERO_ADDRESS } from "@utils/constants";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const Liquidator = artifacts.require("Liquidator");
const MockNexus = artifacts.require("MockNexus");

const { expect } = envSetup.configure();

contract("Liquidator", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const governance = sa.dummy1;
    const ctx: { module?: t.InitializableModuleInstance } = {};
    let systemMachine: SystemMachine;
    let liquidator: t.LiquidatorInstance;
    let nexus: t.MockNexusInstance;

    const redeployLiquidator = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.LiquidatorInstance> => {
        liquidator = await Liquidator.new();
        liquidator.initialize(systemMachine.nexus.address);
        return liquidator;
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
    });

    describe("verifying Module initialization", async () => {
        before("reset contracts", async () => {
            liquidator = await redeployLiquidator();
            ctx.module = liquidator as t.InitializableModuleInstance;
        });

        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

        it("should properly store valid arguments", async () => {
            expect(await liquidator.nexus()).eq(systemMachine.nexus.address);
        });
    });

    describe("addLiquidation()", () => {
        it("should revert if not called by the Governor", async () => {
            await expectRevert(
                liquidator.addLiquidation(ZERO_ADDRESS, ZERO_ADDRESS, new BN(18), {
                    from: sa.default,
                }),
                "Only governor can execute",
            );
        });
        it("should revert if passed a zero address for _bAsset", async () => {
            await expectRevert(
                liquidator.addLiquidation(ZERO_ADDRESS, ZERO_ADDRESS, new BN(18), {
                    from: sa.governor,
                }),
                "bAsset cannot be zero address",
            );
        });
        it("should revert if passed a zero address for _integration", async () => {
            await expectRevert(
                liquidator.addLiquidation(sa.dummy1, ZERO_ADDRESS, new BN(1), {
                    from: sa.governor,
                }),
                "integration cannot be zero address",
            );
        });
        it("should emit an event after adding a liquidation", async () => {
            const tx = await liquidator.addLiquidation(sa.dummy1, sa.dummy2, new BN(1), {
                from: sa.governor,
            });
            await expectEvent(tx.receipt, "LiquidationAdded");
        });
    });

    describe("getLiquidation()", () => {
        it("should revert if not called by the Governor", async () => {
            await expectRevert(
                liquidator.getLiquidation(ZERO_ADDRESS, {
                    from: sa.default,
                }),
                "Only governor can execute",
            );
        });
        it("should revert if the liquidation does not exist", async () => {
            await expectRevert(
                liquidator.getLiquidation.call(sa.dummy3, {
                    from: sa.governor,
                }),
                "No liquidation for this bAsset",
            );
        });
        it("should return a liquidation", async () => {
            await liquidator.addLiquidation(sa.dummy1, sa.dummy2, new BN(1), {
                from: sa.governor,
            });
            const liquidation = await liquidator.getLiquidation.call(sa.dummy1, {
                from: sa.governor,
            });
            expect(liquidation.basset).to.eq(sa.dummy1);
        });
    });

    describe("removeLiquidation()", () => {
        it("should revert if not called by the Governor", async () => {
            await expectRevert(
                liquidator.removeLiquidation(ZERO_ADDRESS, {
                    from: sa.default,
                }),
                "Only governor can execute",
            );
        });
        it("should revert if the liquidation does not exist", async () => {
            await expectRevert(
                liquidator.removeLiquidation.call(sa.dummy3, {
                    from: sa.governor,
                }),
                "No liquidation for this bAsset",
            );
        });
        it("should remove a liquidation", async () => {
            await liquidator.addLiquidation(sa.dummy1, sa.dummy2, new BN(1), {
                from: sa.governor,
            });
            const liquidation = await liquidator.getLiquidation.call(sa.dummy1, {
                from: sa.governor,
            });
            expect(liquidation.basset).to.eq(sa.dummy1);

            const tx = await liquidator.removeLiquidation(sa.dummy1, {
                from: sa.governor,
            });

            await expectEvent(tx.receipt, "LiquidationRemoved");
            await expectRevert(
                liquidator.getLiquidation.call(sa.dummy1, {
                    from: sa.governor,
                }),
                "No liquidation for this bAsset",
            );
        });
    });
    describe("pauseLiquidation()", () => {
        it("should revert if not called by the Governor", async () => {
            await expectRevert(
                liquidator.pauseLiquidation(ZERO_ADDRESS, {
                    from: sa.default,
                }),
                "Only governor can execute",
            );
        });
        it("should revert if the liquidation does not exist", async () => {
            await expectRevert(
                liquidator.removeLiquidation.call(sa.dummy3, {
                    from: sa.governor,
                }),
                "No liquidation for this bAsset",
            );
        });
        it("should pause a liquidiation", async () => {
            await liquidator.addLiquidation(sa.dummy1, sa.dummy2, new BN(1), {
                from: sa.governor,
            });
            await liquidator.pauseLiquidation(sa.dummy1, {
                from: sa.governor,
            });
            const liquidation = await liquidator.getLiquidation.call(sa.dummy1, {
                from: sa.governor,
            });
            expect(liquidation.paused).to.eq(true);
        });
    });
});
