import {
    ERC20MockInstance,
    GovernancePortalMockInstance,
    ManagerMockInstance,
    NexusMockInstance,
    RecollateraliserInstance,
    SimpleOracleHubMockInstance,
    SystokMockInstance,
} from "./../../types/generated/index.d";
import { MASSET_FACTORY_BYTES } from "@utils/constants";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { aToH, BigNumber } from "@utils/tools";

import { Address } from "../../types/common";
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

// const RecollateraliserArtifact = artifacts.require("Recollateraliser");

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

    public governancePortal: GovernancePortalMockInstance;
    public manager: ManagerMockInstance;
    public nexus: NexusMockInstance;
    public oracleHub: SimpleOracleHubMockInstance;
    public recollateraliser: RecollateraliserInstance;
    public systok: SystokMockInstance;

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

            /** NexusMock */
            this.nexus = await this.deployNexus();

            /** Governance */
            this.governancePortal = await this.deployGovernancePortal();
            // add module
            await this.nexus.addModule(
                await this.governancePortal.Key_Governance(),
                this.governancePortal.address,
                {
                    from: this.sa.governor,
                },
            );

            /** SystokMock */
            this.systok = await this.deploySystok();
            // add module
            await this.addModuleToNexus(await this.systok.Key_Systok(), this.systok.address);

            /** OracleHubMock */
            this.oracleHub = await this.deployOracleHub();
            // add module
            await this.addModuleToNexus(
                await this.oracleHub.Key_OracleHub(),
                this.oracleHub.address,
            );

            /** ManagerMock */
            this.manager = await this.deployManager();
            // add module
            await this.addModuleToNexus(await this.manager.Key_Manager(), this.manager.address);

            /** Recollateraliser */
            // this.recollateraliser = await this.deployRecollateraliser();
            // // add module
            // await this.addModuleToNexus(
            //     await this.recollateraliser.Key_Recollateraliser(),
            //     this.recollateraliser.address,
            // );

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
            const nexus = await NexusArtifact.new(this.sa.governor, { from: deployer });

            // this.nexus = new NexusMockContract(
            //     mockInstance.address,
            //     web3.currentProvider,
            //     this.TX_DEFAULTS,
            // );

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
            const oracleHubInstance = await OracleHubArtifact.new(
                this.sa.governor,
                this.nexus.address,
                this.sa.oraclePriceProvider,
                { from: deployer },
            );

            // this.oracleHub = new SimpleOracleHubMockContract(
            //     oracleHubInstance.address,
            //     web3.currentProvider,
            //     this.TX_DEFAULTS,
            // );

            return oracleHubInstance;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy the SystokMock token
     */
    public async deploySystok(): Promise<SystokMockInstance> {
        try {
            const systokInstance = await SystokArtifact.new(
                this.nexus.address,
                this.sa.fundManager,
                {
                    from: this.sa.default,
                },
            );

            // this.systok = new SystokMockContract(
            //     mockInstance.address,
            //     web3.currentProvider,
            //     this.TX_DEFAULTS,
            // );

            return systokInstance;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy the Governance Portal
     */
    public async deployGovernancePortal(
        govOwners: Address[] = this.sa.all.slice(0, 5),
        minQuorum: number = 1,
    ): Promise<GovernancePortalMockInstance> {
        try {
            const mockInstance = await GovernancePortalArtifact.new(
                this.nexus.address,
                govOwners,
                minQuorum,
                { from: this.sa.default },
            );

            // this.governancePortal = new GovernancePortalMockContract(
            //     mockInstance.address,
            //     web3.currentProvider,
            //     this.TX_DEFAULTS,
            // );

            return mockInstance;
        } catch (e) {
            throw e;
        }
    }

    /**
     * @dev Deploy ManagerMock and relevant init
     */
    public async deployManager(): Promise<ManagerMockInstance> {
        try {
            // const stableMathInstance = await StableMathArtifact.deployed();
            // await ForgeLibArtifact.link(StableMathArtifact, stableMathInstance.address);
            const forgeLibInstance = await ForgeLibArtifact.new();

            // await ManagerArtifact.link(StableMathArtifact, stableMathInstance.address);

            const mockInstance = await ManagerArtifact.new(
                this.governancePortal.address,
                this.nexus.address,
                this.systok.address,
                this.oracleHub.address,
                forgeLibInstance.address,
            );
            // this.manager = new ManagerMockContract(
            //     mockInstance.address,
            //     web3.currentProvider,
            //     this.TX_DEFAULTS,
            // );

            return mockInstance;
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
            [b1.address, b2.address],
            [aToH("b1"), aToH("b2")],
            [percentToWeight(50), percentToWeight(50)],
            [createMultiple(1), createMultiple(1)],
            this.sa.feePool,
            this.manager.address,
        );

        // LOG FACTORY NAMES // BYTES AS CONSTANTS
        return this.manager.addMasset(aToH("TMT"), masset.address, {
            from: sender,
        });
    }

    /**
     * @dev Deploy Recollateraliser and add it to Manager
     */
    // public async deployRecollateraliser(): Promise<RecollateraliserContract> {
    //     try {
    //         const stableMathInstance = await StableMathArtifact.deployed();
    //         await RecollateraliserArtifact.link(StableMathArtifact, stableMathInstance.address);

    //         const recollateraliserInstance = await RecollateraliserArtifact.new(
    //             this.nexus.address,
    //             this.manager.address,
    //             this.systok.address,
    //         );
    //         this.recollateraliser = new RecollateraliserContract(
    //             recollateraliserInstance.address,
    //             web3.currentProvider,
    //             this.TX_DEFAULTS,
    //         );
    //         return this.recollateraliser;
    //     } catch (e) {
    //         throw e;
    //     }
    // }

    // TODO - allow deaf module updating
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

        return this.governancePortal.submitTransaction(
            this.nexus.address,
            new BigNumber(0),
            txData,
            {
                from: sender,
            },
        );
    }
}
