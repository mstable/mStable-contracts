import { DEAD_ADDRESS } from "@utils/constants"
import { ethereumAddress } from "@utils/regex"

export enum Chain {
    mainnet,
    polygon,
    ropsten,
    mumbai,
}

export enum Platform {
    Compound,
    Aave,
}
export interface Token {
    symbol: string
    address: string
    chain: Chain
    platform?: Platform
    integrator?: string // Platform integration contract address
    liquidityProvider?: string // liquidity provider token address for Aave and Compound
    decimals: number
    quantityFormatter: string
    parent?: string
    feederPool?: string
    vault?: string
    savings?: string // interest-bearing savings contracts
    platformTokenVendor?: string // hold WMATIC on Polygon's v-imUSD vault
    bridgeForwarder?: string // Mainnet contract that forwards MTA rewards from the Emissions Controller to the L2 Bridge
    bridgeRecipient?: string // L2 contract that receives bridge MTA rewards from the L2 Bridge
    priceGetter?: string // Contract for price of asset, used for NonPeggedFeederPool
    gauge?: string // Curve or Balancer gauge for rewards
}

export function isToken(asset: unknown): asset is Token {
    const token = asset as Token
    return token.symbol !== undefined && token.address.match(ethereumAddress) && token.chain !== undefined && token.decimals !== undefined
}

export const assetAddressTypes = [
    "address",
    "savings",
    "vault",
    "feederPool",
    "integrator",
    "liquidityProvider",
    "platformTokenVendor",
    "bridgeForwarder",
    "bridgeRecipient",
    "gauge",
] as const
export type AssetAddressTypes = typeof assetAddressTypes[number]

// mStable on mainnet
export const mUSD: Token = {
    symbol: "mUSD",
    address: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
    savings: "0x30647a72dc82d7fbb1123ea74716ab8a317eac19",
    vault: "0x78BefCa7de27d07DC6e71da295Cc2946681A6c7B",
}
export const mBTC: Token = {
    symbol: "mBTC",
    address: "0x945Facb997494CC2570096c74b5F66A3507330a1",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
    savings: "0x17d8CBB6Bce8cEE970a4027d1198F6700A7a6c24",
    vault: "0xF38522f63f40f9Dd81aBAfD2B8EFc2EC958a3016",
}

// mStable on Polygon mainnet
export const PmUSD: Token = {
    symbol: "mUSD",
    address: "0xE840B73E5287865EEc17d250bFb1536704B43B21",
    integrator: "0xeab7831c96876433dB9B8953B4e7e8f66c3125c3",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
    savings: "0x5290Ad3d83476CA6A2b178Cd9727eE1EF72432af",
    vault: "0x32aBa856Dc5fFd5A56Bcd182b13380e5C855aa29",
    platformTokenVendor: "0x7b19a4f4ee26037ffef77bc7d99f56209acc8db1",
    bridgeForwarder: "0x7206A7eB2fe1B8a66D4d35db98d68Cadc890FAca",
    bridgeRecipient: "0xd3778a18Ee00a6368A0e5D545cB3412886e5a04c",
}
export const MmUSD: Token = {
    symbol: "mUSD",
    address: "0x0f7a5734f208A356AB2e5Cf3d02129c17028F3cf",
    chain: Chain.mumbai,
    decimals: 18,
    quantityFormatter: "USD",
    bridgeForwarder: "0x1dAdDae168636fE28b5eA34F1b3D4ea9367e8b6F",
    bridgeRecipient: DEAD_ADDRESS,
}
// Ropsten
export const RmUSD: Token = {
    symbol: "mUSD",
    address: "0x4E1000616990D83e56f4b5fC6CC8602DcfD20459",
    chain: Chain.ropsten,
    decimals: 18,
    quantityFormatter: "USD",
    savings: "0x5b7f01dAe6BCE656c9cA4175Eb3E406ADC6c7957",
    vault: "0xDEFc008BAC1e38F13F081DDD20acf89985DFa7C8",
}
export const RmBTC: Token = {
    symbol: "mBTC",
    address: "0x4A677A48A790f26eac4c97f495E537558Abf6A79",
    chain: Chain.ropsten,
    decimals: 18,
    quantityFormatter: "BTC",
    savings: "0xBfe31D984d688628d06Ae2Da1D640Cf5D9e242A5",
    vault: "0x7799BEEAf20120CC78f5cF2EB9C85e395B43bF4D",
}

// USD Main Pool Assets on Mainnet
export const sUSD: Token = {
    symbol: "sUSD",
    address: "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51",
    chain: Chain.mainnet,
    platform: Platform.Aave,
    integrator: "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E",
    liquidityProvider: "0x35f6B052C598d933D69A4EEC4D04c73A191fE6c2", // aSUSD
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const USDC: Token = {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    chain: Chain.mainnet,
    platform: Platform.Compound,
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735",
    liquidityProvider: "0x39aa39c021dfbae8fac545936693ac917d5e7563", // cUSDC
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const USDT: Token = {
    symbol: "USDT",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    chain: Chain.mainnet,
    platform: Platform.Aave,
    integrator: "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E",
    liquidityProvider: "0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811", // aUSDT
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const DAI: Token = {
    symbol: "DAI",
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    chain: Chain.mainnet,
    platform: Platform.Aave,
    integrator: "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E",
    liquidityProvider: "0x028171bCA77440897B824Ca71D1c56caC55b68A3", // aDAI
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}

// USD Main Pool Assets on Polygon
export const PUSDC: Token = {
    symbol: "USDC",
    address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    chain: Chain.polygon,
    platform: Platform.Aave,
    integrator: "0xeab7831c96876433dB9B8953B4e7e8f66c3125c3",
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}

export const PUSDT: Token = {
    symbol: "USDT",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    chain: Chain.polygon,
    platform: Platform.Aave,
    integrator: "0xeab7831c96876433dB9B8953B4e7e8f66c3125c3",
    decimals: 6,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const PDAI: Token = {
    symbol: "DAI",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    chain: Chain.polygon,
    platform: Platform.Aave,
    integrator: "0xeab7831c96876433dB9B8953B4e7e8f66c3125c3",
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}

// USD Feeder Pool Assets on Mainnet
export const GUSD: Token = {
    symbol: "GUSD",
    address: "0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd",
    chain: Chain.mainnet,
    platform: Platform.Aave,
    integrator: "0xd51f062104D7c8eE7dB100878A454451ADFD2811",
    liquidityProvider: "0xD37EE7e4f452C6638c96536e68090De8cBcdb583", // aGUSD
    decimals: 2,
    quantityFormatter: "USD",
    parent: "mUSD",
    feederPool: "0x4fB30C5A3aC8e85bC32785518633303C4590752d",
    vault: "0xAdeeDD3e5768F7882572Ad91065f93BA88343C99",
}
export const BUSD: Token = {
    symbol: "BUSD",
    address: "0x4Fabb145d64652a948d72533023f6E7A623C7C53",
    chain: Chain.mainnet,
    platform: Platform.Aave,
    integrator: "0xac98ffc901d6bB634be06f6d3fE63893b1aF6535",
    liquidityProvider: "0xA361718326c15715591c299427c62086F69923D9", // aBUSD
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
    feederPool: "0xfE842e95f8911dcc21c943a1dAA4bd641a1381c6",
    vault: "0xD124B55f70D374F58455c8AEdf308E52Cf2A6207",
}

// NonPeggedFeederPool contains priceGetter
export const RAI: Token = {
    symbol: "RAI",
    address: "0x03ab458634910aad20ef5f1c8ee96f1d6ac54919",
    chain: Chain.mainnet,
    platform: Platform.Aave,
    integrator: "0x8CC6A1aE38743d453F2522C5228B775D145f43B7",
    liquidityProvider: "0xc9BC48c72154ef3e5425641a3c747242112a46AF", // aRAI,
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
    feederPool: "0x36F944B7312EAc89381BD78326Df9C84691D8A5B",
    vault: "0xF93e0ddE0F7C48108abbD880DB7697A86169f13b",
    priceGetter: "0x07210B8871073228626AB79c296d9b22238f63cE",
}

// FLX token for RAI
export const FLX: Token = {
    symbol: "FLX",
    address: "0x6243d8cea23066d098a15582d81a598b4e8391f4",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// FEI Feeder Pool Asset on Mainnet
export const FEI: Token = {
    symbol: "FEI",
    address: "0x956F47F50A910163D8BF957Cf5846D573E7f87CA",
    chain: Chain.mainnet,
    platform: Platform.Aave,
    integrator: "0x4094aec22f40f11c29941d144c3dc887b33f5504",
    liquidityProvider: "0x683923dB55Fead99A79Fa01A27EeC3cB19679cC3", // aFEI
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
    feederPool: "0x2F1423D27f9B20058d9D1843E342726fDF985Eb4",
    vault: "0xD24099Eb4CD604198071958655E4f2D263a5539B",
}

// TRIBE token for FEI
export const TRIBE: Token = {
    symbol: "TRIBE",
    address: "0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// USD Feeder Pool Assets on Mainnet
export const FRAX: Token = {
    symbol: "FRAX",
    address: "0x853d955acef822db058eb8505911ed77f175b99e",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}
// USD Feeder Pool Assets on Polygon
export const PFRAX: Token = {
    symbol: "FRAX",
    address: "0x104592a158490a9228070E0A8e5343B499e125D0",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
    feederPool: "0xB30a907084AC8a0d25dDDAB4E364827406Fd09f0",
    bridgeForwarder: "0x38dD64B51C1808b04493324f334350eBB3AE8d11",
    bridgeRecipient: "0xc425Fd9Ed3C892d849C9E1a971516da1C1B29696",
}
export const MFRAX: Token = {
    symbol: "FRAX",
    address: "0x8F6F8064A0222F138d56C077a7F27009BDBBE3B1",
    chain: Chain.mumbai,
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}

// Alchemix
export const alUSD: Token = {
    symbol: "alUSD",
    address: "0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9",
    feederPool: "0x4eaa01974B6594C0Ee62fFd7FEE56CF11E6af936",
    integrator: "0xd658d5fDe0917CdC9b10cAadf10E20d942572a7B",
    vault: "0x0997dDdc038c8A958a3A3d00425C16f8ECa87deb",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
    parent: "mUSD",
}
export const ALCX: Token = {
    symbol: "ALCX",
    address: "0xdBdb4d16EdA451D0503b854CF79D55697F90c8DF",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// BTC
export const renBTC: Token = {
    symbol: "renBTC",
    address: "0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D",
    chain: Chain.mainnet,
    decimals: 8,
    quantityFormatter: "BTC",
    parent: "mBTC",
}
export const sBTC: Token = {
    symbol: "sBTC",
    address: "0xfE18be6b3Bd88A2D2A7f928d00292E7a9963CfC6",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "BTC",
    parent: "mBTC",
}
export const WBTC: Token = {
    symbol: "WBTC",
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    chain: Chain.mainnet,
    platform: Platform.Aave,
    integrator: "0xC9451a4483d1752a3E9A3f5D6b1C7A6c34621fC6",
    liquidityProvider: "0x9ff58f4fFB29fA2266Ab25e75e2A8b3503311656", // aWBTC
    decimals: 8,
    quantityFormatter: "BTC",
    parent: "mBTC",
}

// BTC Feeder Pool Assets
export const HBTC: Token = {
    symbol: "HBTC",
    address: "0x0316EB71485b0Ab14103307bf65a021042c6d380",
    chain: Chain.mainnet,
    decimals: 18,
    parent: "mBTC",
    quantityFormatter: "BTC",
    feederPool: "0x48c59199Da51B7E30Ea200a74Ea07974e62C4bA7",
    vault: "0xF65D53AA6e2E4A5f4F026e73cb3e22C22D75E35C",
}
export const TBTC: Token = {
    symbol: "TBTC",
    address: "0x8dAEBADE922dF735c38C80C7eBD708Af50815fAa",
    chain: Chain.mainnet,
    decimals: 18,
    parent: "mBTC",
    quantityFormatter: "BTC",
    feederPool: "0xb61A6F928B3f069A68469DDb670F20eEeB4921e0",
    vault: "0x760ea8CfDcC4e78d8b9cA3088ECD460246DC0731",
}

export const TBTCv2: Token = {
    symbol: "tBTCv2",
    address: "0x18084fbA666a33d37592fA2633fD49a74DD93a88",
    chain: Chain.mainnet,
    decimals: 18,
    parent: "mBTC",
    quantityFormatter: "BTC",
    feederPool: "0xc3280306b6218031E61752d060b091278d45c329",
    vault: "0x97E2a2F97A2E9a4cFB462a49Ab7c8D205aBB9ed9",
}

export const MTA: Token = {
    symbol: "MTA",
    address: "0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
    vault: "0x8f2326316eC696F6d023E37A9931c2b2C177a3D7", // MTA Staking V2
}

export const PMTA: Token = {
    symbol: "MTA",
    address: "0xF501dd45a1198C2E1b5aEF5314A68B9006D842E0",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
}

export const RMTA: Token = {
    symbol: "MTA",
    address: "0x273bc479E5C21CAA15aA8538DecBF310981d14C0",
    chain: Chain.ropsten,
    decimals: 18,
    quantityFormatter: "USD",
    vault: "0x4d8E465ba7FACa907E8A5F39649e056bB14802D1",
}

// Old MTA staking contract
// Was previously vault on MTA but that is now the MTA Staking V2 contract
export const vMTA: Token = {
    symbol: "vMTA",
    address: "0xaE8bC96DA4F9A9613c323478BE181FDb2Aa0E1BF",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const PWMATIC: Token = {
    symbol: "WMATIC",
    address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
}

export const AAVE: Token = {
    symbol: "AAVE",
    address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
    liquidityProvider: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
}
export const stkAAVE: Token = {
    symbol: "stkAAVE",
    address: "0x4da27a545c0c5B758a6BA100e3a049001de870f5",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const COMP: Token = {
    symbol: "COMP",
    address: "0xc00e94Cb662C3520282E6f5717214004A7f26888",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const CREAM: Token = {
    symbol: "CREAM",
    address: "0x2ba592f78db6436527729929aaf6c908497cb200",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const cyMUSD: Token = {
    symbol: "cyMUSD",
    address: "0xbe86e8918dfc7d3cb10d295fc220f941a1470c5c",
    chain: Chain.mainnet,
    decimals: 8,
    quantityFormatter: "USD",
}

export const BAL: Token = {
    symbol: "BAL",
    address: "0xba100000625a3754423978a60c9317c58a424e3D",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const PBAL: Token = {
    symbol: "BAL",
    address: "0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
    bridgeForwarder: "0x4e649Fa2f3C0Ff18b7695d1e1fa371a1999187Dc",
    // The L2BridgeRecipient contract on Polygon
    bridgeRecipient: "0x9A718E9B80F7D7006E891051ba4790C6fc839268",
}

export const RBAL: Token = {
    symbol: "BAL",
    address: "0x0Aa94D9Db9dA74Bb86A437E28EE4ecf22365843E",
    chain: Chain.ropsten,
    decimals: 18,
    quantityFormatter: "USD",
}

export const mBPT: Token = {
    symbol: "mBPT",
    address: "0xe2469f47aB58cf9CF59F9822e3C5De4950a41C49",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
    vault: "0xeFbe22085D9f29863Cfb77EEd16d3cC0D927b011",
    gauge: "0xbeC2d02008Dc64A6AD519471048CF3D3aF5ca0C5",
}

export const RmBPT: Token = {
    symbol: "mBPT",
    address: "0x021c343C6180f03cE9E48FaE3ff432309b9aF199",
    chain: Chain.ropsten,
    decimals: 18,
    quantityFormatter: "USD",
}

export const tokens = [
    AAVE,
    stkAAVE,
    COMP,
    MTA,
    PMTA,
    RMTA,
    vMTA,
    mUSD,
    mBTC,
    sUSD,
    USDC,
    USDT,
    DAI,
    GUSD,
    BUSD,
    RAI,
    FLX,
    FEI,
    TRIBE,
    renBTC,
    sBTC,
    WBTC,
    HBTC,
    TBTC,
    TBTCv2,
    alUSD,
    ALCX,
    PFRAX,
    PmUSD,
    PUSDC,
    PUSDT,
    PDAI,
    PWMATIC,
    RmUSD,
    RmBTC,
    MmUSD,
    MFRAX,
    mBPT,
    RmBPT,
    BAL,
    PBAL,
    RBAL,
]
