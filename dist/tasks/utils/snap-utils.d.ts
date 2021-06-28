import { Signer } from "ethers";
import { BN } from "@utils/math";
import { ExposedMassetLogic, FeederPool, Masset, MV1, MV2, SavingsManager } from "types/generated";
import { MusdEth } from "types/generated/MusdEth";
import { QuantityFormatter } from "./quantity-formatters";
import { Token } from "./tokens";
export interface TxSummary {
    count: number;
    total: BN;
    fees: BN;
}
export interface Balances {
    total: BN;
    save: BN;
    earn: BN;
}
export interface BlockInfo {
    blockNumber: number;
    blockTime: Date;
}
export interface BlockRange {
    fromBlock: BlockInfo;
    toBlock: BlockInfo;
}
export interface SwapRate {
    inputToken: Token;
    inputAmountRaw: BN;
    outputToken: Token;
    mOutputRaw: BN;
    curveOutputRaw: BN;
    curveInverseOutputRaw: BN;
}
export declare function isFeederPool(asset: Masset | MV1 | MV2 | MusdEth | FeederPool): asset is FeederPool;
export declare function isMusdEth(asset: Masset | MV1 | MV2 | MusdEth | FeederPool): asset is MusdEth;
export declare const getBlock: (ethers: any, _blockNumber?: number) => Promise<BlockInfo>;
export declare const getBlockRange: (ethers: any, fromBlockNumber: number, _toBlockNumber?: number) => Promise<BlockRange>;
export declare const getSavingsManager: (signer: Signer, networkName: string) => SavingsManager;
export declare const snapConfig: (asset: Masset | MusdEth | FeederPool, toBlock: number) => Promise<void>;
export declare const snapSave: (signer: Signer, networkName: string, toBlock: number) => Promise<void>;
export interface TvlConfig {
    startingCap: BN;
    capFactor: BN;
    invariantValidatorAddress: string;
}
export declare const getBasket: (asset: Masset | MV1 | MV2 | MusdEth | FeederPool, bAssetSymbols: string[], mAssetName: string, quantityFormatter: QuantityFormatter, toBlock: number, tvlConfig?: TvlConfig, exposedLogic?: ExposedMassetLogic) => Promise<void>;
export declare const getBalances: (mAsset: Masset | MusdEth, accounts: {
    name: string;
    address: string;
}[], quantityFormatter: QuantityFormatter, toBlock: number) => Promise<Balances>;
export declare const getMints: (bAssets: Token[], mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool, fromBlock: number, toBlock: number, quantityFormatter: QuantityFormatter) => Promise<TxSummary>;
export declare const getMultiMints: (bAssets: Token[], mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool, fromBlock: number, toBlock: number, quantityFormatter: QuantityFormatter) => Promise<TxSummary>;
export declare const getSwaps: (bAssets: Token[], mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool, fromBlock: number, toBlock: number, quantityFormatter: QuantityFormatter) => Promise<TxSummary>;
export declare const getRedemptions: (bAssets: Token[], mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool, fromBlock: number, toBlock: number, quantityFormatter: QuantityFormatter) => Promise<TxSummary>;
export declare const getMultiRedemptions: (bAssets: Token[], mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool, fromBlock: number, toBlock: number, quantityFormatter: QuantityFormatter) => Promise<TxSummary>;
export declare const calcApy: (startTime: Date, endTime: Date, quantity: BN, saveBalance: BN) => BN;
export declare const outputFees: (mints: TxSummary, multiMints: TxSummary, swaps: TxSummary, redeems: TxSummary, multiRedeems: TxSummary, balances: Balances, startTime: Date, endTime: Date, quantityFormatter: QuantityFormatter) => void;
export declare const getLiquidatorInterest: (mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool, savingsManager: SavingsManager, fromBlock: BlockInfo, toBlock: BlockInfo, quantityFormatter: QuantityFormatter) => Promise<{
    total: BN;
    count: number;
}>;
export declare const getCollectedInterest: (bAssets: Token[], mAsset: Masset | MV1 | MV2 | MusdEth | FeederPool, savingsManager: SavingsManager, fromBlock: BlockInfo, toBlock: BlockInfo, quantityFormatter: QuantityFormatter, savingsBalance: BN) => Promise<TxSummary>;
export declare const quoteSwap: (signer: Signer, from: Token, to: Token, inAmount: BN, toBlock: BlockInfo, fee?: number) => Promise<{
    outAmount: BN;
    exchangeRate: BN;
}>;
export declare const getCompTokens: (signer: Signer, toBlock: BlockInfo, quantityFormatter?: QuantityFormatter) => Promise<void>;
export declare const getAaveTokens: (signer: Signer, toBlock: BlockInfo, quantityFormatter?: QuantityFormatter) => Promise<void>;
