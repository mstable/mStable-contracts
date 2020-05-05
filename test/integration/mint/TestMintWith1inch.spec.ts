import * as t from "types/generated";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBasketIsHealthy } from "@utils/assertions";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { toWei } from "web3-utils";
import { BN } from "@utils/tools";
import { ZERO, ZERO_ADDRESS } from "@utils/constants";
import shouldBehaveLikeAbstractBuyAndMint from "./AbstractBuyAndMint.behaviour";

const MintWith1Inch: t.MintWith1InchContract = artifacts.require("MintWith1Inch");

contract("MintWith1inch", async (accounts) => {
    const ctx: { abstractBuyAndMint?: t.AbstractBuyAndMintInstance } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;
    let mintWith1Inch: t.MintWith1InchInstance;

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
        let oneSplitAddress: string;
        if (systemMachine.isGanacheFork) {
            // KyberNetworkProxy mainnet address
            oneSplitAddress = "0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E";
        } else {
            oneSplitAddress = sa.dummy4;
        }

        mintWith1Inch = await MintWith1Inch.new(oneSplitAddress, [massetDetails.mAsset.address]);
    });

    describe("should behave like AbstractBuyAndMint", async () => {
        beforeEach("reset contracts", async () => {
            ctx.abstractBuyAndMint = await MintWith1Inch.new(sa.dummy4, [
                massetDetails.mAsset.address,
            ]);
        });

        shouldBehaveLikeAbstractBuyAndMint(ctx as Required<typeof ctx>, sa, sa.dummy4);

        context("AbstractBuyAndMint.constructor", async () => {
            it("should fail when no mAsset address provided", async () => {
                await expectRevert(MintWith1Inch.new(sa.dummy4, []), "No mAssets provided");
            });

            it("should fail when mAsset address already exist", async () => {
                await expectRevert(
                    MintWith1Inch.new(sa.dummy4, [sa.dummy1, sa.dummy1]),
                    "mAsset already exists",
                );
            });

            it("should fail when mAsset address is zero", async () => {
                await expectRevert(
                    MintWith1Inch.new(sa.dummy4, [ZERO_ADDRESS]),
                    "mAsset address is zero",
                );
            });

            it("should fail when dex address is zero", async () => {
                await expectRevert(
                    MintWith1Inch.new(ZERO_ADDRESS, [sa.dummy1]),
                    "1inch address is zero",
                );
            });
        });
    });

    describe("minting mAssets with all ETH", () => {
        // mock distribution
        const distribution: Array<BN> = [new BN(1)];

        it("should fail when zero ETH sent", async () => {
            await Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    await expectRevert(
                        mintWith1Inch.buyAndMint(
                            bAsset.address,
                            massetDetails.mAsset.address,
                            distribution,
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
                        mintWith1Inch.buyAndMint(bAsset.address, sa.dummy1, distribution, {
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

            const mAssetBalanceBefore = await massetDetails.mAsset.balanceOf(sa.default);

            await Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    await mintWith1Inch.buyAndMint(
                        bAsset.address,
                        massetDetails.mAsset.address,
                        distribution,
                    );
                }),
            );

            const mAssetBalanceAfter = await massetDetails.mAsset.balanceOf(sa.default);
            const mAssetsMinted = mAssetBalanceAfter.sub(mAssetBalanceBefore);
            expect(mAssetsMinted).bignumber.gt(ZERO as any);
        });
    });
});
