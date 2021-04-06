import { BN } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"

export type QuantityFormatter = (amount: BN, decimals?: number, pad?: number, displayDecimals?: number) => string

export const usdFormatter: QuantityFormatter = (amount: BN, decimals = 18, pad = 14, displayDecimals = 2): string => {
    const string2decimals = parseFloat(formatUnits(amount, decimals)).toFixed(displayDecimals)
    // Add thousands separator
    return string2decimals.replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(pad)
}

export const btcFormatter: QuantityFormatter = (amount: BN, decimals = 18, pad = 7, displayDecimals = 3): string => {
    const string2decimals = parseFloat(formatUnits(amount, decimals)).toFixed(displayDecimals)
    // Add thousands separator
    return string2decimals.replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(pad)
}
