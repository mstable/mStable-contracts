/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable no-await-in-loop */

import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";

import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { BN } from "@utils/tools";
import { BassetStatus } from "@utils/mstable-objects";
import { ZERO_ADDRESS, fullScale, ratioScale } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import { BasketComposition } from "../../types";

const { expect } = envSetup.configure();

const MockBasketManager1 = artifacts.require("MockBasketManager1");
const MockBasketManager2 = artifacts.require("MockBasketManager2");
const MockERC20 = artifacts.require("MockERC20");
const MockAToken = artifacts.require("MockAToken");
const MockAave = artifacts.require("MockAaveV2");
const AaveIntegration = artifacts.require("AaveIntegration");
const Masset = artifacts.require("Masset");

interface MintOutput {
    minterBassetBalBefore: BN;
    minterBassetBalAfter: BN;
    recipientBalBefore: BN;
    recipientBalAfter: BN;
}

contract("Masset - Mint", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    const runSetup = async (seedBasket = true, enableUSDTFee = false): Promise<void> => {
        massetDetails = seedBasket
            ? await massetMachine.deployMassetAndSeedBasket(enableUSDTFee)
            : await massetMachine.deployMasset(enableUSDTFee);
        await assertBasketIsHealthy(massetMachine, massetDetails);
    };

    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = new MassetMachine(systemMachine);

        await runSetup();
    });

    const assertFailedMint = async (
        mAsset: t.MassetInstance,
        bAsset: t.MockERC20Instance,
        amount: BN,
        reason: string,
    ): Promise<void> => {
        const approval: BN = await massetMachine.approveMasset(bAsset, mAsset, amount);
        await expectRevert(mAsset.mint(bAsset.address, approval), reason);
    };

    // Helper to assert basic minting conditions, i.e. balance before and after
    const assertBasicMint = async (
        md: MassetDetails,
        mAssetMintAmount: BN | number,
        bAsset: t.MockERC20Instance,
        useMintTo = false,
        recipient: string = sa.default,
        sender: string = sa.default,
        ignoreHealthAssertions = false,
    ): Promise<MintOutput> => {
        const { mAsset, basketManager } = md;
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

        const minterBassetBalBefore = await bAsset.balanceOf(sender);
        const derivedRecipient = useMintTo ? recipient : sender;
        const recipientBalBefore = await mAsset.balanceOf(derivedRecipient);
        const bAssetBefore = await massetMachine.getBasset(basketManager, bAsset.address);
        const integratorBalBefore = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator.address,
        );

        const approval0: BN = await massetMachine.approveMasset(
            bAsset,
            mAsset,
            new BN(mAssetMintAmount),
        );

        // Expect to be used in cache
        const platformInteraction = await massetMachine.getPlatformInteraction(
            mAsset,
            "deposit",
            approval0,
            integratorBalBefore,
            bAssetBefore,
        );

        const tx = useMintTo
            ? await mAsset.mintTo(bAsset.address, approval0, derivedRecipient, { from: sender })
            : await mAsset.mint(bAsset.address, approval0, { from: sender });

        const mAssetQuantity = simpleToExactAmount(mAssetMintAmount, 18);
        const bAssetQuantity = simpleToExactAmount(mAssetMintAmount, await bAsset.decimals());
        await expectEvent(tx.receipt, "Minted", {
            minter: sender,
            recipient: derivedRecipient,
            mAssetQuantity,
            bAsset: bAsset.address,
            bAssetQuantity,
        });
        // Transfers to lending platform
        await expectEvent(tx.receipt, "Transfer", {
            from: sender,
            to: bAssetBefore.integrator.address,
            value: bAssetQuantity,
        });
        // Deposits into lending platform
        const emitter = await AaveIntegration.new();
        const integratorBalAfter = await bAssetBefore.contract.balanceOf(
            bAssetBefore.integrator.address,
        );
        expect(integratorBalAfter).bignumber.eq(platformInteraction.rawBalance);
        if (platformInteraction.expectInteraction) {
            await expectEvent.inTransaction(tx.tx, emitter, "Deposit", {
                _bAsset: bAsset.address,
                _amount: platformInteraction.amount,
            });
        }
        // Recipient should have mAsset quantity after
        const recipientBalAfter = await mAsset.balanceOf(derivedRecipient);
        expect(recipientBalAfter).bignumber.eq(recipientBalBefore.add(mAssetQuantity));
        // Sender should have less bAsset after
        const minterBassetBalAfter = await bAsset.balanceOf(sender);
        expect(minterBassetBalAfter).bignumber.eq(minterBassetBalBefore.sub(bAssetQuantity));
        // VaultBalance should update for this bAsset
        const bAssetAfter = await basketManager.getBasset(bAsset.address);
        expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(
            new BN(bAssetBefore.vaultBalance).add(bAssetQuantity),
        );

        // Complete basket should remain in healthy state
        if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
        return {
            minterBassetBalBefore,
            minterBassetBalAfter,
            recipientBalBefore,
            recipientBalAfter,
        };
    };

    const seedWithWeightings = async (md: MassetDetails, weights: Array<BN>): Promise<void> => {
        for (let i = 0; i < md.bAssets.length; i += 1) {
            if (weights[i].gt(new BN(0))) {
                await assertBasicMint(
                    md,
                    weights[i],
                    md.bAssets[i],
                    false,
                    undefined,
                    undefined,
                    true,
                );
            }
        }
    };

    describe("minting with a single bAsset", () => {
        context("when the weights are within the ForgeValidator limit", () => {
            before("reset", async () => {
                await runSetup();
            });
            context("and sending to a specific recipient", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should fail if recipient is 0x0", async () => {
                    const { mAsset, bAssets } = massetDetails;
                    await expectRevert(
                        mAsset.mintTo(bAssets[0].address, new BN(1), ZERO_ADDRESS),
                        "Must be a valid recipient",
                    );
                });
                it("should send mUSD when recipient is a contract", async () => {
                    const { bAssets, forgeValidator } = massetDetails;
                    const recipient = forgeValidator.address;
                    await assertBasicMint(massetDetails, new BN(1), bAssets[0], true, recipient);
                });
                it("should send mUSD when the recipient is an EOA", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = sa.dummy1;
                    await assertBasicMint(massetDetails, new BN(1), bAssets[1], true, recipient);
                });
            });
            context("and specifying one bAsset base unit", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should mint a higher q of mAsset base units when using bAsset with 12", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    // bAsset has 12 dp
                    const decimals = await bAsset.decimals();
                    expect(decimals).bignumber.eq(new BN(12));

                    await bAsset.approve(mAsset.address, new BN(1));

                    const minterBassetBalBefore = await bAsset.balanceOf(sa.default);
                    const recipientBalBefore = await mAsset.balanceOf(sa.default);

                    const tx = await mAsset.mint(bAsset.address, new BN(1));
                    const expectedMasset = new BN(10).pow(new BN(18).sub(decimals));
                    await expectEvent(tx.receipt, "Minted", {
                        minter: sa.default,
                        recipient: sa.default,
                        mAssetQuantity: expectedMasset,
                        bAsset: bAsset.address,
                        bAssetQuantity: new BN(1),
                    });
                    // Recipient should have mAsset quantity after
                    const recipientBalAfter = await mAsset.balanceOf(sa.default);
                    expect(recipientBalAfter).bignumber.eq(recipientBalBefore.add(expectedMasset));
                    // Sender should have less bAsset after
                    const minterBassetBalAfter = await bAsset.balanceOf(sa.default);
                    expect(minterBassetBalAfter).bignumber.eq(minterBassetBalBefore.sub(new BN(1)));
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                });
            });
            context("and not defining recipient", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should mint to sender in basic mint func", async () => {
                    const { bAssets } = massetDetails;
                    await assertBasicMint(massetDetails, new BN(1), bAssets[1], false);
                });
            });
            context("using bAssets with transfer fees", async () => {
                before(async () => {
                    await runSetup(false, true);
                });
                it("should handle tokens with transfer fees", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3];
                    const basket = await massetMachine.getBasketComposition(massetDetails);
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true);

                    // 2.0 Get balances
                    const minterBassetBalBefore = await bAsset.balanceOf(sa.default);
                    const recipient = sa.dummy3;
                    const recipientBalBefore = await mAsset.balanceOf(recipient);
                    expect(recipientBalBefore).bignumber.eq(new BN(0));
                    const mAssetMintAmount = new BN(10);
                    const approval0: BN = await massetMachine.approveMasset(
                        bAsset,
                        mAsset,
                        new BN(mAssetMintAmount),
                    );
                    // 3.0 Do the mint
                    const tx = await mAsset.mintTo(bAsset.address, approval0, recipient);

                    const mAssetQuantity = simpleToExactAmount(mAssetMintAmount, 18);
                    const bAssetQuantity = simpleToExactAmount(
                        mAssetMintAmount,
                        await bAsset.decimals(),
                    );
                    // 3.1 Check Transfers to lending platform
                    await expectEvent(tx.receipt, "Transfer", {
                        from: sa.default,
                        to: await basketManager.getBassetIntegrator(bAsset.address),
                    });
                    // 3.2 Check Deposits into lending platform
                    const emitter = await AaveIntegration.new();
                    await expectEvent.inTransaction(tx.tx, emitter, "Deposit", {
                        _bAsset: bAsset.address,
                    });
                    // 4.0 Recipient should have mAsset quantity after
                    const recipientBalAfter = await mAsset.balanceOf(recipient);
                    // Assert that we minted gt 99% of the bAsset
                    assertBNSlightlyGTPercent(
                        recipientBalBefore.add(mAssetQuantity),
                        recipientBalAfter,
                        "0.3",
                        true,
                    );
                    // Sender should have less bAsset after
                    const minterBassetBalAfter = await bAsset.balanceOf(sa.default);
                    expect(minterBassetBalAfter).bignumber.eq(
                        minterBassetBalBefore.sub(bAssetQuantity),
                    );
                    // VaultBalance should update for this bAsset
                    const bAssetAfter = await basketManager.getBasset(bAsset.address);
                    expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(recipientBalAfter);

                    // Complete basket should remain in healthy state
                    // await assertBasketIsHealthy(massetMachine, massetDetails);
                });
                it("should fail if the token charges a fee but we dont know about it", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3];
                    const basket = await massetMachine.getBasketComposition(massetDetails);
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true);
                    await basketManager.setTransferFeesFlag(bAsset.address, false, {
                        from: sa.governor,
                    });

                    // 2.0 Get balances
                    const mAssetMintAmount = new BN(10);
                    const approval0: BN = await massetMachine.approveMasset(
                        bAsset,
                        mAsset,
                        new BN(mAssetMintAmount),
                    );
                    // 3.0 Do the mint
                    await expectRevert(
                        mAsset.mintTo(bAsset.address, approval0, sa.default),
                        "Asset not fully transferred",
                    );
                });
            });
            context("with an affected bAsset", async () => {
                it("should fail if bAsset is broken below peg", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    const bAsset = bAssets[0];
                    await basketManager.handlePegLoss(bAsset.address, true, {
                        from: sa.governor,
                    });
                    const newBasset = await basketManager.getBasset(bAsset.address);
                    expect(newBasset.status).to.eq(BassetStatus.BrokenBelowPeg.toString());
                    await massetMachine.approveMasset(bAsset, mAsset, new BN(1));
                    await expectRevert(
                        mAsset.mint(bAsset.address, new BN(1)),
                        "bAsset not allowed in mint",
                    );
                });
            });
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should revert when 0 quantities", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    await massetMachine.approveMasset(bAsset, mAsset, new BN(1));
                    await expectRevert(
                        mAsset.mint(bAsset.address, new BN(0)),
                        "Quantity must not be 0",
                    );
                });
                it("should fail if sender doesn't have balance", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    const sender = sa.dummy1;
                    expect(await bAsset.balanceOf(sender)).bignumber.eq(new BN(0));
                    await massetMachine.approveMasset(bAsset, mAsset, new BN(100), sender);
                    await expectRevert(
                        mAsset.mint(bAsset.address, new BN(100), { from: sender }),
                        "SafeERC20: low-level call failed",
                    );
                });
                it("should fail if sender doesn't give approval", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    const sender = sa.dummy2;
                    await bAsset.transfer(sender, new BN(10000));
                    expect(await bAsset.allowance(sender, mAsset.address)).bignumber.eq(new BN(0));
                    expect(await bAsset.balanceOf(sender)).bignumber.eq(new BN(10000));
                    await expectRevert(
                        mAsset.mint(bAsset.address, new BN(100), { from: sender }),
                        "SafeERC20: low-level call failed",
                    );
                });
                it("should fail if the bAsset does not exist", async () => {
                    const { mAsset } = massetDetails;
                    const bAsset = await MockERC20.new("Mock", "MKK", 18, sa.default, 1000);
                    await expectRevert(
                        mAsset.mint(bAsset.address, new BN(100)),
                        "bAsset does not exist",
                    );
                });
            });
            context("pushing the weighting beyond the maximum limit", async () => {
                before(async () => {
                    await runSetup(false, false);
                });
                it("should succeed so long as we don't exceed the max weight", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    const composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 100 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    for (let i = 0; i < composition.bAssets.length; i += 1) {
                        await assertBasicMint(
                            massetDetails,
                            new BN(25),
                            composition.bAssets[i].contract,
                            false,
                        );
                    }
                    // Set updated weightings
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(25, 16)),
                        {
                            from: sa.governor,
                        },
                    );

                    // Assert basket is still healthy with 25 weightings
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    // Should revert since we would be pushing above target
                    const bAsset = bAssets[0];
                    const approval: BN = await massetMachine.approveMasset(
                        bAsset,
                        mAsset,
                        new BN(2),
                    );
                    await expectRevert(
                        mAsset.mint(bAsset.address, approval),
                        "bAssets used in mint cannot exceed their max weight",
                    );
                    // Set sufficient weightings allowance
                    await basketManager.setBasketWeights(
                        [bAsset.address],
                        [simpleToExactAmount(27, 16)],
                        {
                            from: sa.governor,
                        },
                    );

                    // Mint should pass now
                    await assertBasicMint(massetDetails, new BN(2), bAsset, false);
                });
            });
            it("should mint with single bAsset", async () => {
                const { bAssets, mAsset } = massetDetails;
                const oneMasset = simpleToExactAmount(1, 18);
                const mUSD_bal0 = await mAsset.balanceOf(sa.default);

                const approval0: BN = await massetMachine.approveMasset(
                    bAssets[0],
                    mAsset,
                    1,
                    sa.default,
                );
                await mAsset.mint(bAssets[0].address, approval0, {
                    from: sa.default,
                });

                const mUSD_bal1 = await mAsset.balanceOf(sa.default);
                expect(mUSD_bal1).bignumber.eq(mUSD_bal0.add(oneMasset));

                const approval1: BN = await massetMachine.approveMasset(
                    bAssets[1],
                    mAsset,
                    1,
                    sa.default,
                );
                await mAsset.mint(bAssets[1].address, approval1, {
                    from: sa.default,
                });

                const mUSD_bal2 = await mAsset.balanceOf(sa.default);
                expect(mUSD_bal2).bignumber.eq(mUSD_bal1.add(oneMasset));

                const approval2: BN = await massetMachine.approveMasset(
                    bAssets[2],
                    mAsset,
                    1,
                    sa.default,
                );
                await mAsset.mint(bAssets[2].address, approval2, {
                    from: sa.default,
                });

                const mUSD_bal3 = await mAsset.balanceOf(sa.default);
                expect(mUSD_bal3).bignumber.eq(mUSD_bal2.add(oneMasset));

                const approval3: BN = await massetMachine.approveMasset(
                    bAssets[3],
                    mAsset,
                    1,
                    sa.default,
                );
                await mAsset.mint(bAssets[3].address, approval3, {
                    from: sa.default,
                });

                const mUSD_bal4 = await mAsset.balanceOf(sa.default);
                expect(mUSD_bal4).bignumber.eq(mUSD_bal3.add(oneMasset));
            });
        });
        context("with a fluctuating basket", async () => {
            describe("minting when a bAsset has just been removed from the basket", async () => {
                before(async () => {
                    await runSetup(false);
                    const { bAssets, basketManager } = massetDetails;
                    await seedWithWeightings(massetDetails, [
                        new BN(50),
                        new BN(0),
                        new BN(50),
                        new BN(50),
                    ]);
                    // From [A, B, C, D], remove B, replacing it with D
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        [
                            simpleToExactAmount(50, 16),
                            new BN(0),
                            simpleToExactAmount(50, 16),
                            simpleToExactAmount(50, 16),
                        ],
                        { from: sa.governor },
                    );
                    await basketManager.removeBasset(bAssets[1].address, { from: sa.governor });
                });
                it("should still deposit to the right lending platform", async () => {
                    const { bAssets } = massetDetails;

                    const removedBassetBalBefore = await bAssets[1].balanceOf(sa.default);
                    await assertBasicMint(massetDetails, new BN(1), bAssets[3], false);
                    const removedBassetBalAfter = await bAssets[1].balanceOf(sa.default);
                    expect(removedBassetBalBefore).bignumber.eq(removedBassetBalAfter);
                });
                it("should not be possible to mint with the removed bAsset", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    await expectRevert(
                        mAsset.mint(bAssets[1].address, new BN(1)),
                        "bAsset does not exist",
                    );
                });
            });
        });
        context("when the weights exceeds the ForgeValidator limit", async () => {
            let composition: BasketComposition;
            beforeEach(async () => {
                await runSetup(false, false);
                const { bAssets, basketManager } = massetDetails;
                composition = await massetMachine.getBasketComposition(massetDetails);
                // Expect 4 bAssets with 100 weightings
                composition.bAssets.forEach((b) => {
                    expect(b.vaultBalance).bignumber.eq(new BN(0));
                    expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                });
                // Mint 0, 50, 25, 25 of each bAsset, taking total to 100
                await seedWithWeightings(massetDetails, [
                    new BN(0),
                    new BN(50),
                    new BN(25),
                    new BN(25),
                ]);
                // Refactor the weightings to push some overweight
                await basketManager.setBasketWeights(
                    bAssets.map((b) => b.address),
                    bAssets.map(() => simpleToExactAmount(25, 16)),
                    {
                        from: sa.governor,
                    },
                );
            });
            // minting should work as long as the thing we mint with doesnt exceed max
            it("should succeed if bAsset is underweight", async () => {
                const { bAssets, mAsset } = massetDetails;

                // Assert bAssets are now classed as overweight/underweight
                composition = await massetMachine.getBasketComposition(massetDetails);
                expect(composition.bAssets[1].overweight).to.eq(true);

                // Should succeed since we would be pushing towards target
                const bAsset0 = bAssets[0];
                await assertBasicMint(
                    massetDetails,
                    new BN(1),
                    bAsset0,
                    false,
                    undefined,
                    undefined,
                    true,
                );
                // Should fail if we mint with something else that will go over
                expect(composition.bAssets[2].overweight).to.eq(false);
                const bAsset2 = bAssets[2];
                await assertFailedMint(
                    mAsset,
                    bAsset2,
                    new BN(2),
                    "bAssets used in mint cannot exceed their max weight",
                );
            });
            it("should fail if bAsset already exceeds max", async () => {
                const { bAssets, mAsset } = massetDetails;
                // Assert bAssets are now classed as overweight/underweight
                composition = await massetMachine.getBasketComposition(massetDetails);
                expect(composition.bAssets[1].overweight).to.eq(true);

                // Should fail if we mint with something already overweight
                const bAsset1 = bAssets[1];
                await assertFailedMint(
                    mAsset,
                    bAsset1,
                    new BN(1),
                    "bAssets used in mint cannot exceed their max weight",
                );
            });
        });
        context("when there are a large number of bAssets in the basket", async () => {
            // Create a basket filled with 16 bAssets, all hooked into the Mock intergation platform
            before(async () => {
                await runSetup(false);
                const { aaveIntegration, basketManager } = massetDetails;
                const aaveAddress = await aaveIntegration.platformAddress();
                const mockAave = await MockAave.at(aaveAddress);
                await seedWithWeightings(massetDetails, [
                    new BN(100),
                    new BN(0),
                    new BN(0),
                    new BN(0),
                ]);
                // Create 6 new bAssets
                for (let i = 0; i < 6; i += 1) {
                    const mockBasset = await MockERC20.new(
                        `MKI${i}`,
                        `MI${i}`,
                        18,
                        sa.default,
                        100000000,
                    );
                    const mockAToken = await MockAToken.new(aaveAddress, mockBasset.address);
                    // Add to the mock aave platform
                    await mockAave.addAToken(mockAToken.address, mockBasset.address);
                    // Add the pToken to our integration
                    await aaveIntegration.setPTokenAddress(mockBasset.address, mockAToken.address, {
                        from: sa.governor,
                    });
                    // Add the bAsset to the basket
                    await basketManager.addBasset(
                        mockBasset.address,
                        aaveIntegration.address,
                        false,
                        { from: sa.governor },
                    );
                }
            });
            it("should still perform with 10 bAssets in the basket", async () => {
                const { basketManager } = massetDetails;
                // Assert that we have indeed 10 bAssets
                const onChainBassets = await massetMachine.getBassetsInMasset(massetDetails);
                expect(onChainBassets.length).to.eq(10);
                // Set equal basket weightings
                await basketManager.setBasketWeights(
                    onChainBassets.map((b) => b.addr),
                    onChainBassets.map(() => simpleToExactAmount(10, 16)),
                    { from: sa.governor },
                );
                for (let i = 1; i < onChainBassets.length; i += 1) {
                    await assertBasicMint(
                        massetDetails,
                        new BN(1),
                        onChainBassets[i].contract,
                        false,
                        undefined,
                        undefined,
                        true,
                    );
                }
            });
        });
        context("when the basket manager returns invalid response", async () => {
            before(async () => {
                await runSetup();
            });
            it("should mint nothing if the preparation returns invalid from manager", async () => {
                const { mAsset, forgeValidator } = massetDetails;
                // mintSingle
                const bAsset = await MockERC20.new("Mock", "MKK", 18, sa.default, 1000);
                const newManager = await MockBasketManager1.new(bAsset.address);
                const mockMasset = await Masset.new();
                await mockMasset.initialize(
                    "mMock",
                    "MK",
                    systemMachine.nexus.address,
                    forgeValidator.address,
                    newManager.address,
                );
                await massetMachine.approveMasset(bAsset, mAsset, new BN(1000));

                const bAssetBalBefore = await bAsset.balanceOf(sa.default);
                const mAssetBalBefore = await mockMasset.balanceOf(sa.default);
                const mAssetSupplyBefore = await mockMasset.totalSupply();

                // Should mint nothing due to the forge preparation being invalid
                await mockMasset.mint(bAsset.address, new BN(1000));

                const bAssetBalAfter = await bAsset.balanceOf(sa.default);
                expect(bAssetBalBefore).bignumber.eq(bAssetBalAfter);
                const mAssetBalAfter = await mockMasset.balanceOf(sa.default);
                expect(mAssetBalBefore).bignumber.eq(mAssetBalAfter);
                const mAssetSupplyAfter = await mockMasset.totalSupply();
                expect(mAssetSupplyBefore).bignumber.eq(mAssetSupplyAfter);
            });
            it("should fail if given an invalid integrator", async () => {
                const { mAsset, forgeValidator } = massetDetails;
                // mintSingle
                const bAsset = await MockERC20.new("Mock2", "MKK", 18, sa.default, 1000);
                const newManager = await MockBasketManager2.new(bAsset.address);
                const mockMasset = await Masset.new();
                await mockMasset.initialize(
                    "mMock",
                    "MK",
                    systemMachine.nexus.address,
                    forgeValidator.address,
                    newManager.address,
                );
                await massetMachine.approveMasset(bAsset, mAsset, new BN(1000));

                const bAssetBalBefore = await bAsset.balanceOf(sa.default);
                const mAssetBalBefore = await mockMasset.balanceOf(sa.default);
                const mAssetSupplyBefore = await mockMasset.totalSupply();

                // Should revert since we can't just call an invalid integrator
                await expectRevert(
                    mockMasset.mint(bAsset.address, new BN(100)),
                    "SafeERC20: low-level call failed",
                );

                const bAssetBalAfter = await bAsset.balanceOf(sa.default);
                expect(bAssetBalBefore).bignumber.eq(bAssetBalAfter);
                const mAssetBalAfter = await mockMasset.balanceOf(sa.default);
                expect(mAssetBalBefore).bignumber.eq(mAssetBalAfter);
                const mAssetSupplyAfter = await mockMasset.totalSupply();
                expect(mAssetSupplyBefore).bignumber.eq(mAssetSupplyAfter);
            });
            it("reverts if the BasketManager is paused", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                const bAsset = bAssets[0];
                await basketManager.pause({ from: sa.governor });
                expect(await basketManager.paused()).eq(true);
                await expectRevert(mAsset.mint(bAsset.address, new BN(100)), "Pausable: paused");
            });
        });
        context("when the mAsset has failed", () => {
            before(async () => {
                await runSetup(true);
            });
            it("should revert any mints", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                await assertBasketIsHealthy(massetMachine, massetDetails);
                await basketManager.setBasket(true, fullScale);
                const bAsset0 = bAssets[0];
                await assertFailedMint(mAsset, bAsset0, new BN(1), "Basket must be alive");
            });
        });
        context("when the mAsset is undergoing recol", () => {
            before(async () => {
                await runSetup(true);
            });
            it("should revert any mints", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                await assertBasketIsHealthy(massetMachine, massetDetails);
                await basketManager.setRecol(true);
                const bAsset0 = bAssets[0];
                await assertFailedMint(
                    mAsset,
                    bAsset0,
                    new BN(1),
                    "No bAssets can be undergoing recol",
                );
            });
        });
    });

    describe("minting with multiple bAssets", () => {
        // Helper to assert basic minting conditions, i.e. balance before and after
        const assertMintMulti = async (
            md: MassetDetails,
            mAssetMintAmounts: Array<BN | number>,
            bAssets: Array<t.MockERC20Instance>,
            recipient: string = sa.default,
            sender: string = sa.default,
            ignoreHealthAssertions = false,
        ): Promise<void> => {
            const { mAsset, basketManager } = md;

            if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);

            const minterBassetBalBefore = await Promise.all(
                bAssets.map((b) => b.balanceOf(sender)),
            );
            const recipientBalBefore = await mAsset.balanceOf(recipient);
            const bAssetDecimals = await Promise.all(bAssets.map((b) => b.decimals()));
            const bAssetBefore = await Promise.all(
                bAssets.map((b) => basketManager.getBasset(b.address)),
            );

            const approvals: Array<BN> = await Promise.all(
                bAssets.map((b, i) =>
                    massetMachine.approveMasset(b, mAsset, new BN(mAssetMintAmounts[i])),
                ),
            );
            const tx = await mAsset.mintMulti(
                bAssetBefore.map((b) => b.addr),
                approvals,
                recipient,
                { from: sender },
            );

            const mAssetQuantity = simpleToExactAmount(
                mAssetMintAmounts.reduce((p, c, i) => new BN(p).add(new BN(c)), new BN(0)),
                18,
            );
            const bAssetQuantities = mAssetMintAmounts.map((m, i) =>
                simpleToExactAmount(m, bAssetDecimals[i]),
            );

            expectEvent(tx.receipt, "MintedMulti", {
                recipient,
                mAssetQuantity,
            });

            // Recipient should have mAsset quantity after
            const recipientBalAfter = await mAsset.balanceOf(recipient);
            expect(recipientBalAfter).bignumber.eq(recipientBalBefore.add(mAssetQuantity));
            // Sender should have less bAsset after
            const minterBassetBalAfter = await Promise.all(bAssets.map((b) => b.balanceOf(sender)));
            minterBassetBalAfter.map((b, i) =>
                expect(b).bignumber.eq(minterBassetBalBefore[i].sub(bAssetQuantities[i])),
            );
            // VaultBalance should updated for this bAsset
            const bAssetAfter = await Promise.all(
                bAssets.map((b) => basketManager.getBasset(b.address)),
            );
            bAssetAfter.map((b, i) =>
                expect(new BN(b.vaultBalance)).bignumber.eq(
                    new BN(bAssetBefore[i].vaultBalance).add(bAssetQuantities[i]),
                ),
            );

            // Complete basket should remain in healthy state
            if (!ignoreHealthAssertions) await assertBasketIsHealthy(massetMachine, md);
        };

        before(async () => {
            await runSetup();
        });
        context("when the weights are within the ForgeValidator limit", () => {
            context("and sending to a specific recipient", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should mint selected bAssets only", async () => {
                    const comp = await massetMachine.getBasketComposition(massetDetails);
                    await assertMintMulti(
                        massetDetails,
                        [5, 10],
                        [massetDetails.bAssets[2], massetDetails.bAssets[0]],
                    );
                    const compAfter = await massetMachine.getBasketComposition(massetDetails);
                    expect(comp.bAssets[1].vaultBalance).bignumber.eq(
                        compAfter.bAssets[1].vaultBalance,
                    );
                    expect(comp.bAssets[3].vaultBalance).bignumber.eq(
                        compAfter.bAssets[3].vaultBalance,
                    );
                });
                it("should fail if recipient is 0x0", async () => {
                    const { mAsset, bAssets } = massetDetails;
                    await expectRevert(
                        mAsset.mintMulti([bAssets[0].address], [new BN(1)], ZERO_ADDRESS),
                        "Must be a valid recipient",
                    );
                });
                it("should send mUSD when recipient is a contract", async () => {
                    const { bAssets, forgeValidator } = massetDetails;
                    const recipient = forgeValidator.address;
                    await assertMintMulti(massetDetails, [new BN(1)], [bAssets[0]], recipient);
                });
                it("should send mUSD when the recipient is an EOA", async () => {
                    const { bAssets } = massetDetails;
                    const recipient = sa.dummy1;
                    await assertMintMulti(massetDetails, [new BN(1)], [bAssets[0]], recipient);
                });
            });
            context("and specifying one bAsset base unit", async () => {
                before(async () => {
                    await runSetup();
                });
                it("should mint a higher q of mAsset base units when using bAsset with 12", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    // bAsset has 12 dp
                    const decimals = await bAsset.decimals();
                    expect(decimals).bignumber.eq(new BN(12));

                    await bAsset.approve(mAsset.address, new BN(1));

                    const minterBassetBalBefore = await bAsset.balanceOf(sa.default);
                    const recipientBalBefore = await mAsset.balanceOf(sa.default);

                    const tx = await mAsset.mintMulti([bAsset.address], [new BN(1)], sa.default);
                    const expectedMasset = new BN(10).pow(new BN(18).sub(decimals));
                    await expectEvent(tx.receipt, "MintedMulti", {
                        recipient: sa.default,
                        mAssetQuantity: expectedMasset,
                    });
                    // Recipient should have mAsset quantity after
                    const recipientBalAfter = await mAsset.balanceOf(sa.default);
                    expect(recipientBalAfter).bignumber.eq(recipientBalBefore.add(expectedMasset));
                    // Sender should have less bAsset after
                    const minterBassetBalAfter = await bAsset.balanceOf(sa.default);
                    expect(minterBassetBalAfter).bignumber.eq(minterBassetBalBefore.sub(new BN(1)));
                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                });
            });
            context("using bAssets with transfer fees", async () => {
                before(async () => {
                    await runSetup(false, true);
                });
                it("should handle tokens with transfer fees", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3];
                    const basket = await massetMachine.getBasketComposition(massetDetails);
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true);

                    // 2.0 Get balances
                    const minterBassetBalBefore = await bAsset.balanceOf(sa.default);
                    const recipient = sa.dummy3;
                    const recipientBalBefore = await mAsset.balanceOf(recipient);
                    expect(recipientBalBefore).bignumber.eq(new BN(0));
                    const mAssetMintAmount = new BN(10);
                    const approval0: BN = await massetMachine.approveMasset(
                        bAsset,
                        mAsset,
                        new BN(mAssetMintAmount),
                    );
                    // 3.0 Do the mint
                    const tx = await mAsset.mintMulti([bAsset.address], [approval0], recipient);

                    const mAssetQuantity = simpleToExactAmount(mAssetMintAmount, 18);
                    const bAssetQuantity = simpleToExactAmount(
                        mAssetMintAmount,
                        await bAsset.decimals(),
                    );
                    // 3.1 Check Transfers to lending platform
                    await expectEvent(tx.receipt, "Transfer", {
                        from: sa.default,
                        to: await basketManager.getBassetIntegrator(bAsset.address),
                    });
                    // 3.2 Check Deposits into lending platform
                    const emitter = await AaveIntegration.new();
                    await expectEvent.inTransaction(tx.tx, emitter, "Deposit", {
                        _bAsset: bAsset.address,
                    });
                    // 4.0 Recipient should have mAsset quantity after
                    const recipientBalAfter = await mAsset.balanceOf(recipient);
                    // Assert that we minted gt 99% of the bAsset
                    assertBNSlightlyGTPercent(
                        recipientBalBefore.add(mAssetQuantity),
                        recipientBalAfter,
                        "0.3",
                    );
                    // Sender should have less bAsset afterz
                    const minterBassetBalAfter = await bAsset.balanceOf(sa.default);
                    expect(minterBassetBalAfter).bignumber.eq(
                        minterBassetBalBefore.sub(bAssetQuantity),
                    );
                    // VaultBalance should update for this bAsset
                    const bAssetAfter = await basketManager.getBasset(bAsset.address);
                    expect(new BN(bAssetAfter.vaultBalance)).bignumber.eq(recipientBalAfter);

                    // Complete basket should remain in healthy state
                    await assertBasketIsHealthy(massetMachine, massetDetails);
                });
                it("should fail if the token charges a fee but we dont know about it", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    // 1.0 Assert bAsset has fee
                    const bAsset = bAssets[3];
                    const basket = await massetMachine.getBasketComposition(massetDetails);
                    expect(basket.bAssets[3].isTransferFeeCharged).to.eq(true);
                    await basketManager.setTransferFeesFlag(bAsset.address, false, {
                        from: sa.governor,
                    });

                    // 2.0 Get balances
                    const mAssetMintAmount = new BN(10);
                    const approval0: BN = await massetMachine.approveMasset(
                        bAsset,
                        mAsset,
                        new BN(mAssetMintAmount),
                    );
                    // 3.0 Do the mint
                    await expectRevert(
                        mAsset.mintMulti([bAsset.address], [approval0], sa.default),
                        "Asset not fully transferred",
                    );
                });
            });
            context("with an affected bAsset", async () => {
                it("should fail if bAsset is broken below peg", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    const bAsset = bAssets[0];
                    await basketManager.handlePegLoss(bAsset.address, true, {
                        from: sa.governor,
                    });
                    const newBasset = await basketManager.getBasset(bAsset.address);
                    expect(newBasset.status).to.eq(BassetStatus.BrokenBelowPeg.toString());
                    await massetMachine.approveMasset(bAsset, mAsset, new BN(1));
                    await expectRevert(
                        mAsset.mintMulti([newBasset.addr], [new BN(1)], sa.default),
                        "bAsset not allowed in mint",
                    );
                });
            });
            context("passing invalid arguments", async () => {
                before(async () => {
                    await runSetup();
                });
                describe("passing an incorrect bAsset array", async () => {
                    it("should error if the array is empty", async () => {
                        const { mAsset } = massetDetails;
                        await expectRevert(
                            mAsset.mintMulti([], [new BN(1)], sa.default),
                            "Input array mismatch",
                        );
                    });
                    it("should error if both inputs are null", async () => {
                        const { mAsset } = massetDetails;
                        await expectRevert(
                            mAsset.mintMulti([], [], sa.default),
                            "Input array mismatch",
                        );
                    });
                    it("should error if there is a length mismatch", async () => {
                        const { mAsset, bAssets } = massetDetails;
                        await expectRevert(
                            mAsset.mintMulti(
                                [bAssets[0].address],
                                [new BN(1), new BN(1)],
                                sa.default,
                            ),
                            "Input array mismatch",
                        );
                    });
                    it("should error if there is a length mismatch", async () => {
                        const { mAsset, bAssets } = massetDetails;
                        await expectRevert(
                            mAsset.mintMulti(
                                [bAssets[0].address],
                                [new BN(1), new BN(1), new BN(1), new BN(1)],
                                sa.default,
                            ),
                            "Input array mismatch",
                        );
                    });
                    it("should fail if there are duplicate bAsset addresses", async () => {
                        const { mAsset, bAssets } = massetDetails;
                        await expectRevert(
                            mAsset.mintMulti(
                                [bAssets[0].address, bAssets[0].address],
                                [new BN(1), new BN(1)],
                                sa.default,
                            ),
                            "Must have no duplicates",
                        );
                    });
                });
                describe("minting with some 0 quantities", async () => {
                    it("should allow minting with some 0 quantities", async () => {
                        const { bAssets } = massetDetails;
                        const recipient = sa.dummy1;
                        await assertMintMulti(
                            massetDetails,
                            [new BN(1), new BN(0)],
                            [bAssets[0], bAssets[1]],
                            recipient,
                        );
                    });
                    it("should fail if output mAsset quantity is 0", async () => {
                        const { mAsset, bAssets, basketManager } = massetDetails;
                        // Get all before balances
                        const bAssetBefore = await Promise.all(
                            bAssets.map((b) => basketManager.getBasset(b.address)),
                        );
                        // Approve spending of the bAssets
                        await Promise.all(
                            bAssets.map((b, i) =>
                                massetMachine.approveMasset(b, mAsset, new BN(1)),
                            ),
                        );
                        // Pass all 0's
                        await expectRevert(
                            mAsset.mintMulti(
                                bAssetBefore.map((b) => b.addr),
                                [new BN(0), new BN(0), new BN(0), new BN(0)],
                                sa.default,
                            ),
                            "No masset quantity to mint",
                        );
                    });
                });
                it("should fail if sender doesn't have balance", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    const sender = sa.dummy1;
                    expect(await bAsset.balanceOf(sender)).bignumber.eq(new BN(0));
                    await massetMachine.approveMasset(bAsset, mAsset, new BN(100), sender);
                    await expectRevert(
                        mAsset.mintMulti([bAsset.address], [new BN(100)], sa.default, {
                            from: sender,
                        }),
                        "SafeERC20: low-level call failed",
                    );
                });
                it("should fail if sender doesn't give approval", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const bAsset = bAssets[0];
                    const sender = sa.dummy2;
                    await bAsset.transfer(sender, new BN(10000));
                    expect(await bAsset.allowance(sender, mAsset.address)).bignumber.eq(new BN(0));
                    expect(await bAsset.balanceOf(sender)).bignumber.eq(new BN(10000));
                    await expectRevert(
                        mAsset.mintMulti([bAsset.address], [new BN(100)], sa.default, {
                            from: sender,
                        }),
                        "SafeERC20: low-level call failed",
                    );
                });
                it("should fail if the bAsset does not exist", async () => {
                    const { mAsset } = massetDetails;
                    await expectRevert(
                        mAsset.mintMulti([sa.dummy1], [new BN(100)], sa.default),
                        "bAsset must exist",
                    );
                });
            });
            context("pushing the weighting beyond the maximum limit", async () => {
                before(async () => {
                    await runSetup(false, false);
                });
                it("should succeed so long as we don't exceed the max weight", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    const composition = await massetMachine.getBasketComposition(massetDetails);
                    // Expect 4 bAssets with 100 weightings
                    composition.bAssets.forEach((b) => {
                        expect(b.vaultBalance).bignumber.eq(new BN(0));
                        expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                    });
                    // Mint 25 of each bAsset, taking total to 100%
                    for (let i = 0; i < composition.bAssets.length; i += 1) {
                        await assertBasicMint(
                            massetDetails,
                            new BN(25),
                            composition.bAssets[i].contract,
                            false,
                        );
                    }
                    // Set updated weightings
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(25, 16)),
                        {
                            from: sa.governor,
                        },
                    );

                    // Assert basket is still healthy with 25 weightings
                    await assertBasketIsHealthy(massetMachine, massetDetails);

                    // Should revert since we would be pushing above max
                    const bAsset = bAssets[0];
                    const approval: BN = await massetMachine.approveMasset(
                        bAsset,
                        mAsset,
                        new BN(2),
                    );
                    await expectRevert(
                        mAsset.mintMulti([bAsset.address], [approval], sa.default),
                        "bAssets used in mint cannot exceed their max weight",
                    );
                    // Set sufficient weightings allowance
                    await basketManager.setBasketWeights(
                        bAssets.map((b) => b.address),
                        bAssets.map(() => simpleToExactAmount(27, 16)),
                        {
                            from: sa.governor,
                        },
                    );
                    // Mint should pass now
                    await assertMintMulti(massetDetails, [new BN(2)], [bAsset]);
                });
            });
            describe("minting with various orders", async () => {
                before(async () => {
                    await runSetup();
                });

                it("should mint quantities relating to the order of the bAsset indexes", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    const compBefore = await massetMachine.getBasketComposition(massetDetails);
                    await massetMachine.approveMasset(bAssets[0], mAsset, new BN(100));
                    await massetMachine.approveMasset(bAssets[1], mAsset, new BN(100));

                    // Minting with 2 and 1.. they should correspond to lowest index first
                    await mAsset.mintMulti(
                        [bAssets[0].address, bAssets[1].address],
                        [new BN(2), new BN(1)],
                        sa.default,
                    );
                    const compAfter = await massetMachine.getBasketComposition(massetDetails);
                    expect(compAfter.bAssets[0].vaultBalance).bignumber.eq(
                        new BN(compBefore.bAssets[0].vaultBalance).add(new BN(2)),
                    );
                    expect(compAfter.bAssets[1].vaultBalance).bignumber.eq(
                        new BN(compBefore.bAssets[1].vaultBalance).add(new BN(1)),
                    );
                });
                it("should mint using multiple bAssets", async () => {
                    const { bAssets, mAsset } = massetDetails;
                    // It's only possible to mint a single base unit of mAsset, if the bAsset also has 18 decimals
                    // For those tokens with 12 decimals, they can at minimum mint 1*10**6 mAsset base units.
                    // Thus, these basic calculations should work in whole mAsset units, with specific tests for
                    // low decimal bAssets

                    const approvals = await massetMachine.approveMassetMulti(
                        [bAssets[0], bAssets[1], bAssets[2]],
                        mAsset,
                        1,
                        sa.default,
                    );
                    await mAsset.mintMulti(
                        [bAssets[0].address, bAssets[1].address, bAssets[2].address],
                        approvals,
                        sa.default,
                    );

                    const approvals2 = await massetMachine.approveMassetMulti(
                        [bAssets[0], bAssets[1], bAssets[2], bAssets[3]],
                        mAsset,
                        1,
                        sa.default,
                    );
                    const mUSD_balBefore = await mAsset.balanceOf(sa.default);
                    await mAsset.mintMulti(
                        [
                            bAssets[0].address,
                            bAssets[1].address,
                            bAssets[2].address,
                            bAssets[3].address,
                        ],
                        approvals2,
                        sa.default,
                    );
                    const mUSD_balAfter = await mAsset.balanceOf(sa.default);
                    expect(mUSD_balAfter, "Must mint 4 full units of mUSD").bignumber.eq(
                        mUSD_balBefore.add(simpleToExactAmount(4, 18)),
                    );
                });
                it("should mint using 2 bAssets", async () => {
                    const { bAssets, mAsset, basketManager } = massetDetails;
                    const approvals = await massetMachine.approveMassetMulti(
                        [bAssets[0], bAssets[2]],
                        mAsset,
                        1,
                        sa.default,
                    );
                    await mAsset.mintMulti(
                        [bAssets[0].address, bAssets[2].address],
                        approvals,
                        sa.default,
                        {
                            from: sa.default,
                        },
                    );
                });
            });
        });
        context("with a fluctuating basket", async () => {
            describe("minting when a bAsset has just been removed from the basket", async () => {
                before(async () => {
                    await runSetup(false);
                    const { bAssets, basketManager } = massetDetails;
                    // From [A, B, C, D], remove B, replacing it with D
                    await basketManager.setBasketWeights(
                        [
                            bAssets[0].address,
                            bAssets[1].address,
                            bAssets[2].address,
                            bAssets[3].address,
                        ],
                        [
                            simpleToExactAmount(50, 16),
                            new BN(0),
                            simpleToExactAmount(50, 16),
                            simpleToExactAmount(50, 16),
                        ],
                        { from: sa.governor },
                    );
                    await basketManager.removeBasset(bAssets[1].address, { from: sa.governor });
                });
                it("should still deposit to the right lending platform", async () => {
                    const { bAssets } = massetDetails;
                    const removedBassetBalBefore = await bAssets[1].balanceOf(sa.default);
                    await assertMintMulti(
                        massetDetails,
                        [new BN(1), new BN(2), new BN(3)],
                        [bAssets[3], bAssets[0], bAssets[2]],
                        sa.default,
                        sa.default,
                    );
                    const removedBassetBalAfter = await bAssets[1].balanceOf(sa.default);
                    expect(removedBassetBalBefore).bignumber.eq(removedBassetBalAfter);
                });
                it("should not be possible to mint with the removed bAsset", async () => {
                    const { mAsset, bAssets } = massetDetails;
                    await expectRevert(
                        mAsset.mintMulti([bAssets[1].address], [new BN(1)], sa.default),
                        "bAsset must exist",
                    );
                });
            });
        });
        context("when the weights exceeds the ForgeValidator limit", async () => {
            let composition: BasketComposition;
            beforeEach(async () => {
                await runSetup(false, false);
                const { bAssets, basketManager } = massetDetails;
                composition = await massetMachine.getBasketComposition(massetDetails);
                // Expect 4 bAssets with 100 weightings
                composition.bAssets.forEach((b) => {
                    expect(b.vaultBalance).bignumber.eq(new BN(0));
                    expect(b.maxWeight).bignumber.eq(simpleToExactAmount(100, 16));
                });
                // Mint 0, 50, 25, 25 of each bAsset, taking total to 100
                await seedWithWeightings(massetDetails, [
                    new BN(0),
                    new BN(50),
                    new BN(25),
                    new BN(25),
                ]);
                // Refactor the weightings to push some overweight
                await basketManager.setBasketWeights(
                    bAssets.map((b) => b.address),
                    bAssets.map(() => simpleToExactAmount(25, 16)),
                    {
                        from: sa.governor,
                    },
                );
            });
            // minting should work as long as the thing we mint with doesnt exceed max
            it("should succeed if bAsset is underweight", async () => {
                const { bAssets, mAsset } = massetDetails;
                // Assert bAssets are now classed as overweight/underweight
                composition = await massetMachine.getBasketComposition(massetDetails);
                expect(composition.bAssets[1].overweight).to.eq(true);

                // Should succeed since we would be pushing towards target
                const bAsset0 = bAssets[0];
                await assertMintMulti(
                    massetDetails,
                    [new BN(1)],
                    [bAsset0],
                    sa.default,
                    sa.default,
                    true,
                );
                // Should fail if we mint with something else that will go over
                expect(composition.bAssets[2].overweight).to.eq(false);
                const bAsset2 = bAssets[2];
                await massetMachine.approveMasset(bAsset2, mAsset, new BN(2));
                await expectRevert(
                    mAsset.mintMulti(
                        [bAsset2.address],
                        [simpleToExactAmount(2, await bAsset2.decimals())],
                        sa.default,
                    ),
                    "bAssets used in mint cannot exceed their max weight",
                );
            });
        });
        context("when there are a large number of bAssets in the basket", async () => {
            // Create a basket filled with 16 bAssets, all hooked into the Mock intergation platform
            before(async () => {
                await runSetup(false);
                const { aaveIntegration, basketManager } = massetDetails;
                const aaveAddress = await aaveIntegration.platformAddress();
                const mockAave = await MockAave.at(aaveAddress);
                // Create 6 new bAssets
                for (let i = 0; i < 6; i += 1) {
                    const mockBasset = await MockERC20.new(
                        `MKI${i}`,
                        `MI${i}`,
                        18,
                        sa.default,
                        100000000,
                    );
                    const mockAToken = await MockAToken.new(aaveAddress, mockBasset.address);
                    // Add to the mock aave platform
                    await mockAave.addAToken(mockAToken.address, mockBasset.address);
                    // Add the pToken to our integration
                    await aaveIntegration.setPTokenAddress(mockBasset.address, mockAToken.address, {
                        from: sa.governor,
                    });
                    // Add the bAsset to the basket
                    await basketManager.addBasset(
                        mockBasset.address,
                        aaveIntegration.address,
                        false,
                        { from: sa.governor },
                    );
                }
            });
            it("should still perform with 10 bAssets in the basket", async () => {
                const { basketManager } = massetDetails;
                // Assert that we have indeed 10 bAssets
                const onChainBassets = await massetMachine.getBassetsInMasset(massetDetails);
                expect(onChainBassets.length).to.eq(10);
                // Set equal basket weightings
                await basketManager.setBasketWeights(
                    onChainBassets.map((b) => b.addr),
                    onChainBassets.map(() => simpleToExactAmount(10, 16)),
                    { from: sa.governor },
                );
                await assertMintMulti(
                    massetDetails,
                    onChainBassets.map(() => 10),
                    onChainBassets.map((b) => b.contract),
                );
            });
        });
        context("when the basket manager returns invalid response", async () => {
            before(async () => {
                await runSetup();
            });
            it("should mint nothing if the preparation returns invalid from manager", async () => {
                const { mAsset, forgeValidator } = massetDetails;
                // mintSingle
                const bAsset = await MockERC20.new("Mock", "MKK", 18, sa.default, 1000);
                const newManager = await MockBasketManager1.new(bAsset.address);
                const mockMasset = await Masset.new();
                await mockMasset.initialize(
                    "mMock",
                    "MK",
                    systemMachine.nexus.address,
                    forgeValidator.address,
                    newManager.address,
                );
                await massetMachine.approveMasset(bAsset, mAsset, new BN(1000));

                const bAssetBalBefore = await bAsset.balanceOf(sa.default);
                const mAssetBalBefore = await mockMasset.balanceOf(sa.default);
                const mAssetSupplyBefore = await mockMasset.totalSupply();

                // Should mint nothing due to the forge preparation being invalid
                await mockMasset.mintMulti([bAsset.address], [new BN(1)], sa.default);

                const bAssetBalAfter = await bAsset.balanceOf(sa.default);
                expect(bAssetBalBefore).bignumber.eq(bAssetBalAfter);
                const mAssetBalAfter = await mockMasset.balanceOf(sa.default);
                expect(mAssetBalBefore).bignumber.eq(mAssetBalAfter);
                const mAssetSupplyAfter = await mockMasset.totalSupply();
                expect(mAssetSupplyBefore).bignumber.eq(mAssetSupplyAfter);
            });
            it("should fail if given an invalid integrator", async () => {
                const { mAsset, forgeValidator } = massetDetails;
                // mintSingle
                const bAsset = await MockERC20.new("Mock2", "MKK", 18, sa.default, 1000);
                const newManager = await MockBasketManager2.new(bAsset.address);
                const mockMasset = await Masset.new();
                await mockMasset.initialize(
                    "mMock",
                    "MK",
                    systemMachine.nexus.address,
                    forgeValidator.address,
                    newManager.address,
                );
                await massetMachine.approveMasset(bAsset, mAsset, new BN(1000));

                const bAssetBalBefore = await bAsset.balanceOf(sa.default);
                const mAssetBalBefore = await mockMasset.balanceOf(sa.default);
                const mAssetSupplyBefore = await mockMasset.totalSupply();

                // Should revert since we can't just call an invalid integrator
                await expectRevert(
                    mockMasset.mintMulti([bAsset.address], [new BN(1)], sa.default),
                    "SafeERC20: low-level call failed",
                );

                const bAssetBalAfter = await bAsset.balanceOf(sa.default);
                expect(bAssetBalBefore).bignumber.eq(bAssetBalAfter);
                const mAssetBalAfter = await mockMasset.balanceOf(sa.default);
                expect(mAssetBalBefore).bignumber.eq(mAssetBalAfter);
                const mAssetSupplyAfter = await mockMasset.totalSupply();
                expect(mAssetSupplyBefore).bignumber.eq(mAssetSupplyAfter);
            });
            it("reverts if the BasketManager is paused", async () => {
                const { mAsset, basketManager, bAssets } = massetDetails;
                await basketManager.pause({ from: sa.governor });
                expect(await basketManager.paused()).eq(true);
                await expectRevert(
                    mAsset.mintMulti([bAssets[0].address], [new BN(1)], sa.default),
                    "Pausable: paused",
                );
            });
        });
        context("when the mAsset has failed", () => {
            before(async () => {
                await runSetup(true);
            });
            it("should revert any mints", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                await assertBasketIsHealthy(massetMachine, massetDetails);
                await basketManager.setBasket(true, fullScale);
                const bAsset0 = bAssets[0];

                await massetMachine.approveMasset(bAsset0, mAsset, new BN(2));
                await expectRevert(
                    mAsset.mintMulti([bAsset0.address], [new BN(1)], sa.default),
                    "Basket must be alive",
                );
            });
        });
        context("when the mAsset is undergoing recol", () => {
            before(async () => {
                await runSetup(true);
            });
            it("should revert any mints", async () => {
                const { bAssets, mAsset, basketManager } = massetDetails;
                await assertBasketIsHealthy(massetMachine, massetDetails);
                await basketManager.setRecol(true);
                const bAsset0 = bAssets[0];

                await massetMachine.approveMasset(bAsset0, mAsset, new BN(2));
                await expectRevert(
                    mAsset.mintMulti([bAsset0.address], [new BN(1)], sa.default),
                    "No bAssets can be undergoing recol",
                );
            });
        });
    });
});
