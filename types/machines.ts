import { BN } from "../test-utils/math"
import { Address } from "./common"
import { Basset } from "../test-utils/mstable-objects"
import { MockERC20 } from "./generated"

export interface ATokenDetails {
    bAsset: Address
    aToken: Address
}
export interface CTokenDetails {
    bAsset: Address
    cToken: Address
}

export enum IntegrationPlatform {
    none,
    aave,
    compound,
}

export interface BassetIntegrationDetails {
    bAssets: Array<MockERC20>
    bAssetTxFees: boolean[]
    platforms?: Array<IntegrationPlatform>
    aavePlatformAddress?: Address
    aTokens?: Array<ATokenDetails>
    cTokens?: Array<CTokenDetails>
}

export interface BassetDetails extends Basset {
    address: Address
    mAssetUnits: BN
    actualBalance: BN
    rawBalance?: BN
    platformBalance?: BN
}

export interface BasketComposition {
    bAssets: Array<BassetDetails>
    totalSupply: BN
    surplus: BN
    sumOfBassets: BN
    failed: boolean
    undergoingRecol: boolean
    colRatio?: BN
}

export interface ActionDetails {
    hasLendingMarket: boolean
    expectInteraction: boolean
    amount?: BN
    rawBalance?: BN
}
