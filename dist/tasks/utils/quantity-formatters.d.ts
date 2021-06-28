import { BN } from "@utils/math";
export declare type QuantityFormatter = (amount: BN, decimals?: number, pad?: number, displayDecimals?: number) => string;
export declare const usdFormatter: QuantityFormatter;
export declare const btcFormatter: QuantityFormatter;
