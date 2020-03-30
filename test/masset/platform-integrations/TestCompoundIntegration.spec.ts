/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable consistent-return */

import * as t from "types/generated";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine, MassetMachine } from "@utils/machines";
import { MainnetAccounts, ZERO_ADDRESS, MAX_UINT256, fullScale, ZERO } from "@utils/constants";

import envSetup from "@utils/env_setup";
import {
    BassetIntegrationDetails,
    Platform,
    CTokenDetails,
    ATokenDetails,
    Address,
} from "../../../types";
import shouldBehaveLikeModule from "../../shared/behaviours/Module.behaviour";

const { expect, assert } = envSetup.configure();

const c_ERC20: t.ERC20DetailedContract = artifacts.require("ERC20Detailed");
const c_CERC20: t.ICERC20Contract = artifacts.require("ICERC20");

const c_MockERC20: t.MockERC20Contract = artifacts.require("MockERC20");
const c_MockCToken: t.MockCTokenContract = artifacts.require("MockCToken");

const c_Nexus: t.NexusContract = artifacts.require("Nexus");
const c_DelayedProxyAdmin: t.DelayedProxyAdminContract = artifacts.require("DelayedProxyAdmin");

const c_InitializableProxy: t.InitializableAdminUpgradeabilityProxyContract = artifacts.require(
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
);
const c_CompoundIntegration: t.CompoundIntegrationContract = artifacts.require(
    "CompoundIntegration",
);

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

    const runSetup = async (enableUSDTFee = false) => {
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
        await d_CompoundIntegrationProxy.initialize(
            compoundImplementation.address,
            d_DelayedProxyAdmin.address,
            initializationData_CompoundIntegration,
        );

        await nexus.initialize(
            [await d_DelayedProxyAdmin.Key_ProxyAdmin()],
            [d_DelayedProxyAdmin.address],
            [true],
            sa.governor,
            { from: sa.governor },
        );

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
                await shouldFail.reverting.withMessage(
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
                await shouldFail.reverting.withMessage(
                    tempImpl.initialize(
                        nexus.address,
                        [sa.dummy1, sa.dummy1],
                        compoundPlatformAddress,
                        [erc20Mock.address],
                        [aTokenMock.address],
                    ),
                    "Already whitelisted",
                );
                await shouldFail.reverting.withMessage(
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
            await shouldFail.reverting.withMessage(
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
            await shouldFail.reverting.withMessage(
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
            await shouldFail.reverting.withMessage(
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
            await shouldFail.reverting.withMessage(
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
            await shouldFail.reverting(
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
            await shouldFail.reverting.withMessage(
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
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.setPTokenAddress(ZERO_ADDRESS, cTokenMock.address, {
                    from: sa.governor,
                }),
                "Invalid addresses",
            );
            // pToken address is zero
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.setPTokenAddress(erc20Mock.address, ZERO_ADDRESS, {
                    from: sa.governor,
                }),
                "Invalid addresses",
            );
            // pToken address already assigned for a bAsset
            await d_CompoundIntegration.setPTokenAddress(erc20Mock.address, cTokenMock.address, {
                from: sa.governor,
            });
            await shouldFail.reverting.withMessage(
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
            // 3.1 Check that cToken has bAssets
            expect(await bAsset.balanceOf(cToken.address)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );
            // 3.2 Check that compound integration has cTokens
            const cToken_balanceOfIntegration = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );
            const exchangeRate = await cToken.exchangeRateStored();
            const expected_cTokens = amount.mul(new BN(10).pow(new BN(18))).div(exchangeRate);
            expect(expected_cTokens).to.bignumber.equal(cToken_balanceOfIntegration);

            expectEvent.inLogs(tx.logs, "Deposit", { _amount: amount });
        });

        it("should handle the fee calculations", async () => {
            /*
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
            await bAsset.transfer(d_CompoundIntegration.address, amount);

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
            const tx = await d_CompoundIntegration.deposit(bAsset.address, receivedAmount, true);

            // Step 3. Check for things:
            // 3.1 Check that cToken has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(expectedDeposit),
            );
            // 3.2 Check that compound integration has cTokens
            const compoundIntegration_balAfter = await cToken.balanceOf(
                d_CompoundIntegration.address,
            );
            expect(compoundIntegration_balAfter).bignumber.lte(compoundIntegration_balBefore.add(
                receivedAmount,
            ) as any);
            expect(compoundIntegration_balAfter).bignumber.gte(compoundIntegration_balBefore.add(
                expectedDeposit,
            ) as any);
            // 3.3 Check that return value is cool (via event)
            const receivedATokens = compoundIntegration_balAfter.sub(compoundIntegration_balBefore);
            const min = receivedATokens.lt(receivedAmount) ? receivedATokens : receivedAmount;
            expectEvent.inLogs(tx.logs, "Deposit", { _amount: min });
            */
        });

        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            const amount = new BN(10).pow(new BN(await bAsset.decimals()));

            // Step 1. call deposit
            await shouldFail.reverting.withMessage(
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
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.deposit(bAsset.address, amount, false),
                "cToken does not exist",
            );
        });

        it("should fail if we do not first pass the required bAsset", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const amount = new BN(10).pow(new BN(await bAsset.decimals()));

            // Step 2. call deposit
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.deposit(bAsset.address, amount, false),
                "SafeMath: subtraction overflow",
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
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.deposit(bAsset.address, amount_high.toString(), false),
                "SafeMath: subtraction overflow",
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
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.deposit(ZERO_ADDRESS, amount, false),
                "cToken does not exist",
            );
            // Fails with ZERO Amount
            await shouldFail.reverting.withMessage(
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
            const exchangeRate = await cToken.exchangeRateStored();
            const expected_cTokens = amount.mul(new BN(10).pow(new BN(18))).div(exchangeRate);
            expect(expected_cTokens).to.bignumber.equal(cToken_balanceOfIntegration);

            // 3.3 Check that return value is cool (via event)
            expectEvent.inLogs(tx.logs, "Deposit", { _amount: amount });
        });
    });

    describe("withdraw", async () => {
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
            let cToken_balanceOfIntegration = await cToken.balanceOf(d_CompoundIntegration.address);
            const exchangeRate = await cToken.exchangeRateStored();
            const expected_cTokens = amount.mul(new BN(10).pow(new BN(18))).div(exchangeRate);
            expect(expected_cTokens).to.bignumber.equal(cToken_balanceOfIntegration);

            expectEvent.inLogs(tx.logs, "Deposit", { _amount: amount });

            await d_CompoundIntegration.withdraw(sa.default, bAsset.address, amount, false);

            const user_bAsset_balanceAfter = await bAsset.balanceOf(sa.default);
            expect(user_bAsset_balanceAfter).to.bignumber.equal(user_bAsset_balanceBefore);

            cToken_balanceOfIntegration = await cToken.balanceOf(d_CompoundIntegration.address);
            expect(new BN(0)).to.bignumber.equal(cToken_balanceOfIntegration);
        });

        it("should handle the fee calculations");

        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const amount = new BN(10).pow(await bAsset.decimals());

            // Step 1. call deposit
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.withdraw(sa.dummy1, bAsset.address, amount, false, {
                    from: sa.dummy1,
                }),
                "Not a whitelisted address",
            );
        });

        it("should fail if there is insufficient balance", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(1000).mul(new BN(10).pow(bAsset_decimals));

            // Step 1. call deposit
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.withdraw(sa.default, bAsset.address, amount, false),
                "SafeMath: subtraction overflow",
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
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.withdraw(sa.dummy1, ZERO_ADDRESS, amount, false),
                "cToken does not exist",
            );
            // Fails with ZERO recipient address
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.withdraw(ZERO_ADDRESS, bAsset.address, new BN(1), false),
                "",
            );
            // Fails with ZERO Amount
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.withdraw(sa.dummy1, bAsset.address, "0", false),
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
            await shouldFail.reverting.withMessage(
                d_CompoundIntegration.withdraw(sa.dummy1, bAsset.address, amount, false),
                "cToken does not exist",
            );
        });
    });

    describe("checkBalance", async () => {
        it("should return balance when supported token address passed");
        it("should increase our balance over time and activity");
        it("should return balance with same precision as bAsset");
    });

    describe("reApproveAllTokens", async () => {
        it("should re-approve ALL bAssets with aTokens", async () => {
            const bAsset1 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const cToken1 = await c_CERC20.at(integrationDetails.cTokens[0].cToken);
            let allowance = await bAsset1.allowance(d_CompoundIntegration.address, cToken1.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);

            const bAsset2 = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const cToken2 = await c_CERC20.at(integrationDetails.cTokens[0].cToken);
            allowance = await bAsset2.allowance(d_CompoundIntegration.address, cToken2.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);

            d_CompoundIntegration.reApproveAllTokens({
                from: sa.governor,
            });

            allowance = await bAsset1.allowance(d_CompoundIntegration.address, cToken1.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);

            allowance = await bAsset2.allowance(d_CompoundIntegration.address, cToken2.address);
            expect(MAX_UINT256).to.bignumber.equal(allowance);
        });

        it("should only be callable by the Governor", async () => {
            // Fail when not called by the Governor
            await shouldFail.reverting.withMessage(
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
