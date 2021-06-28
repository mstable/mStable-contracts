"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateRatio = exports.buildBasset = exports.equalBassets = exports.equalBasset = exports.createBasset = exports.createBasket = exports.BassetStatus = void 0;
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const constants_1 = require("./constants");
var BassetStatus;
(function (BassetStatus) {
    BassetStatus[BassetStatus["Default"] = 0] = "Default";
    BassetStatus[BassetStatus["Normal"] = 1] = "Normal";
    BassetStatus[BassetStatus["BrokenBelowPeg"] = 2] = "BrokenBelowPeg";
    BassetStatus[BassetStatus["BrokenAbovePeg"] = 3] = "BrokenAbovePeg";
    BassetStatus[BassetStatus["Blacklisted"] = 4] = "Blacklisted";
    BassetStatus[BassetStatus["Liquidating"] = 5] = "Liquidating";
    BassetStatus[BassetStatus["Liquidated"] = 6] = "Liquidated";
    BassetStatus[BassetStatus["Failed"] = 7] = "Failed";
})(BassetStatus = exports.BassetStatus || (exports.BassetStatus = {}));
const createBasket = (bassets, failed = false) => ({
    bassets,
    maxBassets: math_1.BN.from(16),
    expiredBassets: [],
    failed,
    collateralisationRatio: math_1.percentToWeight(100),
});
exports.createBasket = createBasket;
const createBasset = (maxWeight, vaultBalance, decimals = 18, status = BassetStatus.Normal, isTransferFeeCharged = false) => ({
    addr: constants_1.ZERO_ADDRESS,
    isTransferFeeCharged,
    ratio: math_1.createMultiple(decimals).toString(),
    vaultBalance: math_1.simpleToExactAmount(vaultBalance, decimals),
    status,
});
exports.createBasset = createBasset;
const equalBasset = (bAsset1, bAsset2) => {
    chai_1.expect(bAsset1.addr).to.equal(bAsset2.addr);
    chai_1.expect(bAsset1.status).to.equal(bAsset2.status);
    chai_1.expect(bAsset1.isTransferFeeCharged).to.equal(bAsset2.isTransferFeeCharged);
    chai_1.expect(bAsset1.ratio).to.equal(bAsset2.ratio);
    chai_1.expect(bAsset1.vaultBalance).to.equal(bAsset2.vaultBalance);
    return null;
};
exports.equalBasset = equalBasset;
const equalBassets = (bAssetArr1, bAssetArr2) => {
    chai_1.expect(bAssetArr1.length).to.equal(bAssetArr2.length);
    bAssetArr1.map((a, index) => {
        exports.equalBasset(bAssetArr1[index], bAssetArr2[index]);
        return null;
    });
};
exports.equalBassets = equalBassets;
const buildBasset = (_addr, _status, _isTransferFeeCharged, _ratio, _maxWeight, _vaultBalance) => ({
    addr: _addr,
    status: math_1.BN.from(_status),
    isTransferFeeCharged: _isTransferFeeCharged,
    ratio: _ratio,
    vaultBalance: _vaultBalance,
});
exports.buildBasset = buildBasset;
const calculateRatio = (measureMultiple, bAssetDecimals) => {
    const delta = math_1.BN.from(18).sub(bAssetDecimals);
    return measureMultiple.mul(10).pow(delta);
};
exports.calculateRatio = calculateRatio;
//# sourceMappingURL=mstable-objects.js.map