/* eslint-disable consistent-return */

import { MockERC20Instance, AaveIntegrationInstance } from "types/generated";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { MainnetAccounts } from "@utils/constants";

import envSetup from "@utils/env_setup";

const { expect, assert } = envSetup.configure();

const MockERC20 = artifacts.require("MockERC20");
const AaveVault = artifacts.require("AaveIntegration");

let shouldSkip = false;

contract("AaveVault", async (accounts) => {
    let aaveVault: AaveIntegrationInstance;
    const sa = new StandardAccounts(accounts);
    const ma = new MainnetAccounts();
    let systemMachine = new SystemMachine(sa.all);

    const massetAddr = sa.other;
    before("assertOnFork", async function() {
        shouldSkip = await systemMachine.isRunningValidFork();
    });

    beforeEach("before Each", async function() {
        // console.log("z");
        // const isForked: boolean = await systemMachine.isRunningValidFork();
        // console.log("1");
        if (shouldSkip) {
            // console.log("Ganache with mainnet HARDFORK needed to run tests.");
            // console.error("Ganache with mainnet HARDFORK needed to run tests.");
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
        // const aaveLendingPoolProvider = "398eC7346DcD622eDc5ae82352F02bE94C62d119";
        // aaveVault = await AaveVault.new(aaveLendingPoolProvider, { from: sa.governor });

        // Add Whitelisted addresses to allow.
        // await aaveVault.addWhitelisted(massetAddr, { from: sa.governor });

        // Add aTokens
        // TODO add all other tokens.
        // await aaveVault.setPTokenAddress(ma.DAI, ma.aDAI, { from: sa.governor });
    });

    describe("AAVE", async () => {
        it("should deposit DAI to AAVE", async () => {
            // TODO have a common place for token addresses
            // console.log("2");
            // await aaveVault.deposit(sa.dummy1, ma.DAI, 100, false, { from: massetAddr });
            // check for aTokens
            // withdraw
        });
        it("should  do something else", async () => {
            console.log("3");
            assert(true, "xx");
        });
    });
});
