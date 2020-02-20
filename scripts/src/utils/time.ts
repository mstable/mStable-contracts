import { BN } from "../../../test-utils/tools";
import chalk from "chalk";

export const nowSimple = (): number => Math.ceil(Date.now() / 1000);

export const nowExact = (): BN => new BN(nowSimple());

export const timeTravel = async (web3: Web3, seconds: BN) => {
    console.log(chalk.magenta("------------------------------------------------"));
    console.log(
        chalk.magentaBright(
            `🛸 We gotta travel exactly ${seconds.toString()} seconds into the future, Morty 🛸`,
        ),
    );

    const block = await web3.eth.getBlock("latest");
    const forwardTime = block.timestamp + seconds.toNumber();

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
