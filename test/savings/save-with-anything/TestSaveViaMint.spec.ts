/* eslint-disable @typescript-eslint/camelcase */

import { StandardAccounts, MassetMachine, SystemMachine} from "@utils/machines";
import * as t from "types/generated";

const MockERC20 = artifacts.require("MockERC20");
const SavingsManager = artifacts.require("SavingsManager");
const MockNexus = artifacts.require("MockNexus");
const MockMasset = artifacts.require("MockMasset");
const SaveViaMint = artifacts.require("SaveViaMint");

contract("SaveViaMint", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const systemMachine = new SystemMachine(sa.all);
    const massetMachine = new MassetMachine(systemMachine);
    let bAsset: t.MockERC20Instance;
    let mUSD: t.MockERC20Instance;
    let savings: t.SavingsManagerInstance;
    let saveViaMint: t.SaveViaMint;
    let nexus: t.MockNexusInstance;

    const setupEnvironment = async (): Promise<void> => {
        let massetDetails = await massetMachine.deployMasset();
        // deploy contracts
        bAsset = await MockERC20.new() //how to get bAsset out of the massetMachine?
        mUSD = await MockERC20.new(massetDetails.mAsset.name(), massetDetails.mAsset.symbol(), massetDetails.mAsset.decimals(), sa.fundManager, 100000000);
        savings = await SavingsManager.new(nexus.address, mUSD.address, sa.other, {
            from: sa.default,
        });
        saveViaMint = SaveViaMint.new(savings.address);
    };

    before(async () => {
        nexus = await MockNexus.new(sa.governor, sa.governor, sa.dummy1);
        await setupEnvironment();
    });

    describe("saving via mint", async () => {
        it("should mint tokens & deposit", async () => {
            await saveViaMint.mintAndSave(mUSD.address, bAsset, 100000000);
        });
    });
});
