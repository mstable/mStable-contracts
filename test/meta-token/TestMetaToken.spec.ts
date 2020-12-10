import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";

import { StandardAccounts, SystemMachine } from "@utils/machines";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";
import shouldBehaveLikeERC20 from "../shared/behaviours/ERC20.behaviour";
import shouldBehaveLikeERC20Burnable from "../shared/behaviours/ERC20Burnable.behaviour";

const MetaToken = artifacts.require("MetaToken");

const { expect } = envSetup.configure();

contract("MetaToken", async (accounts) => {
    const ctx: {
        module?: t.ModuleInstance;
        token?: t.ERC20Instance;
        burnableToken?: t.ERC20BurnableInstance;
    } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let meta: t.MetaTokenInstance;

    const redeployMeta = async (
        nexusAddress = systemMachine.nexus.address,
        fundRecipient = sa.fundManager,
    ): Promise<t.MetaTokenInstance> => {
        return MetaToken.new(nexusAddress, fundRecipient);
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
        meta = await redeployMeta();
    });

    describe("verifying Module initialization", async () => {
        before("reset contracts", async () => {
            meta = await redeployMeta();
            ctx.module = meta as t.ModuleInstance;
        });

        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

        it("should properly store valid arguments", async () => {
            expect(await meta.nexus()).eq(systemMachine.nexus.address);
        });
    });

    describe("verifying ERC20 properties", async () => {
        beforeEach("reset contracts", async () => {
            meta = await redeployMeta();
            ctx.token = meta as t.ERC20Instance;
            ctx.burnableToken = meta as t.ERC20BurnableInstance;
        });

        shouldBehaveLikeERC20(
            ctx as Required<typeof ctx>,
            "ERC20",
            simpleToExactAmount(100000000, 18),
            sa.fundManager,
            sa.dummy1,
            sa.dummy2,
        );

        shouldBehaveLikeERC20Burnable(
            ctx as Required<typeof ctx>,
            sa.fundManager,
            simpleToExactAmount(100000000, 18),
            [sa.dummy1],
        );

        it("should properly store valid arguments", async () => {
            expect(await meta.name()).eq("Meta");
            expect(await meta.symbol()).eq("MTA");
            expect(await meta.decimals()).bignumber.eq(new BN(18));
        });
    });

    describe("custom ERC20Mintable", async () => {
        beforeEach("reset contracts", async () => {
            meta = await redeployMeta();
        });
        describe("managing minters", () => {
            it("should not allow minters to add minters", async () => {
                await expectRevert(
                    meta.addMinter(sa.dummy2, { from: sa.dummy1 }),
                    "Only governor can execute",
                );
                await expectRevert(
                    meta.addMinter(sa.dummy2, { from: sa.dummy2 }),
                    "Only governor can execute",
                );
            });
            it("should allow the governor to add a minter", async () => {
                expect(await meta.isMinter(sa.dummy1)).eq(false);
                const tx = await meta.addMinter(sa.dummy1, { from: sa.governor });
                expectEvent(tx.receipt, "MinterAdded", {
                    account: sa.dummy1,
                });
                expect(await meta.isMinter(sa.dummy1)).eq(true);
            });
            it("should not allow minters to remove minters", async () => {
                // Add minter role
                expect(await meta.isMinter(sa.dummy1)).eq(false);
                await meta.addMinter(sa.dummy1, { from: sa.governor });
                expect(await meta.isMinter(sa.dummy1)).eq(true);
                // Minter or other cannot remove role
                await expectRevert(
                    meta.removeMinter(sa.dummy1, { from: sa.dummy1 }),
                    "Only governor can execute",
                );
                await expectRevert(
                    meta.removeMinter(sa.dummy1, { from: sa.dummy2 }),
                    "Only governor can execute",
                );
            });
            it("should allow the governor to remove a minter", async () => {
                // Add minter role
                expect(await meta.isMinter(sa.dummy1)).eq(false);
                await meta.addMinter(sa.dummy1, { from: sa.governor });
                expect(await meta.isMinter(sa.dummy1)).eq(true);
                // Minter or other cannot remove role
                const tx = await meta.removeMinter(sa.dummy1, { from: sa.governor });
                expectEvent(tx.receipt, "MinterRemoved", {
                    account: sa.dummy1,
                });
                expect(await meta.isMinter(sa.dummy1)).eq(false);
            });
            it("should allow a minter to renounce their minting ability", async () => {
                expect(await meta.isMinter(sa.dummy1)).eq(false);
                await meta.addMinter(sa.dummy1, { from: sa.governor });
                expect(await meta.isMinter(sa.dummy1)).eq(true);
                // Minter or other cannot remove role
                await meta.renounceMinter({ from: sa.dummy1 });
                expect(await meta.isMinter(sa.dummy1)).eq(false);
                await expectRevert(
                    meta.renounceMinter({ from: sa.dummy1 }),
                    "Roles: account does not have role",
                );
            });
        });
        describe("minting Meta", () => {
            it("should not allow a EOA to mint", async () => {
                await expectRevert(
                    meta.mint(sa.dummy1, 1, { from: sa.default }),
                    "MinterRole: caller does not have the Minter role",
                );
            });
            it("should not allow the governor to mint directly", async () => {
                await expectRevert(
                    meta.mint(sa.dummy1, 1, { from: sa.governor }),
                    "MinterRole: caller does not have the Minter role",
                );
            });
            it("should allow a minter to mint", async () => {
                // Assign minting privs
                await meta.addMinter(sa.dummy1, { from: sa.governor });
                expect(await meta.isMinter(sa.dummy1)).eq(true);

                // Get balance
                const balBefore = await meta.balanceOf(sa.dummy1);

                // Mint
                await meta.mint(sa.dummy1, 1, { from: sa.dummy1 });

                // Check output bal
                const balAfter = await meta.balanceOf(sa.dummy1);
                expect(balAfter).bignumber.eq(balBefore.add(new BN(1)));
            });
            it("should not allow a removed minter", async () => {
                // Assign minting privs
                await meta.addMinter(sa.dummy1, { from: sa.governor });
                expect(await meta.isMinter(sa.dummy1)).eq(true);

                // Get balance
                const balBefore = await meta.balanceOf(sa.dummy1);

                // Mint
                await meta.mint(sa.dummy1, 1, { from: sa.dummy1 });

                // Check output bal
                const balAfter = await meta.balanceOf(sa.dummy1);
                expect(balAfter).bignumber.eq(balBefore.add(new BN(1)));

                // Remove minter privs
                await meta.removeMinter(sa.dummy1, { from: sa.governor });
                expect(await meta.isMinter(sa.dummy1)).eq(false);

                await expectRevert(
                    meta.mint(sa.dummy1, 1, { from: sa.dummy1 }),
                    "MinterRole: caller does not have the Minter role",
                );
            });
        });
    });
});
