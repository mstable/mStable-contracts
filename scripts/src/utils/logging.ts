// eslint-disable-next-line import/no-extraneous-dependencies
import chalk from "chalk";
import { blockTimestampSimple } from "./time";

export const logBlockTimestamp = async (web3: any, block = "latest") => {
    const timestamp = await blockTimestampSimple(web3, block);
    console.log(`Current block timestamp: ${timestamp}`);
};

export const logSeparator = () => {
    console.log(chalk.gray("------------------------------------------------"));
};

export const logObject = (obj: object) => {
    const keys = Object.keys(obj);
    console.table(
        keys.sort().reduce(
            (acc, key) => ({
                [key]: obj[key].toString(),
                ...acc,
            }),
            {},
        ),
    );
};

export const logAndSanitizeArgs = (args: object) => {
    logObject(sanitizeArgs(args));
};

const sanitizeArgs = (args: object) => {
    // Remove indexed keys, use named keys
    return Object.keys(args)
        .filter((key) => key !== "__length__" && !Number.isInteger(parseInt(key, 10)))
        .reduce((acc, key) => ({ ...acc, [key]: args[key] }), {});
};

const logTxResponse = ({ logs }: Truffle.TransactionResponse<any>) => {
    logs.forEach(({ event, args }) => {
        console.log(chalk.gray("Event ") + chalk.italic(event));
        logAndSanitizeArgs(args);
    });
};

export const logTx = async (
    txPromise: Promise<Truffle.TransactionResponse<any> | Truffle.TransactionResponse<any>[]>,
    description: string,
) => {
    logSeparator();
    console.log(`${chalk.blue("[tx]")} ${description}`);
    let response;
    try {
        response = await txPromise;
    } catch (error) {
        console.log(chalk.blue(" --> ") + chalk.redBright("✘ Failed!"));
        throw error;
    }
    console.log(chalk.blue(" --> ") + chalk.greenBright("✔ Success!"));

    if (Array.isArray(response)) {
        response.map(logTxResponse);
    } else {
        logTxResponse(response);
    }

    return response;
};

// export const logTrancheData = async (forge: ForgeRewardsMUSDInstance, trancheNumber: string) => {
//     const [
//         startTime,
//         endTime,
//         claimEndTime,
//         unlockTime,
//         totalMintVolume,
//         totalRewardUnits,
//         unclaimedRewardUnits,
//         rewardees,
//     ] = await forge.getTrancheData(trancheNumber);
//     const data = {
//         startTime,
//         endTime,
//         claimEndTime,
//         unlockTime,
//         totalMintVolume,
//         totalRewardUnits,
//         unclaimedRewardUnits,
//         rewardees,
//     };

//     logSeparator();
//     console.log(`Tranche ${trancheNumber} data:`);
//     logObject(data);

//     return data;
// };

// export const logRewardeeData = async (
//     forge: ForgeRewardsMUSDInstance,
//     trancheNumber: string,
//     account: string,
// ): Promise<{
//     claimed: boolean;
//     claimWindowClosed: boolean;
//     mintVolume: BN;
//     mintWindowClosed: boolean;
//     redeemed: boolean;
//     rewardAllocation: BN;
//     unlocked: boolean;
// }> => {
//     const data: {
//         claimed: boolean;
//         claimWindowClosed: boolean;
//         mintVolume: string;
//         mintWindowClosed: boolean;
//         redeemed: boolean;
//         rewardAllocation: string;
//         unlocked: boolean;
//     } = await forge.contract.methods["getRewardeeData(uint256,address)"](
//         trancheNumber,
//         account,
//     ).call();

//     data.rewardAllocation = new BN(data.rewardAllocation);
//     data.mintVolume = new BN(data.mintVolume);

//     logSeparator();
//     console.log(`Rewardee data for ${account} in tranche ${trancheNumber}:`);
//     logAndSanitizeArgs(data);

//     return data;
// };
