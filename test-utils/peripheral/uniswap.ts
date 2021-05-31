export const encodeUniswapPath = (tokenAddresses: string[], fees: number[]): string => {
    const FEE_SIZE = 3

    if (tokenAddresses.length !== fees.length + 1) {
        throw new Error("tokenAddresses/fees lengths do not match")
    }

    let encoded = "0x"
    fees.forEach((fee, i) => {
        // 20 byte hex encoding of the address
        encoded += tokenAddresses[i].slice(2)
        // 3 byte hex encoding of the fee
        encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, "0")
    })
    // encode the final token
    encoded += tokenAddresses[tokenAddresses.length - 1].slice(2)

    return encoded.toLowerCase()
}
