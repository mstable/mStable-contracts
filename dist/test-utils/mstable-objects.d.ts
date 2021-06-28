import { BN } from "@utils/math";
import { IPlatformIntegration, MockERC20 } from "types/generated";
/**
 * @notice Relevant object interfaces and helper methods to initialise mock instances of those interfaces
 * This will also qualify for mStable-Js lib at some stage
 */
export interface Basket {
    bassets: Basset[];
    maxBassets: BN;
    expiredBassets: string[];
    failed: boolean;
    collateralisationRatio: BN;
}
export declare enum BassetStatus {
    Default = 0,
    Normal = 1,
    BrokenBelowPeg = 2,
    BrokenAbovePeg = 3,
    Blacklisted = 4,
    Liquidating = 5,
    Liquidated = 6,
    Failed = 7
}
export interface Basset {
    addr: string;
    status: BN | BassetStatus;
    isTransferFeeCharged: boolean;
    ratio: BN | string;
    vaultBalance: BN;
    pToken?: string;
    integratorAddr?: string;
    contract?: MockERC20;
    integrator?: IPlatformIntegration;
}
export declare const createBasket: (bassets: Basset[], failed?: boolean) => Basket;
export declare const createBasset: (maxWeight: BN | number | string, vaultBalance: BN | number | string, decimals?: number, status?: BassetStatus, isTransferFeeCharged?: boolean) => Basset;
export declare const equalBasset: (bAsset1: Basset, bAsset2: Basset) => void;
export declare const equalBassets: (bAssetArr1: Array<Basset>, bAssetArr2: Array<Basset>) => void;
export declare const buildBasset: (_addr: string, _status: number, _isTransferFeeCharged: boolean, _ratio: BN, _maxWeight: BN, _vaultBalance: BN) => Basset;
export declare const calculateRatio: (measureMultiple: BN, bAssetDecimals: BN) => BN;
