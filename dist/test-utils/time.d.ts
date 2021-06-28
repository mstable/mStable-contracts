import { BN } from "./math";
export declare const increaseTime: (length: BN | number) => Promise<void>;
export declare const getTimestamp: () => Promise<BN>;
export declare const sleep: (ms: number) => Promise<void>;
