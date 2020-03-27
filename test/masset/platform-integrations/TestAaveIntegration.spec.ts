/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable consistent-return */

import * as t from "types/generated";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine, MassetMachine } from "@utils/machines";
import { MainnetAccounts, ZERO_ADDRESS, MAX_UINT256, fullScale } from "@utils/constants";

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

const c_MockERC20: t.MockERC20Contract = artifacts.require("MockERC20");
const c_MockERC20WithFee: t.MockERC20WithFeeContract = artifacts.require("MockERC20WithFee");
const c_MockAaveAToken: t.MockATokenContract = artifacts.require("MockAToken");
const c_MockAave: t.MockAaveContract = artifacts.require("MockAave");
const c_Nexus: t.NexusContract = artifacts.require("Nexus");
const c_AaveLendingPoolAddressProvider: t.ILendingPoolAddressesProviderContract = artifacts.require(
    "ILendingPoolAddressesProvider",
);
const c_ERC20: t.ERC20DetailedContract = artifacts.require("ERC20Detailed");
const c_AaveAToken: t.IAaveATokenContract = artifacts.require("IAaveAToken");
const c_DelayedProxyAdmin: t.DelayedProxyAdminContract = artifacts.require("DelayedProxyAdmin");

const c_InitializableProxy: t.InitializableAdminUpgradeabilityProxyContract = artifacts.require(
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
);
const c_AaveIntegration: t.AaveIntegrationContract = artifacts.require("AaveIntegration");

contract("AaveIntegration", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const ma = new MainnetAccounts();

    let systemMachine: SystemMachine;
    let nexus: t.NexusInstance;
    let massetMachine: MassetMachine;

    let integrationDetails: BassetIntegrationDetails;
    let d_DelayedProxyAdmin: t.DelayedProxyAdminInstance;
    let d_AaveIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance;
    let d_AaveIntegration: t.AaveIntegrationInstance;

    const ctx: { module?: t.InitializableModuleInstance } = {};

    before("base init", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = systemMachine.massetMachine;

        await runSetup();
    });

    const runSetup = async () => {
        // SETUP
        // ======
        nexus = await c_Nexus.new(sa.governor);
        // Init proxyAdmin
        d_DelayedProxyAdmin = await c_DelayedProxyAdmin.new(nexus.address);
        // Initialize the proxy
        d_AaveIntegrationProxy = await c_InitializableProxy.new();
        d_AaveIntegration = await c_AaveIntegration.at(d_AaveIntegrationProxy.address);

        // Load network specific integration data
        integrationDetails = await massetMachine.loadBassets();

        // Initialize the proxy storage
        const aaveImplementation = await c_AaveIntegration.new();

        const initializationData_AaveIntegration: string = aaveImplementation.contract.methods
            .initialize(
                nexus.address,
                [sa.default],
                integrationDetails.aavePlatformAddress,
                integrationDetails.aTokens.map((a) => a.bAsset),
                integrationDetails.aTokens.map((a) => a.aToken),
            )
            .encodeABI();
        await d_AaveIntegrationProxy.initialize(
            aaveImplementation.address,
            d_DelayedProxyAdmin.address,
            initializationData_AaveIntegration,
        );

        await nexus.initialize(
            [await d_DelayedProxyAdmin.Key_ProxyAdmin()],
            [d_DelayedProxyAdmin.address],
            [true],
            sa.governor,
            { from: sa.governor },
        );

        ctx.module = d_AaveIntegration;
    };

    describe("initializing AaveIntegration", async () => {
        describe("verifying GovernableWhitelist initialization", async () => {
            describe("verifying InitializableModule initialization", async () => {
                shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

                it("should properly store valid arguments", async () => {
                    // Check for nexus addr
                    expect(await d_AaveIntegration.nexus()).eq(nexus.address);
                });
            });

            it("should properly store valid arguments", async () => {
                // check for whitelisted accs
                const whitelisted = await d_AaveIntegration.whitelist(sa.default);
                expect(whitelisted).eq(true);
                // check for non whitelisted accs
                const notWhitelisted = await d_AaveIntegration.whitelist(sa.dummy4);
                expect(notWhitelisted).eq(false);
                const notWhitelisted2 = await d_AaveIntegration.whitelist(sa.governor);
                expect(notWhitelisted2).eq(false);
            });
            it("should fail when empty whitelisted array", async () => {
                const tempImpl = await c_AaveIntegration.new();
                const erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
                const aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
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
                const tempImpl = await c_AaveIntegration.new();
                const erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
                const aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
                await shouldFail.reverting.withMessage(
                    tempImpl.initialize(
                        nexus.address,
                        [sa.dummy1, sa.dummy1],
                        sa.other,
                        [erc20Mock.address],
                        [aTokenMock.address],
                    ),
                    "Already whitelisted",
                );
                await shouldFail.reverting.withMessage(
                    tempImpl.initialize(
                        nexus.address,
                        [ZERO_ADDRESS],
                        sa.other,
                        [erc20Mock.address],
                        [aTokenMock.address],
                    ),
                    "Address is zero",
                );
            });
        });

        it("should properly store valid arguments", async () => {
            // check for platform addr
            expect(integrationDetails.aavePlatformAddress).eq(
                await d_AaveIntegration.platformAddress(),
            );
            // check for pTokens added & events
            expect(integrationDetails.aTokens[0].aToken).eq(
                await d_AaveIntegration.bAssetToPToken(integrationDetails.aTokens[0].bAsset),
            );
            expect(integrationDetails.aTokens[1].aToken).eq(
                await d_AaveIntegration.bAssetToPToken(integrationDetails.aTokens[1].bAsset),
            );
        });

        it("should approve spending of the passed bAssets", async () => {
            const bAsset = await c_MockERC20.at(integrationDetails.aTokens[0].bAsset);
            const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            const approvedAddress = await addressProvider.getLendingPoolCore();
            const balance = await bAsset.allowance(d_AaveIntegration.address, approvedAddress);
            expect(balance).bignumber.eq(MAX_UINT256 as any);
        });

        it("should fail when called again", async () => {
            const tempImpl = await c_AaveIntegration.new();
            const erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
            const aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
            await tempImpl.initialize(
                nexus.address,
                [sa.dummy1],
                integrationDetails.aavePlatformAddress,
                [erc20Mock.address],
                [aTokenMock.address],
            );
            await shouldFail.reverting.withMessage(
                tempImpl.initialize(
                    nexus.address,
                    [sa.dummy1],
                    sa.other,
                    [erc20Mock.address],
                    [aTokenMock.address],
                ),
                "Contract instance has already been initialized",
            );
        });

        it("should fail if passed incorrect data", async () => {
            const tempImpl = await c_AaveIntegration.new();
            const erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
            const aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
            // platformAddress is invalid
            await shouldFail.reverting(
                tempImpl.initialize(
                    nexus.address,
                    [sa.dummy1],
                    ZERO_ADDRESS,
                    [erc20Mock.address],
                    [aTokenMock.address],
                ),
            );
            // bAsset and pToken array length are different
            await shouldFail.reverting.withMessage(
                tempImpl.initialize(
                    nexus.address,
                    [sa.dummy1, sa.dummy2],
                    integrationDetails.aavePlatformAddress,
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
                    integrationDetails.aavePlatformAddress,
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
                    integrationDetails.aavePlatformAddress,
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
                    integrationDetails.aavePlatformAddress,
                    [sa.default],
                    [aTokenMock.address],
                ),
            );
        });
    });

    describe("setting P Token Address", async () => {
        let erc20Mock: t.MockERC20Instance;
        let aTokenMock: t.MockATokenInstance;
        beforeEach("init mocks", async () => {
            erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
            aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
            await runSetup();
        });
        it("should pass only when function called by the Governor", async () => {
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.setPTokenAddress(erc20Mock.address, aTokenMock.address, {
                    from: sa.default,
                }),
                "Only governor can execute",
            );
            await d_AaveIntegration.setPTokenAddress(erc20Mock.address, aTokenMock.address, {
                from: sa.governor,
            });
            expect(aTokenMock.address).eq(
                await d_AaveIntegration.bAssetToPToken(erc20Mock.address),
            );
        });
        it("should approve the spending of the bAsset correctly and emit event", async () => {
            await d_AaveIntegration.setPTokenAddress(erc20Mock.address, aTokenMock.address, {
                from: sa.governor,
            });
            expect(aTokenMock.address).eq(
                await d_AaveIntegration.bAssetToPToken(erc20Mock.address),
            );
            const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            const approvedAddress = await addressProvider.getLendingPoolCore();
            const balance = await erc20Mock.allowance(d_AaveIntegration.address, approvedAddress);
            expect(balance).bignumber.eq(MAX_UINT256 as any);
        });
        it("should fail when passed invalid args", async () => {
            // bAsset address is zero
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.setPTokenAddress(ZERO_ADDRESS, aTokenMock.address, {
                    from: sa.governor,
                }),
                "Invalid addresses",
            );
            // pToken address is zero
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.setPTokenAddress(erc20Mock.address, ZERO_ADDRESS, {
                    from: sa.governor,
                }),
                "Invalid addresses",
            );
            // pToken address already assigned for a bAsset
            await d_AaveIntegration.setPTokenAddress(erc20Mock.address, aTokenMock.address, {
                from: sa.governor,
            });
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.setPTokenAddress(erc20Mock.address, sa.default, {
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
        it("should deposit tokens to Aave", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const amount = new BN(10).pow(new BN(12));
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);
            // 0.1 Get balance before
            const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            const bAssetRecipient = await addressProvider.getLendingPoolCore();
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);

            // Step 1. xfer tokens to integration
            await bAsset.transfer(d_AaveIntegration.address, amount.toString());

            // Step 2. call deposit
            const tx = await d_AaveIntegration.deposit(bAsset.address, amount.toString(), false);

            // Step 3. Check for things:
            // 3.1 Check that lending pool core has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );
            // 3.2 Check that aave integration has aTokens
            expect(await aToken.balanceOf(d_AaveIntegration.address)).bignumber.eq(
                aaveIntegration_balBefore.add(amount),
            );
            // 3.3 Check that return value is cool (via event)
            expectEvent.inLogs(tx.logs, "Deposit", { _amount: amount });
        });

        it("should handle the fee calculations", async () => {
            // Can only run on local, due to constraints from Aave
            if (!systemMachine.isGanacheFork) {
                // Step 0. Choose tokens and set up env
                const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                    integrationDetails.aavePlatformAddress,
                );
                const bAsset = await c_MockERC20WithFee.new("FEE", "F", 12, sa.default, "1000000");
                const amount = new BN(10).pow(new BN(12));
                const aToken = await c_MockAaveAToken.new(
                    await addressProvider.getLendingPool(),
                    bAsset.address,
                );
                await (await c_MockAave.at(integrationDetails.aavePlatformAddress)).addAToken(
                    aToken.address,
                    bAsset.address,
                );
                // 0.1 Add bAsset and aToken to system
                await d_AaveIntegration.setPTokenAddress(bAsset.address, aToken.address, {
                    from: sa.governor,
                });
                // 0.2 Get balance before
                const bAssetRecipient = await addressProvider.getLendingPoolCore();
                const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
                const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);

                // Step 1. xfer tokens to integration
                const bal1 = await bAsset.balanceOf(d_AaveIntegration.address);
                await bAsset.transfer(d_AaveIntegration.address, amount.toString());

                const bal2 = await bAsset.balanceOf(d_AaveIntegration.address);
                const receivedAmount = bal2.sub(bal1);
                // fee = initialAmount - receivedAmount
                const fee = amount.sub(receivedAmount);
                // feeRate = fee/amount (base 1e18)
                const feeRate = fee.mul(fullScale).div(amount);
                // expectedDepoit = receivedAmount - (receivedAmount*feeRate)
                const expectedDeposit = receivedAmount.sub(
                    receivedAmount.mul(feeRate).div(fullScale),
                );

                // Step 2. call deposit
                const tx = await d_AaveIntegration.deposit(
                    bAsset.address,
                    receivedAmount.toString(),
                    true,
                );

                // Step 3. Check for things:
                // 3.1 Check that lending pool core has bAssets
                expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                    bAssetRecipient_balBefore.add(expectedDeposit),
                );
                // 3.2 Check that aave integration has aTokens
                const aaveIntegration_balAfter = await aToken.balanceOf(d_AaveIntegration.address);
                expect(aaveIntegration_balAfter).bignumber.lte(
                    aaveIntegration_balBefore.add(receivedAmount) as any,
                );
                expect(aaveIntegration_balAfter).bignumber.gte(
                    aaveIntegration_balBefore.add(expectedDeposit) as any,
                );
                // 3.3 Check that return value is cool (via event)
                const receivedATokens = aaveIntegration_balAfter.sub(aaveIntegration_balBefore);
                const min = receivedATokens.lt(receivedAmount) ? receivedATokens : receivedAmount;
                expectEvent.inLogs(tx.logs, "Deposit", { _amount: min });
            }
        });

        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            const amount = new BN(10).pow(new BN(12));

            // Step 1. call deposit
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.deposit(bAsset.address, amount.toString(), false, {
                    from: sa.dummy1,
                }),
                "Not a whitelisted address",
            );
        });
        it("should fail if the bAsset is not supported", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const amount = new BN(10).pow(new BN(12));

            // Step 1. call deposit
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.deposit(bAsset.address, amount.toString(), false),
                "aToken does not exist",
            );
        });
        it("should fail if we do not first pass the required bAsset", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const amount = new BN(10).pow(new BN(12));
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);

            // Step 2. call deposit
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.deposit(bAsset.address, amount.toString(), false),
                "SafeERC20: low-level call failed",
            );
        });
        it("should fail if we try to deposit too much", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).mul(new BN(10).pow(bAsset_decimals));
            const amount_high = new BN(11).mul(new BN(10).pow(bAsset_decimals));
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[1].aToken);

            // Step 1. xfer low tokens to integration
            await bAsset.transfer(d_AaveIntegration.address, amount.toString());
            expect(await bAsset.balanceOf(d_AaveIntegration.address)).bignumber.lte(amount as any);
            // Step 2. call deposit with high tokens
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.deposit(bAsset.address, amount_high.toString(), false),
                "SafeERC20: low-level call failed",
            );
        });
        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[1].aToken);

            // 0.1 Get balance before
            const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            const bAssetRecipient = await addressProvider.getLendingPoolCore();
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);

            // Step 1. xfer low tokens to integration
            await bAsset.transfer(d_AaveIntegration.address, amount.toString());

            // Fails with ZERO bAsset Address
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.deposit(ZERO_ADDRESS, amount.toString(), false),
                "aToken does not exist",
            );
            // Fails with ZERO Amount
            await shouldFail.reverting.withMessage(
                d_AaveIntegration.deposit(bAsset.address, "0", false),
                "Must deposit something",
            );
            // Succeeds with Incorrect bool (defaults to false)
            const tx = await d_AaveIntegration.deposit(
                bAsset.address,
                amount.toString(),
                undefined,
            );

            // Step 3. Check for things:
            // 3.1 Check that lending pool core has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );
            // 3.2 Check that aave integration has aTokens
            expect(await aToken.balanceOf(d_AaveIntegration.address)).bignumber.eq(
                aaveIntegration_balBefore.add(amount),
            );
            // 3.3 Check that return value is cool (via event)
            expectEvent.inLogs(tx.logs, "Deposit", { _amount: amount });
        });
        it("should fail if lending pool or core does not exist (skip on mainnet)", async () => {
            // Can only run on local, due to constraints from Aave
            if (!systemMachine.isGanacheFork) {
                const mockAave = await c_MockAave.at(integrationDetails.aavePlatformAddress);
                await mockAave.breakLendingPools();
                const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
                await bAsset.transfer(d_AaveIntegration.address, "1");
                // Fails with ZERO Amount
                await shouldFail.reverting.withMessage(
                    d_AaveIntegration.deposit(bAsset.address, "1", false),
                    "Lending pool does not exist",
                );
                // Fails with ZERO Amount
                await shouldFail.reverting.withMessage(
                    d_AaveIntegration.reApproveAllTokens({ from: sa.governor }),
                    "Lending pool core does not exist",
                );
            }
        });
    });

    describe("withdraw", async () => {
        it("should only allow a whitelisted user to call function");
        it("should withdraw tokens from Aave", async () => {
            // check that the recipient receives the tokens
            // check that the lending pool core has tokens
            // check that our new balance of aTokens is given
            // should give accurate return value
        });

        it("should withdraw all if there is no fee");
        it("should handle the fee calculations", async () => {
            // should deduct the transfer fee from the return value
        });

        it("should fail if there is insufficient balance");
        it("should fail with broken arguments");
        it("should fail if the bAsset is not supported");
    });

    describe("checkBalance", async () => {
        it("should return balance when supported token address passed");
        it("should increase our balance over time and activity");
        it("should return balance with same precision as bAsset");
    });

    describe("reApproveAllTokens", async () => {
        it("should re-approve ALL bAssets with aTokens");
        it("should only be callable bby the Governor");
        it("should fail if lending pool core does not exist (mock)");

        it("should be able to be called multiple times");
    });

    describe("disapprove", async () => {
        it("should be implemented...");
    });
});
