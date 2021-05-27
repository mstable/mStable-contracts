export interface Token {
    symbol: string
    address: string
    integrator?: string // Platform integration contract address
    liquidityProvider?: string // liquidity provider token address for Aave and Compound
    decimals: number
    quantityFormatter: string
    parent?: string
    feederPool?: string
    saving?: string
}

// mStable on mainnet
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

// mStable on Polygon mainnet
export const PmUSD: Token = {
    symbol: "mUSD",
    address: "0xE840B73E5287865EEc17d250bFb1536704B43B21",
    decimals: 18,
    quantityFormatter: "USD",
}

// USD Main Pool Assets on Mainnet
export const sUSD: Token = {
    symbol: "sUSD",
    address: "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51",
    integrator: "0xb9b0cfa90436c3fcbf8d8eb6ed8d0c2e3da47ca9", // Old Aave V2
    liquidityProvider: "0x35f6B052C598d933D69A4EEC4D04c73A191fE6c2", // aSUSD
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const USDC: Token = {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735", // Compound
    liquidityProvider: "0x39aa39c021dfbae8fac545936693ac917d5e7563", // cUSDC
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const USDT: Token = {
    symbol: "USDT",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    integrator: "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E", // Aave
    liquidityProvider: "0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811", // aUSDT
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const DAI: Token = {
    symbol: "DAI",
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    integrator: "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E", // Aave
    liquidityProvider: "0x028171bCA77440897B824Ca71D1c56caC55b68A3", // aDAI
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}

// USD Main Pool Assets on Mainnet
export const PUSDC: Token = {
    symbol: "USDC",
    address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    integrator: "0xeab7831c96876433dB9B8953B4e7e8f66c3125c3",
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const PUSDT: Token = {
    symbol: "USDT",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    integrator: "0xeab7831c96876433dB9B8953B4e7e8f66c3125c3",
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const PDAI: Token = {
    symbol: "DAI",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    integrator: "0xeab7831c96876433dB9B8953B4e7e8f66c3125c3",
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}

// USD Feeder Pool Assets
export const GUSD: Token = {
    symbol: "GUSD",
    address: "0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd",
    integrator: "0xd51f062104D7c8eE7dB100878A454451ADFD2811", // Aave
    decimals: 2,
    quantityFormatter: "USD",
    parent: "mUSD",
    feederPool: "0x4fB30C5A3aC8e85bC32785518633303C4590752d",
    saving: "0xAdeeDD3e5768F7882572Ad91065f93BA88343C99",
}
export const BUSD: Token = {
    symbol: "BUSD",
    address: "0x4Fabb145d64652a948d72533023f6E7A623C7C53",
    integrator: "0xac98ffc901d6bB634be06f6d3fE63893b1aF6535", // Aave
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
    feederPool: "0xfE842e95f8911dcc21c943a1dAA4bd641a1381c6",
    saving: "0xD124B55f70D374F58455c8AEdf308E52Cf2A6207",
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
    integrator: "0xC9451a4483d1752a3E9A3f5D6b1C7A6c34621fC6", // Aave
    liquidityProvider: "0x9ff58f4fFB29fA2266Ab25e75e2A8b3503311656", // aWBTC
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
    saving: "0xF65D53AA6e2E4A5f4F026e73cb3e22C22D75E35C",
}
export const TBTC: Token = {
    symbol: "TBTC",
    address: "0x8dAEBADE922dF735c38C80C7eBD708Af50815fAa",
    decimals: 18,
    parent: "mBTC",
    quantityFormatter: "BTC",
    feederPool: "0xb61A6F928B3f069A68469DDb670F20eEeB4921e0",
    saving: "0x760ea8CfDcC4e78d8b9cA3088ECD460246DC0731",
}

export const MTA: Token = {
    symbol: "MTA",
    address: "0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2",
    decimals: 18,
    quantityFormatter: "USD",
    saving: "0xaE8bC96DA4F9A9613c323478BE181FDb2Aa0E1BF",
}

export const aave: Token = {
    symbol: "Aave",
    address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    decimals: 18,
    quantityFormatter: "USD",
    liquidityProvider: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
}
export const stkAave: Token = {
    symbol: "stkAave",
    address: "0x4da27a545c0c5B758a6BA100e3a049001de870f5",
    decimals: 18,
    quantityFormatter: "USD",
}

export const COMP: Token = {
    symbol: "COMP",
    address: "0xc00e94Cb662C3520282E6f5717214004A7f26888",
    decimals: 18,
    quantityFormatter: "USD",
}

export const tokens = [mUSD, mBTC, sUSD, USDC, USDT, DAI, GUSD, BUSD, renBTC, sBTC, WBTC, HBTC, TBTC]
