/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable consistent-return */

import * as t from "types/generated";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine, MassetMachine } from "@utils/machines";
import { MainnetAccounts, ZERO_ADDRESS, MAX_UINT256 } from "@utils/constants";

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
const c_MockAaveAToken: t.MockATokenContract = artifacts.require("MockAToken");
const c_MockAave: t.MockAaveContract = artifacts.require("MockAave");
const c_MockNexus: t.MockNexusContract = artifacts.require("MockNexus");
const c_AaveLendingPoolAddressProvider: t.ILendingPoolAddressesProviderContract = artifacts.require(
    "ILendingPoolAddressesProvider",
);
const c_DelayedProxyAdmin: t.DelayedProxyAdminContract = artifacts.require("DelayedProxyAdmin");

const c_InitializableProxy: t.InitializableAdminUpgradeabilityProxyContract = artifacts.require(
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
);
const c_AaveIntegration: t.AaveIntegrationContract = artifacts.require("AaveIntegration");

contract("AaveIntegration", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const ma = new MainnetAccounts();

    let systemMachine: SystemMachine;
    let nexus: t.MockNexusInstance;
    let massetMachine: MassetMachine;

    let integrationDetails: BassetIntegrationDetails;
    let d_DelayedProxyAdmin: t.DelayedProxyAdminInstance;
    let d_AaveIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance;
    let d_AaveIntegration: t.AaveIntegrationInstance;

    const ctx: { module?: t.InitializableModuleInstance } = {};

    before("base init", async () => {
        systemMachine = new SystemMachine(sa.all);
        nexus = await c_MockNexus.new(sa.governor, sa.dummy1, sa.dummy2);
        massetMachine = systemMachine.massetMachine;

        await runSetup();
    });

    const runSetup = async () => {
        // SETUP
        // ======
        // Init proxyAdmin
        d_DelayedProxyAdmin = await c_DelayedProxyAdmin.new(nexus.address);
        await nexus.setProxyAdmin(d_DelayedProxyAdmin.address);
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

        ctx.module = d_AaveIntegration;
    };

    describe("initializing AaveIntegration", async () => {
        describe("verifying GovernableWhitelist initialization", async () => {
            describe("verifying InitializableModule initialization", async () => {
                shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

                it("should properly store valid arguments", async () => {
                    // Check for nexus addr
                    expect(await d_AaveIntegration.nexus()).eq(nexus.address);
                    // TODO check Nexus.proxyAdmin
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
        it("should only allow a whitelisted user to call function");
        it("should deposit tokens to Aave", async () => {
            // check that the lending pool core has tokens
            // check that our new balance of aTokens is given
            // should give accurate return value
        });

        it("should deposit all if there is no fee");
        it("should handle the fee calculations", async () => {
            // should deduct the transfer fee from the return value
        });

        it("should fail if we do not first pass the required bAsset");
        it("should fail with broken arguments");
        it("should fail if the bAsset is not supported");
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
        it("should only be callable bby the Governor");

        it("should be able to be called multiple times");
    });

    describe("disapprove", async () => {
        it("should be implemented...");
    });
});
