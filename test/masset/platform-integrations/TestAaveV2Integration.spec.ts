/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable consistent-return */

import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { BN } from "@utils/tools";
import {
    assertBNClose,
    assertBNClosePercent,
    assertBNSlightlyGT,
    assertBNSlightlyGTPercent,
} from "@utils/assertions";
import { StandardAccounts, SystemMachine, MassetMachine } from "@utils/machines";
import {
    MainnetAccounts,
    ZERO_ADDRESS,
    MAX_UINT256,
    fullScale,
    ONE_WEEK,
    TEN_MINS,
} from "@utils/constants";
import { simpleToExactAmount } from "@utils/math";

import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import { BassetIntegrationDetails } from "../../../types";
import shouldBehaveLikeModule from "../../shared/behaviours/Module.behaviour";

const { expect } = envSetup.configure();

const c_MockERC20 = artifacts.require("MockERC20");
const c_Nexus = artifacts.require("Nexus");
const c_ERC20 = artifacts.require("ERC20Detailed");
const c_DelayedProxyAdmin = artifacts.require("DelayedProxyAdmin");
const c_InitializableProxy = artifacts.require("InitializableAdminUpgradeabilityProxy");

const c_AaveIntegration = artifacts.require("MockAaveV2Integration");
const c_MockAaveAToken = artifacts.require("MockATokenV2");
const c_MockAave = artifacts.require("MockAaveV2");
const c_AaveLendingPoolAddressProvider = artifacts.require("ILendingPoolAddressesProviderV2");
const c_AaveLendingPool = artifacts.require("IAaveLendingPoolV2");
const c_AaveAToken = artifacts.require("IAaveATokenV2");

contract("AaveIntegration", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const ma = new MainnetAccounts();

    let systemMachine: SystemMachine;
    let nexus: t.NexusInstance;
    let massetMachine: MassetMachine;

    let integrationDetails: BassetIntegrationDetails;
    let d_DelayedProxyAdmin: t.DelayedProxyAdminInstance;
    let d_AaveIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance;
    let d_AaveIntegration: t.MockAaveV2IntegrationInstance;

    const ctx: { module?: t.ModuleInstance } = {};

    before("base init", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = systemMachine.massetMachine;

        await runSetup(false, false);
    });

    const runSetup = async (enableUSDTFee = false, simulateMint = false) => {
        // SETUP
        // ======
        nexus = await c_Nexus.new(sa.governor);
        // Init proxyAdmin
        d_DelayedProxyAdmin = await c_DelayedProxyAdmin.new(nexus.address);
        // Initialize the proxy
        d_AaveIntegrationProxy = await c_InitializableProxy.new();
        d_AaveIntegration = await c_AaveIntegration.at(d_AaveIntegrationProxy.address);

        // Load network specific integration data
        integrationDetails = await massetMachine.loadBassets(enableUSDTFee, false);

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
        await d_AaveIntegrationProxy.methods["initialize(address,address,bytes)"](
            aaveImplementation.address,
            d_DelayedProxyAdmin.address,
            initializationData_AaveIntegration,
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
                integrationDetails.aTokens.map(async ({ bAsset, aToken }) => {
                    // Step 0. Choose tokens
                    const d_bAsset = await c_ERC20.at(bAsset);
                    const bAsset_decimals = await d_bAsset.decimals();
                    const amount = new BN(enableUSDTFee ? 101 : 100).mul(
                        new BN(10).pow(bAsset_decimals.sub(new BN(1))),
                    );
                    const amount_dep = new BN(100).mul(
                        new BN(10).pow(bAsset_decimals.sub(new BN(1))),
                    );
                    // Step 1. xfer tokens to integration
                    await d_bAsset.transfer(d_AaveIntegration.address, amount.toString());
                    // Step 2. call deposit
                    return d_AaveIntegration.deposit(bAsset, amount_dep.toString(), true);
                }),
            );
        }

        ctx.module = d_AaveIntegration as t.ModuleInstance;
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
                const tempImpl = await c_AaveIntegration.new();
                const erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
                const aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
                await expectRevert(
                    tempImpl.initialize(
                        nexus.address,
                        [sa.dummy1, sa.dummy1],
                        sa.other,
                        [erc20Mock.address],
                        [aTokenMock.address],
                    ),
                    "Already whitelisted",
                );
                await expectRevert(
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
            const approvedAddress = await addressProvider.getLendingPool();
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
            await expectRevert(
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
            await expectRevert.unspecified(
                tempImpl.initialize(
                    nexus.address,
                    [sa.dummy1],
                    ZERO_ADDRESS,
                    [erc20Mock.address],
                    [aTokenMock.address],
                ),
            );
            // bAsset and pToken array length are different
            await expectRevert(
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
            await expectRevert(
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
            await expectRevert(
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
            await expectRevert.unspecified(
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
        let aTokenMock: t.MockATokenV2Instance;
        beforeEach("init mocks", async () => {
            erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
            aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
            await runSetup();
        });
        it("should pass only when function called by the Governor", async () => {
            await expectRevert(
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
            const approvedAddress = await addressProvider.getLendingPool();
            const balance = await erc20Mock.allowance(d_AaveIntegration.address, approvedAddress);
            expect(balance).bignumber.eq(MAX_UINT256 as any);
        });
        it("should fail when passed invalid args", async () => {
            // bAsset address is zero
            await expectRevert(
                d_AaveIntegration.setPTokenAddress(ZERO_ADDRESS, aTokenMock.address, {
                    from: sa.governor,
                }),
                "Invalid addresses",
            );
            // pToken address is zero
            await expectRevert(
                d_AaveIntegration.setPTokenAddress(erc20Mock.address, ZERO_ADDRESS, {
                    from: sa.governor,
                }),
                "Invalid addresses",
            );
            // pToken address already assigned for a bAsset
            await d_AaveIntegration.setPTokenAddress(erc20Mock.address, aTokenMock.address, {
                from: sa.governor,
            });
            await expectRevert(
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
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);
            // 0.1 Get balance before
            const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            const bAssetRecipient = await addressProvider.getLendingPool();
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);
            // Cross that match with the `checkBalance` call
            let directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(aaveIntegration_balBefore);

            // Step 1. xfer tokens to integration
            await bAsset.transfer(d_AaveIntegration.address, amount.toString());

            // Step 2. call deposit
            const tx = await d_AaveIntegration.deposit(bAsset.address, amount.toString(), false);

            // Step 3. Check for things:
            // 3.1 Check that lending pool has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );
            // 3.2 Check that aave integration has aTokens
            const expectedBalance = aaveIntegration_balBefore.add(amount);
            const actualBalance = await aToken.balanceOf(d_AaveIntegration.address);
            assertBNSlightlyGTPercent(actualBalance, expectedBalance);
            // Cross that match with the `checkBalance` call
            directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(actualBalance);
            // Assert that Balance goes up over time
            await time.increase(TEN_MINS);
            const newBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            assertBNSlightlyGTPercent(
                newBalance,
                directBalance,
                "0.0001",
                systemMachine.isGanacheFork,
            );
            // 3.3 Check that return value is cool (via event)
            expectEvent(tx.receipt, "Deposit", { _amount: amount });
        });

        it("should handle the fee calculations", async () => {
            // Step 0. Choose tokens and set up env
            await runSetup(true);

            const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[1].aToken);

            // 0.1 Get balance before
            const bAssetRecipient = await addressProvider.getLendingPool();
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);
            // Cross that match with the `checkBalance` call
            let directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(aaveIntegration_balBefore);

            // Step 1. xfer tokens to integration
            const bal1 = await bAsset.balanceOf(d_AaveIntegration.address);
            await bAsset.transfer(d_AaveIntegration.address, amount.toString());

            const bal2 = await bAsset.balanceOf(d_AaveIntegration.address);
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
            const tx = await d_AaveIntegration.deposit(
                bAsset.address,
                receivedAmount.toString(),
                true,
            );

            // Step 3. Check for things:
            // 3.1 Check that lending pool has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(expectedDeposit),
            );
            // 3.2 Check that aave integration has aTokens
            const aaveIntegration_balAfter = await aToken.balanceOf(d_AaveIntegration.address);
            assertBNClose(
                aaveIntegration_balAfter,
                aaveIntegration_balBefore.add(expectedDeposit),
                fee,
            );
            // Cross that match with the `checkBalance` call
            directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(aaveIntegration_balAfter);

            // 3.3 Check that return value is cool (via event)
            const receivedATokens = aaveIntegration_balAfter.sub(aaveIntegration_balBefore);
            const min = receivedATokens.lt(receivedAmount) ? receivedATokens : receivedAmount;
            expectEvent(tx.receipt, "Deposit", { _amount: min });
        });
        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            const amount = new BN(10).pow(new BN(12));

            // Step 1. call deposit
            await expectRevert(
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
            await expectRevert(
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
            await expectRevert(
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
            await expectRevert(
                d_AaveIntegration.deposit(bAsset.address, amount_high.toString(), false),
                "SafeERC20: low-level call failed",
            );
        });
        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);

            // 0.1 Get balance before
            const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            const bAssetRecipient = await addressProvider.getLendingPool();
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);

            // Step 1. xfer low tokens to integration
            await bAsset.transfer(d_AaveIntegration.address, amount.toString());

            // Fails with ZERO bAsset Address
            await expectRevert(
                d_AaveIntegration.deposit(ZERO_ADDRESS, amount.toString(), false),
                "aToken does not exist",
            );
            // Fails with ZERO Amount
            await expectRevert(
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
            // 3.1 Check that lending pool has bAssets
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );
            // 3.2 Check that aave integration has aTokens
            const newBal = await aToken.balanceOf(d_AaveIntegration.address);
            assertBNSlightlyGT(newBal, aaveIntegration_balBefore.add(amount), new BN("1000"));
            // Cross that match with the `checkBalance` call
            const directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(newBal);

            // 3.3 Check that return value is cool (via event)
            expectEvent(tx.receipt, "Deposit", { _amount: amount });
        });
        it("should fail if lending pool does not exist (skip on fork)", async () => {
            // Can only run on local, due to constraints from Aave
            if (systemMachine.isGanacheFork) return;
            const mockAave = await c_MockAave.at(integrationDetails.aavePlatformAddress);
            await mockAave.breakLendingPools();
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            await bAsset.transfer(d_AaveIntegration.address, "1");
            // Fails with ZERO Amount
            await expectRevert(
                d_AaveIntegration.deposit(bAsset.address, "1", false),
                "Lending pool does not exist",
            );
            // Fails with ZERO Amount
            await expectRevert(
                d_AaveIntegration.reApproveAllTokens({ from: sa.governor }),
                "Lending pool does not exist",
            );
        });
    });

    describe("withdraw", async () => {
        beforeEach("init mocks", async () => {
            await runSetup(false, true);
        });
        it("should withdraw tokens from Aave", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);
            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1;
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);

            // Step 1. call withdraw
            const tx = await d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                bAssetRecipient,
                bAsset.address,
                amount.toString(),
                false,
            );

            // Step 2. Check for things:
            // 2.1 Check that the recipient receives the tokens
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );
            // 2.2 Check that integration aToken balance has gone down
            const actualBalance = await aToken.balanceOf(d_AaveIntegration.address);
            const expectedBalance = aaveIntegration_balBefore.sub(amount);
            assertBNSlightlyGTPercent(
                actualBalance,
                expectedBalance,
                "0.001",
                systemMachine.isGanacheFork,
            );
            // Cross that match with the `checkBalance` call
            const directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(actualBalance);
            // Assert that Balance goes up over time
            await time.increase(TEN_MINS);
            const newBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            assertBNSlightlyGTPercent(
                newBalance,
                directBalance,
                "0.001",
                systemMachine.isGanacheFork,
            );
            // 2.3 Should give accurate return value
            expectEvent(tx.receipt, "PlatformWithdrawal", {
                bAsset: bAsset.address,
                totalAmount: amount,
                userAmount: amount,
            });
        });

        it("should handle the fee calculations", async () => {
            await runSetup(true, true);
            // should deduct the transfer fee from the return value
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[1].aToken);

            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1;
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);

            // Step 1. call withdraw
            const tx = await d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                bAssetRecipient,
                bAsset.address,
                amount.toString(),
                true,
            );
            const bAssetRecipient_balAfter = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balAfter = await aToken.balanceOf(d_AaveIntegration.address);

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
            expect(aaveIntegration_balAfter).bignumber.eq(
                aaveIntegration_balBefore.sub(amount) as any,
            );
            const expectedBalance = aaveIntegration_balBefore.sub(amount);
            assertBNSlightlyGT(aaveIntegration_balAfter, expectedBalance, new BN("100"));
            // Cross that match with the `checkBalance` call
            const directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(expectedBalance);
        });

        it("should only allow a whitelisted user to call function", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);

            // Step 1. call deposit
            await expectRevert(
                d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.dummy1,
                    bAsset.address,
                    amount.toString(),
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
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(1000).mul(new BN(10).pow(bAsset_decimals));

            // Step 1. call deposit
            await expectRevert(
                d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.default,
                    bAsset.address,
                    amount.toString(),
                    false,
                ),
                systemMachine.isGanacheFork
                    ? "User cannot redeem more than the available balance"
                    : "ERC20: burn amount exceeds balance",
            );
        });
        it("should fail with broken arguments", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);

            // 0.1 Get balance before
            const bAssetRecipient = sa.dummy1;
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);

            // Fails with ZERO bAsset Address
            await expectRevert(
                d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.dummy1,
                    ZERO_ADDRESS,
                    amount.toString(),
                    false,
                ),
                "aToken does not exist",
            );
            // Fails with ZERO recipient address
            await expectRevert.unspecified(
                d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                    ZERO_ADDRESS,
                    bAsset.address,
                    new BN(1),
                    false,
                ),
            );
            // Fails with ZERO Amount
            await expectRevert(
                d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.dummy1,
                    bAsset.address,
                    "0",
                    false,
                ),
                "Must withdraw something",
            );
            // Succeeds with Incorrect bool (defaults to false)
            const tx = await d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                sa.dummy1,
                bAsset.address,
                amount.toString(),
                undefined,
            );

            // 2.1 Check that the recipient receives the tokens
            expect(await bAsset.balanceOf(bAssetRecipient)).bignumber.eq(
                bAssetRecipient_balBefore.add(amount),
            );
            // 2.2 Check that integration aToken balance has gone down
            const currentBalance = await aToken.balanceOf(d_AaveIntegration.address);
            assertBNSlightlyGTPercent(
                currentBalance,
                aaveIntegration_balBefore.sub(amount),
                "0.0001",
                systemMachine.isGanacheFork,
            );
            // 2.3 Should give accurate return value
            expectEvent(tx.receipt, "PlatformWithdrawal", {
                bAsset: bAsset.address,
                totalAmount: amount,
                userAmount: amount,
            });
        });
        it("should fail if the bAsset is not supported", async () => {
            // Step 0. Choose tokens
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);
            const amount = new BN(10).pow(new BN(12));

            // Step 1. call withdraw
            await expectRevert(
                d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                    sa.dummy1,
                    bAsset.address,
                    amount.toString(),
                    false,
                ),
                "aToken does not exist",
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
                const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
                const bAsset_decimals = await bAsset.decimals();
                const amount = simpleToExactAmount(5, bAsset_decimals);
                const totalAmount = amount.muln(2);
                const aToken = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);
                // 0.1 Get balance before
                const bAssetRecipient = sa.dummy1;
                const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
                const aaveIntegration_balBefore = await bAsset.balanceOf(d_AaveIntegration.address);
                const aaveBalanceBefore = await d_AaveIntegration.checkBalance.call(bAsset.address);

                // fail if called by non Bm or mAsset
                await expectRevert(
                    d_AaveIntegration.methods["withdraw(address,address,uint256,uint256,bool)"](
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
                const tx = await d_AaveIntegration.methods[
                    "withdraw(address,address,uint256,uint256,bool)"
                ](bAssetRecipient, bAsset.address, amount, totalAmount, false);
                const bAssetRecipient_balAfter = await bAsset.balanceOf(bAssetRecipient);
                const aaveIntegration_balAfter = await bAsset.balanceOf(d_AaveIntegration.address);
                const aaveBalanceAfter = await d_AaveIntegration.checkBalance.call(bAsset.address);
                expect(bAssetRecipient_balAfter).bignumber.eq(
                    bAssetRecipient_balBefore.add(amount),
                );
                expect(aaveIntegration_balAfter).bignumber.eq(
                    aaveIntegration_balBefore.add(totalAmount.sub(amount)),
                );
                expect(aaveBalanceAfter).bignumber.eq(aaveBalanceBefore.sub(totalAmount));
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
                const bAsset = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
                const bAsset_decimals = await bAsset.decimals();
                const amount = simpleToExactAmount(5, bAsset_decimals);
                const totalAmount = amount.muln(2);
                await expectRevert(
                    d_AaveIntegration.methods["withdraw(address,address,uint256,uint256,bool)"](
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
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            await expectRevert(
                d_AaveIntegration.withdrawRaw(sa.dummy3, bAsset.address, new BN(1), {
                    from: sa.dummy1,
                }),
                "Not a whitelisted address",
            );
        });
        it("should allow the mAsset or BM to withdraw a given bAsset", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = simpleToExactAmount(5, bAsset_decimals);

            await bAsset.transfer(d_AaveIntegration.address, amount);

            const bAssetRecipient = sa.dummy1;
            const bAssetRecipient_balBefore = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balBefore = await bAsset.balanceOf(d_AaveIntegration.address);
            const aaveBalanceBefore = await d_AaveIntegration.checkBalance.call(bAsset.address);

            const tx = await d_AaveIntegration.withdrawRaw(bAssetRecipient, bAsset.address, amount);

            const bAssetRecipient_balAfter = await bAsset.balanceOf(bAssetRecipient);
            const aaveIntegration_balAfter = await bAsset.balanceOf(d_AaveIntegration.address);
            const aaveBalanceAfter = await d_AaveIntegration.checkBalance.call(bAsset.address);

            // Balances remain the same
            expect(bAssetRecipient_balAfter).bignumber.eq(bAssetRecipient_balBefore.add(amount));
            expect(aaveIntegration_balAfter).bignumber.eq(aaveIntegration_balBefore.sub(amount));
            expect(aaveBalanceAfter).bignumber.eq(aaveBalanceBefore);

            // Emits expected event
            expectEvent(tx.receipt, "Withdrawal", {
                _bAsset: bAsset.address,
                _pToken: ZERO_ADDRESS,
                _amount: amount,
            });
        });
        it("should fail if there is no balance in a given asset", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            await expectRevert(
                d_AaveIntegration.withdrawRaw(sa.dummy3, bAsset.address, new BN(1)),
                "SafeERC20: low-level call failed",
            );
        });
        it("should fail if specified a 0 amount", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            await expectRevert(
                d_AaveIntegration.withdrawRaw(sa.dummy3, bAsset.address, new BN(0)),
                "Must withdraw something",
            );
        });
    });

    // See deposit and withdraw tests for basic balance checking
    describe("checkBalance", async () => {
        it("should return balance for any caller when supported token address passed", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);

            const aaveIntegration_bal = await aToken.balanceOf(d_AaveIntegration.address);
            // Cross that match with the `checkBalance` call
            const directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(aaveIntegration_bal);
        });

        // it("should return balance with same precision as bAsset", async () => {});
        // By checking that the aToken balance == balBefore + deposit amount, we are implicitly checking
        // that the number of decimals returned from checkbalance is the same

        it("should increase our balance over time and activity", async () => {
            // Simulating activity on mainnet only, as our mocks are not capable
            if (!systemMachine.isGanacheFork) return;

            // Load things up and do some mints
            await runSetup(false, true);

            // 1. Load up our target tokens and get the balances now
            const bAsset = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            const bAsset_decimals = await bAsset.decimals();
            const amount = new BN(10).pow(bAsset_decimals);
            const aToken = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);
            // 1.1 Get balance before
            const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            const aaveIntegration_balBefore = await aToken.balanceOf(d_AaveIntegration.address);
            expect(aaveIntegration_balBefore).bignumber.gt(new BN(0) as any);
            // Cross that match with the `checkBalance` call
            let directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(aaveIntegration_balBefore);

            // 2. Simulate some external activity by depositing or redeeming
            // DIRECTlY to the LendingPool.
            // Doing this activity should raise our aToken balances slightly
            // 2.1. Approve the LendingPool
            await bAsset.approve(await addressProvider.getLendingPool(), amount);
            const d_lendingPool = await c_AaveLendingPool.at(
                await addressProvider.getLendingPool(),
            );
            // 2.2. Call the deposit func
            await d_lendingPool.deposit(bAsset.address, amount, sa.default, 9999);
            // 2.3. Fast forward some time
            await time.increase(ONE_WEEK);
            // 2.4. Do a redemption
            await d_lendingPool.withdraw(bAsset.address, amount, sa.default);

            // 3. Analyse our new balances
            const aaveIntegration_balAfter = await aToken.balanceOf(d_AaveIntegration.address);
            // Should not go up by more than 2% during this period
            assertBNSlightlyGTPercent(
                aaveIntegration_balAfter,
                aaveIntegration_balBefore,
                "1",
                true,
            );
            // Cross that match with the `checkBalance` call
            directBalance = await d_AaveIntegration.checkBalance.call(bAsset.address);
            expect(directBalance).bignumber.eq(aaveIntegration_balAfter);

            // 4. Withdraw our new interest - we worked hard for it!
            await d_AaveIntegration.methods["withdraw(address,address,uint256,bool)"](
                sa.default,
                bAsset.address,
                aaveIntegration_balAfter,
                false,
            );
        });
        it("should fail if called with inactive token", async () => {
            const bAsset = await c_ERC20.at(integrationDetails.cTokens[0].bAsset);

            await expectRevert(
                d_AaveIntegration.checkBalance(bAsset.address),
                "aToken does not exist",
            );
        });
    });

    describe("reApproveAllTokens", async () => {
        before("init mocks", async () => {
            // Do some mints to mess up the allowances
            await runSetup(false, true);
        });
        it("should re-approve ALL bAssets with aTokens", async () => {
            const bassetsMapped = await d_AaveIntegration.getBassetsMapped();
            expect(bassetsMapped.length).to.be.gt(0 as any);

            const addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            const approvedAddress = await addressProvider.getLendingPool();

            await d_AaveIntegration.reApproveAllTokens({
                from: sa.governor,
            });
            bassetsMapped.forEach(async (b) => {
                const bAsset = await c_MockERC20.at(b);
                const balance = await bAsset.allowance(d_AaveIntegration.address, approvedAddress);
                expect(balance).bignumber.eq(MAX_UINT256);
                const balanceOfSender = await bAsset.allowance(
                    d_AaveIntegration.address,
                    sa.governor,
                );
                expect(balanceOfSender).bignumber.eq(new BN(0));
            });
        });
        it("should be able to be called multiple times", async () => {
            const bassetsMapped = await d_AaveIntegration.getBassetsMapped();
            expect(bassetsMapped.length).to.be.gt(0 as any);

            await d_AaveIntegration.reApproveAllTokens({
                from: sa.governor,
            });
            await d_AaveIntegration.reApproveAllTokens({
                from: sa.governor,
            });
        });
        it("should only be callable by the Governor", async () => {
            await expectRevert(
                d_AaveIntegration.reApproveAllTokens({
                    from: sa.dummy1,
                }),
                "Only governor can execute",
            );
        });
        it("should fail if lending pool does not exist (mock)", async () => {
            // Can only run on local, due to constraints from Aave
            if (systemMachine.isGanacheFork) return;
            const mockAave = await c_MockAave.at(integrationDetails.aavePlatformAddress);
            await mockAave.breakLendingPools();
            // Fails with ZERO Amount
            await expectRevert(
                d_AaveIntegration.reApproveAllTokens({ from: sa.governor }),
                "Lending pool does not exist",
            );
        });
    });
});
