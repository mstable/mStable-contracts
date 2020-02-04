import { BigNumber } from "./tools";

import { ZERO_ADDRESS } from "./constants";
import { createMultiple, percentToWeight, simpleToExactAmount } from "./math";

/**
 * @notice Relevant object interfaces and helper methods to initialise mock instances of those interfaces
 * This will also qualify for mStable-Js lib at some stage
 */

export interface Basket {
    bassets: Basset[];
    expiredBassets: string[];
    grace: string;
    failed: boolean;
    collateralisationRatio: string;
}

export enum BassetStatus {
    Normal,
    BrokenBelowPeg,
    BrokenAbovePeg,
    Liquidating,
    Liquidated,
    Failed,
}

export interface Basset {
    addr: string;
    decimals: number;
    key: string;
    ratio: string;
    maxWeight: string;
    vaultBalance: string;
    status: BassetStatus;
}

export const createBasket = (bassets: Basset[], grace = 0, failed = false): Basket => {
    return {
        bassets,
        expiredBassets: [],
        grace: percentToWeight(grace).toFixed(),
        failed,
        collateralisationRatio: percentToWeight(100).toFixed(),
    };
};

export const createBasset = (
    maxWeight,
    vaultBalance,
    decimals = 18,
    status = BassetStatus.Normal,
): Basset => {
    return {
        addr: ZERO_ADDRESS,
        decimals,
        key: "0x",
        ratio: createMultiple(
            new BigNumber(10).pow(new BigNumber(18 - decimals)).toNumber(),
        ).toFixed(),
        maxWeight: percentToWeight(maxWeight).toFixed(),
        vaultBalance: simpleToExactAmount(vaultBalance, decimals).toFixed(),
        status,
    };
};
