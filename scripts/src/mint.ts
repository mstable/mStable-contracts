import { BN } from "@utils/tools";
import { StandardAccounts } from "@utils/machines/standardAccounts";
import { MUSDMinter } from "./utils/mUSDMinter";
import { getRelevantContractInstances } from "./utils/getRelevantContractInstances";
import { logTx } from "./utils/logging";

export default async (scope: any, amount: string, account?: string) => {
    const { mUSD, basketManager, bassets } = await getRelevantContractInstances(scope);
    const minter = new MUSDMinter(mUSD, basketManager, bassets);

    const sa = new StandardAccounts(await scope.web3.eth.getAccounts());
    const txDetails = { from: sa.default };
    account = account || sa.default;

    await logTx(
        minter.approveAllBassets(new BN(amount), txDetails),
        `Approving all bassets to transfer ${amount} for ${account}`,
    );

    console.log(`mUSD balance before: ${await minter.getMUSDBalance(account)}`);

    await logTx(
        minter.mintAllBassets(new BN(amount), account, txDetails),
        `Minting all bassets for ${amount} for account ${account}`,
    );

    console.log(`mUSD balance after:  ${await minter.getMUSDBalance(account)}`);
};
