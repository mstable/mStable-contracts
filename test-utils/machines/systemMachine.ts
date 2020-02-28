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
    SystokControllerInstance,
    SystokInstance,
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
const SystokArtifact = artifacts.require("Systok");
const SystokControllerArtifact = artifacts.require("SystokController");

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

    public systok: SystokInstance;
    public systokController: SystokControllerInstance;

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

            /** Systok */
            this.systok = await this.deploySystok();
            this.systokController = await this.deploySystokController();
            moduleKeys[0] = await this.nexus.Key_Systok();
            moduleAddresses[0] = this.systok.address;
            isLocked[0] = true; // TODO Ensure that its locked at deploy time?

            await this.systok.transfer(this.sa._, simpleToExactAmount(1000, 18), {
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
     * @dev Adds prices for the mAsset and Systok into the Oracle
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
            [mAssetAddress, this.systok.address],
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
     * @dev Deploy the SystokMock token
     */
    public async deploySystok(): Promise<SystokInstance> {
        try {
            const miniTokenFactory = await MiniMeTokenFactoryArtifact.new({
                from: this.sa.default,
            });
            const systokInstance = await SystokArtifact.new(
                miniTokenFactory.address,
                this.sa.fundManager,
                {
                    from: this.sa.default,
                },
            );

            return systokInstance;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy the SystokController token
     */
    public async deploySystokController(): Promise<SystokControllerInstance> {
        try {
            const systokController = await SystokControllerArtifact.new(
                this.nexus.address,
                this.systok.address,
                {
                    from: this.sa.default,
                },
            );
            await this.systok.changeController(systokController.address, { from: this.sa.default });

            return systokController;
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
