import { MockERC20Instance } from "types/generated";
import envSetup from "@utils/env_setup";
import { BN } from "@utils/tools";
import { ZERO_ADDRESS } from "./constants";
import { createMultiple, percentToWeight, simpleToExactAmount } from "./math";

const { expect } = envSetup.configure();

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
    Blacklisted,
    Liquidating,
    Liquidated,
    Failed,
}

export interface Basset {
    addr: string;
    status: BN;
    isTransferFeeCharged: boolean;
    ratio: BN;
    targetWeight: BN;
    vaultBalance: BN;
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
//     targetWeight: number,
//     vaultBalance: number,
//     decimals = 18,
//     status = BassetStatus.Normal,
// ): Basset => {
//     return {
//         addr: ZERO_ADDRESS,
//         isTransferFeeCharged: false,
//         ratio: createMultiple(new BN(10).pow(new BN(18 - decimals)).toNumber()),
//         targetWeight: percentToWeight(targetWeight),
//         vaultBalance: simpleToExactAmount(vaultBalance, decimals),
//         status,
//     };
// };

export const equalBassets = (bAssetArr1: Array<Basset>, bAssetArr2: Array<Basset>): void => {
    expect(bAssetArr1.length).to.equal(bAssetArr2.length);
    bAssetArr1.map((a, index) => {
        equalBasset(bAssetArr1[index], bAssetArr2[index]);
        return null;
    });
};

export const equalBasset = (bAsset1: Basset, bAsset2: Basset): void => {
    expect(bAsset1.addr).to.equal(bAsset2.addr);
    expect(bAsset1.status).to.bignumber.equal(bAsset2.status);
    expect(bAsset1.isTransferFeeCharged).to.equal(bAsset2.isTransferFeeCharged);
    expect(bAsset1.ratio).to.bignumber.equal(bAsset2.ratio);
    expect(bAsset1.targetWeight).to.bignumber.equal(bAsset2.targetWeight);
    expect(bAsset1.vaultBalance).to.bignumber.equal(bAsset2.vaultBalance);
    return null;
};

export const buildBasset = (
    _addr: string,
    _status: number,
    _isTransferFeeCharged: boolean,
    _ratio: BN,
    _targetWeight: BN,
    _vaultBalance: BN,
): Basset => {
    return {
        addr: _addr,
        status: new BN(_status),
        isTransferFeeCharged: _isTransferFeeCharged,
        ratio: _ratio,
        targetWeight: _targetWeight,
        vaultBalance: _vaultBalance,
    };
};
