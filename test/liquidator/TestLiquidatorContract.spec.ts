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
        liquidator.initialize(systemMachine.nexus.address, ZERO_ADDRESS);
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

    describe("createLiquidation()", () => {
        it("should revert if not called by the Governor", async () => {
            await expectRevert(
                liquidator.createLiquidation(
                    sa.dummy1,
                    sa.dummy2,
                    ZERO_ADDRESS,
                    [ZERO_ADDRESS],
                    new BN(1),
                    false,
                    {
                        from: sa.default,
                    },
                ),
                "Only governor can execute",
            );
        });
        it("should revert if passed a zero address for _bAsset", async () => {
            await expectRevert(
                liquidator.createLiquidation(
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    [ZERO_ADDRESS],
                    new BN(1),
                    false,
                    {
                        from: sa.governor,
                    },
                ),
                "bAsset cannot be zero address",
            );
        });
        it("should revert if passed a zero address for _integration", async () => {
            await expectRevert(
                liquidator.createLiquidation(
                    sa.dummy1,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    [ZERO_ADDRESS],
                    new BN(1),
                    false,
                    {
                        from: sa.governor,
                    },
                ),
                "integration cannot be zero address",
            );
        });
        it("should emit an event after adding a liquidation", async () => {
            const tx = await liquidator.createLiquidation(
                sa.dummy1,
                sa.dummy2,
                ZERO_ADDRESS,
                [ZERO_ADDRESS],
                new BN(1),
                false,
                {
                    from: sa.governor,
                },
            );
            await expectEvent(tx.receipt, "LiquidationAdded");
        });
    });

    describe("readLiqudation()", () => {
        it("should revert if not called by the Governor", async () => {
            await expectRevert(
                liquidator.readLiquidation(ZERO_ADDRESS, {
                    from: sa.default,
                }),
                "Only governor can execute",
            );
        });
        it("should revert if the liquidation does not exist", async () => {
            await expectRevert(
                liquidator.readLiquidation.call(sa.dummy3, {
                    from: sa.governor,
                }),
                "No liquidation for this bAsset",
            );
        });
        it("should return a liquidation", async () => {
            await liquidator.createLiquidation(
                sa.dummy1,
                sa.dummy2,
                ZERO_ADDRESS,
                [ZERO_ADDRESS],
                new BN(1),
                false,
                {
                    from: sa.governor,
                },
            );
            const liquidation = await liquidator.readLiquidation.call(sa.dummy1, {
                from: sa.governor,
            });
            expect(liquidation.bAsset).to.eq(sa.dummy1);
        });
    });

    describe("deleteLiquidation()", () => {
        it("should revert if not called by the Governor", async () => {
            await expectRevert(
                liquidator.deleteLiquidation(ZERO_ADDRESS, {
                    from: sa.default,
                }),
                "Only governor can execute",
            );
        });
        it("should revert if the liquidation does not exist", async () => {
            await expectRevert(
                liquidator.deleteLiquidation.call(sa.dummy3, {
                    from: sa.governor,
                }),
                "No liquidation for this bAsset",
            );
        });
        it("should delete a liquidation", async () => {
            await liquidator.createLiquidation(
                sa.dummy1,
                sa.dummy2,
                ZERO_ADDRESS,
                [ZERO_ADDRESS],
                new BN(1),
                false,
                {
                    from: sa.governor,
                },
            );
            const liquidation = await liquidator.readLiquidation.call(sa.dummy1, {
                from: sa.governor,
            });
            expect(liquidation.bAsset).to.eq(sa.dummy1);

            const tx = await liquidator.deleteLiquidation(sa.dummy1, {
                from: sa.governor,
            });

            await expectEvent(tx.receipt, "LiquidationRemoved");
            await expectRevert(
                liquidator.readLiquidation.call(sa.dummy1, {
                    from: sa.governor,
                }),
                "No liquidation for this bAsset",
            );
        });
    });
    describe("updateLiquidation()", () => {
        it("should revert if not called by the Governor", async () => {
            await expectRevert(
                liquidator.updateLiquidation(
                    sa.dummy1,
                    sa.dummy2,
                    ZERO_ADDRESS,
                    [ZERO_ADDRESS],
                    new BN(1),
                    true,
                    {
                        from: sa.default,
                    },
                ),
                "Only governor can execute",
            );
        });
        it("should revert if the liquidation does not exist", async () => {
            await expectRevert(
                liquidator.deleteLiquidation.call(sa.dummy3, {
                    from: sa.governor,
                }),
                "No liquidation for this bAsset",
            );
        });
        it("should pause a liquidiation", async () => {
            await liquidator.createLiquidation(
                sa.dummy1,
                sa.dummy2,
                ZERO_ADDRESS,
                [ZERO_ADDRESS],
                new BN(1),
                true,
                {
                    from: sa.governor,
                },
            );
            await liquidator.updateLiquidation(
                sa.dummy1,
                sa.dummy2,
                ZERO_ADDRESS,
                [ZERO_ADDRESS],
                new BN(1),
                true,
                {
                    from: sa.governor,
                },
            );
            const liquidation = await liquidator.readLiquidation.call(sa.dummy1, {
                from: sa.governor,
            });
            expect(liquidation.paused).to.eq(true);
        });
    });
    describe("updateUniswap()", () => {
        it("should revert if not called by the Governor", async () => {
            await expectRevert(
                liquidator.updateUniswapAddress(ZERO_ADDRESS, {
                    from: sa.default,
                }),
                "Only governor can execute",
            );
        });
        it("should update the Uniswap address", async () => {
            await liquidator.updateUniswapAddress(sa.dummy1, {
                from: sa.governor,
            });
            const updatedUniswapAddress = await liquidator.uniswapAddress.call({
                from: sa.governor,
            });
            expect(updatedUniswapAddress).to.eq(sa.dummy1);
        });
        it("should revert if passed a zero address for _uniswapAddress", async () => {
            await expectRevert(
                liquidator.updateUniswapAddress(ZERO_ADDRESS, {
                    from: sa.governor,
                }),
                "_uniswapAddress cannot be zero address",
            );
        });
    });
    describe("triggerLiquidation()", () => {
        it("should swap tokens with Uniswap", async () => {
            await liquidator.createLiquidation(
                sa.dummy1,
                sa.dummy2,
                ZERO_ADDRESS,
                [ZERO_ADDRESS],
                new BN(1),
                true,
                {
                    from: sa.governor,
                },
            );
        });
    });
    describe("randomNumber()", () => {
        it("should return a random number", async () => {
            const tx = await liquidator.randomNumber.call({
                from: sa.governor,
            });
            await console.log(tx.toString());
        });
    });
});
