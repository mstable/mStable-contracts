import { latest } from "openzeppelin-test-helpers/src/time";
import { MASSET_FACTORY_BYTES } from "@utils/constants";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { aToH, BN } from "@utils/tools";
import {
    ERC20MockInstance,
    ForgeValidatorInstance,
    ManagerInstance,
    MassetInstance,
    NexusInstance,
    SimpleOracleHubMockInstance,
    MetaTokenControllerInstance,
    MetaTokenInstance,
} from "types/generated";

import { Address } from "../../types/common";
import { BassetMachine } from "./bassetMachine";
import { StandardAccounts } from "./standardAccounts";
import { MainnetAccounts } from './mainnetAccounts';

const CommonHelpersArtifact = artifacts.require("CommonHelpers");
const StableMathArtifact = artifacts.require("StableMath");

const Erc20Artifact = artifacts.require("ERC20Mock");

const ManagerArtifact = artifacts.require("Manager");

const MassetArtifact = artifacts.require("Masset");
const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

const NexusArtifact = artifacts.require("Nexus");

const OracleHubMockArtifact = artifacts.require("SimpleOracleHubMock");

const MiniMeTokenFactoryArtifact = artifacts.require("MiniMeTokenFactory");
const MetaTokenArtifact = artifacts.require("MetaToken");
const MetaTokenControllerArtifact = artifacts.require("MetaTokenController");

/**
 * @dev The SystemMachine is responsible for creating mock versions of our contracts
 * Since we will need to generate usable, customisable contracts throughout our test
 * framework, this will act as a Machine to generate these various mocks
 */
export class SystemMachine {
    /**
     * @dev Default accounts as per system Migrations
     */
    public sa: StandardAccounts;

    public ma: MainnetAccounts;

    public manager: ManagerInstance;

    public nexus: NexusInstance;

    public oracleHub: SimpleOracleHubMockInstance;

    public metaToken: MetaTokenInstance;
    public metaTokenController: MetaTokenControllerInstance;

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
            await CommonHelpersArtifact.new();
            await StableMathArtifact.new();
            this.forgeValidator = await ForgeValidatorArtifact.new();

            /** Nexus */
            this.nexus = await this.deployNexus();

            const moduleKeys: string[] = new Array(3);
            const moduleAddresses: Address[] = new Array(3);
            const isLocked: boolean[] = new Array(3);

            /** MetaToken */
            this.metaToken = await this.deployMetaToken();
            this.metaTokenController = await this.deployMetaTokenController();
            moduleKeys[0] = await this.nexus.Key_MetaToken();
            moduleAddresses[0] = this.metaToken.address;
            isLocked[0] = true;

            await this.metaToken.transfer(this.sa._, simpleToExactAmount(1000, 18), {
                from: this.sa.fundManager,
            });

            /** OracleHubMock */
            this.oracleHub = await this.deployOracleHub();
            moduleKeys[1] = await this.nexus.Key_OracleHub();
            moduleAddresses[1] = this.oracleHub.address;
            isLocked[1] = false;

            /** ManagerMock */
            this.manager = await this.deployManager();
            moduleKeys[2] = await this.nexus.Key_Manager();
            moduleAddresses[2] = this.manager.address;
            isLocked[2] = false;

            await this.initializeNexusWithModules(moduleKeys, moduleAddresses, isLocked);

            await this.mintAllTokens();

            return Promise.resolve(true);
        } catch (e) {
            console.log(e);
            return Promise.reject(e);
        }
    }

    public async isRunningForkedGanache() {
        try {
            const code: string = await web3.eth.getCode(this.ma.DAI);
            // Empty code on mainnet DAI contract address
            if(code === "0x") 
                return false;
            else
                return true;
        } catch (e) {
            return false;
        }
    }

    public async mintAllTokens() {
        // When Ganache not running mainnet forked version, dont mint
        if( ! (await this.isRunningForkedGanache()) ) {
            console.warn("*** Ganache not running on MAINNET fork. Hence, avoid minting tokens ***");
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
        for(i = 0; i < this.sa.all.length; i++) {
            await instance.transfer(this.sa.all[i], HUNDRED_TOKEN, {from: this.ma.OKEX});
            const bal: BN = await instance.balanceOf(this.sa.all[i]);
            console.log(bal.toString(10));
        }        
    }

    /**
     * @dev Adds prices for the mAsset and MetaToken into the Oracle
     * @param mAssetPrice Where $1 == 1e6 ("1000000")
     * @return txHash
     */
    public async addMockPrices(
        mAssetPrice: string,
        mAssetAddress: string,
    ): Promise<Truffle.TransactionResponse> {
        const time = await latest();
        return this.oracleHub.addMockPrices(
            [new BN(mAssetPrice), new BN("12000000")],
            [time, time],
            [mAssetAddress, this.metaToken.address],
            { from: this.sa.oraclePriceProvider },
        );
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

    /**
     * @dev Deploy the OracleHubMock
     */
    public async deployOracleHub(
        deployer: Address = this.sa.default,
    ): Promise<SimpleOracleHubMockInstance> {
        try {
            const oracleHubInstance = await OracleHubMockArtifact.new(
                this.nexus.address,
                this.sa.oraclePriceProvider,
                { from: deployer },
            );

            return oracleHubInstance;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy the MetaTokenMock token
     */
    public async deployMetaToken(): Promise<MetaTokenInstance> {
        try {
            const miniTokenFactory = await MiniMeTokenFactoryArtifact.new({
                from: this.sa.default,
            });
            const metaTokenInstance = await MetaTokenArtifact.new(
                miniTokenFactory.address,
                this.sa.fundManager,
                {
                    from: this.sa.default,
                },
            );

            return metaTokenInstance;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy the MetaTokenController token
     */
    public async deployMetaTokenController(): Promise<MetaTokenControllerInstance> {
        try {
            const metaTokenController = await MetaTokenControllerArtifact.new(
                this.nexus.address,
                this.metaToken.address,
                {
                    from: this.sa.default,
                },
            );
            await this.metaToken.changeController(metaTokenController.address, {
                from: this.sa.default,
            });

            return metaTokenController;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy ManagerMock and relevant init
     */
    public async deployManager(): Promise<ManagerInstance> {
        try {
            const instance = await ManagerArtifact.new(this.nexus.address);

            return instance;
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
