/* eslint-disable @typescript-eslint/camelcase */

import { StandardAccounts, MassetMachine, SystemMachine } from "@utils/machines";
import * as t from "types/generated";

const SavingsContract = artifacts.require("SavingsContract");
const MockNexus = artifacts.require("MockNexus");
const SaveViaMint = artifacts.require("SaveViaMint");

contract("SaveViaMint", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const systemMachine = new SystemMachine(sa.all);
    const massetMachine = new MassetMachine(systemMachine);
    let bAsset: t.MockERC20Instance;
    let mUSD: t.MassetInstance;
    let savings: t.SavingsContractInstance;
    let saveViaMint: t.SaveViaMintInstance;
    let nexus: t.MockNexusInstance;

    const setupEnvironment = async (): Promise<void> => {
        let massetDetails = await massetMachine.deployMasset();
        // deploy contracts
        bAsset = massetDetails.bAssets[0];
        mUSD = massetDetails.mAsset;
        savings = await SavingsContract.new(
            nexus.address,
            mUSD.address,
            "Savings Credit",
            "ymUSD",
            18,
        );
        saveViaMint = await SaveViaMint.new(savings.address, mUSD.address);
    };

    before(async () => {
        nexus = await MockNexus.new(sa.governor, sa.governor, sa.dummy1);
        await setupEnvironment();
    });

    describe("saving via mint", async () => {
        it("should mint tokens & deposit", async () => {
            await bAsset.approve(saveViaMint.address, 100);
            await saveViaMint.mintAndSave(mUSD.address, bAsset.address, 100);
        });
    });
});
