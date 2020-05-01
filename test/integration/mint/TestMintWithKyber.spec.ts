import * as t from "types/generated";
import { MassetDetails, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBasketIsHealthy, assertBNSlightlyGTPercent } from "@utils/assertions";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { toWei } from "web3-utils";
import { BN } from "@utils/tools";
import { MockERC20Instance } from "types/generated";
import { ZERO } from "@utils/constants";

const MintWithKyber: t.MintWithKyberContract = artifacts.require("MintWithKyber");

contract("MintWithKyber", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;
    let mintWithKyber: t.MintWithKyberInstance;

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
        // TODO Change the correct address
        const kyberProxyAddress = accounts[9];
        mintWithKyber = await MintWithKyber.new(kyberProxyAddress, [massetDetails.mAsset.address]);
    });

    describe("minting max mAssets with all ETH", () => {
        it("should fail when zero ETH sent", async () => {
            Promise.all(
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
            Promise.all(
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

        it("should fail when KyberNetwork contract is disabled", async () => {
            if (!systemMachine.isGanacheFork) return;

            Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    await expectRevert(
                        mintWithKyber.buyAndMintMaxMasset(
                            bAsset.address,
                            massetDetails.mAsset.address,
                            { value: toWei(new BN(1), "ether") },
                        ),
                        "KyberNetworkProxy disabled",
                    );
                }),
            );
        });

        it("should mint mAssets for the user", async () => {
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
        const mAssetAmount = new BN(1000);

        it("should fail when zero ETH sent", async () => {
            Promise.all(
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
            Promise.all(
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

        it("should fail when KyberNetwork contract is disabled", async () => {
            if (!systemMachine.isGanacheFork) return;

            Promise.all(
                massetDetails.bAssets.map(async (bAsset) => {
                    await expectRevert(
                        mintWithKyber.buyAndMintGivenMasset(
                            bAsset.address,
                            massetDetails.mAsset.address,
                            mAssetAmount,
                            { value: toWei(new BN(1), "ether") },
                        ),
                        "KyberNetworkProxy disabled",
                    );
                }),
            );
        });

        it("should mint given number of mAssets for the user");
    });

    describe("minting mAssets using multiple bAssets", async () => {
        const ONE_ETH = new BN(toWei("1", "ether"));

        it("should fail when zero ETH sent", async () => {
            const bAssetsArray: Array<string> = massetDetails.bAssets.map((a) => a.address);
            const ethAmountToSend = ONE_ETH.div(new BN(bAssetsArray.length));
            const ethAmountArray: Array<BN> = massetDetails.bAssets.map(() => ethAmountToSend);
            await expectRevert(
                mintWithKyber.buyAndMintMulti(
                    bAssetsArray,
                    ethAmountArray,
                    massetDetails.mAsset.address,
                ),
                "ETH not sent",
            );
        });

        it("should fail when invalid mAsset address sent");

        it("should fail when empty array passed");

        it("should fail when array length not matched");

        it("should fail when KyberNetwork is disabled");

        it("should mint mAssets using multiMint");
    });
});
