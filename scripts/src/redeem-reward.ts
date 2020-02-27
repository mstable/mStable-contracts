import humanizeDuration from "humanize-duration";
import { StandardAccounts } from "@utils/machines/standardAccounts";
import { getForgeContractInstances } from "./utils/getForgeContractInstances";
import { logTrancheData, logTx } from "./utils/logging";
import { blockTimestampExact } from "./utils/time";

export default async (scope: any, trancheNumber: string, account?: string) => {
    const { MTA, forge } = await getForgeContractInstances(scope);
    const sa = new StandardAccounts(await scope.web3.eth.getAccounts());
    account = account || sa.default;
    const txDetails = { from: account };

    const trancheData = await logTrancheData(forge, trancheNumber);

    const now = await blockTimestampExact(scope.web3);
    if (now.lt(trancheData.unlockTime)) {
        const seconds = trancheData.unlockTime.sub(now);
        console.log(
            `Exiting: tranche not unlocked yet. Try time-travelling ${humanizeDuration(
                seconds.toNumber() * 1000,
            )}.`,
        );
        return;
    }

    console.log("MTA balance before", (await MTA.balanceOf(account, txDetails)).toString());

    await logTx(
        forge.redeemReward(trancheNumber, txDetails),
        `Redeeming reward for ${account} for tranche ${trancheNumber}`,
    );

    console.log("MTA balance after ", (await MTA.balanceOf(account, txDetails)).toString());
};
