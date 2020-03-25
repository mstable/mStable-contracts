/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable consistent-return */

import * as t from "types/generated";
import { Address } from "types/common";
import { BassetIntegrationDetails, Platform, CTokenDetails, ATokenDetails } from "types/machines";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine, MassetMachine } from "@utils/machines";
import { MainnetAccounts } from "@utils/constants";

import envSetup from "@utils/env_setup";
const { expect, assert } = envSetup.configure();

const MockERC20: t.MockERC20Contract = artifacts.require("MockERC20");
const c_MockAave: t.MockAaveContract = artifacts.require("MockAave");

const c_InitializableProxy: t.InitializableAdminUpgradeabilityProxyContract = artifacts.require(
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
);
const c_AaveIntegration: t.AaveIntegrationContract = artifacts.require("AaveIntegration");

let isRunningFork = false;

contract("AaveIntegration", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const ma = new MainnetAccounts();
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let aavePlatformAddress: Address;
    let d_AaveIntegration: t.AaveIntegrationInstance;

    before("assertOnFork", async function() {
        systemMachine = new SystemMachine(sa.all);
        isRunningFork = await systemMachine.isRunningValidFork();
        massetMachine = systemMachine.massetMachine;
    });

    beforeEach("before Each", async function() {
        if (!isRunningFork) {
            return this.skip();
        }

        // SETUP
        // ======
        // Initialize the proxy
        const d_AaveIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance = await c_InitializableProxy.new();
        d_AaveIntegration = await c_AaveIntegration.at(d_AaveIntegration.address);

        // Load network specific integration data
        let integrationDetails = await massetMachine.loadBassets();

        // Initialize the proxy storage
        let aaveImplementation = await c_AaveIntegration.new();

        const initializationData_AaveIntegration: string = aaveImplementation.contract.methods
            .initialize(
                sa.governor,
                systemMachine.nexus.address,
                [sa.default],
                integrationDetails.aavePlatformAddress,
                integrationDetails.aTokens.map((a) => a.bAsset),
                integrationDetails.aTokens.map((a) => a.aToken),
            )
            .encodeABI();
        await d_AaveIntegrationProxy.initialize(
            aaveImplementation.address,
            sa.default,
            initializationData_AaveIntegration,
        );
    });

    describe("behaviour", async () => {
        beforeEach("behave like a Module", async () => {
            // Module
        });

        // shouldB
    });

    describe("GovernableWhitelist", async () => {
        describe("initialize", async () => {
            it("should properly store valid arguments", () => {
                // check for whitelisted accs
                // check for proxyadmin set
                // check for nexus addr
            });

            it("should properly initialize initializableModule", () => {});

            it("should fail when empty whitelisted array");

            it("should fail when whitelisted address is zero");

            it("should fail when address already whitelisted");
        });
    });

    describe("Initializing AaveIntegration", async () => {
        // describe("by constructor", async () => {
        //     it("should succeed when passed valid arguments");

        //     it("should properly store valid arguments", () => {
        //         // check for whitelisted accs
        //         // check for proxyadmin set
        //         // check for nexus addr
        //         // check for pTokens added & events
        //     });

        //     it("should fail if passed incorrect data", async () => {
        //         // platformAddress is zero
        //         // bAsset and pToken array length are different
        //         // pToken address is zero
        //         // duplicate pToken or bAsset
        //     });
        // });

        // describe("by initialize()", async () => {
        it("should properly store valid arguments", () => {
            // check for whitelisted accs
            // check for proxyadmin set
            // check for nexus addr
            // check for pTokens added & events
        });

        it("should initialize GovernableWhitelist", () => {});

        it("should fail when called again");

        it("should fail if passed incorrect data", async () => {
            // platformAddress is zero
            // bAsset and pToken array length are different
            // pToken address is zero
            // duplicate pToken or bAsset
        });
        // });
    });

    describe("AbstractIntegration", async () => {
        describe("setPTokenAddress", async () => {
            describe("should succeed", async () => {
                it("when function called by the Governor");
            });

            describe("should fail", async () => {
                it("when function called by Other user");

                it("when bAsset address is zero");

                it("when pToken address is zero");

                it("when pToken address already assigned for a bAsset");
            });
        });
    });

    describe("AaveIntegration", async () => {
        describe("constructor", async () => {
            describe("should succeed", async () => {
                it("");
            });

            describe("should fail", async () => {
                it("");
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
});
