import { BN } from "../test-utils/math"
import { EthAddress } from "./common"
import { Basset } from "../test-utils/mstable-objects"
import { MockERC20 } from "./generated"

export interface ATokenDetails {
    bAsset: EthAddress
    aToken: EthAddress
}
export interface CTokenDetails {
    bAsset: EthAddress
    cToken: EthAddress
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
    aavePlatformAddress?: EthAddress
    aTokens?: Array<ATokenDetails>
    cTokens?: Array<CTokenDetails>
}

export interface BassetDetails extends Basset {
    address: EthAddress
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
