import { expect } from "chai"
import { BN, createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math"
import { IPlatformIntegration, MockERC20 } from "types/generated"
import { ZERO_ADDRESS } from "./constants"

/**
 * @notice Relevant object interfaces and helper methods to initialise mock instances of those interfaces
 * This will also qualify for mStable-Js lib at some stage
 */

export interface Basket {
    bassets: Basset[]
    maxBassets: BN
    expiredBassets: string[]
    failed: boolean
    collateralisationRatio: BN
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
    addr: string
    status: BN | BassetStatus
    isTransferFeeCharged: boolean
    ratio: BN | string
    vaultBalance: BN
    pToken?: string
    integratorAddr?: string
    contract?: MockERC20
    integrator?: IPlatformIntegration
}

export const createBasket = (bassets: Basset[], failed = false): Basket => ({
    bassets,
    maxBassets: BN.from(16),
    expiredBassets: [],
    failed,
    collateralisationRatio: percentToWeight(100),
})

export const createBasset = (
    maxWeight: BN | number | string,
    vaultBalance: BN | number | string,
    decimals = 18,
    status = BassetStatus.Normal,
    isTransferFeeCharged = false,
): Basset => ({
    addr: ZERO_ADDRESS,
    isTransferFeeCharged,
    ratio: createMultiple(decimals).toString(),
    vaultBalance: simpleToExactAmount(vaultBalance, decimals),
    status,
})

export const equalBasset = (bAsset1: Basset, bAsset2: Basset): void => {
    expect(bAsset1.addr).to.equal(bAsset2.addr)
    expect(bAsset1.status).to.equal(bAsset2.status)
    expect(bAsset1.isTransferFeeCharged).to.equal(bAsset2.isTransferFeeCharged)
    expect(bAsset1.ratio).to.equal(bAsset2.ratio)
    expect(bAsset1.vaultBalance).to.equal(bAsset2.vaultBalance)
    return null
}

export const equalBassets = (bAssetArr1: Array<Basset>, bAssetArr2: Array<Basset>): void => {
    expect(bAssetArr1.length).to.equal(bAssetArr2.length)
    bAssetArr1.map((a, index) => {
        equalBasset(bAssetArr1[index], bAssetArr2[index])
        return null
    })
}

export const buildBasset = (
    _addr: string,
    _status: number,
    _isTransferFeeCharged: boolean,
    _ratio: BN,
    _maxWeight: BN,
    _vaultBalance: BN,
): Basset => ({
    addr: _addr,
    status: BN.from(_status),
    isTransferFeeCharged: _isTransferFeeCharged,
    ratio: _ratio,
    vaultBalance: _vaultBalance,
})

export const calculateRatio = (measureMultiple: BN, bAssetDecimals: BN): BN => {
    const delta = BN.from(18).sub(bAssetDecimals)
    return measureMultiple.mul(10).pow(delta)
}
