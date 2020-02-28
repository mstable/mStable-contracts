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

    public manager: ManagerInstance;

    public nexus: NexusInstance;

    public oracleHub: SimpleOracleHubMockInstance;

    public metaToken: MetaTokenInstance;
    public metaTokenController: MetaTokenControllerInstance;

    public forgeValidator: ForgeValidatorInstance;

    private TX_DEFAULTS: any;

    constructor(accounts: Address[], defaultSender: Address, defaultGas = 50000000) {
        this.sa = new StandardAccounts(accounts);

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
            isLocked[0] = true; // TODO Ensure that its locked at deploy time?

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

            return Promise.resolve(true);
        } catch (e) {
            console.log(e);
            return Promise.reject(e);
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
