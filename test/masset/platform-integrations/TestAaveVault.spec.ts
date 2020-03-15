import { ForceSendInstance, ERC20MockInstance, AaveVaultInstance } from "types/generated";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine, MainnetAccounts } from "@utils/machines";

import envSetup from "@utils/env_setup";
const { expect, assert } = envSetup.configure();

const ForceSend = artifacts.require("ForceSend");
const ERC20Mock = artifacts.require("ERC20Mock");
const AaveVault = artifacts.require("AaveVault");

let shouldSkip = false;

contract("AaveVault", async (accounts) => {
    let aaveVault: AaveVaultInstance;
    const sa = new StandardAccounts(accounts);
    const ma = new MainnetAccounts();
    let systemMachine = new SystemMachine(sa.all, sa.other);

    const massetAddr = sa.other;
    before("assertOnFork", async function() {
        shouldSkip = await systemMachine.isRunningForkedGanache();
    });

    beforeEach("before Each", async function() {
        // console.log("z");
        // const isForked: boolean = await systemMachine.isRunningForkedGanache();
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

        systemMachine = new SystemMachine(sa.all, sa.other);
        await systemMachine.initialiseMocks();

        // SETUP
        // ======
        // deploy AaveVault
        const aaveLendingPoolProvider = "398eC7346DcD622eDc5ae82352F02bE94C62d119";
        aaveVault = await AaveVault.new(aaveLendingPoolProvider, { from: sa.governor });

        // Add Whitelisted addresses to allow.
        await aaveVault.addWhitelisted(massetAddr, { from: sa.governor });

        // Add aTokens
        // TODO add all other tokens.
        await aaveVault.setPTokenAddress(ma.DAI, ma.aDAI, { from: sa.governor });
    });

    describe("AAVE", async () => {
        console.log("1");
        it("should deposit DAI to AAVE", async () => {
            // TODO have a common place for token addresses
            console.log("2");
            await aaveVault.deposit(sa.dummy1, ma.DAI, 100, false, { from: massetAddr });

            // check for aTokens

            // withdraw
        });
        it("should  do something else", async () => {
            console.log("3");
            assert(true, "xx");
        });
    });
});
