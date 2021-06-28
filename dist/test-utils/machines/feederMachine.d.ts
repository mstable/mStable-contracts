import { Signer } from "ethers";
import { FeederLogic, FeederPool, MockERC20, FeederManager, InterestValidator, Masset } from "types/generated";
import { BN } from "@utils/math";
import { MainnetAccounts } from "@utils/constants";
import { Basset } from "@utils/mstable-objects";
import { StandardAccounts } from "./standardAccounts";
import { ActionDetails, BasketComposition } from "../../types/machines";
import { MassetMachine, MassetDetails } from "./mAssetMachine";
export interface FeederDetails {
    pool?: FeederPool;
    logic?: FeederLogic;
    manager?: FeederManager;
    interestValidator?: InterestValidator;
    mAsset?: MockERC20 & Masset;
    fAsset?: MockERC20;
    bAssets?: MockERC20[];
    pTokens?: Array<string>;
    mAssetDetails?: MassetDetails;
}
export declare class FeederMachine {
    sa: StandardAccounts;
    ma: MainnetAccounts;
    mAssetMachine: MassetMachine;
    constructor(massetMachine: MassetMachine);
    initAccounts(accounts: Signer[]): Promise<FeederMachine>;
    deployFeeder(feederWeights?: Array<BN | number>, mAssetWeights?: Array<BN | number>, useLendingMarkets?: boolean, useInterestValidator?: boolean, use2dp?: boolean): Promise<FeederDetails>;
    getBassets(feederDetails: FeederDetails): Promise<Basset[]>;
    getAsset(feederDetails: FeederDetails, assetAddress: string): Promise<Basset & {
        isMpAsset: boolean;
        feederPoolOrMassetContract: MockERC20;
    }>;
    getBasketComposition(feederDetails: FeederDetails): Promise<BasketComposition>;
    approveFeeder(asset: MockERC20, feeder: string, assetQuantity: number | BN | string, sender?: Signer, inputIsBaseUnits?: boolean): Promise<BN>;
    static getPlatformInteraction(pool: FeederPool, type: "deposit" | "withdrawal", amount: BN, bAsset: Basset): Promise<ActionDetails>;
}
