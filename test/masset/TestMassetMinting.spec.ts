/* eslint-disable @typescript-eslint/camelcase */

import * as t from "types/generated";
import { expectRevert } from "@openzeppelin/test-helpers";

import { assertBasketIsHealthy, assertBnGte } from "@utils/assertions";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BN } from "@utils/tools";
import { ZERO_ADDRESS, fullScale } from "@utils/constants";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { BasketComposition, BassetDetails } from "../../types";

const { expect, assert } = envSetup.configure();

const Masset: t.MassetContract = artifacts.require("Masset");

interface MintOutput {
    minterBassetBalBefore: BN;
    minterBassetBalAfter: BN;
    recipientBalBefore: BN;
    recipientBalAfter: BN;
}

contract("MassetMinting", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);

        await runSetup();
    });

    const runSetup = async () => {
        massetDetails = await massetMachine.deployMassetAndSeedBasket();
        await assertBasketIsHealthy(massetMachine, massetDetails);
    };

    // Helper methods for:
    //  - Setting BasketManager into broken state

    // Helper to assert that a given bAsset is currently above its target weight
    const assertBassetOverweight = async (md: MassetDetails, bAsset: t.MockERC20Instance) => {
        // Read full basket composition
        const composition = await massetMachine.getBasketComposition(md);
        const target = composition.bAssets.find((b) => b.address === bAsset.address);
        expect(target.overweight).to.eq(true);
    };

    // Helper to assert basic minting conditions, i.e. balance before and after
    const assertBasicMint = async (
        md: MassetDetails,
        mAssetMintAmount: BN | number,
        bAsset: t.MockERC20Instance,
        useMintTo: boolean = false,
        recipient: string = sa.default,
        sender: string = sa.default,
    ): Promise<MintOutput> => {
        const minterBassetBalBefore = await bAsset.balanceOf(sender);
        recipient = useMintTo ? sender : recipient;
        const recipientBalBefore = await md.mAsset.balanceOf(recipient);

        const approval0: BN = await massetMachine.approveMasset(
            bAsset,
            md.mAsset,
            new BN(mAssetMintAmount),
        );
        useMintTo
            ? await md.mAsset.mintTo(bAsset.address, approval0, recipient)
            : await md.mAsset.mint(bAsset.address, approval0);

        const recipientBalAfter = await md.mAsset.balanceOf(recipient);
        expect(recipientBalAfter).bignumber.eq(
            recipientBalBefore.add(simpleToExactAmount(mAssetMintAmount, 18)),
        );
        const minterBassetBalAfter = await bAsset.balanceOf(sender);
        expect(minterBassetBalAfter).bignumber.eq(
            minterBassetBalBefore.sub(
                simpleToExactAmount(mAssetMintAmount, await bAsset.decimals()),
            ),
        );
        return {
            minterBassetBalBefore,
            minterBassetBalAfter,
            recipientBalBefore,
            recipientBalAfter,
        };
    };

    describe("minting with a single bAsset", () => {
        context("at any time", () => {
            context("sending to a specific recipient", async () => {
                it("should fail if recipient is 0x0", async () => {
                    await expectRevert(
                        massetDetails.mAsset.mintTo(
                            massetDetails.bAssets[0].address,
                            new BN(1),
                            ZERO_ADDRESS,
                        ),
                        "Must be a valid recipient",
                    );
                });
                it("should send mUSD when recipient is a contract", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = massetDetails.forgeValidator.address;
                    await assertBasicMint(massetDetails, new BN(1), bAssets[0], true, recipient);
                });
                it("should send mUSD when the recipient is an EOA", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = sa.dummy1;
                    await assertBasicMint(massetDetails, new BN(1), bAssets[1], true, recipient);
                });
            });
            context("and not defining recipient", async () => {
                it("should mint to sender in basic mint func", async () => {
                    const { bAssets } = massetDetails;
                    await assertBasicMint(massetDetails, new BN(1), bAssets[1], false);
                });
            });
            it("should revert when 0 quantities", async () => {
                const bAsset = massetDetails.bAssets[0];
                await massetMachine.approveMasset(bAsset, massetDetails.mAsset, new BN(1));
                await expectRevert(
                    massetDetails.mAsset.mint(bAsset.address, new BN(0)),
                    "Quantity must not be 0",
                );
            });
            it("should fail if sender doesn't have balance", async () => {
                const bAsset = massetDetails.bAssets[0];
                const sender = sa.dummy1;
                expect(await bAsset.balanceOf(sender)).bignumber.eq(new BN(0));
                await massetMachine.approveMasset(
                    bAsset,
                    massetDetails.mAsset,
                    new BN(100),
                    sender,
                );
                await expectRevert(
                    massetDetails.mAsset.mint(bAsset.address, new BN(100), { from: sender }),
                    "SafeERC20: low-level call failed",
                );
            });
            it("should fail if sender doesn't give approval", async () => {
                const bAsset = massetDetails.bAssets[0];
                const sender = sa.dummy2;
                await bAsset.transfer(sender, new BN(10000));
                expect(await bAsset.allowance(sender, massetDetails.mAsset.address)).bignumber.eq(
                    new BN(0),
                );
                expect(await bAsset.balanceOf(sender)).bignumber.eq(new BN(10000));
                await expectRevert(
                    massetDetails.mAsset.mint(bAsset.address, new BN(100), { from: sender }),
                    "SafeERC20: low-level call failed",
                );
            });
            it("should fail if the bAsset does not exist", async () => {
                // mintSingle
            });
            it("should mint nothing if the preparation returns invalid from manager", async () => {
                // mintSingle
            });
            it("should fail if given an invalid integrator");
            it("reverts if the mAsset is paused", async () => {});
        });

        context("when the weights are within the ForgeValidator limit", () => {
            // handle loads of bAssets (like 10)
            // handle dud result from prepareForgeBassets

            // mint effects -> should increase vaultBalance (ONLY one)
            // only modifies balance of target bAsset
            // should calculate ratio correctly (use varying ratios)
            // emit mint event
            // return q

            it("Should mint single bAsset", async () => {
                const { bAssets } = massetDetails;
                const oneMasset = simpleToExactAmount(1, 18);
                const mUSD_bal0 = await massetDetails.mAsset.balanceOf(sa.default);

                const approval0: BN = await massetMachine.approveMasset(
                    bAssets[0],
                    massetDetails.mAsset,
                    1,
                    sa.default,
                );
                await massetDetails.mAsset.mint(bAssets[0].address, approval0, {
                    from: sa.default,
                });

                const mUSD_bal1 = await massetDetails.mAsset.balanceOf(sa.default);
                expect(mUSD_bal1).bignumber.eq(mUSD_bal0.add(oneMasset));

                const approval1: BN = await massetMachine.approveMasset(
                    bAssets[1],
                    massetDetails.mAsset,
                    1,
                    sa.default,
                );
                await massetDetails.mAsset.mint(bAssets[1].address, approval1, {
                    from: sa.default,
                });

                const mUSD_bal2 = await massetDetails.mAsset.balanceOf(sa.default);
                expect(mUSD_bal2).bignumber.eq(mUSD_bal1.add(oneMasset));

                const approval2: BN = await massetMachine.approveMasset(
                    bAssets[2],
                    massetDetails.mAsset,
                    1,
                    sa.default,
                );
                await massetDetails.mAsset.mint(bAssets[2].address, approval2, {
                    from: sa.default,
                });

                const mUSD_bal3 = await massetDetails.mAsset.balanceOf(sa.default);
                expect(mUSD_bal3).bignumber.eq(mUSD_bal2.add(oneMasset));

                const approval3: BN = await massetMachine.approveMasset(
                    bAssets[3],
                    massetDetails.mAsset,
                    1,
                    sa.default,
                );
                await massetDetails.mAsset.mint(bAssets[3].address, approval3, {
                    from: sa.default,
                });

                const mUSD_bal4 = await massetDetails.mAsset.balanceOf(sa.default);
                expect(mUSD_bal4).bignumber.eq(mUSD_bal3.add(oneMasset));
            });
            it("should deposit tokens into target platform", async () => {
                // check event for sender -> intergator
            });
            context("using bAssets with transfer fees", async () => {
                it("should handle tokens with transfer fees", async () => {});
                it("should fail if the token charges a fee but we dont know about it", async () => {});
            });
            it("should mint selected bAsset only", async () => {});
            // context("when some bAssets are overweight...")
            it("should fail if the mint pushes overweight");
            it("should fail if the mint pushes....");
            it("should fail if the mint uses invalid bAssets");
            // it("should fail if the mint uses invalid bAssets");
        });

        context("when the weights exceeds the ForgeValidator limit", () => {
            // minting should work as long as the thing we mint with doesnt exceed max
            // other states?
        });
        context("when the mAsset has failed", () => {
            it("should revert any mints");
        });
    });

    describe("minting with multiple bAssets", () => {
        context("at any time", () => {
            it("should fail if recipient is 0x0", async () => {
                // mintSingle
            });

            it("should fail if the bAsset does not exist", async () => {
                // mintSingle
            });
            it("should send mUSD when recipient is a contract");
            it("should send mUSD when the recipient is an EOA", () => {});
            it("should mint to sender in basic mint func", async () => {
                // mintSingle
            });
            it("should mint nothing if the preparation returns invalid from manager", async () => {
                // mintSingle
            });
            it("should revert when 0 quantities");
            it("reverts if the mAsset is paused");
            it("should allow minting with some 0 quantities, but not all");
            it("should mint nothing if the preparation returns invalid from manager", async () => {});
            it("should fail if output mAsset quantity is 0");
        });

        context("when the weights are within the ForgeValidator limit", () => {
            it("Should mint using multiple bAssets", async () => {
                // It's only possible to mint a single base unit of mAsset, if the bAsset also has 18 decimals
                // For those tokens with 12 decimals, they can at minimum mint 1*10**6 mAsset base units.
                // Thus, these basic calculations should work in whole mAsset units, with specific tests for
                // low decimal bAssets
                const { bAssets } = massetDetails;

                const approvals = await massetMachine.approveMassetMulti(
                    [bAssets[0], bAssets[1], bAssets[2]],
                    massetDetails.mAsset,
                    1,
                    sa.default,
                );
                await massetDetails.mAsset.mintMulti(7, approvals, sa.default);

                const approvals2 = await massetMachine.approveMassetMulti(
                    [bAssets[0], bAssets[1], bAssets[2], bAssets[3]],
                    massetDetails.mAsset,
                    1,
                    sa.default,
                );
                const mUSD_balBefore = await massetDetails.mAsset.balanceOf(sa.default);
                await massetDetails.mAsset.mintMulti(15, approvals2, sa.default);
                const mUSD_balAfter = await massetDetails.mAsset.balanceOf(sa.default);
                expect(mUSD_balAfter, "Must mint 4 full units of mUSD").bignumber.eq(
                    mUSD_balBefore.add(simpleToExactAmount(4, 18)),
                );
            });
            it("Should mint using 2 bAssets", async () => {
                const { bAssets } = massetDetails;
                const approvals = await massetMachine.approveMassetMulti(
                    [bAssets[0], bAssets[2]],
                    massetDetails.mAsset,
                    1,
                    sa.default,
                );
                const bitmap = 5; // 0101 = 5
                await massetDetails.mAsset.mintMulti(bitmap, approvals, sa.default, {
                    from: sa.default,
                });
            });
            it("should deposit tokens into target platform", async () => {});
            it("should mint selected bAssets only", async () => {});
            // context("when some bAssets are overweight...")
            it("should fail if the mint pushes overweight");
            it("should fail if the mint uses invalid bAssets");
            // it("should fail if the mint uses invalid bAssets");
        });

        context("and the weights exceeds the ForgeValidator limit", () => {});
    });
});
