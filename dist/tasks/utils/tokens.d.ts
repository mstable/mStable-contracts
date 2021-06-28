export declare enum Chain {
    mainnet = 0,
    polygon = 1
}
export declare enum Platform {
    Compound = 0,
    Aave = 1
}
export interface Token {
    symbol: string;
    address: string;
    chain: Chain;
    platform?: Platform;
    integrator?: string;
    liquidityProvider?: string;
    decimals: number;
    quantityFormatter: string;
    parent?: string;
    feederPool?: string;
    vault?: string;
    savings?: string;
}
export declare const mUSD: Token;
export declare const mBTC: Token;
export declare const PmUSD: Token;
export declare const sUSD: Token;
export declare const USDC: Token;
export declare const USDT: Token;
export declare const DAI: Token;
export declare const PUSDC: Token;
export declare const PUSDT: Token;
export declare const PDAI: Token;
export declare const GUSD: Token;
export declare const BUSD: Token;
export declare const renBTC: Token;
export declare const sBTC: Token;
export declare const WBTC: Token;
export declare const HBTC: Token;
export declare const TBTC: Token;
export declare const MTA: Token;
export declare const AAVE: Token;
export declare const stkAAVE: Token;
export declare const COMP: Token;
export declare const CREAM: Token;
export declare const cyMUSD: Token;
export declare const tokens: Token[];
