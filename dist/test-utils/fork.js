"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.impersonateAccount = exports.impersonate = void 0;
const hardhat_1 = require("hardhat");
// impersonates a specific account
const impersonate = async (addr) => {
    await hardhat_1.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    });
    return hardhat_1.ethers.provider.getSigner(addr);
};
exports.impersonate = impersonate;
const impersonateAccount = async (address) => {
    await hardhat_1.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [address],
    });
    const signer = hardhat_1.ethers.provider.getSigner(address);
    return {
        signer,
        address,
    };
};
exports.impersonateAccount = impersonateAccount;
//# sourceMappingURL=fork.js.map