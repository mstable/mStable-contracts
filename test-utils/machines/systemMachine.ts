import { latest } from "openzeppelin-test-helpers/src/time";
import {
    ERC20MockInstance,
    ForgeValidatorInstance,
    MassetInstance,
    NexusInstance,
} from "types/generated";
import { Address } from "types/common";

import { BassetMachine } from "./bassetMachine";
import { StandardAccounts } from "./standardAccounts";

import { MASSET_FACTORY_BYTES, MainnetAccounts } from "@utils/constants";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { aToH, BN } from "@utils/tools";

const Erc20Artifact = artifacts.require("ERC20Mock");

const MUSD = artifacts.require("MUSD");
const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

const NexusArtifact = artifacts.require("Nexus");

/**
 * @dev The SystemMachine is responsible for creating mock versions of our contracts
 * Since we will need to generate usable, customisable contracts throughout our test
 * framework, this will act as a Machine to generate these various mocks
 */
export class SystemMachine {
    /** @dev Default accounts as per system Migrations */
    public sa: StandardAccounts;
    public ma: MainnetAccounts;

    public nexus: NexusInstance;

    public forgeValidator: ForgeValidatorInstance;

    private TX_DEFAULTS: any;

    constructor(accounts: Address[], defaultSender: Address, defaultGas = 50000000) {
        this.sa = new StandardAccounts(accounts);
        this.ma = new MainnetAccounts();

        this.TX_DEFAULTS = {
            from: defaultSender,
            gas: defaultGas,
        };
    }

    /**
     * @dev Initialises the system to replicate current migration scripts
     * Critical that this mock initialisation mirrors the generic with
     * deployments from the correct accounts
     */
    public async initialiseMocks() {
        try {
            /** Shared */
            this.forgeValidator = await ForgeValidatorArtifact.new();

            /** Nexus */
            this.nexus = await this.deployNexus();

            console.log("NETWORK", process.env.NETWORK);
            if (process.env.NETWORK == "fork") {
                // use mainnet addresses
                // use bAssets
            } else if (process.env.NETWORK == "development") {
            }

            // await this.mintAllTokens();

            return Promise.resolve(true);
        } catch (e) {
            console.log(e);
            return Promise.reject(e);
        }
    }

    public async isRunningForkedGanache() {
        try {
            // console.log("e", web3.eth.getCode, this.ma.DAI);
            console.log("011");
            const code: string = await web3.eth.getCode(this.ma.DAI);
            console.log("11");
            // Empty code on mainnet DAI contract address
            if (code === "0x") return false;
            console.log("22");
            return true;
        } catch (e) {
            console.log("33");
            return false;
        }
    }

    public async mintAllTokens() {
        // When Ganache not running mainnet forked version, dont mint
        if (!(await this.isRunningForkedGanache())) {
            console.warn(
                "*** Ganache not running on MAINNET fork. Hence, avoid minting tokens ***",
            );
            return;
        }

        // mainnet addresses
        // DAI
        await this.mintERC20(this.ma.DAI);
        // GUSD
        await this.mintERC20(this.ma.GUSD);
        // PAX
        await this.mintERC20(this.ma.PAX);
        // SUSD
        // Getting error when calling `transfer()` "Transfer requires settle"
        //await this.mintERC20(this.ma.SUSD);
        // TUSD
        await this.mintERC20(this.ma.TUSD);
        // USDC
        await this.mintERC20(this.ma.USDC);
        // USDT
        await this.mintERC20(this.ma.USDT);
    }

    public async mintERC20(erc20: string) {
        const instance: ERC20MockInstance = await Erc20Artifact.at(erc20);
        const decimals = await instance.decimals();
        const symbol = await instance.symbol();
        console.log("Symbol: " + symbol + " decimals: " + decimals);
        const ONE_TOKEN = new BN(10).pow(decimals);
        const HUNDRED_TOKEN = ONE_TOKEN.mul(new BN(100));
        let i;
        for (i = 0; i < this.sa.all.length; i++) {
            await instance.transfer(this.sa.all[i], HUNDRED_TOKEN, { from: this.ma.OKEX });
            const bal: BN = await instance.balanceOf(this.sa.all[i]);
            console.log(bal.toString(10));
        }
    }

    /**
     * @dev Deploy the Nexus
     */
    public async deployNexus(deployer: Address = this.sa.default): Promise<NexusInstance> {
        try {
            const nexus = await NexusArtifact.new(this.sa.governor, { from: deployer });
            return nexus;
        } catch (e) {
            throw e;
        }
    }

    public async initializeNexusWithModules(
        moduleKeys: string[],
        moduleAddresses: Address[],
        isLocked: boolean[],
        sender: Address = this.sa.governor,
    ): Promise<Truffle.TransactionResponse> {
        return this.nexus.initialize(moduleKeys, moduleAddresses, isLocked, this.sa.governor, {
            from: sender,
        });
    }
}
