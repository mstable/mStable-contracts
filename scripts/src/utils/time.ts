import chalk from "chalk";
import humanizeDuration from "humanize-duration";
import { BN } from "../../../test-utils/tools";

export const nowSimple = (): number => Math.ceil(Date.now() / 1000);

export const nowExact = (): BN => new BN(nowSimple());

export const blockTimestampExact = async (web3: any, block = "latest"): Promise<BN> => {
    const timestamp = await blockTimestampSimple(web3, block);
    return new BN(timestamp);
};

export const blockTimestampSimple = async (web3: any, block = "latest"): Promise<number> => {
    const { timestamp } = await web3.eth.getBlock(block);
    return timestamp;
};

export const timeTravel = async (web3: any, seconds: number) => {
    const timestamp = await blockTimestampSimple(web3);
    const newTimestamp = timestamp + seconds;
    console.log(`Advancing block time ${seconds} seconds...`);

    return new Promise((resolve, reject) => {
        web3.currentProvider.send(
            {
                jsonrpc: "2.0",
                method: "evm_mine",
                params: [newTimestamp],
                id: new Date().getTime(),
            },
            (err, result) => {
                if (err) {
                    return reject(err);
                }
                return resolve(result);
            },
        );
    });
};
