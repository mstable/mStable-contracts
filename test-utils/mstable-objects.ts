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
        expect(a.addr).to.equal(bAssetArr2[index].addr);
        expect(a.status).to.bignumber.equal(bAssetArr2[index].status);
        expect(a.isTransferFeeCharged).to.equal(bAssetArr2[index].isTransferFeeCharged);
        expect(a.ratio).to.bignumber.equal(bAssetArr2[index].ratio);
        expect(a.targetWeight).to.bignumber.equal(bAssetArr2[index].targetWeight);
        expect(a.vaultBalance).to.bignumber.equal(bAssetArr2[index].vaultBalance);
        return null;
    });
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
