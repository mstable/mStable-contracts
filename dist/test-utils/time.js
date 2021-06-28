"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = exports.getTimestamp = exports.increaseTime = void 0;
const hardhat_1 = require("hardhat");
const math_1 = require("./math");
const increaseTime = async (length) => {
    await hardhat_1.ethers.provider.send("evm_increaseTime", [math_1.BN.from(length).toNumber()]);
    await hardhat_1.ethers.provider.send("evm_mine", []);
};
exports.increaseTime = increaseTime;
const getTimestamp = async () => math_1.BN.from((await hardhat_1.ethers.provider.getBlock(await hardhat_1.ethers.provider.getBlockNumber())).timestamp);
exports.getTimestamp = getTimestamp;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.sleep = sleep;
//# sourceMappingURL=time.js.map