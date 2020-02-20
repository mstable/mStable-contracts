import {
    ERC20MockInstance,
    ForgeValidatorInstance,
    ManagerInstance,
    NexusInstance,
    SimpleOracleHubMockInstance,
    SystokInstance,
} from "./../../types/generated/index.d";
import { MASSET_FACTORY_BYTES } from "@utils/constants";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { aToH, BN } from "@utils/tools";

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

    public forgeValidator: ForgeValidatorInstance;

    private TX_DEFAULTS: any;

    constructor(accounts: Address[], defaultSender: Address, defaultGas: number = 50000000) {
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
            moduleKeys[0] = await this.nexus.Key_Systok();
            moduleAddresses[0] = this.systok.address;
            isLocked[0] = true; // TODO Ensure that its locked at deploy time?

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
                this.nexus.address,
                this.sa.fundManager,
                {
                    from: this.sa.governor,
                },
            );

            return systokInstance;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy ManagerMock and relevant init
     */
    public async deployManager(): Promise<ManagerInstance> {
        try {
            const instance = await ManagerArtifact.new(
                this.nexus.address,
                this.forgeValidator.address,
            );

            return instance;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy a Masset via the Manager
     */
    public async createMassetViaManager(
        sender: Address = this.sa.governor,
    ): Promise<Truffle.TransactionResponse> {
        const bassetMachine = new BassetMachine(this.sa.default, this.sa.other, 500000);

        const b1: ERC20MockInstance = await bassetMachine.deployERC20Async();
        const b2: ERC20MockInstance = await bassetMachine.deployERC20Async();

        const masset = await MassetArtifact.new(
            "TestMasset",
            "TMT",
            this.nexus.address,
            [b1.address, b2.address],
            [aToH("b1"), aToH("b2")],
            [percentToWeight(50), percentToWeight(50)],
            [createMultiple(1), createMultiple(1)],
            this.sa.feePool,
            this.forgeValidator.address,
        );

        // Adds the Masset to Manager so that it can look up its price
        return this.manager.addMasset(aToH("TMT"), masset.address, { from: this.sa.governor });
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
