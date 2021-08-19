import { ethers } from "hardhat"
import { expect } from "chai"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount} from "@utils/math"
import {
    ERC20,
    ImmutableModule,
    ERC20Burnable,
    MetaToken,
    MetaToken__factory,
    Nexus,
    Nexus__factory,
} from "types/generated"

import { shouldBehaveLikeModule, IModuleBehaviourContext } from "../shared/Module.behaviour";
import { shouldBehaveLikeERC20, IERC20BehaviourContext } from "../shared/ERC20.behaviour"
import { shouldBehaveLikeERC20Burnable, IERC20BurnableBehaviourContext } from "../shared/ERC20Burnable.behaviour"

describe("MetaToken", () => {
    let sa: StandardAccounts
    const ctxModule: Partial<IModuleBehaviourContext> = {}
    const ctxERC20: Partial<IERC20BehaviourContext> = {}
    const ctxERC20Burnable: Partial<IERC20BurnableBehaviourContext> = {}

    let mAssetMachine: MassetMachine
    let meta: MetaToken
    let nexus: Nexus


    const redeployMeta = async (): Promise<MetaToken> => {
        nexus = await new Nexus__factory(sa.default.signer).deploy(sa.governor.address)
        meta = await new MetaToken__factory(sa.default.signer).deploy(nexus.address, sa.fundManager.address)
        return meta;
    };

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        meta = await redeployMeta();
        // IModuleBehaviourContext
        ctxModule.sa = sa;
        ctxModule.module = meta as ImmutableModule;

        // IERC20BehaviourContext
        ctxERC20.mAssetMachine = mAssetMachine;
        ctxERC20.initialHolder = sa.fundManager;
        ctxERC20.recipient = sa.dummy1;
        ctxERC20.anotherAccount = sa.dummy2;
        ctxERC20.details = await mAssetMachine.deployMasset();
        ctxERC20.token = meta as ERC20


        // IERC20BurnableBehaviourContext
        ctxERC20Burnable.burnableToken = meta as ERC20Burnable;
        ctxERC20Burnable.owner = sa.fundManager;
        ctxERC20Burnable.burner = sa.dummy1;

    })
    describe("verifying Module initialization", async () => {
        before("reset contracts", async () => {
            meta = await redeployMeta();
            ctxModule.module = meta as ImmutableModule;
            ctxERC20.token = meta as ERC20
            ctxERC20Burnable.burnableToken = meta as ERC20Burnable;
        });

        shouldBehaveLikeModule(ctxModule as Required<IModuleBehaviourContext>)

        it("should properly store valid arguments", async () => {
            expect(await meta.nexus()).eq(nexus.address);
        });
    });

    describe("verifying ERC20 properties", async () => {
        beforeEach("reset contracts", async () => {
            meta = await redeployMeta();
            ctxModule.module = meta as ImmutableModule;
            ctxERC20.token = meta as ERC20;
            ctxERC20Burnable.burnableToken = meta as ERC20Burnable;
        });

        shouldBehaveLikeERC20(
            ctxERC20 as IERC20BehaviourContext,
            "ERC20",
            simpleToExactAmount(100000000, 18)
        );

        shouldBehaveLikeERC20Burnable(
            ctxERC20Burnable as IERC20BurnableBehaviourContext,
            "ERC20",
            simpleToExactAmount(100000000, 18),
        );

        it("should properly store valid arguments", async () => {
            expect(await meta.name()).eq("Meta");
            expect(await meta.symbol()).eq("MTA");
            expect(await meta.decimals()).eq(BN.from(18));
        });
    });

    describe("custom ERC20Mintable", async () => {
        beforeEach("reset contracts", async () => {
            meta = await redeployMeta();
        });
        describe("managing minters", () => {
            it("should not allow minters to add minters", async () => {
                await expect(
                    meta.connect(sa.dummy1.signer).addMinter(sa.dummy2.address)).to.be.revertedWith(
                        "Only governor can execute",
                    );
                await expect(
                    meta.connect(sa.dummy2.signer).addMinter(sa.dummy2.address)).to.be.revertedWith(
                        "Only governor can execute",
                    );
            });
            it("should allow the governor to add a minter", async () => {
                expect(await meta.isMinter(sa.dummy1.address)).eq(false);
                const tx = await meta.connect(sa.governor.signer).addMinter(sa.dummy1.address);
                await expect(tx).to.emit(meta, "MinterAdded").withArgs(sa.dummy1.address);
                expect(await meta.isMinter(sa.dummy1.address)).eq(true);
            });
            it("should not allow minters to remove minters", async () => {
                // Add minter role
                expect(await meta.isMinter(sa.dummy1.address)).eq(false);
                await meta.connect(sa.governor.signer).addMinter(sa.dummy1.address);
                expect(await meta.isMinter(sa.dummy1.address)).eq(true);
                // Minter or other cannot remove role
                await expect(
                    meta.connect(sa.dummy1.signer).removeMinter(sa.dummy1.address)).to.be.revertedWith(
                        "Only governor can execute",
                    );
                await expect(
                    meta.connect(sa.dummy2.signer).removeMinter(sa.dummy1.address)).to.be.revertedWith(
                        "Only governor can execute",
                    );
            });
            it("should allow the governor to remove a minter", async () => {
                // Add minter role
                expect(await meta.isMinter(sa.dummy1.address)).eq(false);
                await meta.connect(sa.governor.signer).addMinter(sa.dummy1.address);
                expect(await meta.isMinter(sa.dummy1.address)).eq(true);
                // Minter or other cannot remove role
                const tx = await meta.connect(sa.governor.signer).removeMinter(sa.dummy1.address);
                await expect(tx).to.emit(meta, "MinterRemoved").withArgs( sa.dummy1.address);
                expect(await meta.isMinter(sa.dummy1.address)).eq(false);
            });
            it("should allow a minter to renounce their minting ability", async () => {
                expect(await meta.isMinter(sa.dummy1.address)).eq(false);
                await meta.connect(sa.governor.signer).addMinter(sa.dummy1.address);
                expect(await meta.isMinter(sa.dummy1.address)).eq(true);
                // Minter or other cannot remove role
                await meta.connect(sa.dummy1.signer).renounceMinter();
                expect(await meta.isMinter(sa.dummy1.address)).eq(false);
                // "Roles: account does not have role",
                await expect(
                    meta.connect(sa.dummy1.signer).renounceMinter()).to.be.revertedWith(
                        "MinterRole: caller does not have the Minter role",
                    );
            });
        });
        describe("minting Meta", () => {
            it("should not allow a EOA to mint", async () => {
                await expect(
                    meta.connect(sa.default.signer).mint(sa.dummy1.address, 1)).to.be.revertedWith(
                        "MinterRole: caller does not have the Minter role",
                    );
            });
            it("should not allow the governor to mint directly", async () => {
                await expect(
                    meta.connect(sa.governor.signer).mint(sa.dummy1.address, 1)).to.be.revertedWith(
                        "MinterRole: caller does not have the Minter role",
                    );
            });
            it("should allow a minter to mint", async () => {
                // Assign minting privs
                await meta.connect(sa.governor.signer).addMinter(sa.dummy1.address);
                expect(await meta.isMinter(sa.dummy1.address)).eq(true);

                // Get balance
                const balBefore = await meta.balanceOf(sa.dummy1.address);

                // Mint
                await meta.connect(sa.dummy1.signer).mint(sa.dummy1.address, 1);

                // Check output bal
                const balAfter = await meta.balanceOf(sa.dummy1.address);
                expect(balAfter).eq(balBefore.add(BN.from(1)));
            });
            it("should not allow a removed minter", async () => {
                // Assign minting privs
                await meta.connect(sa.governor.signer).addMinter(sa.dummy1.address);
                expect(await meta.isMinter(sa.dummy1.address)).eq(true);

                // Get balance
                const balBefore = await meta.balanceOf(sa.dummy1.address);

                // Mint
                await meta.connect(sa.dummy1.signer).mint(sa.dummy1.address, 1);

                // Check output bal
                const balAfter = await meta.balanceOf(sa.dummy1.address);
                expect(balAfter).eq(balBefore.add(BN.from(1)));

                // Remove minter privs
                await meta.connect(sa.governor.signer).removeMinter(sa.dummy1.address);
                expect(await meta.isMinter(sa.dummy1.address)).eq(false);

                await expect(
                    meta.connect(sa.dummy1.signer).mint(sa.dummy1.address, 1)).to.be.revertedWith(
                        "MinterRole: caller does not have the Minter role",
                    );
            });
        });
    });
});
