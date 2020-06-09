import * as t from "types/generated";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBasketIsHealthy } from "@utils/assertions";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { toWei } from "web3-utils";
import { BN } from "@utils/tools";
import { ZERO, ZERO_ADDRESS } from "@utils/constants";
import shouldBehaveLikeAbstractBuyAndMint from "./AbstractBuyAndMint.behaviour";

const MintWithKyber: t.MintWithKyberContract = artifacts.require("MintWithKyber");

contract("MintWithKyber", async (accounts) => {
    const ctx: { abstractBuyAndMint?: t.AbstractBuyAndMintInstance } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;
    let mintWithKyber: t.MintWithKyberInstance;
    let kyberProxyAddress: string;

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

        if (systemMachine.isGanacheFork) {
            // KyberNetworkProxy mainnet address
            kyberProxyAddress = "0x818E6FECD516Ecc3849DAf6845e3EC868087B755";
        } else {
            kyberProxyAddress = sa.dummy4;
        }

        mintWithKyber = await MintWithKyber.new(kyberProxyAddress, [massetDetails.mAsset.address]);
    });

    describe("should behave like AbstractBuyAndMint", async () => {
        beforeEach("reset contracts", async () => {
            ctx.abstractBuyAndMint = await MintWithKyber.new(sa.dummy4, [
                massetDetails.mAsset.address,
            ]);
        });

        shouldBehaveLikeAbstractBuyAndMint(ctx as Required<typeof ctx>, sa, sa.dummy4);

        context("AbstractBuyAndMint.constructor", async () => {
            it("should fail when no mAsset address provided", async () => {
                await expectRevert(MintWithKyber.new(sa.dummy4, []), "No mAssets provided");
            });

            it("should fail when mAsset address already exist", async () => {
                await expectRevert(
                    MintWithKyber.new(sa.dummy4, [sa.dummy1, sa.dummy1]),
                    "mAsset already exists",
                );
            });

            it("should fail when mAsset address is zero", async () => {
                await expectRevert(
                    MintWithKyber.new(sa.dummy4, [ZERO_ADDRESS]),
                    "mAsset address is zero",
                );
            });

            it("should fail when dex address is zero", async () => {
                await expectRevert(
                    MintWithKyber.new(ZERO_ADDRESS, [sa.dummy1]),
                    "Kyber proxy address is zero",
                );
            });
        });
    });

    describe("minting max mAssets with all ETH", () => {
        it("should fail when zero ETH sent", async () => {
            await Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    await expectRevert(
                        mintWithKyber.buyAndMintMaxMasset(
                            bAsset.address,
                            massetDetails.mAsset.address,
                        ),
                        "ETH not sent",
                    );
                }),
            );
        });

        it("should fail when invalid mAsset address sent", async () => {
            await Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    await expectRevert(
                        mintWithKyber.buyAndMintMaxMasset(bAsset.address, sa.dummy1, {
                            value: toWei(new BN(1), "ether"),
                        }),
                        "Not a valid mAsset",
                    );
                }),
            );
        });

        it("should mint mAssets for the user", async () => {
            // Executes only in forked Ganache network
            if (!systemMachine.isGanacheFork) return;

            await Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    const ethBalanceBefore = await web3.eth.getBalance(sa.default);
                    const mAssetBalanceBefore = await massetDetails.mAsset.balanceOf(sa.default);
                    expect(mAssetBalanceBefore).to.bignumber.equal(ZERO);

                    // Should buy bAsset from Kyber and mint mAssets
                    await mintWithKyber.buyAndMintMaxMasset(
                        bAsset.address,
                        massetDetails.mAsset.address,
                        { value: toWei(new BN(1), "ether") },
                    );

                    // ETH balance for user should decrease
                    const ethBalanceAfter = await web3.eth.getBalance(sa.default);
                    expect(ethBalanceBefore.sub(toWei("1", "ether"))).to.bignumber.equal(
                        ethBalanceAfter,
                    );

                    // mAsset balance for user should increase
                    const mAssetBalanceAfter = await massetDetails.mAsset.balanceOf(sa.default);
                    expect(mAssetBalanceAfter).to.not.bignumber.equal(ZERO);
                }),
            );
        });
    });

    describe("minting given number of mAssets", () => {
        const mAssetAmount = new BN(100);

        it("should fail when zero ETH sent", async () => {
            await Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    await expectRevert(
                        mintWithKyber.buyAndMintGivenMasset(
                            bAsset.address,
                            massetDetails.mAsset.address,
                            mAssetAmount,
                        ),
                        "ETH not sent",
                    );
                }),
            );
        });

        it("should fail when invalid mAsset address sent", async () => {
            await Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    await expectRevert(
                        mintWithKyber.buyAndMintGivenMasset(
                            bAsset.address,
                            sa.dummy1,
                            mAssetAmount,
                            {
                                value: toWei(new BN(1), "ether"),
                            },
                        ),
                        "Not a valid mAsset",
                    );
                }),
            );
        });

        it("should mint given number of mAssets for the user", async () => {
            // Executes only in forked Ganache network
            if (!systemMachine.isGanacheFork) return;

            await Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    const mAssetBalOfUserBefore = await massetDetails.mAsset.balanceOf(sa.default);

                    await mintWithKyber.buyAndMintGivenMasset(
                        bAsset.address,
                        massetDetails.mAsset.address,
                        mAssetAmount,
                        {
                            value: toWei(new BN(1), "ether"),
                        },
                    );

                    const mAssetBalOfUserAfter = await massetDetails.mAsset.balanceOf(sa.default);
                    const mAssetsMinted = mAssetBalOfUserAfter.sub(mAssetBalOfUserBefore);
                    expect(mAssetAmount).to.bignumber.equal(mAssetsMinted);
                }),
            );
        });
    });

    describe("minting mAssets using multiple bAssets", async () => {
        const ONE_ETH = new BN(toWei("1", "ether"));
        let bAssetsArray: Array<string>;
        let ethAmountArray: Array<BN>;

        beforeEach(async () => {
            bAssetsArray = massetDetails.bAssets.map((a) => a.address);
            const ethAmountToSend = ONE_ETH.div(new BN(bAssetsArray.length));
            ethAmountArray = massetDetails.bAssets.map(() => ethAmountToSend);
        });

        it("should fail when zero ETH sent", async () => {
            await expectRevert(
                mintWithKyber.buyAndMintMulti(
                    bAssetsArray,
                    ethAmountArray,
                    massetDetails.mAsset.address,
                ),
                "ETH not sent",
            );
        });

        it("should fail when invalid mAsset address sent", async () => {
            await expectRevert(
                mintWithKyber.buyAndMintMulti(bAssetsArray, ethAmountArray, sa.dummy3, {
                    value: ONE_ETH,
                }),
                "Not a valid mAsset",
            );
        });

        it("should fail when empty array passed", async () => {
            await expectRevert(
                mintWithKyber.buyAndMintMulti([], [], massetDetails.mAsset.address, {
                    value: ONE_ETH,
                }),
                "No array data sent",
            );
        });

        it("should fail when array length not matched", async () => {
            await expectRevert(
                mintWithKyber.buyAndMintMulti(bAssetsArray, [], massetDetails.mAsset.address, {
                    value: ONE_ETH,
                }),
                "Array length not matched",
            );
        });

        it("should mint mAssets using multiMint", async () => {
            // Executes only in forked Ganache network
            if (!systemMachine.isGanacheFork) return;

            const mAssetBalanceOfUserBefore = await massetDetails.mAsset.balanceOf(sa.default);
            await mintWithKyber.buyAndMintMulti(
                bAssetsArray,
                ethAmountArray,
                massetDetails.mAsset.address,
                {
                    value: ONE_ETH,
                },
            );

            const mAssetBalanceOfUserAfter = await massetDetails.mAsset.balanceOf(sa.default);
            const mAssetsMinted = mAssetBalanceOfUserAfter.sub(mAssetBalanceOfUserBefore);
            expect(mAssetsMinted).bignumber.gt(ZERO as any);
        });
    });
});
