import {
    ManagerInstance,
    MassetContract,
    MassetInstance,
    ERC20MockInstance,
} from "types/generated";
import { BN, aToH } from "@utils/tools";
import { DEFAULT_DECIMALS, DEFAULT_SUPPLY, expScale } from "@utils/constants";
import { Basset, BassetStatus } from "@utils/mstable-objects";
import { Address } from "types/common";
import { BassetMachine } from "./bassetMachine";
import { SystemMachine } from "./systemMachine";
import { StandardAccounts } from "./standardAccounts";
import { createMultiple, simpleToExactAmount, percentToWeight } from "@utils/math";

const MassetArtifact = artifacts.require("Masset");

export interface MassetDetails {
    mAsset: MassetInstance;
    bAssets: Array<ERC20MockInstance>;
}

export class MassetMachine {
    public system: SystemMachine;

    constructor(systemMachine: SystemMachine) {
        this.system = systemMachine;
    }

    /**
     * @dev Deploy a Masset via the Manager
     */
    public async createBasicMasset(
        bAssetCount: number = 5,
        sender: Address = this.system.sa.governor,
    ): Promise<MassetDetails> {
        const bassetMachine = new BassetMachine(
            this.system.sa.default,
            this.system.sa.other,
            500000,
        );

        let bAssetPromises = [];
        for (var i = 0; i < bAssetCount; i++) {
            bAssetPromises.push(bassetMachine.deployERC20Async());
        }
        let bAssets: Array<ERC20MockInstance> = await Promise.all(bAssetPromises);

        const mAsset = await MassetArtifact.new(
            "TestMasset",
            "TMT",
            this.system.nexus.address,
            bAssets.map((b) => b.address),
            bAssets.map(() => percentToWeight(200 / bAssetCount)),
            bAssets.map(() => createMultiple(1)),
            bAssets.map(() => false),
            this.system.sa.feePool,
            this.system.forgeValidator.address,
        );

        // Adds the Masset to Manager so that it can look up its price
        await this.system.manager.addMasset(aToH("TMT"), mAsset.address, {
            from: this.system.sa.governor,
        });
        return {
            mAsset,
            bAssets,
        };
    }

    /**
     * @dev Deploy a Masset via the Manager then:
     *      1. Mint with optimal weightings
     */
    public async createMassetAndSeedBasket(
        initialSupply: number = 5000000,
        bAssetCount: number = 5,
        sender: Address = this.system.sa.governor,
    ): Promise<MassetDetails> {
        try {
            let massetDetails = await this.createBasicMasset();

            // Mint initialSupply with shared weightings
            let basketDetails = await this.getBassetsInMasset(massetDetails.mAsset.address);
            console.log("Checkpoint 1");
            // Calc optimal weightings
            let totalWeighting = basketDetails.reduce((p, c) => p.add(c.maxWeight), new BN(0));
            let totalMintAmount = simpleToExactAmount(initialSupply, 18);
            let mintAmounts = basketDetails.map((b) => {
                // e.g. 5e35 / 2e18 = 2.5e17
                const relativeWeighting = b.maxWeight.mul(expScale).div(totalWeighting);
                // e.g. 5e25 * 25e16 / 1e18
                return totalMintAmount.mul(relativeWeighting).div(expScale);
            });
            console.log("Checkpoint 2");
            // Approve bAssets
            await Promise.all(
                massetDetails.bAssets.map((b, i) =>
                    b.approve(massetDetails.mAsset.address, mintAmounts[i], {
                        from: this.system.sa.default,
                    }),
                ),
            );
            console.log("Checkpoint 3");
            const bitmap = await massetDetails.mAsset.getBitmapForAllBassets();
            // Mint
            // console.log("Checkpoint 4", bitmap.toNumber());
            // console.log(
            //     "Checkpoint 4",
            //     mintAmounts.map((m) => m.toString()),
            // );
            // console.log(
            //     "Checkpoint 4",
            //     await Promise.all(
            //         massetDetails.bAssets.map(async (b) =>
            //             (
            //                 await b.allowance(this.system.sa.default, massetDetails.mAsset.address)
            //             ).toString(),
            //         ),
            //     ),
            // );
            // console.log(
            //     "Checkpoint 5",
            //     await Promise.all(
            //         massetDetails.bAssets.map(async (b) =>
            //             (await b.balanceOf(this.system.sa.default)).toString(),
            //         ),
            //     ),
            // );

            await massetDetails.mAsset.mintMulti(
                bitmap.toNumber(),
                mintAmounts,
                this.system.sa.default,
                { from: this.system.sa.default },
            );

            console.log("Checkpoint 6");
            return massetDetails;
        } catch (e) {
            console.error(e);
        }
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
                ratio: bArrays[1][i],
                maxWeight: bArrays[2][i],
                vaultBalance: bArrays[3][i],
                isTransferFeeCharged: bArrays[4][i],
                status: parseInt(bArrays[5][i].toString()),
            };
        });
    };
}
