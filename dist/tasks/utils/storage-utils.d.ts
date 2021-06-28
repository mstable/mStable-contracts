import { FeederPool, Masset } from "types/generated";
import { MusdEth } from "types/generated/MusdEth";
export declare const dumpTokenStorage: (token: Masset | MusdEth | FeederPool, toBlock: number) => Promise<void>;
export declare const dumpBassetStorage: (mAsset: Masset | MusdEth, toBlock: number) => Promise<void>;
export declare const dumpFassetStorage: (pool: FeederPool, toBlock: number) => Promise<void>;
export declare const dumpConfigStorage: (mAsset: Masset | MusdEth | FeederPool, toBlock: number) => Promise<void>;
export declare const dumpFeederDataStorage: (pool: FeederPool, toBlock: number) => Promise<void>;
