import { BN } from "@utils/tools";
import { ForgeRewardsMUSDMinter } from "./utils/forgeRewardsMUSDMinter";
import { getForgeContractInstances } from "./utils/getForgeContractInstances";
import { logTx } from "./utils/logging";
import { StandardAccounts } from "@utils/machines/standardAccounts";

export default async (scope: any, amount: string, account?: string) => {
    const { mUSD, forge, bassets } = await getForgeContractInstances(scope);
    const minter = new ForgeRewardsMUSDMinter(forge, mUSD, bassets);

    const sa = new StandardAccounts(await scope.web3.eth.getAccounts());
    const txDetails = { from: sa.default };
    account = account || sa.default;

    await logTx(
        minter.approveAllBassets(new BN(amount), txDetails),
        `Approving all bassets to transfer ${amount} for ${account}`,
    );

    console.log(`mUSD balance before: ${await minter.getMUSDBalance(account)}`);

    await logTx(
        minter.mintAllBassets(new BN(amount), account, account, txDetails),
        `Minting all bassets for ${amount} for account ${account}`,
    );

    console.log(`mUSD balance after:  ${await minter.getMUSDBalance(account)}`);
};
