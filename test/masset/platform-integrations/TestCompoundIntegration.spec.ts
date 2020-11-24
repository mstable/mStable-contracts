/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable consistent-return */

import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { BN } from "@utils/tools";
import { assertBNSlightlyGTPercent, assertBNClose, assertBNSlightlyGT } from "@utils/assertions";
import { StandardAccounts, SystemMachine, MassetMachine } from "@utils/machines";
import {
    MainnetAccounts,
    ZERO_ADDRESS,
    MAX_UINT256,
    fullScale,
    ZERO,
    ONE_WEEK,
} from "@utils/constants";

import envSetup from "@utils/env_setup";
import { simpleToExactAmount } from "@utils/math";
import * as t from "types/generated";
import { BassetIntegrationDetails } from "../../../types";
import shouldBehaveLikeModule from "../../shared/behaviours/Module.behaviour";

const { expect } = envSetup.configure();

const c_ERC20 = artifacts.require("ERC20Detailed");
const c_CERC20 = artifacts.require("ICERC20");

const c_MockERC20 = artifacts.require("MockERC20");
const c_MockCToken = artifacts.require("MockCToken");

const c_Nexus = artifacts.require("Nexus");
const c_DelayedProxyAdmin = artifacts.require("DelayedProxyAdmin");

const c_InitializableProxy = artifacts.require("InitializableAdminUpgradeabilityProxy");
const c_CompoundIntegration = artifacts.require("CompoundIntegration");

const convertUnderlyingToCToken = async (
    cToken: t.ICERC20Instance,
    underlyingAmount: BN,
): Promise<BN> => {
    const exchangeRate = await cToken.exchangeRateStored();
    return underlyingAmount.addn(1).mul(fullScale).div(exchangeRate);
};
const convertCTokenToUnderlying = async (
    cToken: t.ICERC20Instance,
    cTokenAmount: BN,
): Promise<BN> => {
    const exchangeRate = await cToken.exchangeRateStored();
    return cTokenAmount.mul(exchangeRate).div(fullScale);
};

contract("CompoundIntegration", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const ma = new MainnetAccounts();

    // No platform specific address for Compound, hence using ZERO_ADDRESS
    const compoundPlatformAddress = ZERO_ADDRESS;

    let systemMachine: SystemMachine;
    let nexus: t.NexusInstance;
    let massetMachine: MassetMachine;

    let integrationDetails: BassetIntegrationDetails;
    let d_DelayedProxyAdmin: t.DelayedProxyAdminInstance;
    let d_CompoundIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance;
    let d_CompoundIntegration: t.CompoundIntegrationInstance;

    const ctx: { module?: t.InitializableModuleInstance } = {};

    before("base init", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = systemMachine.massetMachine;

        await runSetup();
    });

    const runSetup = async (enableUSDTFee = false, simulateMint = false) => {
        // SETUP
        // ======
        nexus = await c_Nexus.new(sa.governor);
        // Init proxyAdmin
        d_DelayedProxyAdmin = await c_DelayedProxyAdmin.new(nexus.address);
        // Initialize the proxy
        d_CompoundIntegrationProxy = await c_InitializableProxy.new();
        d_CompoundIntegration = await c_CompoundIntegration.at(d_CompoundIntegrationProxy.address);

        // Load network specific integration data
        integrationDetails = await massetMachine.loadBassets(enableUSDTFee);

        // Initialize the proxy storage
        const compoundImplementation = await c_CompoundIntegration.new();

        const initializationData_CompoundIntegration: string = compoundImplementation.contract.methods
            .initialize(
                nexus.address,
                [sa.default],
                compoundPlatformAddress,
                integrationDetails.cTokens.map((c) => c.bAsset),
                integrationDetails.cTokens.map((c) => c.cToken),
            )
            .encodeABI();
        await d_CompoundIntegrationProxy.methods["initialize(address,address,bytes)"](
            compoundImplementation.address,
            d_DelayedProxyAdmin.address,
            initializationData_CompoundIntegration,
        );

        await nexus.initialize(
            [web3.utils.keccak256("ProxyAdmin")],
            [d_DelayedProxyAdmin.address],
            [true],
            sa.governor,
            { from: sa.governor },
        );

        if (simulateMint) {
            await Promise.all(
                integrationDetails.cTokens.map(async ({ bAsset, cToken }) => {
                    // Step 0. Choose tokens
                    const d_bAsset = await c_ERC20.at(bAsset);
                    const bAsset_decimals = await d_bAsset.decimals();
                    const amount = new BN(enableUSDTFee ? 101 : 100).mul(
                        new BN(10).pow(bAsset_decimals.sub(new BN(1))),
                    );
                    const amount_dep = new BN(10).mul(new BN(10).pow(bAsset_decimals));

                    // Step 1. xfer tokens to integration
                    await d_bAsset.transfer(d_CompoundIntegration.address, amount);

                    // Step 2. call deposit
                    return d_CompoundIntegration.deposit(bAsset, amount_dep, true);
                }),
            );
        }

        ctx.module = d_CompoundIntegration;
    };

    describe("initializing CompoundIntegration", async () => {
        describe("verifying GovernableWhitelist initialization", async () => {
            describe("verifying InitializableModule initialization", async () => {
                shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

                it("should properly store valid arguments", async () => {
                    // Check for nexus addr
                    expect(await d_CompoundIntegration.nexus()).eq(nexus.address);
                });
            });

            it("should properly store valid arguments", async () => {
                // check for whitelisted accs
                const whitelisted = await d_CompoundIntegration.whitelist(sa.default);
                expect(whitelisted).eq(true);
                // check for non whitelisted accs
                const notWhitelisted = await d_CompoundIntegration.whitelist(sa.dummy4);
                expect(notWhitelisted).eq(false);
                const notWhitelisted2 = await d_CompoundIntegration.whitelist(sa.governor);
                expect(notWhitelisted2).eq(false);
            });
            it("should fail when empty whitelisted array", async () => {
                const tempImpl = await c_CompoundIntegration.new();
                const erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
                const aTokenMock = await c_MockCToken.new(erc20Mock.address);
                await expectRevert(
                    tempImpl.initialize(
                        nexus.address,
                        [],
                        sa.other,
                        [erc20Mock.address],
                        [aTokenMock.address],
                    ),
                    "Empty whitelist array",
                );
            });

            it("should fail when whitelisted address is zero or duplicate", async () => {
                const tempImpl = await c_CompoundIntegration.new();
                const erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
                const aTokenMock = await c_MockCToken.new(erc20Mock.address);
                await expectRevert(
                    tempImpl.initialize(
                        nexus.address,
                        [sa.dummy1, sa.dummy1],
                        compoundPlatformAddress,
                        [erc20Mock.address],
                        [aTokenMock.address],
                    ),
                    "Already whitelisted",
                );
                await expectRevert(
                    tempImpl.initialize(
                        nexus.address,
                        [ZERO_ADDRESS],
                        compoundPlatformAddress,
                        [erc20Mock.address],
                        [aTokenMock.address],
                    ),
                    "Address is zero",
                );
            });
        });

        it("should properly store valid arguments", async () => {
            // check for platform addr
            expect(compoundPlatformAddress).eq(await d_CompoundIntegration.platformAddress());

            // check for pTokens added & events
            expect(integrationDetails.cTokens[0].cToken).eq(
                await d_CompoundIntegration.bAssetToPToken(integrationDetails.cTokens[0].bAsset),
            );

            expect(integrationDetails.cTokens[1].cToken).eq(
                await d_CompoundIntegration.bAssetToPToken(integrationDetails.cTokens[1].bAsset),
            );
        });

        it("should pre-approve spending of the passed bAssets", async () => {
            await Promise.all(
                integrationDetails.cTokens.map(async ({ bAsset, cToken }) => {
                    const d_bAsset = await c_ERC20.at(bAsset);
                    const balance = await d_bAsset.allowance(d_CompoundIntegration.address, cToken);
                    expect(balance).bignumber.eq(MAX_UINT256);
                }),
            );
        });

        it("should fail when called again", async () => {
            const tempImpl = await c_CompoundIntegration.new();
            const erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
            const aTokenMock = await c_MockCToken.new(erc20Mock.address);
            await tempImpl.initialize(
                nexus.address,
                [sa.dummy1],
                compoundPlatformAddress,
                [erc20Mock.address],
                [aTokenMock.address],
            );
            await expectRevert(
                tempImpl.initialize(
                    nexus.address,
                    [sa.dummy1],
                    compoundPlatformAddress,
                    [erc20Mock.address],
                    [aTokenMock.address],
                ),
                "Contract instance has already been initialized",
            );
        });

        it("should fail if passed incorrect data", async () => {
            const tempImpl = await c_CompoundIntegration.new();
            const erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
            const aTokenMock = await c_MockCToken.new(erc20Mock.address);

            // bAsset and pToken array length are different
            await expectRevert(
                tempImpl.initialize(
                    nexus.address,
                    [sa.dummy1, sa.dummy2],
                    compoundPlatformAddress,
                    [erc20Mock.address],
                    [aTokenMock.address, aTokenMock.address],
                ),
                "Invalid input arrays",
            );
            // pToken address is zero
            await expectRevert(
                tempImpl.initialize(
                    nexus.address,
                    [sa.dummy1, sa.dummy2],
                    compoundPlatformAddress,
                    [erc20Mock.address],
                    [ZERO_ADDRESS],
                ),
                "Invalid addresses",
            );
            // duplicate pToken or bAsset
            await expectRevert(
                tempImpl.initialize(
                    nexus.address,
                    [sa.dummy1, sa.dummy2],
                    compoundPlatformAddress,
                    [erc20Mock.address, erc20Mock.address],
                    [aTokenMock.address, sa.default],
                ),
                "pToken already set",
            );
            // invalid bAsset addresses
            await expectRevert.unspecified(
                tempImpl.initialize(
                    nexus.address,
                    [sa.dummy1, sa.dummy2],
                    compoundPlatformAddress,
                    [sa.default],
                    [aTokenMock.address],
                ),
            );
        });
    });

    describe("setting P Token Address", async () => {
        let erc20Mock: t.MockERC20Instance;
        let cTokenMock: t.MockCTokenInstance;
        beforeEach("init mocks", async () => {
            erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
            cTokenMock = await c_MockCToken.new(erc20Mock.address);
            await runSetup();
        });

        it("should pass only when function called by the Governor", async () => {
            await expectRevert(
                d_CompoundIntegration.setPTokenAddress(erc20Mock.address, cTokenMock.address, {
                    from: sa.default,
                }),
                "Only governor can execute",
            );
            await d_CompoundIntegration.setPTokenAddress(erc20Mock.address, cTokenMock.address, {
                from: sa.governor,
            });
            expect(cTokenMock.address).eq(
                await d_CompoundIntegration.bAssetToPToken(erc20Mock.address),
            );
        });

        it("should approve the spending of the bAsset correctly and emit event", async () => {
            await d_CompoundIntegration.setPTokenAddress(erc20Mock.address, cTokenMock.address, {
                from: sa.governor,
            });
            expect(cTokenMock.address).eq(
                await d_CompoundIntegration.bAssetToPToken(erc20Mock.address),
            );

            const approvedAddress = cTokenMock.address;
            const balance = await erc20Mock.allowance(
                d_CompoundIntegration.address,
                approvedAddress,
            );
            expect(balance).bignumber.eq(MAX_UINT256 as any);
        });

        it("should fail when passed invalid args", async () => {
            // bAsset address is zero
            await expectRevert(
                d_CompoundIntegration.setPTokenAddress(ZERO_ADDRESS, cTokenMock.address, {
                    from: sa.governor,
                }),
                "Invalid addresses",
            );
            // pToken address is zero
            await expectRevert(
                d_CompoundIntegration.setPTokenAddress(erc20Mock.address, ZERO_ADDRESS, {
                    from: sa.governor,
                }),
                "Invalid addresses",
            );
            // pToken address already assigned for a bAsset
            await d_CompoundIntegration.setPTokenAddress(erc20Mock.address, cTokenMock.address, {
                from: sa.governor,
            });
            await expectRevert(
                d_CompoundIntegration.setPTokenAddress(erc20Mock.address, sa.default, {
                    from: sa.governor,
                }),
                "pToken already set",
            );
        });
    });

    describe("calling deposit", async () => {
        beforeEach("init mocks", async () => {
            await runSetup();
        });

        it("should deposit tokens to Compound", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const amount = new BN(10).pow(await bAsset.decimals());
            const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken);

            const user_bAsset_balanceBefore = await bAsset.balanceOf(sa.default);
            const bAssetRecipient_balBefore = await bAsset.balanceOf(cToken.address);

            // Step 1. xfer tokens to integration
            await bAsset.transfer(d_CompoundIntegration.address, amount);
            expect(user_bAsset_balanceBefore.sub(amount)).to.bignumber.equal(
                await bAsset.balanceOf(sa.default),
            );

            // Step 2. call deposit
            const tx = await d_CompoundIntegration.deposit(bAsset.address, amount, false);

            // Step 3. Check for things:
            // 3.1 Check that compound integration has cTokens
            const cToken_balanceOfIntegration = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );
            expect(await convertUnderlyingToCToken(cToken, amount)).to.bignumber.equal(
                cToken_balanceOfIntegration,
            );
            // 3.2 Check that cToken has bAssets
            expect(await bAsset.balanceOf(cToken.address)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );

            expectEvent(tx.receipt, "Deposit", { _amount: amount });
        });

        it("should handle the fee calculations", async () => {
            // Step 0. Choose tokens and set up env
            await runSetup(true);

            const bAsset = await c_ERC20.at(integrationDetails.cTokens[1].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const cToken = await c_CERC20.at(integrationDetails.cTokens[1].cToken);

            // 0.1 Get balance before
            const bAssetRecipient = cToken.address;
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const compoundIntegration_balBefore = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );

            // Step 1. xfer tokens to integration
            const bal1 = await bAsset.balanceOf(d_CompoundIntegration.address);
            const transferTx = await bAsset.transfer(d_CompoundIntegration.address, amount);

            const bal2 = await bAsset.balanceOf(d_CompoundIntegration.address);
            const receivedAmount = bal2.sub(bal1);
            // Ensure fee is being deducted
            expect(receivedAmount).bignumber.lt(amount as any);
            // fee = initialAmount - receivedAmount
            const fee = amount.sub(receivedAmount);
            // feeRate = fee/amount (base 1e18)
            const feeRate = fee.mul(fullScale).div(amount);
            // expectedDepoit = receivedAmount - (receivedAmount*feeRate)
            const expectedDeposit = receivedAmount.sub(receivedAmount.mul(feeRate).div(fullScale));

            // Step 2. call deposit
            const depositTx = await d_CompoundIntegration.deposit(
                bAsset.address,
                receivedAmount,
                true,
            );

            // Step 3. Check for things:
            // 3.1 Check that cToken has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(expectedDeposit),
            );
            // 3.2 Check that compound integration has cTokens
            const compoundIntegration_balAfter = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );
            const expected_cTokens = await convertUnderlyingToCToken(cToken, receivedAmount);
            assertBNSlightlyGTPercent(compoundIntegration_balAfter, expected_cTokens, "0.01");

            // 3.3 Check that return value is cool (via event)
            const receivedUnderlying = await convertCTokenToUnderlying(
                cToken,
                compoundIntegration_balAfter,
            );

            const min = receivedAmount.lt(receivedUnderlying) ? receivedAmount : receivedUnderlying;
            expectEvent(depositTx.receipt, "Deposit", { _amount: min });
        });

        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            const amount = new BN(10).pow(new BN(await bAsset.decimals()));

            // Step 1. call deposit
            await expectRevert(
                d_CompoundIntegration.deposit(bAsset.address, amount, false, {
                    from: sa.dummy1,
                }),
                "Not a whitelisted address",
            );
        });

        it("should fail if the bAsset is not supported", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const amount = new BN(10).pow(await bAsset.decimals());

            // Step 1. call deposit
            await expectRevert(
                d_CompoundIntegration.deposit(bAsset.address, amount, false),
                "cToken does not exist",
            );
        });

        it("should fail if we do not first pass the required bAsset", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const amount = new BN(10).pow(new BN(await bAsset.decimals()));

            // Step 2. call deposit
            await expectRevert(
                d_CompoundIntegration.deposit(bAsset.address, amount, false),
                "ERC20: transfer amount exceeds balance",
            );
        });

        it("should fail if we try to deposit too much", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[1].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).mul(new BN(10).pow(bAsset_decimals));
            const amount_high = new BN(11).mul(new BN(10).pow(bAsset_decimals));

            // Step 1. xfer low tokens to integration
            await bAsset.transfer(d_CompoundIntegration.address, amount.toString());
            expect(await bAsset.balanceOf(d_CompoundIntegration.address)).bignumber.lte(
                amount as any,
            );
            // Step 2. call deposit with high tokens
            await expectRevert(
                d_CompoundIntegration.deposit(bAsset.address, amount_high.toString(), false),
                "ERC20: transfer amount exceeds balance",
            );
        });

        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken);

            // 0.1 Get balance before
            const bAssetRecipient = cToken.address;
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const compoundIntegration_balBefore = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );

            // Step 1. xfer low tokens to integration
            await bAsset.transfer(d_CompoundIntegration.address, amount);

            // Fails with ZERO bAsset Address
            await expectRevert(
                d_CompoundIntegration.deposit(ZERO_ADDRESS, amount, false),
                "cToken does not exist",
            );
            // Fails with ZERO Amount
            await expectRevert(
                d_CompoundIntegration.deposit(bAsset.address, "0", false),
                "Must deposit something",
            );
            // Succeeds with Incorrect bool (defaults to false)
            const tx = await d_CompoundIntegration.deposit(bAsset.address, amount, undefined);

            // Step 3. Check for things:
            // 3.1 Check that cToken has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );
            // 3.2 Check that compound integration has cTokens
            const cToken_balanceOfIntegration = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );
            const expected_cTokens = await convertUnderlyingToCToken(cToken, amount);
            expect(expected_cTokens).to.bignumber.equal(cToken_balanceOfIntegration);

            // 3.3 Check that return value is cool (via event)
            expectEvent(tx.receipt, "Deposit", { _amount: amount });
        });
    });

    describe("withdraw", () => {
        beforeEach("init mocks", async () => {
            await runSetup();
        });

        it("should withdraw tokens from Compound", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const amount = new BN(10).pow(await bAsset.decimals());
            const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken);

            const user_bAsset_balanceBefore = await bAsset.balanceOf(sa.default);
            const bAssetRecipient_balBefore = await bAsset.balanceOf(cToken.address);

            // Step 1. xfer tokens to integration
            await bAsset.transfer(d_CompoundIntegration.address, amount);

            expect(user_bAsset_balanceBefore.sub(amount)).to.bignumber.equal(
                await bAsset.balanceOf(sa.default),
            );

            // Step 2. call deposit
            const tx = await d_CompoundIntegration.deposit(bAsset.address, amount, false);

            // Step 3. Check for things:
            // 3.1 Check that cToken has bAssets
            expect(await bAsset.balanceOf(cToken.address)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );
            // 3.2 Check that compound integration has cTokens
            const cToken_balanceOfIntegration = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );
            const exchangeRate = await cToken.exchangeRateStored();
            const expected_cTokens = amount
                .addn(1)
                .mul(fullScale)
                .div(exchangeRate);
            expect(expected_cTokens).to.bignumber.equal(cToken_balanceOfIntegration);

            expectEvent(tx.receipt, "Deposit", { _amount: amount });

            // 4. Call withdraw
            await d_CompoundIntegration.methods["withdraw(address,address,uint256,bool)"](
                sa.default,
                bAsset.address,
                amount,
                false,
            );
            const expected_cTokenWithdrawal = await convertUnderlyingToCToken(cToken, amount);

            // 5. Check stuff
            // 5.1 Check that bAsset has returned to the user
            const user_bAsset_balanceAfter = await bAsset.balanceOf(sa.default);
            expect(user_bAsset_balanceAfter).to.bignumber.equal(user_bAsset_balanceBefore);

            // 5.2 Check that bAsset has returned to the user
            const cToken_balanceOfIntegrationAfter = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );
            expect(cToken_balanceOfIntegrationAfter).bignumber.eq(
                cToken_balanceOfIntegration.sub(expected_cTokenWithdrawal),
            );
        });
        context("and specifying a minute amount of bAsset", () => {
            beforeEach(async () => {
                await runSetup(false, true);
            });
            it("should withdraw 0 if the cToken amount is 0", async () => {
                // Step 0. Choose tokens
                const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
                const amount = new BN(1);
                const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken);

                const recipientBassetBalBefore = await bAsset.balanceOf(sa.default);
                const integrationCTokenBalanceBefore = await cToken.balanceOf(
                    d_CompoundIntegration.address,
                );

                const cTokenAmount = await convertUnderlyingToCToken(cToken, amount);
                expect(cTokenAmount).bignumber.eq(new BN(0), "cToken amount is not 0");

                const tx = await d_CompoundIntegration.methods[
                    "withdraw(address,address,uint256,bool)"
                ](sa.default, bAsset.address, amount, false);

                expectEvent(tx.receipt, "SkippedWithdrawal", {
                    bAsset: bAsset.address,
                    amount,
                });

                // recipient bAsset bal is the same
                const recipientBassetBalAfter = await bAsset.balanceOf(sa.default);
                expect(recipientBassetBalBefore).bignumber.eq(recipientBassetBalAfter);
                // compoundIntegration cTokenBal is the same
                const integrationCTokenBalanceAfter = await cToken.balanceOf(
                    d_CompoundIntegration.address,
                );
                expect(integrationCTokenBalanceBefore).bignumber.eq(integrationCTokenBalanceAfter);
            });
            it("should function normally if bAsset decimals are low", async () => {
                // Step 0. Choose tokens
                const bAsset = await c_ERC20.at(integrationDetails.cTokens[1].bAsset);
                const amount = new BN(1);
                const cToken = await c_CERC20.at(integrationDetails.cTokens[1].cToken);

                expect(await bAsset.decimals()).bignumber.eq(new BN(6));

                const recipientBassetBalBefore = await bAsset.balanceOf(sa.default);
                const integrationCTokenBalanceBefore = await cToken.balanceOf(
                    d_CompoundIntegration.address,
                );

                const cTokenAmount = await convertUnderlyingToCToken(cToken, amount);
                expect(cTokenAmount).bignumber.gt(new BN(0) as any, "cToken amount is 0");

                const tx = await d_CompoundIntegration.methods[
                    "withdraw(address,address,uint256,bool)"
                ](sa.default, bAsset.address, amount, false);

                expectEvent(tx.receipt, "PlatformWithdrawal", {
                    bAsset: bAsset.address,
                    pToken: cToken.address,
                    totalAmount: amount,
                    userAmount: amount,
                });

                // recipient bAsset bal is the same
                const recipientBassetBalAfter = await bAsset.balanceOf(sa.default);
                expect(recipientBassetBalAfter).bignumber.eq(recipientBassetBalBefore.add(amount));
                // compoundIntegration cTokenBal is the same
                const integrationCTokenBalanceAfter = await cToken.balanceOf(
                    d_CompoundIntegration.address,
                );
                expect(integrationCTokenBalanceAfter).bignumber.eq(
                    integrationCTokenBalanceBefore.sub(cTokenAmount),
                );
            });
        });

        it("should handle the fee calculations", async () => {
            await runSetup(true, true);

            // should deduct the transfer fee from the return value
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[1].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const cToken = await c_CERC20.at(integrationDetails.cTokens[1].cToken);

            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1;
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const compoundIntegration_balBefore = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );

            // Step 1. call withdraw
            const tx = await d_CompoundIntegration.methods[
                "withdraw(address,address,uint256,bool)"
            ](bAssetRecipient, bAsset.address, amount, true);
            const bAssetRecipient_balAfter = await bAsset.balanceOf(bAssetRecipient);
            const compoundIntegration_balAfter = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );

            // 99% of amt
            const scale = simpleToExactAmount("0.99", 18);
            const amountScaled = amount.mul(scale);
            const expectedAmount = amountScaled.div(fullScale);
            // Step 2. Validate recipient
            expect(bAssetRecipient_balAfter).bignumber.gte(
                bAssetRecipient_balBefore.add(expectedAmount) as any,
            );
            expect(bAssetRecipient_balAfter).bignumber.lte(
                bAssetRecipient_balBefore.add(amount) as any,
            );
            expect(compoundIntegration_balAfter).bignumber.eq(
                compoundIntegration_balBefore.sub(
                    await convertUnderlyingToCToken(cToken, amount),
                ) as any,
            );
            const expectedBalance = compoundIntegration_balBefore.sub(
                await convertUnderlyingToCToken(cToken, amount),
            );
            assertBNSlightlyGTPercent(compoundIntegration_balAfter, expectedBalance, "0.1");
            const underlyingBalance = await convertCTokenToUnderlying(
                cToken,
                compoundIntegration_balAfter,
            );
            // Cross that match with the `checkBalance` call
            const fetchedBalance = await d_CompoundIntegration.checkBalance.call(bAsset.address);
            expect(fetchedBalance).bignumber.eq(underlyingBalance);
        });

        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const amount = new BN(10).pow(await bAsset.decimals());

            // Step 1. call deposit
            await expectRevert(
                d_CompoundIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.dummy1,
                    bAsset.address,
                    amount,
                    false,
                    {
                        from: sa.dummy1,
                    },
                ),
                "Not a whitelisted address",
            );
        });

        it("should fail if there is insufficient balance", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(1000).mul(new BN(10).pow(bAsset_decimals));

            // Step 1. call deposit
            await expectRevert(
                d_CompoundIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.default,
                    bAsset.address,
                    amount,
                    false,
                ),
                "ERC20: burn amount exceeds balance",
            );
        });

        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken);

            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1;

            // Fails with ZERO bAsset Address
            await expectRevert(
                d_CompoundIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.dummy1,
                    ZERO_ADDRESS,
                    amount,
                    false,
                ),
                "cToken does not exist",
            );

            // Fails with ZERO recipient address
            await expectRevert(
                d_CompoundIntegration.methods["withdraw(address,address,uint256,bool)"](
                    ZERO_ADDRESS,
                    bAsset.address,
                    new BN(1),
                    false,
                ),
                "Must specify recipient",
            );

            // Fails with ZERO Amount
            await expectRevert(
                d_CompoundIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.dummy1,
                    bAsset.address,
                    "0",
                    false,
                ),
                "Must withdraw something",
            );

            expect(ZERO).to.bignumber.equal(await bAsset.balanceOf(bAssetRecipient));

            expect(ZERO).to.bignumber.equal(await cToken.balanceOf(d_CompoundIntegration.address));
        });

        it("should fail if the bAsset is not supported", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const amount = new BN(10).pow(await bAsset.decimals());

            // Step 1. call withdraw
            await expectRevert(
                d_CompoundIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.dummy1,
                    bAsset.address,
                    amount,
                    false,
                ),
                "cToken does not exist",
            );
        });
    });

    describe("withdraw specific amount", async () => {
        describe("and the token does not have transfer fee", async () => {
            beforeEach("init mocks", async () => {
                await runSetup(false, true);
            });
            it("should allow withdrawal of X and give Y to the caller", async () => {
                // Step 0. Choose tokens
                const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
                const bAsset_decimals = await bAsset.decimals();
                const amount = simpleToExactAmount(5, bAsset_decimals);
                const totalAmount = amount.muln(2);
                const aToken = await c_MockCToken.at(integrationDetails.cTokens[0].cToken);
                // 0.1 Get balance before
                const bAssetRecipient = sa.dummy1;
                const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
                const compoundIntegration_balBefore = await bAsset.balanceOf(
                    d_CompoundIntegration.address,
                );
                const compoundBalanceBefore = await d_CompoundIntegration.checkBalance.call(
                    bAsset.address,
                );

                // fail if called by non Bm or mAsset
                await expectRevert(
                    d_CompoundIntegration.methods["withdraw(address,address,uint256,uint256,bool)"](
                        bAssetRecipient,
                        bAsset.address,
                        amount,
                        totalAmount,
                        false,
                        {
                            from: sa.dummy1,
                        },
                    ),
                    "Not a whitelisted address",
                );
                // send the amount
                const tx = await d_CompoundIntegration.methods[
                    "withdraw(address,address,uint256,uint256,bool)"
                ](bAssetRecipient, bAsset.address, amount, totalAmount, false);
                const bAssetRecipient_balAfter = await bAsset.balanceOf(bAssetRecipient);
                const compoundIntegration_balAfter = await bAsset.balanceOf(
                    d_CompoundIntegration.address,
                );
                const compoundBalanceAfter = await d_CompoundIntegration.checkBalance.call(
                    bAsset.address,
                );
                expect(bAssetRecipient_balAfter).bignumber.eq(
                    bAssetRecipient_balBefore.add(amount),
                );
                expect(compoundIntegration_balAfter).bignumber.eq(
                    compoundIntegration_balBefore.add(totalAmount.sub(amount)),
                );
                const dust = compoundBalanceBefore.muln(1).divn(1000);
                assertBNSlightlyGT(
                    compoundBalanceAfter,
                    compoundBalanceBefore.sub(totalAmount),
                    dust,
                    false,
                );
                // emit the event
                expectEvent(tx.receipt, "PlatformWithdrawal", {
                    bAsset: bAsset.address,
                    pToken: aToken.address,
                    totalAmount: totalAmount,
                    userAmount: amount,
                });
            });
        });
        describe("and the token has transfer fees", async () => {
            beforeEach("init mocks", async () => {
                await runSetup(true, true);
            });
            it("should fail if totalAmount != userAmount", async () => {
                const bAsset = await c_ERC20.at(integrationDetails.cTokens[1].bAsset);
                const bAsset_decimals = await bAsset.decimals();
                const amount = simpleToExactAmount(5, bAsset_decimals);
                const totalAmount = amount.muln(2);
                await expectRevert(
                    d_CompoundIntegration.methods["withdraw(address,address,uint256,uint256,bool)"](
                        sa.dummy1,
                        bAsset.address,
                        amount,
                        totalAmount,
                        true,
                    ),
                    "Cache inactive for assets with fee",
                );
            });
        });
    });

    describe("withdrawRaw", async () => {
        beforeEach("init mocks", async () => {
            await runSetup(false, true);
        });
        it("should fail if caller is not whitelisetd", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            await expectRevert(
                d_CompoundIntegration.withdrawRaw(sa.dummy3, bAsset.address, new BN(1), {
                    from: sa.dummy1,
                }),
                "Not a whitelisted address",
            );
        });
        it("should allow the mAsset or BM to withdraw a given bAsset", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = simpleToExactAmount(5, bAsset_decimals);

            await bAsset.transfer(d_CompoundIntegration.address, amount);

            const bAssetRecipient = sa.dummy1;
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const compoundIntegration_balBefore = await bAsset.balanceOf(
                d_CompoundIntegration.address,
            );
            const compoundBalanceBefore = await d_CompoundIntegration.checkBalance.call(
                bAsset.address,
            );

            const tx = await d_CompoundIntegration.withdrawRaw(
                bAssetRecipient,
                bAsset.address,
                amount,
            );

            const bAssetRecipient_balAfter = await bAsset.balanceOf(bAssetRecipient);
            const compoundIntegration_balAfter = await bAsset.balanceOf(
                d_CompoundIntegration.address,
            );
            const compoundBalanceAfter = await d_CompoundIntegration.checkBalance.call(
                bAsset.address,
            );

            // Balances remain the same
            expect(bAssetRecipient_balAfter).bignumber.eq(bAssetRecipient_balBefore.add(amount));
            expect(compoundIntegration_balAfter).bignumber.eq(
                compoundIntegration_balBefore.sub(amount),
            );
            expect(compoundBalanceAfter).bignumber.eq(compoundBalanceBefore);

            // Emits expected event
            expectEvent(tx.receipt, "Withdrawal", {
                _bAsset: bAsset.address,
                _pToken: ZERO_ADDRESS,
                _amount: amount,
            });
        });
        it("should fail if there is no balance in a given asset", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            await expectRevert(
                d_CompoundIntegration.withdrawRaw(sa.dummy3, bAsset.address, new BN(1)),
                "SafeERC20: low-level call failed",
            );
        });
        it("should fail if specified a 0 amount", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            await expectRevert(
                d_CompoundIntegration.withdrawRaw(sa.dummy3, bAsset.address, new BN(0)),
                "Must withdraw something",
            );
        });
    });

    describe("checkBalance", async () => {
        beforeEach(async () => {
            await runSetup(false, true);
        });
        it("should return balance for any caller when supported token address passed", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);

            const expectedBal = new BN(10).mul(new BN(10).pow(await bAsset.decimals()));

            const fetchedBalance = await d_CompoundIntegration.checkBalance.call(bAsset.address);

            assertBNClose(fetchedBalance, expectedBal, new BN(100));
        });

        it("should increase our balance over time and activity", async () => {
            // Simulating activity on mainnet only, as our mocks are not capable
            if (!systemMachine.isGanacheFork) return;

            // Load things up and do some mints
            await runSetup(false, true);

            // 1. Load up our target tokens and get the balances now
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const cToken = await c_CERC20.at(integrationDetails.cTokens[0].cToken);

            const compoundIntegration_balBefore = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );
            expect(compoundIntegration_balBefore).bignumber.gt(new BN(0) as any);
            const underlyingBalanceBefore = await convertCTokenToUnderlying(
                cToken,
                compoundIntegration_balBefore,
            );
            // Cross that match with the `checkBalance` call
            const fetchedBalanceBefore = await d_CompoundIntegration.checkBalance.call(
                bAsset.address,
            );
            expect(fetchedBalanceBefore).bignumber.eq(underlyingBalanceBefore);

            // 2. Simulate some external activity by depositing or redeeming
            // DIRECTlY to the LendingPool.
            // Doing this activity should raise our aToken balances slightly
            // 2.1. Approve the LendingPool Core
            await bAsset.approve(cToken.address, amount);

            // 2.2. Call the deposit func
            await cToken.mint(amount);
            // 2.3. Fast forward some time
            await time.increase(ONE_WEEK);
            // 2.4. Do a redemption
            await cToken.redeemUnderlying(amount);

            // 3. Analyse our new balances
            const compoundIntegration_balAfter = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );
            // Should not go up by more than 2% during this period
            const underlyingBalanceAfter = await convertCTokenToUnderlying(
                cToken,
                compoundIntegration_balAfter,
            );
            assertBNSlightlyGTPercent(underlyingBalanceAfter, underlyingBalanceBefore, "2", true);
            // Cross that match with the `checkBalance` call
            const fetchedBalance = await d_CompoundIntegration.checkBalance.call(bAsset.address);
            expect(fetchedBalance).bignumber.eq(underlyingBalanceAfter);
            expect(fetchedBalance).bignumber.gt(fetchedBalanceBefore as any);

            // 4. Withdraw our new interested - we worked hard for it!
            await d_CompoundIntegration.methods["withdraw(address,address,uint256,bool)"](
                sa.default,
                bAsset.address,
                underlyingBalanceAfter,
                false,
            );
        });

        it("should fail if called with inactive token", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);

            await expectRevert(
                d_CompoundIntegration.checkBalance(bAsset.address),
                "cToken does not exist",
            );
        });
    });

    describe("reApproveAllTokens", async () => {
        before(async () => {
            await runSetup();
        });
        it("should re-approve ALL bAssets with aTokens", async () => {
            const bAsset1 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const cToken1 = await c_CERC20.at(integrationDetails.cTokens[0].cToken);
            let allowance = await bAsset1.allowance(d_CompoundIntegration.address, cToken1.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);

            const bAsset2 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const cToken2 = await c_CERC20.at(integrationDetails.cTokens[0].cToken);
            allowance = await bAsset2.allowance(d_CompoundIntegration.address, cToken2.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);

            await d_CompoundIntegration.reApproveAllTokens({
                from: sa.governor,
            });

            allowance = await bAsset1.allowance(d_CompoundIntegration.address, cToken1.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);

            allowance = await bAsset2.allowance(d_CompoundIntegration.address, cToken2.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);
        });

        it("should only be callable by the Governor", async () => {
            // Fail when not called by the Governor
            await expectRevert(
                d_CompoundIntegration.reApproveAllTokens({
                    from: sa.dummy1,
                }),
                "Only governor can execute",
            );

            // Succeed when called by the Governor
            d_CompoundIntegration.reApproveAllTokens({
                from: sa.governor,
            });
        });

        it("should be able to be called multiple times", async () => {
            const bAsset1 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const cToken1 = await c_CERC20.at(integrationDetails.cTokens[0].cToken);
            const bAsset2 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const cToken2 = await c_CERC20.at(integrationDetails.cTokens[0].cToken);

            let allowance = await bAsset1.allowance(d_CompoundIntegration.address, cToken1.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);
            allowance = await bAsset2.allowance(d_CompoundIntegration.address, cToken2.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);

            d_CompoundIntegration.reApproveAllTokens({
                from: sa.governor,
            });

            d_CompoundIntegration.reApproveAllTokens({
                from: sa.governor,
            });

            allowance = await bAsset1.allowance(d_CompoundIntegration.address, cToken1.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);
            allowance = await bAsset2.allowance(d_CompoundIntegration.address, cToken2.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);
        });
    });
});
