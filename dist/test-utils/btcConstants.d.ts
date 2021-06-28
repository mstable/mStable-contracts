import { ERC20 } from "types/generated";
export declare const config: {
    a: number;
    limits: {
        min: import("@utils/math").BN;
        max: import("@utils/math").BN;
    };
};
export declare const startingCap: import("@utils/math").BN;
export declare const capFactor: import("@utils/math").BN;
export declare const mBtcName = "mStable BTC";
export declare const mBtcSymbol = "mBTC";
export interface Bassets {
    name: string;
    symbol: string;
    decimals: number;
    integrator: string;
    txFee: boolean;
    initialMint: number;
}
export interface DeployedBasset {
    integrator: string;
    txFee: boolean;
    contract: ERC20;
    symbol: string;
}
export declare const btcBassets: Bassets[];
export declare const contracts: {
    mainnet: {
        renBTC: string;
        sBTC: string;
        WBTC: string;
        mBTC: string;
        imBTC: string;
        Manager: string;
        InvariantValidator: string;
        sushiPool: string;
        fundManager: string;
    };
    ropsten: {
        renBTC: string;
        sBTC: string;
        WBTC: string;
        mBTC: string;
        imBTC: string;
    };
};
export declare const getBassetFromAddress: (address: string, network?: string) => Bassets;
