// eslint-disable-next-line import/prefer-default-export
export const getRelevantContractInstances = async ({
    artifacts,
}: {
    artifacts: Truffle.Artifacts;
}) => {
    const cErc20 = artifacts.require("ERC20Detailed");
    const cMasset = artifacts.require("Masset");
    const cBasketManager = artifacts.require("BasketManager");
    const cSavingsContract = artifacts.require("SavingsContract");

    const mUSD = await cMasset.deployed();
    const basketManager = await cBasketManager.at(await mUSD.getBasketManager());
    const savings = await cSavingsContract.deployed();

    const bAssets = (await basketManager.getBassets())[0];

    const bassets = await Promise.all(bAssets.map((b) => cErc20.at(b.addr)));

    return {
        mUSD,
        basketManager,
        savings,
        bassets,
    };
};
