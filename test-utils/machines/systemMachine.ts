import { MassetMachine, MassetDetails } from "@utils/machines";
import * as t from "types/generated";
import { Address } from "../../types";

import { StandardAccounts } from "./standardAccounts";

import { MASSET_FACTORY_BYTES, MainnetAccounts } from "@utils/constants";
import { simpleToExactAmount } from "@utils/math";
import { aToH, BN } from "@utils/tools";

// Nexus
const c_Nexus = artifacts.require("Nexus");

// Savings
const c_SavingsContract = artifacts.require("SavingsContract");
const c_SavingsManager = artifacts.require("SavingsManager");

const c_DelayedProxyAdmin = artifacts.require("DelayedProxyAdmin");

/**
 * @dev The SystemMachine is responsible for creating mock versions of our contracts
 * Since we will need to generate usable, customisable contracts throughout our test
 * framework, this will act as a Machine to generate these various mocks
 */
export class SystemMachine {
    /** @dev Default accounts as per system Migrations */
    public sa: StandardAccounts;
    public massetMachine: MassetMachine;
    public isGanacheFork = false;

    public nexus: t.NexusInstance;
    public mUSD: MassetDetails;
    public savingsContract: t.SavingsContractInstance;
    public savingsManager: t.SavingsManagerInstance;
    public delayedProxyAdmin: t.DelayedProxyAdminInstance;

    constructor(accounts: Address[]) {
        this.sa = new StandardAccounts(accounts);
        this.massetMachine = new MassetMachine(this);
        if (process.env.NETWORK == "fork") {
            this.isGanacheFork = true;
            this.isRunningValidFork().then((valid: boolean) => {
                if (!valid) {
                    throw "Must run on a valid fork";
                }
            });
        }
        /***************************************
        Deploy Nexus at minimum, to allow MassetMachine access
        ****************************************/
        this.deployNexus().then((nexus: t.NexusInstance) => {
            this.nexus = nexus;
        });
    }

    /**
     * @dev Initialises the system to replicate current migration scripts
     */
    public async initialiseMocks(seedMasset = false, dummySavingsManager = false) {
        /***************************************
            1. Nexus (Redeploy)
        ****************************************/
        this.nexus = await this.deployNexus();

        /***************************************
            2. mUSD
        ****************************************/
        this.mUSD = seedMasset
            ? await this.massetMachine.deployMassetAndSeedBasket()
            : await this.massetMachine.deployMasset();

        /***************************************
            3. Savings
        ****************************************/
        this.savingsContract = await c_SavingsContract.new(
            this.nexus.address,
            this.mUSD.mAsset.address,
            { from: this.sa.default },
        );
        this.savingsManager = await c_SavingsManager.new(
            this.nexus.address,
            this.mUSD.mAsset.address,
            this.savingsContract.address,
            { from: this.sa.default },
        );

        /***************************************
            4. Init
        ****************************************/
        await this.nexus.initialize(
            [
                await this.savingsManager.KEY_SAVINGS_MANAGER(),
                await this.mUSD.proxyAdmin.KEY_PROXY_ADMIN(),
            ],
            [
                dummySavingsManager ? this.sa.dummy1 : this.savingsManager.address,
                this.mUSD.proxyAdmin.address,
            ],
            [false, true],
            this.sa.governor,
            { from: this.sa.governor },
        );
        return Promise.resolve(true);
    }

    /**
     * @dev Deploy the Nexus
     */
    public async deployNexus(deployer: Address = this.sa.default): Promise<t.NexusInstance> {
        try {
            const nexus = await c_Nexus.new(this.sa.governor, { from: deployer });
            return nexus;
        } catch (e) {
            throw e;
        }
    }

    public async isRunningValidFork(): Promise<boolean> {
        try {
            const testContract = new MainnetAccounts().DAI;
            const code: string = await web3.eth.getCode(testContract);
            if (code === "0x") return false;
            return true;
        } catch (e) {
            return false;
        }
    }
}
