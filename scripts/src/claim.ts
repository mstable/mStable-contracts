import humanizeDuration from "humanize-duration";
import { StandardAccounts } from "@utils/machines/standardAccounts";
import { getForgeContractInstances } from "./utils/getForgeContractInstances";
import { logRewardeeData, logTrancheData, logTx } from "./utils/logging";
import { blockTimestampExact } from "./utils/time";

export default async (scope: any, trancheNumber: string, account?: string) => {
    const { forge } = await getForgeContractInstances(scope);
    const sa = new StandardAccounts(await scope.web3.eth.getAccounts());
    account = account || sa.default;

    const trancheData = await logTrancheData(forge, trancheNumber);
    const rewardeeData = await logRewardeeData(forge, trancheNumber, account);

    if (rewardeeData.claimed) {
        console.log("Exiting: Already claimed.");
        return;
    }

    if (rewardeeData.claimWindowClosed) {
        console.log("Exiting: Claim window closed.");
        return;
    }

    const now = await blockTimestampExact(scope.web3);
    if (!(now.gt(trancheData.endTime) && now.lt(trancheData.claimEndTime))) {
        const seconds = trancheData.endTime.sub(now);
        console.log(
            `Exiting: claim window not open yet. Try time-travelling ${humanizeDuration(
                seconds.toNumber() * 1000,
            )} seconds.`,
        );
        return;
    }

    await logTx(
        forge.claimReward(trancheNumber, { from: account }),
        `Claiming tranche ${trancheNumber} reward for ${account}`,
    );

    await logTrancheData(forge, trancheNumber);
    await logRewardeeData(forge, trancheNumber, account);
};
