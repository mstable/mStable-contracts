export interface EncodedPaths {
    encoded: string;
    encodedReversed: string;
}
export declare const encodeUniswapPath: (tokenAddresses: string[], fees: number[]) => EncodedPaths;
