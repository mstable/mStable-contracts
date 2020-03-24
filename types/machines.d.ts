import * as t from "./generated";

export interface MassetDetails {
    mAsset?: t.MassetInstance;
    basketManager?: t.BasketManagerInstance;
    bAssets?: Array<t.MockERC20Instance>;
    proxyAdmin?: t.DelayedProxyAdminInstance;
    aaveIntegration?: t.AaveIntegrationInstance;
    compoundIntegration?: t.CompoundIntegrationInstance;
}

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
    bAssets: Array<t.MockERC20Instance>;
    platforms: Array<Platform>;
    aavePlatformAddress: Address;
    aTokens: Array<ATokenDetails>;
    cTokens: Array<CTokenDetails>;
}
