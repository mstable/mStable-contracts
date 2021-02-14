import { ZERO_ADDRESS } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { ERC20 } from "types/generated"

export const config = {
    a: 120,
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(75, 16),
    },
}
export const startingCap = simpleToExactAmount(9, 18) // 9 (9 BTC = 405,000)
export const capFactor = simpleToExactAmount(20, 18) // 20 (20 BTC = 900,000)

export const mBtcName = "mStable BTC"
export const mBtcSymbol = "mBTC"

export interface Bassets {
    name: string
    symbol: string
    decimals: number
    integrator: string
    txFee: boolean
    initialMint: number
}

export interface DeployedBasset {
    integrator: string
    txFee: boolean
    contract: ERC20
    symbol: string
}

export const btcBassets: Bassets[] = [
    {
        name: "Ren BTC",
        symbol: "renBTC",
        decimals: 8,
        integrator: ZERO_ADDRESS,
        txFee: false,
        initialMint: 11000,
    },
    {
        name: "Synthetix BTC",
        symbol: "sBTC",
        decimals: 18,
        integrator: ZERO_ADDRESS,
        txFee: false,
        initialMint: 3500,
    },
    {
        name: "Wrapped BTC",
        symbol: "WBTC",
        decimals: 8,
        integrator: ZERO_ADDRESS,
        txFee: false,
        initialMint: 43000,
    },
]

export const contracts = {
    mainnet: {
        // BTC tokens
        renBTC: "0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D",
        sBTC: "0xfE18be6b3Bd88A2D2A7f928d00292E7a9963CfC6",
        WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",

        // mBTC contracts
        mBTC: "0x945Facb997494CC2570096c74b5F66A3507330a1",
        imBTC: "0x17d8CBB6Bce8cEE970a4027d1198F6700A7a6c24",
        Manager: "0x1E91F826fa8aA4fa4D3F595898AF3A64dd188848",
        InvariantValidator: "0xd36050B5F28126b5292B59128ED25E489a0f2F3f",

        // Sushi
        sushiPool: "0xf5A434FbAA1C00b33Ea141122603C43dE86cc9FE",

        fundManager: "0xD8baE7d96df905E46718B6ceE3410F535e11bF20",
    },
    ropsten: {
        // BTC tokens
        renBTC: "0xf297a737f46f78cc07b810E544bB0f282C53a4a1",
        sBTC: "0x4F85915Ef4409b953aAa70cC0169Cb48fC909C4d",
        WBTC: "0x6f19A562A32EC6d6404BeaA8C218C425cA73c451",

        // mBTC contracts
        mBTC: "0x4A677A48A790f26eac4c97f495E537558Abf6A79",
        imBTC: "0xBfe31D984d688628d06Ae2Da1D640Cf5D9e242A5",
    },
}

export const getBassetFromAddress = (address: string, network = "mainnet"): Bassets => {
    const contract = Object.entries(contracts[network]).find((c) => c[1] === address)
    if (!contract) return undefined
    const symbol = contract[0]
    return btcBassets.find((btcBasset) => btcBasset.symbol === symbol)
}
