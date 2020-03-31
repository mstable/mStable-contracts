import chalk from "chalk";
import humanizeDuration from "humanize-duration";
import parseDuration from "parse-duration";
import { timeTravel } from "./utils/time";
import { logBlockTimestamp } from "./utils/logging";
import { BN } from "@utils/tools";
import { StandardAccounts } from "@utils/machines/standardAccounts";
import { MUSDMinter } from "./utils/mUSDMinter";
import { getRelevantContractInstances } from "./utils/getRelevantContractInstances";
import { logTx } from "./utils/logging";

export default async ({ web3 }: any, ...args: string[]) => {
    const duration = args.join(" ");
    const seconds = parseDuration(duration) / 1000;
    const humanizedDuration = humanizeDuration(seconds * 1000);

    console.log(chalk.magenta("------------------------------------------------"));
    console.log(
        chalk.magentaBright(`🛸 We gotta travel ${humanizedDuration} into the future, Morty 🛸`),
    );
    console.log(chalk.gray("🚶‍ aww jeez...‍"));
    console.log(chalk.magenta("------------------------------------------------"));

    await logBlockTimestamp(web3);
    await timeTravel(web3, seconds);
    await logBlockTimestamp(web3);
};
