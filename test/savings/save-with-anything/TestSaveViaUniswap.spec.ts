/* eslint-disable @typescript-eslint/camelcase */

import { StandardAccounts } from "@utils/machines";
import * as t from "types/generated";

const MockERC20 = artifacts.require("MockERC20");
const SavingsManager = artifacts.require("SavingsManager");
const MockNexus = artifacts.require("MockNexus");
const SaveViaUniswap = artifacts.require("SaveViaUniswap");
const MockUniswap = artifacts.require("MockUniswap");

contract("SavingsContract", async (accounts) => {
    const sa = new StandardAccounts(accounts);

    let bAsset: t.MockERC20Instance;
    let mUSD: t.MockERC20Instance;
    let savings: t.SavingsManagerInstance;
    let saveViaUniswap: t.SaveViaUniswap;
    let nexus: t.MockNexusInstance;
    let uniswap: t.MockUniswap;

    const setupEnvironment = async (): Promise<void> => {
        // deploy contracts
        bAsset = await MockERC20.new("Mock coin", "MCK", 18, sa.fundManager, 100000000);
        mUSD = await MockERC20.new("mStable USD", "mUSD", 18, sa.fundManager, 100000000);
        uniswap = await MockUniswap.new();
        savings = await SavingsManager.new(nexus.address, mUSD.address, sa.other, {
            from: sa.default,
        });
        saveViaUniswap = await SaveViaUniswap.new(savings.address, uniswap.address);
    };

    before(async () => {
        nexus = await MockNexus.new(sa.governor, sa.governor, sa.dummy1);
        await setupEnvironment();
    });

    describe("saving via uniswap", async () => {
        it("should swap tokens & deposit", async () => {
            saveViaUniswap.buyAndSave(); // how to get all the params here?
        });
    });
});
