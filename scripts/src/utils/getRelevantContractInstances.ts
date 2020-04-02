import * as t from "types/generated";

export const getRelevantContractInstances = async ({ artifacts }: any) => {
    const cERC20: t.ERC20DetailedContract = artifacts.require("ERC20Detailed");

    const cMUSD: t.MUSDContract = artifacts.require("MUSD");
    const cBasketManager: t.BasketManagerContract = artifacts.require("BasketManager");
    const cSavingsContract: t.SavingsContractContract = artifacts.require("SavingsContract");

    const mUSD = await cMUSD.deployed();
    const basketManager = await cBasketManager.at(await mUSD.getBasketManager());
    const savings = await cSavingsContract.deployed();

    const bAssets = (await basketManager.getBassets())[0];

    const bassets: Array<t.ERC20DetailedInstance> = await Promise.all(
        bAssets.map((b, i) => cERC20.at(b.addr)),
    );

    return {
        mUSD,
        basketManager,
        savings,
        bassets,
    };
};
