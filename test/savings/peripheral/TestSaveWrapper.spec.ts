/* eslint-disable @typescript-eslint/camelcase */

import { StandardAccounts, SystemMachine } from "@utils/machines";
import * as t from "types/generated";

const SaveWrapper = artifacts.require("SaveWrapper");

contract("SaveWrapper", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const systemMachine = new SystemMachine(sa.all);
    let bAsset: t.MockERC20Instance;
    let mUSD: t.MassetInstance;
    let savings: t.SavingsContractInstance;
    let saveWrapper: t.SaveWrapperInstance;

    const setupEnvironment = async (): Promise<void> => {
        // await systemMachine.initialiseMocks();
        // const massetDetails = systemMachine.mUSD;
        // [bAsset] = massetDetails.bAssets;
        // mUSD = massetDetails.mAsset;
        // savings = systemMachine.savingsContract;
        // saveWrapper = await SaveWrapper.new(savings.address, mUSD.address);
    };

    before(async () => {
        await setupEnvironment();
    });

    describe("saving via mint", async () => {
        it("should mint tokens & deposit", async () => {
            // await bAsset.approve(SaveWrapper.address, 100);
            // await saveWrapper.mintAndSave(mUSD.address, bAsset.address, 100);
        });
    });
});
