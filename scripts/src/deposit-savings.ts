import { BN } from "@utils/tools";
import { StandardAccounts } from "@utils/machines/standardAccounts";
import { MUSDMinter } from "./utils/mUSDMinter";
import { getRelevantContractInstances } from "./utils/getRelevantContractInstances";
import { logTx } from "./utils/logging";
import { simpleToExactAmount } from "@utils/math";

export default async (scope: any, amount: string, account?: string) => {
    const { mUSD, basketManager, bassets, savings } = await getRelevantContractInstances(scope);

    const sa = new StandardAccounts(await scope.web3.eth.getAccounts());
    const txDetails = { from: sa.default };
    account = account || sa.default;

    let exactAmount = simpleToExactAmount(amount, 18);
    await logTx(
        mUSD.approve(savings.address, exactAmount),
        `Approving savings contract to take ${amount} from ${account}`,
    );

    console.log(`mUSD balance before: ${(await mUSD.balanceOf(account)).toString()}`);
    console.log(`credit balance before: ${(await savings.creditBalances(account)).toString()}`);

    await logTx(
        savings.depositSavings(exactAmount, txDetails),
        `Saving ${amount} for account ${account}`,
    );

    console.log(`mUSD balance after: ${(await mUSD.balanceOf(account)).toString()}`);
    console.log(`credit balance after: ${(await savings.creditBalances(account)).toString()}`);
};
