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
import { white } from "color-name";

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
    let nexus: t.NexusInstance;
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

        // SETUP
        // ======
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
                d_DelayedProxyAdmin.address,
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
    });

    describe("initializing AaveIntegration", async () => {
        describe("verifying GovernableWhitelist initialization", async () => {
            describe("verifying InitializableModule initialization", async () => {
                shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

                it("should properly store valid arguments", async () => {
                    // Expect governor to act as proxy admin
                    expect(d_DelayedProxyAdmin.address).eq(await d_AaveIntegration.proxyAdmin());
                    // Ensure ProxyAdmin on the implementation matches that of the proxy
                    expect(await d_AaveIntegration.proxyAdmin()).eq(
                        await d_DelayedProxyAdmin.getProxyAdmin(d_AaveIntegration.address),
                    );
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
                let tempImpl = await c_AaveIntegration.new();
                let erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
                let aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
                await shouldFail.reverting.withMessage(
                    tempImpl.initialize(
                        sa.governor,
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
                let tempImpl = await c_AaveIntegration.new();
                let erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
                let aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
                await shouldFail.reverting.withMessage(
                    tempImpl.initialize(
                        sa.governor,
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
                        sa.governor,
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
            // Should be initialized with correct version
            expect("1.0").eq(await d_AaveIntegration.version());
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
            let bAsset = await c_MockERC20.at(integrationDetails.aTokens[0].bAsset);
            let addressProvider = await c_AaveLendingPoolAddressProvider.at(
                integrationDetails.aavePlatformAddress,
            );
            let approvedAddress = await addressProvider.getLendingPoolCore();
            let balance = await bAsset.allowance(d_AaveIntegration.address, approvedAddress);
            expect(balance).bignumber.eq(MAX_UINT256 as any);
        });

        it("should fail when called again", async () => {
            let tempImpl = await c_AaveIntegration.new();
            let erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
            let aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
            await tempImpl.initialize(
                sa.governor,
                nexus.address,
                [sa.dummy1],
                integrationDetails.aavePlatformAddress,
                [erc20Mock.address],
                [aTokenMock.address],
            );
            await shouldFail.reverting.withMessage(
                tempImpl.initialize(
                    sa.governor,
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
            let tempImpl = await c_AaveIntegration.new();
            let erc20Mock = await c_MockERC20.new("TMP", "TMP", 18, sa.default, "1000000");
            let aTokenMock = await c_MockAaveAToken.new(sa.other, erc20Mock.address);
            // platformAddress is invalid
            await shouldFail.reverting(
                tempImpl.initialize(
                    sa.governor,
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
                    sa.governor,
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
                    sa.governor,
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
                    sa.governor,
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
                    sa.governor,
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
        it("should succeed when function called by the Governor");
        it("should approve the spending of the bAsset correctly");
        it("should fail when function called by Other user");
        it("should fail when passed invalid args", () => {
            // bAsset address is zero
            // pToken address is zero
            // pToken address already assigned for a bAsset
        });
    });

    describe("deposit", async () => {
        describe("should succeed", async () => {
            it("when a whitelisted user calls function");

            it("when token transfer fee charged");

            it("when no token transfer fee charged");
        });

        describe("should fail", async () => {
            it("when a non-whitelisted user calls function");

            it("when wrong bAsset address passed");
        });
    });

    describe("withdraw", async () => {
        describe("should succeed", async () => {
            it("when a whitelisted user calls function");
        });

        describe("should fail", async () => {
            it("when a non-whitelisted user calls function");

            it("when wrong bAsset address passed");
        });
    });

    describe("checkBalance", async () => {
        describe("should succeed", async () => {
            it("when supported token address passed");
        });

        describe("should fail", async () => {
            it("when non-supported token address passed");
        });
    });

    describe("reApproveAllTokens", async () => {
        describe("should succeed", async () => {
            it("when function called by the Governor");

            it("when function called multiple times");
        });

        describe("should fail", async () => {
            it("when function called by the Other user");
        });
    });

    describe("disapprove", async () => {
        it("should be implemented...");
    });
});
