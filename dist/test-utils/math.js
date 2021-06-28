"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.minimum = exports.createMultiple = exports.applyRatioCeil = exports.applyRatio = exports.applyRatioMassetToBasset = exports.percentToWeight = exports.applyDecimals = exports.simpleToExactAmount = exports.BN = void 0;
const ethers_1 = require("ethers");
Object.defineProperty(exports, "BN", { enumerable: true, get: function () { return ethers_1.BigNumber; } });
const constants_1 = require("./constants");
// Converts an unscaled number to scaled number with the specified number of decimals
// eg convert 3 to 3000000000000000000 with 18 decimals
const simpleToExactAmount = (amount, decimals = 18) => {
    // Code is largely lifted from the guts of web3 toWei here:
    // https://github.com/ethjs/ethjs-unit/blob/master/src/index.js
    let amountString = amount.toString();
    const decimalsBN = ethers_1.BigNumber.from(decimals);
    if (decimalsBN.gt(100)) {
        throw new Error(`Invalid decimals amount`);
    }
    const scale = ethers_1.BigNumber.from(10).pow(decimals);
    const scaleString = scale.toString();
    // Is it negative?
    const negative = amountString.substring(0, 1) === "-";
    if (negative) {
        amountString = amountString.substring(1);
    }
    if (amountString === ".") {
        throw new Error(`Error converting number ${amountString} to precise unit, invalid value`);
    }
    // Split it into a whole and fractional part
    // eslint-disable-next-line prefer-const
    let [whole, fraction, ...rest] = amountString.split(".");
    if (rest.length > 0) {
        throw new Error(`Error converting number ${amountString} to precise unit, too many decimal points`);
    }
    if (!whole) {
        whole = "0";
    }
    if (!fraction) {
        fraction = "0";
    }
    if (fraction.length > scaleString.length - 1) {
        throw new Error(`Error converting number ${amountString} to precise unit, too many decimal places`);
    }
    while (fraction.length < scaleString.length - 1) {
        fraction += "0";
    }
    const wholeBN = ethers_1.BigNumber.from(whole);
    const fractionBN = ethers_1.BigNumber.from(fraction);
    let result = wholeBN.mul(scale).add(fractionBN);
    if (negative) {
        result = result.mul("-1");
    }
    return result;
};
exports.simpleToExactAmount = simpleToExactAmount;
// How many mAssets is this bAsset worth using bAsset decimal length
// eg convert 3679485 with 6 decimals (3.679485) to 3679485000000000000 with 18 decimals
const applyDecimals = (inputQuantity, decimals = 18) => ethers_1.BigNumber.from(10)
    .pow(18 - decimals)
    .mul(inputQuantity);
exports.applyDecimals = applyDecimals;
const percentToWeight = (percent) => {
    return exports.simpleToExactAmount(percent, 16);
};
exports.percentToWeight = percentToWeight;
// How many bAssets is this mAsset worth
const applyRatioMassetToBasset = (input, ratio) => {
    return input.mul(constants_1.ratioScale).div(ratio);
};
exports.applyRatioMassetToBasset = applyRatioMassetToBasset;
// How many mAssets is this bAsset worth
const applyRatio = (bAssetQ, ratio) => {
    return ethers_1.BigNumber.from(bAssetQ).mul(ratio).div(constants_1.ratioScale);
};
exports.applyRatio = applyRatio;
// How many mAssets is this bAsset worth
const applyRatioCeil = (bAssetQ, ratio) => {
    const scaled = ethers_1.BigNumber.from(bAssetQ).mul(ratio);
    const ceil = ethers_1.BigNumber.from(scaled).add(constants_1.ratioScale.sub(1));
    return ceil.div(constants_1.ratioScale);
};
exports.applyRatioCeil = applyRatioCeil;
const createMultiple = (decimals) => {
    const ratio = ethers_1.BigNumber.from(10).pow(18 - decimals);
    return ethers_1.BigNumber.from(ratio).mul(constants_1.ratioScale);
};
exports.createMultiple = createMultiple;
// Returns the smaller number
const minimum = (a, b) => (a.lte(b) ? a : b);
exports.minimum = minimum;
//# sourceMappingURL=math.js.map