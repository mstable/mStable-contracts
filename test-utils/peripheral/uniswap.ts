export interface EncodedPaths {
    encoded: string
    encodedReversed: string
}
export const encodeUniswapPath = (tokenAddresses: string[], fees: number[]): EncodedPaths => {
    const FEE_SIZE = 3

    if (tokenAddresses.length !== fees.length + 1) {
        throw new Error("tokenAddresses/fees lengths do not match")
    }

    let encoded = "0x"
    let encodedReversed = ""
    fees.forEach((fee, i) => {
        // 20 byte hex encoding of the address
        const encodedAddress = tokenAddresses[i].slice(2)
        encoded += encodedAddress
        encodedReversed = encodedAddress + encodedReversed

        // 3 byte hex encoding of the fee
        const encodedFee = fees[i].toString(16).padStart(2 * FEE_SIZE, "0")
        encoded += encodedFee
        encodedReversed = encodedFee + encodedReversed
    })
    // encode the final token
    const finalAddress = tokenAddresses[tokenAddresses.length - 1].slice(2)
    encoded += finalAddress
    encodedReversed = `0x${finalAddress}${encodedReversed}`

    return {
        encoded: encoded.toLowerCase(),
        encodedReversed: encodedReversed.toLowerCase(),
    }
}
