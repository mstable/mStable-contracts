import { StandardAccounts } from "@utils/machines/standardAccounts";
import { getRelevantContractInstances } from "./utils/getRelevantContractInstances";
import { logTx } from "./utils/logging";
import { simpleToExactAmount } from "@utils/math";

export default async (scope: any, amount: string, account?: string) => {
    const { mUSD, savings } = await getRelevantContractInstances(scope);

    const sa = new StandardAccounts(await scope.web3.eth.getAccounts());
    const txDetails = { from: sa.default };
    account = account || sa.default;

    let exactAmount = simpleToExactAmount(amount, 18);

    console.log(`mUSD balance before: ${(await mUSD.balanceOf(account)).toString()}`);
    console.log(`credit balance before: ${(await savings.creditBalances(account)).toString()}`);

    await logTx(
        savings.redeem(exactAmount, txDetails),
        `Withdrawing ${amount} for account ${account}`,
    );

    console.log(`mUSD balance after: ${(await mUSD.balanceOf(account)).toString()}`);
    console.log(`credit balance after: ${(await savings.creditBalances(account)).toString()}`);
};
