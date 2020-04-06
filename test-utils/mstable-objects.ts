import { BN } from "./tools";

import { ZERO_ADDRESS } from "./constants";
import { createMultiple, percentToWeight, simpleToExactAmount } from "./math";
import { MockERC20Instance } from "types/generated";

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

export enum BassetStatus {
    Default,
    Normal,
    BrokenBelowPeg,
    BrokenAbovePeg,
    Blacklisted,
    Liquidating,
    Liquidated,
    Failed,
}

export interface Basset {
    addr: string;
    status: BassetStatus;
    isTransferFeeCharged: boolean;
    ratio: BN | string;
    targetWeight: BN | string;
    vaultBalance: BN | string;
    contract?: MockERC20Instance;
}

export const createBasket = (bassets: Basset[], failed = false): Basket => {
    return {
        bassets,
        maxBassets: new BN(16),
        expiredBassets: [],
        failed,
        collateralisationRatio: percentToWeight(100),
    };
};

export const createBasset = (
    targetWeight: BN,
    vaultBalance: BN,
    decimals = 18,
    status = BassetStatus.Normal,
    isTransferFeeCharged = false,
): Basset => {
    return {
        addr: ZERO_ADDRESS,
        isTransferFeeCharged,
        ratio: createMultiple(decimals).toString(),
        targetWeight: percentToWeight(targetWeight).toString(),
        vaultBalance: simpleToExactAmount(vaultBalance, decimals).toString(),
        status,
    };
};
