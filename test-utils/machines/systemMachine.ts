import { MassetMachine, MassetDetails } from "@utils/machines";
import { latest } from "openzeppelin-test-helpers/src/time";
import * as t from "types/generated";
import { Address } from "types/common";

import { BassetMachine } from "./bassetMachine";
import { StandardAccounts } from "./standardAccounts";

import { MASSET_FACTORY_BYTES, MainnetAccounts } from "@utils/constants";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { aToH, BN } from "@utils/tools";

// Nexus
const c_Nexus: t.NexusContract = artifacts.require("Nexus");

// Savings
const c_SavingsContract: t.SavingsContractContract = artifacts.require("SavingsContract");
const c_SavingsManager: t.SavingsManagerContract = artifacts.require("SavingsManager");

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

    constructor(accounts: Address[]) {
        this.sa = new StandardAccounts(accounts);
        this.massetMachine = new MassetMachine(this);
        if (process.env.NETWORK == "fork") {
            this.isGanacheFork = true;
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
    public async initialiseMocks() {
        try {
            if (this.isGanacheFork) {
                var validFork = await this.isRunningValidFork();
                if (!validFork) throw "err";
            }
            /***************************************
            1. Nexus (Redeploy)
            ****************************************/
            this.nexus = await this.deployNexus();

            /***************************************
            2. mUSD
            ****************************************/
            this.mUSD = await this.massetMachine.deployMasset();

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
            this.nexus.initialize(
                [await this.savingsManager.Key_SavingsManager()],
                [this.savingsManager.address],
                [false],
                this.sa.governor,
                { from: this.sa.governor },
            );
            return Promise.resolve(true);
        } catch (e) {
            console.log(e);
            return Promise.reject(e);
        }
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
