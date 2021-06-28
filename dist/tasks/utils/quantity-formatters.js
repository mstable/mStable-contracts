"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.btcFormatter = exports.usdFormatter = void 0;
const utils_1 = require("ethers/lib/utils");
const usdFormatter = (amount, decimals = 18, pad = 14, displayDecimals = 2) => {
    const string2decimals = parseFloat(utils_1.formatUnits(amount, decimals)).toFixed(displayDecimals);
    // Add thousands separator
    return string2decimals.replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(pad);
};
exports.usdFormatter = usdFormatter;
const btcFormatter = (amount, decimals = 18, pad = 7, displayDecimals = 3) => {
    const string2decimals = parseFloat(utils_1.formatUnits(amount, decimals)).toFixed(displayDecimals);
    // Add thousands separator
    return string2decimals.replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(pad);
};
exports.btcFormatter = btcFormatter;
//# sourceMappingURL=quantity-formatters.js.map