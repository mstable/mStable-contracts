/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable consistent-return */

import * as t from "types/generated";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine, MassetMachine } from "@utils/machines";
import { MainnetAccounts } from "@utils/constants";

import envSetup from "@utils/env_setup";
import {
    BassetIntegrationDetails,
    Platform,
    CTokenDetails,
    ATokenDetails,
    Address,
} from "../../../types";

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

    before("init", async function() {
        systemMachine = new SystemMachine(sa.all);
        isRunningFork = await systemMachine.isRunningValidFork();
        massetMachine = systemMachine.massetMachine;
    });

    beforeEach("before Each", async function() {
        // if (!isRunningFork) {
        //     return this.skip();
        // }

        // SETUP
        // ======
        // Initialize the proxy
        const d_AaveIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance = await c_InitializableProxy.new();
        d_AaveIntegration = await c_AaveIntegration.at(d_AaveIntegrationProxy.address);

        // Load network specific integration data
        const integrationDetails = await massetMachine.loadBassets();

        // Initialize the proxy storage
        const aaveImplementation = await c_AaveIntegration.new();

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

    context("Initializing AaveIntegration", async () => {
        describe("verifying GovernableWhitelist initialization", async () => {
            describe("verifying for InitializableModule initialization", async () => {
                // should behave like a module
                it("should properly initialize initializableModule");
            });

            it("should properly store valid arguments", () => {
                // check for whitelisted accs
                // check for proxyadmin set
                // check for nexus addr
            });

            it("should fail when empty whitelisted array");

            it("should fail when whitelisted address is zero");

            it("should fail when address already whitelisted");
        });

        it("should properly store valid arguments", () => {
            // check for whitelisted accs
            // check for proxyadmin set
            // check for nexus addr
            // check for platform addr
            // check for pTokens added & events
        });

        it("should approve spending of the passed bAssets", () => {});

        it("should fail when called again");

        it("should fail if passed incorrect data", async () => {
            // platformAddress is zero
            // bAsset and pToken array length are different
            // pToken address is zero
            // duplicate pToken or bAsset
        });
    });

    describe("setPTokenAddress", async () => {
        it("should succeed when function called by the Governor");
        it("should approve the spending of the bAsset correctly");
        it("should fail when function called by Other user");
        it("should fail when passed invalid args", () => {
            // bAsset address is zero
            // pToken address is zero
            // pToken address already assigned for a bAsset
        });
    });

    describe("Testing core functionality", async () => {
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
