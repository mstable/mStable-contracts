/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable consistent-return */

import * as t from "types/generated";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { MainnetAccounts } from "@utils/constants";

import envSetup from "@utils/env_setup";

const { expect, assert } = envSetup.configure();

const c_MockNexus: t.MockNexusContract = artifacts.require("MockNexus");
const MockERC20 = artifacts.require("MockERC20");
const c_AaveIntegration: t.AaveIntegrationContract = artifacts.require("AaveIntegration");
const c_Nexus: t.NexusContract = artifacts.require("Nexus");

let shouldSkip = false;

contract("AaveIntegration", async (accounts) => {
    let d_Nexus: t.MockNexusInstance;
    let d_AaveIntegration: t.AaveIntegrationInstance;
    const sa = new StandardAccounts(accounts);
    const ma = new MainnetAccounts();
    let systemMachine = new SystemMachine(sa.all);
    const governanceAddr = sa.governor;
    const managerAddr = sa.dummy4;

    before("assertOnFork", async function() {
        shouldSkip = await systemMachine.isRunningValidFork();
        d_Nexus = await c_MockNexus.new(sa.governor, governanceAddr, managerAddr);
    });

    beforeEach("before Each", async function() {
        if (shouldSkip) {
            return this.skip();
        }
        // console.log("z");
        // COMMAND FOR GANACHE FORK
        // ========================
        // ganache-cli -f https://mainnet.infura.io/v3/810573cebf304c4f867483502c8b7b93@9618357 -p 7545 -l 100000000 --allowUnlimitedContractSize --unlock "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b"
        // ========================

        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks();

        // SETUP
        // ======
        // deploy AaveVault
        // aaveVault = await c_AaveIntegration.new(ma.aavePlatform, { from: sa.governor });

        // Add Whitelisted addresses to allow.
        // await aaveVault.addWhitelisted(massetAddr, { from: sa.governor });

        // Add aTokens
        // TODO add all other tokens.
        // await aaveVault.setPTokenAddress(ma.DAI, ma.aDAI, { from: sa.governor });
    });

    describe("AAVE", async () => {
        it("should deposit DAI to AAVE", async () => {
            // TODO have a common place for token addresses
            // await aaveVault.deposit(sa.dummy1, ma.DAI, 100, false, { from: massetAddr });
            // check for aTokens
            // withdraw
        });
        it("should  do something else");
    });

    describe("behaviour", async () => {
        beforeEach("behave like a Module", async () => {
            // Module
        });

        // shouldB
    });

    describe("InitializableModule", async () => {

    });

    describe("AbstractIntegration", async () => {
        describe("constructor", async () => {
            describe("should succeed", async () => {
                it("when passed valid arguments");

                it("and have expected version");

                it("and have expected platformAddress");

                it("and have expected bAssetToPToken");
            });

            describe("should fail", async () => {                
                it("when nexus address is zero");     
            });
        });

        describe("initialize", async () => {
            describe("should succeed", async () => {
                it("");
            });
            
            describe("should fail", async () => {
                it("when initialize function called again");

                it("when platformAddress is zero");

                it("when bAsset and pToken array length are different");

                it("when bAsset address is zero");

                it("when pToken address is zero");

                it("when pToken address already assigned for a bAsset");
            });            
        });

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

    describe("GovernableWhitelist", async () => {
        describe("constructor", async () => {
            describe("should succeed", async () => {
                it("when passed valid arguments");
            });

            describe("should fail", async () => {
                it("when empty whitelisted array");

                it("when whitelisted address is zero");

                it("when address already whitelisted");       
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
