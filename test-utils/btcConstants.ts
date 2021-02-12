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
        decimals: 18,
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
        symbol: "wBTC",
        decimals: 18,
        integrator: ZERO_ADDRESS,
        txFee: false,
        initialMint: 43000,
    },
]
