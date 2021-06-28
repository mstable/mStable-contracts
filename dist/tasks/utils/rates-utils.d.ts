import { BN } from "@utils/math";
import { FeederPool, Masset } from "types/generated";
import { MusdEth } from "types/generated/MusdEth";
import { QuantityFormatter } from "./quantity-formatters";
import { Token } from "./tokens";
export interface Balances {
    total: BN;
    save: BN;
    earn: BN;
}
export interface BlockInfo {
    fromBlockNumber: number;
    toBlockNumber: number;
    startTime: Date;
    endTime: Date;
}
export interface SwapRate {
    inputToken: Token;
    inputAmountRaw: BN;
    inputDisplay: string;
    outputToken: Token;
    mOutputRaw: BN;
    curveOutputRaw: BN;
    curveInverseOutputRaw: BN;
}
export declare const outputSwapRate: (swap: SwapRate, quantityFormatter: QuantityFormatter) => void;
export declare const getSwapRates: (inputTokens: Token[], outputTokens: Token[], mAsset: Masset | MusdEth | FeederPool, toBlock: number, quantityFormatter: QuantityFormatter, networkName: string, inputAmount?: BN | number | string) => Promise<SwapRate[]>;
