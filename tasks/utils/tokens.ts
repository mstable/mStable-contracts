export interface Token {
    symbol: string
    address: string
    integrator?: string
    decimals: number
    quantityFormatter: string
    parent?: string
    feederPool?: string
}

// mStable
export const mUSD: Token = {
    symbol: "mUSD",
    address: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
    decimals: 18,
    quantityFormatter: "USD",
}
export const mBTC: Token = {
    symbol: "mBTC",
    address: "0x945Facb997494CC2570096c74b5F66A3507330a1",
    decimals: 18,
    quantityFormatter: "USD",
}

// USD Main Pool Assets
export const sUSD: Token = {
    symbol: "sUSD",
    address: "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51",
    integrator: "0xb9b0cfa90436c3fcbf8d8eb6ed8d0c2e3da47ca9",
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const USDC: Token = {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735",
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const USDT: Token = {
    symbol: "USDT",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39",
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const DAI: Token = {
    symbol: "DAI",
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735",
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}

// USD Feeder Pool Assets
export const GUSD: Token = {
    symbol: "GUSD",
    address: "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd",
    integrator: "0x85306936842Eb09D9Cea45BffAEc7A81D126508D",
    decimals: 2,
    quantityFormatter: "USD",
    parent: "mUSD",
    feederPool: "0x4fB30C5A3aC8e85bC32785518633303C4590752d",
}
export const BUSD: Token = {
    symbol: "BUSD",
    address: "0x4Fabb145d64652a948d72533023f6E7A623C7C53",
    integrator: "0x875d56e691A4c85b32E13d6aC846f6A84Bc57384",
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
    feederPool: "0xfE842e95f8911dcc21c943a1dAA4bd641a1381c6",
}

// BTC
export const renBTC: Token = {
    symbol: "renBTC",
    address: "0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D",
    decimals: 8,
    quantityFormatter: "BTC",
    parent: "mBTC",
}
export const sBTC: Token = {
    symbol: "sBTC",
    address: "0xfE18be6b3Bd88A2D2A7f928d00292E7a9963CfC6",
    decimals: 18,
    quantityFormatter: "BTC",
    parent: "mBTC",
}
export const WBTC: Token = {
    symbol: "WBTC",
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    decimals: 8,
    quantityFormatter: "BTC",
    parent: "mBTC",
}

// BTC Feeder Pool Assets
export const HBTC: Token = {
    symbol: "HBTC",
    address: "0x0316EB71485b0Ab14103307bf65a021042c6d380",
    decimals: 18,
    parent: "mBTC",
    quantityFormatter: "BTC",
    feederPool: "0x48c59199Da51B7E30Ea200a74Ea07974e62C4bA7",
}
export const TBTC: Token = {
    symbol: "TBTC",
    address: "0x8dAEBADE922dF735c38C80C7eBD708Af50815fAa",
    decimals: 18,
    parent: "mBTC",
    quantityFormatter: "BTC",
    feederPool: "0xb61A6F928B3f069A68469DDb670F20eEeB4921e0",
}

export const tokens = [mUSD, mBTC, sUSD, USDC, USDT, DAI, GUSD, BUSD, renBTC, sBTC, WBTC, HBTC, TBTC]
