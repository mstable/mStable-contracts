import { Signer } from "ethers";
import { ExposedMasset, Masset, MockERC20, DelayedProxyAdmin, MockPlatformIntegration, AssetProxy, MockNexus, MassetLogic, MassetManager } from "types/generated";
import { BN } from "@utils/math";
import { MainnetAccounts } from "@utils/constants";
import { Basset } from "@utils/mstable-objects";
import { Address } from "types/common";
import { StandardAccounts } from "./standardAccounts";
import { ActionDetails, ATokenDetails, BasketComposition, BassetIntegrationDetails } from "../../types/machines";
export interface MassetDetails {
    mAsset?: ExposedMasset;
    bAssets?: Array<MockERC20>;
    pTokens?: Array<string>;
    proxyAdmin?: DelayedProxyAdmin;
    platform?: MockPlatformIntegration;
    aavePlatformAddress?: string;
    integrationAddress?: string;
    logicLib?: MassetLogic;
    managerLib?: MassetManager;
    wrappedManagerLib?: MassetManager;
    nexus?: MockNexus;
}
export declare class MassetMachine {
    sa: StandardAccounts;
    ma: MainnetAccounts;
    constructor();
    initAccounts(accounts: Signer[]): Promise<MassetMachine>;
    deployLite(a?: number): Promise<MassetDetails>;
    deployMasset(useLendingMarkets?: boolean, useTransferFees?: boolean, a?: number): Promise<MassetDetails>;
    /**
     * @dev Seeds the mAsset basket with custom weightings
     * @param md Masset details object containing all deployed contracts
     * @param weights Whole numbers of mAsset to mint for each given bAsset
     */
    seedWithWeightings(md: MassetDetails, weights: Array<BN | number>, inputIsInBaseUnits?: boolean): Promise<void>;
    loadBassetProxy(name: string, sym: string, dec: number, recipient?: string, init?: number, enableUSDTFee?: boolean): Promise<MockERC20>;
    loadBassetsLocal(useLendingMarkets?: boolean, useTransferFees?: boolean, recipient?: string): Promise<BassetIntegrationDetails>;
    /**
     * Deploy a mocked Aave contract.
     * For each bAsset:
     *   - transfer some bAsset tokens to the Aave mock
     *   - deploy a new mocked A token for the bAsset
     *   - add new A token to the mAsset platform integration
     * @param bAssets
     * @returns
     */
    loadATokens(bAssets: MockERC20[]): Promise<{
        aavePlatformAddress: Address;
        aTokens?: Array<ATokenDetails>;
    }>;
    getBassetsInMasset(mAssetDetails: MassetDetails): Promise<Basset[]>;
    getBasset(mAssetDetails: MassetDetails, bAssetAddress: string): Promise<Basset>;
    getBasketComposition(mAssetDetails: MassetDetails): Promise<BasketComposition>;
    /**
     * @dev Takes a whole unit approval amount, and converts it to the equivalent
     * base asset amount, before approving and returning the exact approval
     * @param bAsset Asset to approve spending of
     * @param mAsset Masset that gets permission to spend
     * @param fullMassetUnits Whole number or fraction to approve
     * @param sender Set if needed, else fall back to default
     * @param inputIsBaseUnits Override the scaling up to MassetQ
     */
    approveMasset(bAsset: MockERC20, mAsset: Masset | ExposedMasset | MockERC20 | AssetProxy, fullMassetUnits: number | BN | string, sender?: Signer, inputIsBaseUnits?: boolean): Promise<BN>;
    approveMassetMulti(bAssets: Array<MockERC20>, mAsset: Masset | ExposedMasset, fullMassetUnits: number, sender: Signer): Promise<Array<BN>>;
    static getPlatformInteraction(mAsset: Masset | ExposedMasset, type: "deposit" | "withdrawal", amount: BN, bAsset: Basset): Promise<ActionDetails>;
}
