import * as t from "types/generated";
import { BN } from "../test-utils/tools";
import { Address } from "./common";
import { Basset } from "../test-utils/mstable-objects";

export interface ATokenDetails {
    bAsset: Address;
    aToken: Address;
}
export interface CTokenDetails {
    bAsset: Address;
    cToken: Address;
}

export enum Platform {
    aave,
    compound,
}

export interface BassetIntegrationDetails {
    bAssets: Array<t.MockErc20Instance>;
    fees: Array<boolean>;
    platforms: Array<Platform>;
    aavePlatformAddress: Address;
    aTokens: Array<ATokenDetails>;
    cTokens: Array<CTokenDetails>;
}

export interface BassetDetails extends Basset {
    address: Address;
    mAssetUnits: BN;
    overweight: boolean;
}

export interface BasketComposition {
    bAssets: Array<BassetDetails>;
    totalSupply: BN;
    sumOfBassets: BN;
    failed: boolean;
    undergoingRecol: boolean;
    colRatio: BN;
}
