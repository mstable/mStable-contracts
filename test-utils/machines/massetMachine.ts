import { BN } from "@utils/tools";
import { DEFAULT_DECIMALS, DEFAULT_SUPPLY } from "@utils/constants";
import { Basset, BassetStatus } from "@utils/mstable-objects";
import { MassetContract, MassetInstance } from "types/generated/index.d";
import { Address } from "../../types/common";

const MassetArtifact = artifacts.require("Masset");

export class MassetMachine {
    private deployer: Address;

    private TX_DEFAULTS: any;

    constructor(accounts: Address[], defaultSender: Address, defaultGas = 500000) {
        this.deployer = accounts[0];
        this.TX_DEFAULTS = {
            from: defaultSender,
            gas: defaultGas,
        };
    }

    public async getMassetAtAddress(address: Address): Promise<MassetInstance> {
        return MassetArtifact.at(address);
    }

    public async getBassetsInMasset(address: Address): Promise<Basset[]> {
        // const masset = await this.getMassetAtAddress(address);
        const masset = await this.getMassetAtAddress(address);
        const bArrays = await masset.getBassets();

        return this.convertToBasset(bArrays);
    }

    /*
    public async function createMassetWithBassets(
        sysMachine: SystemMachine,
        sa: StandardAccounts,
        numOfBassets): Promise<MassetInstance> {

        await sysMachine.initialiseMocks();
        const bassetMachine = new BassetMachine(sa.default, sa.other, 500000);

        // 1. Deploy bAssets
        let bAssets = new Array();
        let bAssetsAddr = new Array();
        let symbols = new Array();
        let weights = new Array();
        let multiplier = new Array();

        const percent = 200 / numOfBassets;// Lets take 200% and divide by total bAssets to create
        let i;
        for (i = 0; i < numOfBassets; i++) {
            bAssets[i] = await bassetMachine.deployERC20Async();
            bAssetsAddr[i] = bAssets[i].address;
            symbols[i] = aToH("bAsset-" + (i + 1));
            weights[i] = percentToWeight(percent);
            multiplier[i] = createMultiple(1); // By Default all ratio 1
        }

        // 2. Masset contract deploy
        const masset: MassetInstance = await MassetArtifact.new(
            "TestMasset",
            "TMT",
            sysMachine.nexus.address,
            bAssetsAddr,
            symbols,
            weights,
            multiplier,
            sa.feePool,
            sysMachine.forgeValidator.address,
        );
        return masset;
    }
    */

    private convertToBasset = (bArrays: any[]): Basset[] => {
        return bArrays[0].map((_, i) => {
            return {
                addr: bArrays[0][i],
                key: bArrays[1][i],
                ratio: bArrays[2][i],
                maxWeight: bArrays[3][i],
                vaultBalance: bArrays[4][i],
                status: bArrays[5][i],
            };
        });
    };
}
