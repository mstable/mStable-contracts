import chalk from "chalk";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { BN } from "../../../test-utils/tools";

dayjs.extend(relativeTime);

export const nowSimple = (): number => Math.ceil(Date.now() / 1000);

export const nowExact = (): BN => new BN(nowSimple());

export const timeTravel = async (web3: Web3, seconds: BN) => {
    const block = await web3.eth.getBlock("latest");
    const forwardTime = block.timestamp + seconds.toNumber() * 1000;
    const diff = dayjs(block.timestamp).to(forwardTime, true);

    console.log(chalk.magenta("------------------------------------------------"));
    console.log(
        chalk.magentaBright(`🛸 We gotta travel exactly ${diff} into the future, Morty 🛸`),
    );
    console.log(chalk.gray("🚶‍ aww jeez...‍"));

    return new Promise((resolve, reject) => {
        web3.currentProvider.send(
            {
                jsonrpc: "2.0",
                method: "evm_mine",
                params: [forwardTime],
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
