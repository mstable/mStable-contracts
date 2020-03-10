import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { ForceSendInstance, ERC20MockInstance, AaveVaultInstance } from "types/generated";
import { BN } from "@utils/tools";
import { StandardAccounts, SystemMachine, MainnetAccounts } from "@utils/machines";

const { expect, assert } = envSetup.configure();

const ForceSend = artifacts.require("ForceSend");
const ERC20Mock = artifacts.require("ERC20Mock");
const AaveVault = artifacts.require("AaveVault");

contract("AaveVault", async (accounts) => {

    let aaveVault: AaveVaultInstance;
    let systemMachine: SystemMachine;
    const sa = new StandardAccounts(accounts);
    const ma = new MainnetAccounts();

    const massetAddr = sa.other;

    beforeEach("before Each", async () => {
        
        // COMMAND FOR GANACHE FORK
        // ========================
        // ganache-cli -f https://mainnet.infura.io/v3/810573cebf304c4f867483502c8b7b93@9618357 -p 7545 -l 100000000 --allowUnlimitedContractSize --unlock "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b"
        // ========================

        systemMachine = new SystemMachine(sa.all, sa.other);
        const isForked: boolean = await systemMachine.isRunningForkedGanache();
        if( ! isForked) {
            assert.fail("Ganache with mainnet HARDFORK needed to run tests.");
        }
        await systemMachine.initialiseMocks();

        // SETUP
        // ======
        // deploy AaveVault
        const aaveLendingPoolProvider = "398eC7346DcD622eDc5ae82352F02bE94C62d119";
        aaveVault = await AaveVault.new(aaveLendingPoolProvider, {from: sa.governor});

        // Add Whitelisted addresses to allow.
        await aaveVault.addWhitelisted(massetAddr, {from: sa.governor});

        // Add aTokens
        // TODO add all other tokens.
        await aaveVault.setPTokenAddress(ma.DAI, ma.aDAI, {from: sa.governor});
        
    } );

    describe("AAVE", async () => {
        it("should deposit DAI to AAVE", async () => {
            // TODO have a common place for token addresses
            await aaveVault.deposit(sa.dummy1, ma.DAI, 100, false, {from: massetAddr});

            // check for aTokens

            // withdraw
        });
    });
});