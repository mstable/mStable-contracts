"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const csv_parse_1 = __importDefault(require("csv-parse"));
const fs_1 = __importDefault(require("fs"));
const parseMintTestRecords = async (parser) => {
    const mintReserves = [];
    let previousMintReserve;
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0")
            continue;
        const mint = {
            bAssetIndex: record[3],
            bAssetQty: record[4],
            expectedQty: record[5],
        };
        // If the reserves are different from the last
        if ((previousMintReserve === null || previousMintReserve === void 0 ? void 0 : previousMintReserve.reserve0) !== record[0] ||
            (previousMintReserve === null || previousMintReserve === void 0 ? void 0 : previousMintReserve.reserve1) !== record[1] ||
            (previousMintReserve === null || previousMintReserve === void 0 ? void 0 : previousMintReserve.reserve2) !== record[2]) {
            previousMintReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                mints: [mint],
            };
            mintReserves.push(previousMintReserve);
        }
        else {
            // If the reserves are the save as the previous record
            previousMintReserve.mints.push(mint);
        }
    }
    return mintReserves;
};
const parseMultiMintTestRecords = async (parser) => {
    const mintReserves = [];
    let previousMintReserve;
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0")
            continue;
        const mint = {
            bAssetQtys: [record[3], record[4], record[5]],
            expectedQty: record[7],
        };
        // If the reserves are different from the last
        if ((previousMintReserve === null || previousMintReserve === void 0 ? void 0 : previousMintReserve.reserve0) !== record[0] ||
            (previousMintReserve === null || previousMintReserve === void 0 ? void 0 : previousMintReserve.reserve1) !== record[1] ||
            (previousMintReserve === null || previousMintReserve === void 0 ? void 0 : previousMintReserve.reserve2) !== record[2]) {
            previousMintReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                mints: [mint],
            };
            mintReserves.push(previousMintReserve);
        }
        else {
            // If the reserves are the save as the previous record
            previousMintReserve.mints.push(mint);
        }
    }
    return mintReserves;
};
const parseRedeemTestRecords = async (parser) => {
    const redeemReserves = [];
    let previousRedeemReserve;
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0")
            continue;
        const redeem = {
            bAssetIndex: record[3],
            mAssetQty: record[4],
            expectedQty: record[5],
        };
        // If the reserves are different from the last
        if ((previousRedeemReserve === null || previousRedeemReserve === void 0 ? void 0 : previousRedeemReserve.reserve0) !== record[0] ||
            (previousRedeemReserve === null || previousRedeemReserve === void 0 ? void 0 : previousRedeemReserve.reserve1) !== record[1] ||
            (previousRedeemReserve === null || previousRedeemReserve === void 0 ? void 0 : previousRedeemReserve.reserve2) !== record[2]) {
            previousRedeemReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                redeems: [redeem],
            };
            redeemReserves.push(previousRedeemReserve);
        }
        else {
            // If the reserves are the save as the previous record
            previousRedeemReserve.redeems.push(redeem);
        }
    }
    return redeemReserves;
};
const parseRedeemExactTestRecords = async (parser) => {
    const redeemReserves = [];
    let previousRedeemReserve;
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0")
            continue;
        const mint = {
            bAssetQtys: [record[3], record[4], record[5]],
            expectedQty: record[7],
        };
        // If the reserves are different from the last
        if ((previousRedeemReserve === null || previousRedeemReserve === void 0 ? void 0 : previousRedeemReserve.reserve0) !== record[0] ||
            (previousRedeemReserve === null || previousRedeemReserve === void 0 ? void 0 : previousRedeemReserve.reserve1) !== record[1] ||
            (previousRedeemReserve === null || previousRedeemReserve === void 0 ? void 0 : previousRedeemReserve.reserve2) !== record[2]) {
            previousRedeemReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                redeems: [mint],
            };
            redeemReserves.push(previousRedeemReserve);
        }
        else {
            // If the reserves are the save as the previous record
            previousRedeemReserve.redeems.push(mint);
        }
    }
    return redeemReserves;
};
const parseSwapTestRecords = async (parser) => {
    const swapReserves = [];
    let previousSwapReserve;
    for await (const record of parser) {
        // Ignore the first title record
        if (record[0] === "reserve0")
            continue;
        const swap = {
            inputIndex: record[3],
            inputQty: record[5],
            outputIndex: record[4],
            outputQty: record[6],
        };
        // If the reserves are different from the last
        if ((previousSwapReserve === null || previousSwapReserve === void 0 ? void 0 : previousSwapReserve.reserve0) !== record[0] ||
            (previousSwapReserve === null || previousSwapReserve === void 0 ? void 0 : previousSwapReserve.reserve1) !== record[1] ||
            (previousSwapReserve === null || previousSwapReserve === void 0 ? void 0 : previousSwapReserve.reserve2) !== record[2]) {
            previousSwapReserve = {
                reserve0: record[0],
                reserve1: record[1],
                reserve2: record[2],
                swaps: [swap],
            };
            swapReserves.push(previousSwapReserve);
        }
        else {
            // If the reserves are the save as the previous record
            previousSwapReserve.swaps.push(swap);
        }
    }
    return swapReserves;
};
const parseCsvFile = async (testFilename, recordParser) => {
    const parser = fs_1.default.createReadStream(testFilename).pipe(csv_parse_1.default());
    return recordParser(parser);
};
const main = async () => {
    const mintData = await parseCsvFile("./mbtc_test_mint.csv", parseMintTestRecords);
    fs_1.default.writeFileSync("mintTestData.json", JSON.stringify(mintData));
    const multiMintData = await parseCsvFile("./mbtc_test_multi_mint.csv", parseMultiMintTestRecords);
    fs_1.default.writeFileSync("multiMintTestData.json", JSON.stringify(multiMintData));
    const redeemData = await parseCsvFile("./mbtc_test_redeem.csv", parseRedeemTestRecords);
    fs_1.default.writeFileSync("redeemTestData.json", JSON.stringify(redeemData));
    const redeemExactData = await parseCsvFile("./mbtc_test_multi_redeem.csv", parseRedeemExactTestRecords);
    fs_1.default.writeFileSync("redeemExactTestData.json", JSON.stringify(redeemExactData));
    const swapData = await parseCsvFile("./mbtc_test_swap.csv", parseSwapTestRecords);
    fs_1.default.writeFileSync("swapTestData.json", JSON.stringify(swapData));
};
main()
    .then()
    .catch((err) => console.error(err));
//# sourceMappingURL=convertCsvTestFiles.js.map