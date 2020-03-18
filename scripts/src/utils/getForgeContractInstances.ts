import {
    DAIContract,
    ForgeRewardsMUSDContract,
    GUSDContract,
    MUSDContract,
    PAXContract,
    MetaTokenContract,
    SUSDContract,
    TUSDContract,
    USDCContract,
    USDTContract,
    ERC20Instance,
} from "types/generated";
// import { OrderedBassets } from "./types";

export const getForgeContractInstances = async ({ artifacts }: any) => {
    const cForgeRewardsMUSD: ForgeRewardsMUSDContract = artifacts.require("ForgeRewardsMUSD");
    const cMUSD: MUSDContract = artifacts.require("MUSD");
    const cUSDT: USDTContract = artifacts.require("USDT");
    const cUSDC: USDCContract = artifacts.require("USDC");
    const cTUSD: TUSDContract = artifacts.require("TUSD");
    const cDAI: DAIContract = artifacts.require("DAI");
    const cSUSD: SUSDContract = artifacts.require("SUSD");
    const cGUSD: GUSDContract = artifacts.require("GUSD");
    const cPAX: PAXContract = artifacts.require("PAX");
    const cMTA: MetaTokenContract = artifacts.require("MetaToken");

    const forge = await cForgeRewardsMUSD.deployed();
    const mUSD = await cMUSD.deployed();
    const USDT = await cUSDT.deployed();
    const USDC = await cUSDC.deployed();
    const TUSD = await cTUSD.deployed();
    const DAI = await cDAI.deployed();
    const SUSD = await cSUSD.deployed();
    const GUSD = await cGUSD.deployed();
    const PAX = await cPAX.deployed();
    const MTA = await cMTA.deployed();

    const bassets: Array<ERC20Instance> = [USDT, USDC, TUSD, DAI, SUSD, GUSD, PAX];

    return {
        bassets,
        forge,
        mUSD,
        MTA,
    };
};
