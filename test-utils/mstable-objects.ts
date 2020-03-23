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
    expiredBassets: string[];
    failed: boolean;
    collateralisationRatio: BN;
}

export enum BassetStatus {
    Default,
    Normal,
    BrokenBelowPeg,
    BrokenAbovePeg,
    Liquidating,
    Liquidated,
    Failed,
}

export interface Basset {
    addr: string;
    status: BassetStatus;
    isTransferFeeCharged: boolean;
    ratio: BN;
    maxWeight: BN;
    vaultBalance: BN;
    contract?: MockERC20Instance;
}

export const createBasket = (bassets: Basset[], failed = false): Basket => {
    return {
        bassets,
        expiredBassets: [],
        failed,
        collateralisationRatio: percentToWeight(100),
    };
};

// export const createBasset = (
//     maxWeight: number,
//     vaultBalance: number,
//     decimals = 18,
//     status = BassetStatus.Normal,
// ): Basset => {
//     return {
//         addr: ZERO_ADDRESS,
//         isTransferFeeCharged: false,
//         ratio: createMultiple(new BN(10).pow(new BN(18 - decimals)).toNumber()),
//         maxWeight: percentToWeight(maxWeight),
//         vaultBalance: simpleToExactAmount(vaultBalance, decimals),
//         status,
//     };
// };
