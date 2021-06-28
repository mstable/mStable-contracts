import { BigNumber as BN } from "ethers";
import { Address } from "../types/common";
/**
 * @notice This file contains constants relevant across the mStable test suite
 * Wherever possible, it should conform to fixed on chain vars
 */
export declare const ratioScale: BN;
export declare const fullScale: BN;
export declare const DEAD_ADDRESS = "0x0000000000000000000000000000000000000001";
export declare const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export declare const ZERO_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000";
export declare const MAX_UINT256: BN;
export declare const MAX_INT128: BN;
export declare const MIN_INT128: BN;
export declare const ZERO: BN;
export declare const ONE_MIN: BN;
export declare const TEN_MINS: BN;
export declare const ONE_HOUR: BN;
export declare const ONE_DAY: BN;
export declare const FIVE_DAYS: BN;
export declare const TEN_DAYS: BN;
export declare const ONE_WEEK: BN;
export declare const ONE_YEAR: BN;
export declare const KEY_SAVINGS_MANAGER: string;
export declare const KEY_PROXY_ADMIN: string;
export declare const KEY_LIQUIDATOR: string;
export declare class MainnetAccounts {
    private okex;
    private binance;
    FUND_SOURCES: {
        dai: string;
        usdc: string;
        tusd: string;
        usdt: string;
    };
    USDT_OWNER: Address;
    COMP: Address;
    DAI: Address;
    TUSD: Address;
    USDC: Address;
    USDT: Address;
    allNativeTokens: Address[];
    aavePlatform: Address;
    aTUSD: Address;
    aUSDT: Address;
    allATokens: Address[];
    cDAI: Address;
    cUSDC: Address;
    allCTokens: Address[];
}
export declare class RopstenAccounts {
    DAI: Address;
    USDC: Address;
    TUSD: Address;
    USDT: Address;
    allNativeTokens: Address[];
    aavePlatform: Address;
    aTUSD: Address;
    aUSDT: Address;
    allATokens: Address[];
    cDAI: Address;
    cUSDC: Address;
    allCTokens: Address[];
}
export declare class KovanAccounts {
    DAI: Address;
    USDC: Address;
    TUSD: Address;
    USDT: Address;
    allNativeTokens: Address[];
    aavePlatform: Address;
    aTUSD: Address;
    aUSDT: Address;
    allATokens: Address[];
    cDAI: Address;
    cUSDC: Address;
    allCTokens: Address[];
}
