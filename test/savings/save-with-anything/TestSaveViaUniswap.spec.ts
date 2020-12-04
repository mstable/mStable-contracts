/* eslint-disable @typescript-eslint/camelcase */

import { StandardAccounts, MassetMachine, SystemMachine } from "@utils/machines";
import * as t from "types/generated";

const MockERC20 = artifacts.require("MockERC20");
const SavingsManager = artifacts.require("SavingsManager");
const MockNexus = artifacts.require("MockNexus");
const SaveViaUniswap = artifacts.require("SaveViaUniswap");
const MockUniswap = artifacts.require("MockUniswap");
const MockCurveMetaPool = artifacts.require("MockCurveMetaPool");

contract("SaveViaUniswap", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    const systemMachine = new SystemMachine(sa.all);
    const massetMachine = new MassetMachine(systemMachine);
    let bAsset: t.MockERC20Instance;
    let mUSD: t.MockERC20Instance;
    let savings: t.SavingsManagerInstance;
    let saveViaUniswap: t.SaveViaUniswap;
    let nexus: t.MockNexusInstance;
    let uniswap: t.MockUniswap;
    let curve: t.MockCurveMetaPool;

    const setupEnvironment = async (): Promise<void> => {
        let massetDetails = await massetMachine.deployMasset();
        // deploy contracts
        asset = await MockERC20.new() // asset for the uniswap swap?
        bAsset = await MockERC20.new("Mock coin", "MCK", 18, sa.fundManager, 100000000); // how to get the bAsset from massetMachine?
        mUSD = await MockERC20.new(
            massetDetails.mAsset.name(),
            massetDetails.mAsset.symbol(),
            massetDetails.mAsset.decimals(),
            sa.fundManager,
            100000000,
        );
        uniswap = await MockUniswap.new();
        savings = await SavingsManager.new(nexus.address, mUSD.address, sa.other, {
            from: sa.default,
        });
        curveAssets = []; //best way of gettings the addresses here?
        curve = await MockCurveMetaPool.new([], mUSD.address);
        saveViaUniswap = await SaveViaUniswap.new(
            savings.address,
            uniswap.address,
            curve.address,
            mUSD.address,
        );

        // mocking rest of the params for buyAndSave, i.e - _amountOutMin, _path, _deadline, _curvePosition, _minOutCrv?
    };

    before(async () => {
        nexus = await MockNexus.new(sa.governor, sa.governor, sa.dummy1);
        await setupEnvironment();
    });

    describe("saving via uniswap", async () => {
        it("should swap tokens & deposit", async () => {
            await saveViaUniswap.buyAndSave(); 
        });
    });
});
