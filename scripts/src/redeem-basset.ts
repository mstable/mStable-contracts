import { BN } from "@utils/tools";
import { simpleToExactAmount } from "@utils/math";
import { StandardAccounts } from "@utils/machines/standardAccounts";
import { getForgeContractInstances } from "./utils/getForgeContractInstances";
import { logTx } from "./utils/logging";

export default async (scope: any, bassetIndex: string, amount: string, account?: string) => {
    const { MTA, mUSD, bassets } = await getForgeContractInstances(scope);
    const sa = new StandardAccounts(await scope.web3.eth.getAccounts());
    account = account || sa.default;

    const basset = bassets[parseInt(bassetIndex, 10)];
    const bassetDecimals = await basset.decimals();
    const bassetSymbol = await basset.symbol();

    console.log("MTA balance before", (await MTA.balanceOf(account)).toString());
    console.log("mUSD balance before", (await mUSD.balanceOf(account)).toString());
    console.log(`${bassetSymbol} balance before`, (await basset.balanceOf(account)).toString());

    const bassetQ = simpleToExactAmount(new BN(amount), bassetDecimals.toNumber());
    await logTx(
        mUSD.redeemSingle(basset.address, bassetQ),
        `Redeeming ${amount} ${bassetSymbol} for ${account}`,
    );

    console.log("MTA balance after", (await MTA.balanceOf(account)).toString());
    console.log("mUSD balance after", (await mUSD.balanceOf(account)).toString());
    console.log(`${bassetSymbol} balance after`, (await basset.balanceOf(account)).toString());
};
