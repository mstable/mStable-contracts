"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KovanAccounts = exports.RopstenAccounts = exports.MainnetAccounts = exports.KEY_LIQUIDATOR = exports.KEY_PROXY_ADMIN = exports.KEY_SAVINGS_MANAGER = exports.ONE_YEAR = exports.ONE_WEEK = exports.TEN_DAYS = exports.FIVE_DAYS = exports.ONE_DAY = exports.ONE_HOUR = exports.TEN_MINS = exports.ONE_MIN = exports.ZERO = exports.MIN_INT128 = exports.MAX_INT128 = exports.MAX_UINT256 = exports.ZERO_KEY = exports.ZERO_ADDRESS = exports.DEAD_ADDRESS = exports.fullScale = exports.ratioScale = void 0;
/* eslint-disable max-classes-per-file */
const ethers_1 = require("ethers");
/**
 * @notice This file contains constants relevant across the mStable test suite
 * Wherever possible, it should conform to fixed on chain vars
 */
exports.ratioScale = ethers_1.BigNumber.from(10).pow(8);
exports.fullScale = ethers_1.BigNumber.from(10).pow(18);
exports.DEAD_ADDRESS = "0x0000000000000000000000000000000000000001";
exports.ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
exports.ZERO_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000";
exports.MAX_UINT256 = ethers_1.BigNumber.from(2).pow(256).sub(1);
exports.MAX_INT128 = ethers_1.BigNumber.from(2).pow(127).sub(1);
exports.MIN_INT128 = ethers_1.BigNumber.from(2).pow(127).mul(-1);
exports.ZERO = ethers_1.BigNumber.from(0);
exports.ONE_MIN = ethers_1.BigNumber.from(60);
exports.TEN_MINS = ethers_1.BigNumber.from(60 * 10);
exports.ONE_HOUR = ethers_1.BigNumber.from(60 * 60);
exports.ONE_DAY = ethers_1.BigNumber.from(60 * 60 * 24);
exports.FIVE_DAYS = ethers_1.BigNumber.from(60 * 60 * 24 * 5);
exports.TEN_DAYS = ethers_1.BigNumber.from(60 * 60 * 24 * 10);
exports.ONE_WEEK = ethers_1.BigNumber.from(60 * 60 * 24 * 7);
exports.ONE_YEAR = ethers_1.BigNumber.from(60 * 60 * 24 * 365);
exports.KEY_SAVINGS_MANAGER = ethers_1.utils.keccak256(ethers_1.utils.toUtf8Bytes("SavingsManager"));
exports.KEY_PROXY_ADMIN = ethers_1.utils.keccak256(ethers_1.utils.toUtf8Bytes("ProxyAdmin"));
exports.KEY_LIQUIDATOR = ethers_1.utils.keccak256(ethers_1.utils.toUtf8Bytes("Liquidator"));
class MainnetAccounts {
    constructor() {
        // Exchange Accounts
        this.okex = "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b";
        this.binance = "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE";
        this.FUND_SOURCES = {
            dai: this.okex,
            usdc: this.binance,
            tusd: "0x3dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3",
            usdt: this.binance,
        };
        this.USDT_OWNER = "0xc6cde7c39eb2f0f0095f41570af89efc2c1ea828";
        this.COMP = "0xc00e94Cb662C3520282E6f5717214004A7f26888";
        // All Native Tokens
        this.DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
        this.TUSD = "0x0000000000085d4780B73119b644AE5ecd22b376";
        this.USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
        this.USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
        this.allNativeTokens = [this.DAI, this.TUSD, this.USDC, this.USDT];
        // AAVE
        this.aavePlatform = "0x24a42fD28C976A61Df5D00D0599C34c4f90748c8";
        this.aTUSD = "0x4DA9b813057D04BAef4e5800E36083717b4a0341";
        this.aUSDT = "0x71fc860F7D3A592A4a98740e39dB31d25db65ae8";
        this.allATokens = [this.aTUSD, this.aUSDT];
        // Compound cTokens
        this.cDAI = "0x5d3a536e4d6dbd6114cc1ead35777bab948e3643";
        this.cUSDC = "0x39aa39c021dfbae8fac545936693ac917d5e7563";
        this.allCTokens = [this.cDAI, this.cUSDC];
    }
}
exports.MainnetAccounts = MainnetAccounts;
class RopstenAccounts {
    constructor() {
        // All Native Tokens
        this.DAI = "0xb5e5d0f8c0cba267cd3d7035d6adc8eba7df7cdd";
        this.USDC = "0x8a9447df1fb47209d36204e6d56767a33bf20f9f";
        this.TUSD = "0xa2ea00df6d8594dbc76b79befe22db9043b8896f";
        this.USDT = "0xB404c51BBC10dcBE948077F18a4B8E553D160084";
        this.allNativeTokens = [this.DAI, this.TUSD, this.USDC, this.USDT];
        // AAVE
        this.aavePlatform = "0x1c8756FD2B28e9426CDBDcC7E3c4d64fa9A54728";
        this.aTUSD = "0x9265d51f5abf1e23be64418827859bc83ae70a57";
        this.aUSDT = "0x790744bC4257B4a0519a3C5649Ac1d16DDaFAE0D";
        this.allATokens = [this.aTUSD, this.aUSDT];
        // Compound cTokens
        this.cDAI = "0x6ce27497a64fffb5517aa4aee908b1e7eb63b9ff";
        this.cUSDC = "0x20572e4c090f15667cf7378e16fad2ea0e2f3eff";
        this.allCTokens = [this.cDAI, this.cUSDC];
    }
}
exports.RopstenAccounts = RopstenAccounts;
class KovanAccounts {
    constructor() {
        // All Native Tokens
        this.DAI = "0x4f96fe3b7a6cf9725f59d353f723c1bdb64ca6aa";
        this.USDC = "0xb7a4f3e9097c08da09517b5ab877f7a917224ede";
        this.TUSD = "0x1c4a937d171752e1313D70fb16Ae2ea02f86303e";
        this.USDT = "0x13512979ade267ab5100878e2e0f485b568328a4";
        this.allNativeTokens = [this.DAI, this.TUSD, this.USDC, this.USDT];
        // AAVE
        this.aavePlatform = "0x506B0B2CF20FAA8f38a4E2B524EE43e1f4458Cc5";
        this.aTUSD = "0xA79383e0d2925527ba5Ec1c1bcaA13c28EE00314";
        this.aUSDT = "0xA01bA9fB493b851F4Ac5093A324CB081A909C34B";
        this.allATokens = [this.aTUSD, this.aUSDT];
        // Compound cTokens
        this.cDAI = "0xf0d0eb522cfa50b716b3b1604c4f0fa6f04376ad";
        this.cUSDC = "0x4a92e71227d294f041bd82dd8f78591b75140d63";
        this.allCTokens = [this.cDAI, this.cUSDC];
    }
}
exports.KovanAccounts = KovanAccounts;
//# sourceMappingURL=constants.js.map