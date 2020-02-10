import {
    ERC20MockInstance,
    ManagerInstance,
    ForgeValidatorInstance,
    MultiSigWalletInstance,
    NexusMockInstance,
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

const MultiSigArtifact = artifacts.require("MultiSigWallet");

const ManagerArtifact = artifacts.require("Manager");

const MassetArtifact = artifacts.require("Masset");
const ForgeValidatorArtifact = artifacts.require("ForgeValidator");

const NexusMockArtifact = artifacts.require("NexusMock");

const OracleHubMockArtifact = artifacts.require("SimpleOracleHubMock");

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

    public multiSig: MultiSigWalletInstance;

    public manager: ManagerInstance;
    public nexus: NexusMockInstance;
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

            /** NexusMock */
            this.nexus = await this.deployNexus();

            /** Governance */
            this.multiSig = await this.deployMultiSig();
            // add module
            await this.nexus.addModule(await this.nexus.Key_Governance(), this.multiSig.address, {
                from: this.sa.governor,
            });

            /** Systok */
            this.systok = await this.deploySystok();
            // add module
            await this.addModuleToNexus(await this.nexus.Key_Systok(), this.systok.address);

            /** OracleHubMock */
            this.oracleHub = await this.deployOracleHub();
            // add module
            await this.addModuleToNexus(await this.nexus.Key_OracleHub(), this.oracleHub.address);

            /** ManagerMock */
            this.manager = await this.deployManager();
            // add module
            await this.addModuleToNexus(await this.nexus.Key_Manager(), this.manager.address);

            return Promise.resolve(true);
        } catch (e) {
            console.log(e);
            return Promise.reject(e);
        }
    }

    /**
     * @dev Deploy the NexusMock
     */
    public async deployNexus(deployer: Address = this.sa.default): Promise<NexusMockInstance> {
        try {
            const nexus = await NexusMockArtifact.new(this.sa.governor, { from: deployer });

            return nexus;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy the Governance Portal
     */
    public async deployMultiSig(
        govOwners: Address[] = this.sa.all.slice(0, 5),
        minQuorum: number = 1,
    ): Promise<MultiSigWalletInstance> {
        try {
            const mockInstance = await MultiSigArtifact.new(govOwners, minQuorum, {
                from: this.sa.default,
            });

            return mockInstance;
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
            const systokInstance = await SystokArtifact.new(
                this.nexus.address,
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
        const txData = this.manager.contract.methods
            .addMasset(aToH("TMT"), masset.address)
            .encodeABI();

        return this.multiSig.submitTransaction(this.nexus.address, new BN(0), txData, {
            from: sender,
        });
    }

    public async addModuleToNexus(
        moduleKey: string,
        moduleAddress: Address,
        sender: Address = this.sa.governor,
    ): Promise<Truffle.TransactionResponse> {
        return this.publishModuleThroughMultisig(moduleKey, moduleAddress, sender);
    }

    /**
     * @dev Assuming that the minimum quorum on the Multisig is 1, then we can execute transactions here
     * @param key
     * @param address
     * @param sender
     */
    private async publishModuleThroughMultisig(key, address, sender) {
        const txData = this.nexus.contract.methods.addModule(key, address).encodeABI();

        return this.multiSig.submitTransaction(this.nexus.address, new BN(0), txData, {
            from: sender,
        });
    }
}
