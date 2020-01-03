import { MASSET_FACTORY_BYTES } from "@utils/constants";
import {
    ERC20MockContract,
    GovernancePortalMockContract,
    ManagerMockContract,
    NexusMockContract,
    SimpleOracleHubMockContract,
    SystokMockContract,
} from "@utils/contracts";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { aToH, BigNumber } from "@utils/tools";

import { Address } from "../../types/common";
import { RecollateraliserContract } from "../../types/generated/recollateraliser";
import { BassetMachine } from "./bassetMachine";
import { StandardAccounts } from "./standardAccounts";

const CommonHelpersArtifact = artifacts.require("CommonHelpers");
const StableMathArtifact = artifacts.require("StableMath");
const Erc20Artifact = artifacts.require("ERC20Mock");

const GovernancePortalArtifact = artifacts.require("GovernancePortalMock");

const ManagerArtifact = artifacts.require("ManagerMock");

const MassetArtifact = artifacts.require("Masset");
const ForgeLibArtifact = artifacts.require("ForgeLib");

const NexusArtifact = artifacts.require("NexusMock");

const OracleHubArtifact = artifacts.require("SimpleOracleHubMock");

const RecollateraliserArtifact = artifacts.require("Recollateraliser");

const SystokArtifact = artifacts.require("SystokMock");

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

    public governancePortal: GovernancePortalMockContract;
    public manager: ManagerMockContract;
    public nexus: NexusMockContract;
    public oracleHub: SimpleOracleHubMockContract;
    public recollateraliser: RecollateraliserContract;
    public systok: SystokMockContract;

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
            // TODO: figure out why this isn't propagating from env_setup
            web3.currentProvider["sendAsync"] = web3.currentProvider["send"];

            /** Shared */
            await CommonHelpersArtifact.new();
            await StableMathArtifact.new();

            /** NexusMock */
            await this.deployNexus();

            /** OracleHubMock */
            const oracleHub = await this.deployOracleHub();
            // add module
            await this.addModuleToNexus(
                await oracleHub.Key_OracleHub.callAsync(),
                oracleHub.address,
            );

            /** SystokMock */
            const systok = await this.deploySystok();
            // add module
            await this.addModuleToNexus(await systok.Key_Systok.callAsync(), systok.address);

            /** Governance */
            const governancePortal = await this.deployGovernancePortal();
            // add module
            await this.addModuleToNexus(
                await governancePortal.Key_Governance.callAsync(),
                governancePortal.address,
            );

            /** ManagerMock */
            const manager = await this.deployManager();
            // add module
            await this.addModuleToNexus(await manager.Key_Manager.callAsync(), manager.address);

            /** Recollateraliser */
            const recollateraliser = await this.deployRecollateraliser();
            // add module
            await this.addModuleToNexus(
                await recollateraliser.Key_Recollateraliser.callAsync(),
                recollateraliser.address,
            );

            return Promise.resolve(true);
        } catch (e) {
            console.log(e);
            return Promise.reject(e);
        }
    }

    /**
     * @dev Deploy the NexusMock
     */
    public async deployNexus(deployer: Address = this.sa.default): Promise<NexusMockContract> {
        try {
            const mockInstance = await NexusArtifact.new(this.sa.governor, { from: deployer });

            this.nexus = new NexusMockContract(
                mockInstance.address,
                web3.currentProvider,
                this.TX_DEFAULTS,
            );

            return this.nexus;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy the OracleHubMock
     */
    public async deployOracleHub(
        deployer: Address = this.sa.default,
    ): Promise<SimpleOracleHubMockContract> {
        try {
            const oracleHubInstance = await OracleHubArtifact.new(
                this.sa.governor,
                this.nexus.address,
                this.sa.oraclePriceProvider,
                { from: deployer },
            );

            this.oracleHub = new SimpleOracleHubMockContract(
                oracleHubInstance.address,
                web3.currentProvider,
                this.TX_DEFAULTS,
            );

            return this.oracleHub;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy the SystokMock token
     */
    public async deploySystok(): Promise<SystokMockContract> {
        try {
            const mockInstance = await SystokArtifact.new(this.nexus.address, this.sa.fundManager, {
                from: this.sa.default,
            });

            this.systok = new SystokMockContract(
                mockInstance.address,
                web3.currentProvider,
                this.TX_DEFAULTS,
            );

            return this.systok;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy the Governance Portal
     */
    public async deployGovernancePortal(
        govOwners: Address[] = this.sa.all.slice(4, 10),
        minQuorum: number = 3,
    ): Promise<GovernancePortalMockContract> {
        try {
            const mockInstance = await GovernancePortalArtifact.new(
                this.nexus.address,
                govOwners,
                minQuorum,
                { from: this.sa.default },
            );

            this.governancePortal = new GovernancePortalMockContract(
                mockInstance.address,
                web3.currentProvider,
                this.TX_DEFAULTS,
            );

            return this.governancePortal;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy ManagerMock and relevant init
     */
    public async deployManager(): Promise<ManagerMockContract> {
        try {
            const stableMathInstance = await StableMathArtifact.deployed();
            await ForgeLibArtifact.link(StableMathArtifact, stableMathInstance.address);
            const forgeLibInstance = await ForgeLibArtifact.new();

            await ManagerArtifact.link(StableMathArtifact, stableMathInstance.address);

            const mockInstance = await ManagerArtifact.new(
                this.sa.governor,
                this.nexus.address,
                this.systok.address,
                this.oracleHub.address,
                forgeLibInstance.address,
            );
            this.manager = new ManagerMockContract(
                mockInstance.address,
                web3.currentProvider,
                this.TX_DEFAULTS,
            );

            return this.manager;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy a Masset via the Manager
     */
    public async createMassetViaManager(sender: Address = this.sa.governor): Promise<Address> {
        const bassetMachine = new BassetMachine(this.sa.default, this.sa.other, 500000);

        const b1: ERC20MockContract = await bassetMachine.deployERC20Async();
        const b2: ERC20MockContract = await bassetMachine.deployERC20Async();

        const masset = await MassetArtifact.new(
            "TestMasset",
            "TMT",
            [b1.address, b2.address],
            [aToH("b1"), aToH("b2")],
            [percentToWeight(50), percentToWeight(50)],
            [createMultiple(1), createMultiple(1)],
            this.manager.address,
        );

        // LOG FACTORY NAMES // BYTES AS CONSTANTS
        return this.manager.addMasset.sendTransactionAsync(aToH("TMT"), masset.address, {
            from: sender,
        });
    }

    /**
     * @dev Deploy Recollateraliser and add it to Manager
     */
    public async deployRecollateraliser(): Promise<RecollateraliserContract> {
        try {
            const stableMathInstance = await StableMathArtifact.deployed();
            await RecollateraliserArtifact.link(StableMathArtifact, stableMathInstance.address);

            const recollateraliserInstance = await RecollateraliserArtifact.new(
                this.nexus.address,
                this.manager.address,
                this.systok.address,
            );
            this.recollateraliser = new RecollateraliserContract(
                recollateraliserInstance.address,
                web3.currentProvider,
                this.TX_DEFAULTS,
            );
            return this.recollateraliser;
        } catch (e) {
            throw e;
        }
    }

    public async addModuleToNexus(
        moduleKey: string,
        moduleAddress: Address,
        subscribe: boolean = true,
        sender: Address = this.sa.governor,
    ): Promise<string> {
        if (subscribe) {
            return this.nexus.addModule.sendTransactionAsync(moduleKey, moduleAddress, {
                from: sender,
            });
        } else {
            return this.nexus.addDeafModule.sendTransactionAsync(moduleKey, moduleAddress, {
                from: sender,
            });
        }
    }
}
