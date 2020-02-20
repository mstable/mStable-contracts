import { StandardAccounts } from "@utils/machines/standardAccounts";
import { getForgeContractInstances } from "./utils/getForgeContractInstances";
import { logTrancheData, logTx } from "./utils/logging";
import { nowExact, timeTravel } from "./utils/time";

export default async (scope: any, trancheNumber: string, account?: string) => {
    const { MTA, forge } = await getForgeContractInstances(scope);
    const sa = new StandardAccounts(await scope.web3.eth.getAccounts());
    account = account || sa.default;
    const txDetails = { from: account };

    const trancheData = await logTrancheData(forge, trancheNumber);

    const now = nowExact();
    if (now.lt(trancheData.unlockTime)) {
        await timeTravel(scope.web3, trancheData.unlockTime.sub(now));
    }

    console.log("MTA balance before", (await MTA.balanceOf(account, txDetails)).toString());

    await logTx(
        forge.redeemReward(trancheNumber, txDetails),
        `Redeeming reward for ${account} for tranche ${trancheNumber}`,
    );

    console.log("MTA balance after ", (await MTA.balanceOf(account, txDetails)).toString());
};
