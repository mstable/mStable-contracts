import parse from "csv-parse"
import fs from "fs"

interface MintData {
    bAssetIndex: string
    bAssetQty: string
    expectedQty: string
}

interface MintReserves {
    reserve0: string
    reserve1: string
    reserve2?: string
    reserve3?: string
    reserve4?: string
    mints: MintData[]
}

interface MultiMintData {
    bAssetQtys: string[]
    expectedQty: string
}

interface MultiMintReserves {
    reserve0: string
    reserve1: string
    reserve2?: string
    reserve3?: string
    reserve4?: string
    mints: MultiMintData[]
}

interface RedeemData {
    bAssetIndex: string
    mAssetQty: string
    expectedQty: string
}

interface RedeemReserves {
    reserve0: string
    reserve1: string
    reserve2?: string
    reserve3?: string
    reserve4?: string
    redeems: RedeemData[]
}

interface RedeemExactData {
    bAssetQtys: string[]
    expectedQty: string
}

interface RedeemExactReserves {
    reserve0: string
    reserve1: string
    reserve2?: string
    reserve3?: string
    reserve4?: string
    redeems: RedeemExactData[]
}

interface SwapData {
    inputIndex: string
    inputQty: string
    outputIndex: string
    outputQty: string
}

interface SwapReserves {
    reserve0: string
    reserve1: string
    reserve2?: string
    reserve3?: string
    reserve4?: string
    swaps: SwapData[]
}

const parseMintTestRecords = async (parser: parse.Parser): Promise<MintReserves[]> => {
    const mintReserves: MintReserves[] = []
    let previousMintReserve: MintReserves
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0") continue
        const mint: MintData = {
            bAssetIndex: record[3],
            bAssetQty: record[4],
            expectedQty: record[5],
        }
        // If the reserves are different from the last
        if (
            previousMintReserve?.reserve0 !== record[0] ||
            previousMintReserve?.reserve1 !== record[1] ||
            previousMintReserve?.reserve2 !== record[2]
        ) {
            previousMintReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                mints: [mint],
            }
            mintReserves.push(previousMintReserve)
        } else {
            // If the reserves are the save as the previous record
            previousMintReserve.mints.push(mint)
        }
    }
    return mintReserves
}

const parseMultiMintTestRecords = async (parser: parse.Parser): Promise<MultiMintReserves[]> => {
    const mintReserves: MultiMintReserves[] = []
    let previousMintReserve: MultiMintReserves
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0") continue
        const mint: MultiMintData = {
            bAssetQtys: [record[3], record[4], record[5]],
            expectedQty: record[7],
        }
        // If the reserves are different from the last
        if (
            previousMintReserve?.reserve0 !== record[0] ||
            previousMintReserve?.reserve1 !== record[1] ||
            previousMintReserve?.reserve2 !== record[2]
        ) {
            previousMintReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                mints: [mint],
            }
            mintReserves.push(previousMintReserve)
        } else {
            // If the reserves are the save as the previous record
            previousMintReserve.mints.push(mint)
        }
    }
    return mintReserves
}

const parseRedeemTestRecords = async (parser: parse.Parser): Promise<RedeemReserves[]> => {
    const redeemReserves: RedeemReserves[] = []
    let previousRedeemReserve: RedeemReserves
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0") continue
        const redeem: RedeemData = {
            bAssetIndex: record[3],
            mAssetQty: record[4],
            expectedQty: record[5],
        }
        // If the reserves are different from the last
        if (
            previousRedeemReserve?.reserve0 !== record[0] ||
            previousRedeemReserve?.reserve1 !== record[1] ||
            previousRedeemReserve?.reserve2 !== record[2]
        ) {
            previousRedeemReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                redeems: [redeem],
            }
            redeemReserves.push(previousRedeemReserve)
        } else {
            // If the reserves are the save as the previous record
            previousRedeemReserve.redeems.push(redeem)
        }
    }
    return redeemReserves
}

const parseRedeemExactTestRecords = async (parser: parse.Parser): Promise<RedeemExactReserves[]> => {
    const redeemReserves: RedeemExactReserves[] = []
    let previousRedeemReserve: RedeemExactReserves
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0") continue
        const mint: RedeemExactData = {
            bAssetQtys: [record[3], record[4], record[5]],
            expectedQty: record[7],
        }
        // If the reserves are different from the last
        if (
            previousRedeemReserve?.reserve0 !== record[0] ||
            previousRedeemReserve?.reserve1 !== record[1] ||
            previousRedeemReserve?.reserve2 !== record[2]
        ) {
            previousRedeemReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                redeems: [mint],
            }
            redeemReserves.push(previousRedeemReserve)
        } else {
            // If the reserves are the save as the previous record
            previousRedeemReserve.redeems.push(mint)
        }
    }
    return redeemReserves
}

const parseSwapTestRecords = async (parser: parse.Parser): Promise<SwapReserves[]> => {
    const swapReserves: SwapReserves[] = []
    let previousSwapReserve: SwapReserves
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0") continue
        const swap: SwapData = {
            inputIndex: record[3],
            inputQty: record[5],
            outputIndex: record[4],
            outputQty: record[6],
        }
        // If the reserves are different from the last
        if (
            previousSwapReserve?.reserve0 !== record[0] ||
            previousSwapReserve?.reserve1 !== record[1] ||
            previousSwapReserve?.reserve2 !== record[2]
        ) {
            previousSwapReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                swaps: [swap],
            }
            swapReserves.push(previousSwapReserve)
        } else {
            // If the reserves are the save as the previous record
            previousSwapReserve.swaps.push(swap)
        }
    }
    return swapReserves
}

const parseCsvFile = async <T>(testFilename: string, recordParser: (parser: parse.Parser) => Promise<T[]>): Promise<T[]> => {
    const parser: parse.Parser = fs.createReadStream(testFilename).pipe(parse())
    return recordParser(parser)
}

const main = async () => {
    const mintData = await parseCsvFile<MintReserves>("./mbtc_test_mint.csv", parseMintTestRecords)
    fs.writeFileSync("mintTestData.json", JSON.stringify(mintData))

    const multiMintData = await parseCsvFile<MultiMintReserves>("./mbtc_test_multi_mint.csv", parseMultiMintTestRecords)
    fs.writeFileSync("multiMintTestData.json", JSON.stringify(multiMintData))

    const redeemData = await parseCsvFile<RedeemReserves>("./mbtc_test_redeem.csv", parseRedeemTestRecords)
    fs.writeFileSync("redeemTestData.json", JSON.stringify(redeemData))

    const redeemExactData = await parseCsvFile<RedeemExactReserves>("./mbtc_test_multi_redeem.csv", parseRedeemExactTestRecords)
    fs.writeFileSync("redeemExactTestData.json", JSON.stringify(redeemExactData))

    const swapData = await parseCsvFile<SwapReserves>("./mbtc_test_swap.csv", parseSwapTestRecords)
    fs.writeFileSync("swapTestData.json", JSON.stringify(swapData))
}

main()
    .then()
    .catch((err) => console.error(err))
