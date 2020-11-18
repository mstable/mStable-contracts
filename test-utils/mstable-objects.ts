import envSetup from "@utils/env_setup";
import { BN } from "@utils/tools";
import * as t from "types/generated";
import { ZERO_ADDRESS } from "./constants";
import { createMultiple, percentToWeight, simpleToExactAmount } from "./math";

const { expect } = envSetup.configure();

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
    status: BN | BassetStatus;
    isTransferFeeCharged: boolean;
    ratio: BN | string;
    maxWeight: BN | string;
    vaultBalance: BN | string;
    contract?: t.MockERC20Instance;
    integrator?: t.IPlatformIntegrationInstance;
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
    maxWeight: BN | number | string,
    vaultBalance: BN | number | string,
    decimals = 18,
    status = BassetStatus.Normal,
    isTransferFeeCharged = false,
): Basset => {
    return {
        addr: ZERO_ADDRESS,
        isTransferFeeCharged,
        ratio: createMultiple(decimals).toString(),
        maxWeight: percentToWeight(maxWeight).toString(),
        vaultBalance: simpleToExactAmount(vaultBalance, decimals).toString(),
        status,
    };
};

export const equalBasset = (bAsset1: Basset, bAsset2: Basset): void => {
    expect(bAsset1.addr).to.equal(bAsset2.addr);
    expect(bAsset1.status).to.bignumber.equal(bAsset2.status);
    expect(bAsset1.isTransferFeeCharged).to.equal(bAsset2.isTransferFeeCharged);
    expect(bAsset1.ratio).to.bignumber.equal(bAsset2.ratio);
    expect(bAsset1.maxWeight).to.bignumber.equal(bAsset2.maxWeight);
    expect(bAsset1.vaultBalance).to.bignumber.equal(bAsset2.vaultBalance);
    return null;
};

export const equalBassets = (bAssetArr1: Array<Basset>, bAssetArr2: Array<Basset>): void => {
    expect(bAssetArr1.length).to.equal(bAssetArr2.length);
    bAssetArr1.map((a, index) => {
        equalBasset(bAssetArr1[index], bAssetArr2[index]);
        return null;
    });
};

export const buildBasset = (
    _addr: string,
    _status: number,
    _isTransferFeeCharged: boolean,
    _ratio: BN,
    _maxWeight: BN,
    _vaultBalance: BN,
): Basset => {
    return {
        addr: _addr,
        status: new BN(_status),
        isTransferFeeCharged: _isTransferFeeCharged,
        ratio: _ratio,
        maxWeight: _maxWeight,
        vaultBalance: _vaultBalance,
    };
};

export const calculateRatio = (measureMultiple: BN, bAssetDecimals: BN): BN => {
    const delta = new BN(18).sub(bAssetDecimals);
    return measureMultiple.mul(new BN(10).pow(new BN(delta)));
};
