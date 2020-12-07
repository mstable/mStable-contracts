/* eslint-disable @typescript-eslint/camelcase */

import { StandardAccounts, SystemMachine } from "@utils/machines";
import * as t from "types/generated";

const SaveViaMint = artifacts.require("SaveViaMint");

contract("SaveViaMint", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const systemMachine = new SystemMachine(sa.all);
    let bAsset: t.MockERC20Instance;
    let mUSD: t.MassetInstance;
    let savings: t.SavingsContractInstance;
    let saveViaMint: t.SaveViaMintInstance;

    const setupEnvironment = async (): Promise<void> => {
        await systemMachine.initialiseMocks();

        const massetDetails = systemMachine.mUSD;
        [bAsset] = massetDetails.bAssets;
        mUSD = massetDetails.mAsset;
        savings = systemMachine.savingsContract;

        saveViaMint = await SaveViaMint.new(savings.address, mUSD.address);
    };

    before(async () => {
        await setupEnvironment();
    });

    describe("saving via mint", async () => {
        it("should mint tokens & deposit", async () => {
            await bAsset.approve(saveViaMint.address, 100);
            await saveViaMint.mintAndSave(mUSD.address, bAsset.address, 100);
        });
    });
});
