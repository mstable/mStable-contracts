import * as t from "types/generated";
import { Address } from "./common";
import { Basset } from "../test-utils/mstable-objects";

import BN = require("bn.js");

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
    underweight: boolean;
}

export interface BasketComposition {
    bAssets: Array<BassetDetails>;
    totalSupply: BN;
    grace: BN;
    sumOfBassets: BN;
    failed: boolean;
    colRatio: BN;
}
