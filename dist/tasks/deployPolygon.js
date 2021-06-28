"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mUsdBassets = void 0;
/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */
require("ts-node/register");
require("tsconfig-paths/register");
const config_1 = require("hardhat/config");
const generated_1 = require("types/generated");
const constants_1 = require("@utils/constants");
const math_1 = require("@utils/math");
const units_1 = require("@ethersproject/units");
const deploy_utils_1 = require("./utils/deploy-utils");
// FIXME: this import does not work for some reason
// import { sleep } from "@utils/time"
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sleepTime = 10000; // milliseconds
exports.mUsdBassets = [
    {
        name: "(PoS) USD Coin",
        symbol: "PoS-USDC",
        decimals: 6,
        integrator: constants_1.ZERO_ADDRESS,
        initialMint: 1000000,
    },
    {
        name: "(PoS) Dai Stablecoin",
        symbol: "PoS-DAI",
        decimals: 18,
        integrator: constants_1.ZERO_ADDRESS,
        initialMint: 1000000,
    },
    {
        name: "(PoS) Tether USD",
        symbol: "PoS-USDT",
        decimals: 6,
        integrator: constants_1.ZERO_ADDRESS,
        initialMint: 1000000,
    },
];
const deployBasset = async (deployer, name, symbol, decimals = 18, initialMint = 500000) => {
    // Deploy Implementation
    const impl = await deploy_utils_1.deployContract(new generated_1.MockInitializableToken__factory(deployer), `${symbol} impl`);
    // Initialization Implementation
    const data = impl.interface.encodeFunctionData("initialize", [name, symbol, decimals, deployer.address, initialMint]);
    // Deploy Proxy
    const proxy = await deploy_utils_1.deployContract(new generated_1.AssetProxy__factory(deployer), `${symbol} proxy`, [impl.address, constants_1.DEAD_ADDRESS, data]);
    return new generated_1.MockERC20__factory(deployer).attach(proxy.address);
};
const deployBassets = async (deployer, bAssetsProps) => {
    const bAssets = [];
    let i = 0;
    // eslint-disable-next-line
    for (const basset of bAssetsProps) {
        const bAssetContract = await deployBasset(deployer, basset.name, basset.symbol, basset.decimals, basset.initialMint);
        await sleep(sleepTime);
        const pTokenContract = await deploy_utils_1.deployContract(new generated_1.MockERC20__factory(deployer), `pToken for ${basset.symbol}`, [
            `Aave Matic Market ${basset.name}`,
            `am${basset.symbol}`,
            basset.decimals,
            deployer.address,
            0,
        ]);
        bAssets.push({
            ...bAssetsProps[i],
            bAssetContract,
            pTokenContract,
        });
        i += 1;
    }
    return bAssets;
};
const attachBassets = (deployer, bAssetsProps, bAssetAddresses, pTokenAddresses) => {
    const bAssets = [];
    bAssetsProps.forEach((basset, i) => {
        const bAssetContract = new generated_1.MockERC20__factory(deployer).attach(bAssetAddresses[i]);
        const pTokenContract = new generated_1.MockERC20__factory(deployer).attach(pTokenAddresses[i]);
        bAssets.push({
            ...bAssetsProps[i],
            bAssetContract,
            pTokenContract,
        });
    });
    return bAssets;
};
const deployMasset = async (deployer, linkedAddress, nexus, delayedProxyAdmin, recolFee = math_1.simpleToExactAmount(5, 13)) => {
    const mAssetFactory = new generated_1.Masset__factory(linkedAddress, deployer);
    const impl = await deploy_utils_1.deployContract(mAssetFactory, "Masset Impl", [nexus.address, recolFee]);
    const proxy = await deploy_utils_1.deployContract(new generated_1.AssetProxy__factory(deployer), "Masset Proxy", [
        impl.address,
        delayedProxyAdmin.address,
        "0x", // Passing zero bytes as we'll initialize the proxy contract later
    ]);
    return mAssetFactory.attach(proxy.address);
};
const deployInterestBearingMasset = async (deployer, nexus, mUsd, delayedProxyAdmin, poker, symbol, name) => {
    const impl = await deploy_utils_1.deployContract(new generated_1.SavingsContract__factory(deployer), "SavingsContract Impl", [
        nexus.address,
        mUsd.address,
    ]);
    const initializeData = impl.interface.encodeFunctionData("initialize", [poker, name, symbol]);
    const proxy = await deploy_utils_1.deployContract(new generated_1.AssetProxy__factory(deployer), "SavingsContract Proxy", [
        impl.address,
        delayedProxyAdmin.address,
        initializeData,
    ]);
    return new generated_1.SavingsContract__factory(deployer).attach(proxy.address);
};
const deployAaveIntegration = async (deployer, nexus, mAsset, bAssetAddresses, pTokenAddresses, networkName) => {
    let platformAddress = constants_1.DEAD_ADDRESS;
    let rewardTokenAddress = constants_1.DEAD_ADDRESS;
    let rewardControllerAddress = constants_1.DEAD_ADDRESS;
    let quickSwapRouter = constants_1.DEAD_ADDRESS;
    if (networkName === "polygon_mainnet") {
        platformAddress = "0xd05e3E715d945B59290df0ae8eF85c1BdB684744"; // Aave lendingPoolAddressProvider
        rewardTokenAddress = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"; // wMatic
        rewardControllerAddress = "0x357D51124f59836DeD84c8a1730D72B749d8BC23"; // Aave AaveIncentivesController
        quickSwapRouter = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff";
    }
    const aaveIntegration = await deploy_utils_1.deployContract(new generated_1.PAaveIntegration__factory(deployer), "PAaveIntegration", [
        nexus.address,
        mAsset.address,
        platformAddress,
        rewardTokenAddress,
        rewardControllerAddress,
    ]);
    // initialize Aave integration with bAssets and pTokens
    console.log(`About to initialize Aave integration with bAssets ${bAssetAddresses} and pTokens ${pTokenAddresses}`);
    const tx = await aaveIntegration.initialize(bAssetAddresses, pTokenAddresses);
    await tx.wait();
    // Deploy Liquidator
    const liquidator = await deploy_utils_1.deployContract(new generated_1.PLiquidator__factory(deployer), "PLiquidator", [
        nexus.address,
        quickSwapRouter,
        mAsset.address,
    ]);
    return {
        integrator: aaveIntegration,
        liquidator,
    };
};
const mint = async (sender, bAssets, mAsset, scaledMintQty) => {
    // Approve spending
    const approvals = [];
    // eslint-disable-next-line
    for (const bAsset of bAssets) {
        const dec = bAsset.decimals;
        const approval = dec === 18 ? scaledMintQty : scaledMintQty.div(math_1.simpleToExactAmount(1, math_1.BN.from(18).sub(dec)));
        approvals.push(approval);
        const tx = await bAsset.bAssetContract.approve(mAsset.address, approval);
        const receiptApprove = await tx.wait();
        console.log(`Approved mAsset to transfer ${units_1.formatUnits(scaledMintQty)} ${bAsset.symbol} from ${sender.address}. gas used ${receiptApprove.gasUsed}`);
        console.log(`Balance ${(await bAsset.bAssetContract.balanceOf(await sender.getAddress())).toString()}`);
    }
    // Mint
    const tx = await mAsset.mintMulti(bAssets.map((b) => b.bAssetContract.address), approvals, 1, await sender.getAddress(), { gasLimit: 8000000 });
    const receiptMint = await tx.wait();
    // Log minted amount
    const mAssetAmount = units_1.formatUnits(await mAsset.totalSupply());
    console.log(`Minted ${mAssetAmount} mAssets from ${units_1.formatUnits(scaledMintQty)} units for each bAsset. gas used ${receiptMint.gasUsed}`);
};
const save = async (sender, mAsset, imAsset, scaledSaveQty) => {
    console.log(`About to save ${units_1.formatUnits(scaledSaveQty)} mAssets`);
    await mAsset.approve(imAsset.address, scaledSaveQty);
    await imAsset["depositSavings(uint256)"](scaledSaveQty, { gasLimit: 8000000 });
    console.log(`Saved ${units_1.formatUnits(scaledSaveQty)} mAssets to interest bearing mAssets`);
};
config_1.task("deploy-polly", "Deploys mUSD & System to a Polygon network").setAction(async (_, hre) => {
    const { network } = hre;
    const [deployer] = await hre.ethers.getSigners();
    // Deploy Nexus
    const nexus = await deploy_utils_1.deployContract(new generated_1.Nexus__factory(deployer), "Nexus", [deployer.address]);
    // Deploy DelayedProxyAdmin
    const delayedProxyAdmin = await deploy_utils_1.deployContract(new generated_1.DelayedProxyAdmin__factory(deployer), "DelayedProxyAdmin", [
        nexus.address,
    ]);
    await sleep(sleepTime);
    let deployedUsdBassets;
    let multiSigAddress;
    if (network.name === "hardhat") {
        multiSigAddress = deployer.address;
        // Deploy mocked base USD assets
        deployedUsdBassets = await deployBassets(deployer, exports.mUsdBassets);
    }
    else if (network.name === "polygon_testnet") {
        multiSigAddress = "0xE1304aA964C5119C98E8AE554F031Bf3B21eC836"; // 1/3 Multisig
        // Attach to already deployed mocked bAssets
        deployedUsdBassets = attachBassets(deployer, exports.mUsdBassets, [
            "0x4fa81E591dC5dAf1CDA8f21e811BAEc584831673",
            "0xD84574BFE3294b472C74D7a7e3d3bB2E92894B48",
            "0x872093ee2BCb9951b1034a4AAC7f489215EDa7C2", // Tether
        ], [
            "0xA2De18B8AE0450D918EA5Bf5890CBA5dD7055A4f",
            "0x85581E4BDeDB67840876DF20eFeaA6926dfFa11E",
            "0xAD209ADbCDF8B6917E69E6BcF9D05592388B8ada",
        ]);
    }
    else if (network.name === "polygon_mainnet") {
        multiSigAddress = "0x4aA2Dd5D5387E4b8dcf9b6Bfa4D9236038c3AD43"; // 4/8 Multisig
        // Attach to 3rd party bAssets
        deployedUsdBassets = attachBassets(deployer, exports.mUsdBassets, [
            "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
            "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
            "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // Tether
        ], [
            "0x1a13F4Ca1d028320A707D99520AbFefca3998b7F",
            "0x27F8D03b3a2196956ED754baDc28D73be8830A6e",
            "0x60D55F02A771d515e077c9C2403a1ef324885CeC",
        ]);
    }
    await sleep(sleepTime);
    // Deploy mAsset dependencies
    const massetLogic = await deploy_utils_1.deployContract(new generated_1.MassetLogic__factory(deployer), "MassetLogic");
    const managerLib = await deploy_utils_1.deployContract(new generated_1.MassetManager__factory(deployer), "MassetManager");
    const linkedAddress = {
        __$6a4be19f34d71a078def5cee18ccebcd10$__: massetLogic.address,
        __$3b19b776afde68cd758db0cae1b8e49f94$__: managerLib.address,
    };
    // Deploy mUSD Masset
    const mUsd = await deployMasset(deployer, linkedAddress, nexus, delayedProxyAdmin);
    await sleep(sleepTime);
    const { integrator, liquidator } = await deployAaveIntegration(deployer, nexus, mUsd, deployedUsdBassets.map((b) => b.bAssetContract.address), deployedUsdBassets.map((b) => b.pTokenContract.address), network.name);
    const config = {
        a: 300,
        limits: {
            min: math_1.simpleToExactAmount(5, 16),
            max: math_1.simpleToExactAmount(75, 16),
        },
    };
    const txMusd = await mUsd.initialize("mUSD", "mStable USD (Polygon PoS)", deployedUsdBassets.map((b) => ({
        addr: b.bAssetContract.address,
        integrator: network.name === "polygon_mainnet" ? integrator.address : constants_1.ZERO_ADDRESS,
        hasTxFee: false,
        status: 0,
    })), config, { gasLimit: 8000000 });
    console.log(`mUSD initialize tx ${txMusd.hash}`);
    const receiptMusd = await txMusd.wait();
    console.log(`mUSD initialize status ${receiptMusd.status} from receipt`);
    await sleep(sleepTime);
    // Deploy Interest Bearing mUSD
    const imUsd = await deployInterestBearingMasset(deployer, nexus, mUsd, delayedProxyAdmin, constants_1.DEAD_ADDRESS, "imUSD", "Interest bearing mStable USD (Polygon PoS)");
    await sleep(sleepTime);
    // Deploy Save Wrapper
    const saveWrapper = await deploy_utils_1.deployContract(new generated_1.SaveWrapper__factory(deployer), "SaveWrapper");
    // Deploy Savings Manager
    const savingsManager = await deploy_utils_1.deployContract(new generated_1.SavingsManager__factory(deployer), "SavingsManager", [
        nexus.address,
        mUsd.address,
        imUsd.address,
        math_1.simpleToExactAmount(9, 17),
        constants_1.ONE_DAY,
    ]);
    await sleep(sleepTime);
    // SaveWrapper contract approves the savings contract (imUSD) to spend its USD mAsset tokens (mUSD)
    await saveWrapper["approve(address,address)"](mUsd.address, imUsd.address);
    // SaveWrapper approves the mUSD contract to spend its bAsset tokens
    const bAssetAddresses = deployedUsdBassets.map((b) => b.bAssetContract.address);
    await saveWrapper["approve(address[],address)"](bAssetAddresses, mUsd.address);
    console.log("Successful token approvals from the SaveWrapper");
    await sleep(sleepTime);
    // Initialize Nexus Modules
    const moduleKeys = [constants_1.KEY_SAVINGS_MANAGER, constants_1.KEY_PROXY_ADMIN, constants_1.KEY_LIQUIDATOR];
    const moduleAddresses = [savingsManager.address, delayedProxyAdmin.address, liquidator.address];
    const moduleIsLocked = [false, true, false];
    const nexusTx = await nexus.connect(deployer).initialize(moduleKeys, moduleAddresses, moduleIsLocked, multiSigAddress);
    const nexusReceipt = await nexusTx.wait();
    console.log(`Nexus initialize status ${nexusReceipt.status} from receipt`);
    await sleep(sleepTime);
    if (hre.network.name !== "polygon_mainnet") {
        await mint(deployer, deployedUsdBassets, mUsd, math_1.simpleToExactAmount(20));
        await save(deployer, mUsd, imUsd, math_1.simpleToExactAmount(15));
    }
    else if (hre.network.name === "polygon_mainnet") {
        // Multimint 2 USD and then save 4
        await mint(deployer, deployedUsdBassets, mUsd, math_1.simpleToExactAmount(2));
        await save(deployer, mUsd, imUsd, math_1.simpleToExactAmount(4));
    }
});
config_1.task("deploy-polly-mint", "Deploys mUSD & System to a Polygon network").setAction(async (_, hre) => {
    const [deployer] = await hre.ethers.getSigners();
    const deployedUsdBassets = attachBassets(deployer, exports.mUsdBassets, [
        "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    ], [
        "0x1a13F4Ca1d028320A707D99520AbFefca3998b7F",
        "0x27F8D03b3a2196956ED754baDc28D73be8830A6e",
        "0x60D55F02A771d515e077c9C2403a1ef324885CeC",
    ]);
    const linkedAddress = {
        __$6a4be19f34d71a078def5cee18ccebcd10$__: "0xB9cCA2B53e8D7bC4cBDDCcb66d20B411B87d213f",
        __$3b19b776afde68cd758db0cae1b8e49f94$__: "0xB9E0408bE53a91A31828b3A175230f0dCd8c117e",
    };
    const mUsd = new generated_1.Masset__factory(linkedAddress, deployer).attach("0xE840B73E5287865EEc17d250bFb1536704B43B21");
    const imUsd = new generated_1.SavingsContract__factory(deployer).attach("0x5290Ad3d83476CA6A2b178Cd9727eE1EF72432af");
    // Multimint 2 USD and then save 4
    await mint(deployer, deployedUsdBassets, mUsd, math_1.simpleToExactAmount(2));
    await save(deployer, mUsd, imUsd, math_1.simpleToExactAmount(4));
});
config_1.task("deploy-polly-sub", "Deploys mUSD & System to a Polygon network").setAction(async (_, hre) => {
    const { network } = hre;
    const [deployer] = await hre.ethers.getSigners();
    // Deploy Nexus
    const nexus = new generated_1.Nexus__factory(deployer).attach("0x856e569904331Cb262D69bd9F33E4Cb39eA3efE9");
    // Deploy DelayedProxyAdmin
    const delayedProxyAdmin = new generated_1.DelayedProxyAdmin__factory(deployer).attach("0x9e002E3B526CF12392520cc22aA8800C9b59527a");
    let deployedUsdBassets;
    let multiSigAddress;
    if (network.name === "hardhat") {
        multiSigAddress = deployer.address;
        // Deploy mocked base USD assets
        deployedUsdBassets = await deployBassets(deployer, exports.mUsdBassets);
    }
    else if (network.name === "polygon_testnet") {
        multiSigAddress = "0xE1304aA964C5119C98E8AE554F031Bf3B21eC836"; // 1/3 Multisig
        // Attach to already deployed mocked bAssets
        deployedUsdBassets = attachBassets(deployer, exports.mUsdBassets, [
            "0x4fa81E591dC5dAf1CDA8f21e811BAEc584831673",
            "0xD84574BFE3294b472C74D7a7e3d3bB2E92894B48",
            "0x872093ee2BCb9951b1034a4AAC7f489215EDa7C2",
        ], [
            "0xA2De18B8AE0450D918EA5Bf5890CBA5dD7055A4f",
            "0x85581E4BDeDB67840876DF20eFeaA6926dfFa11E",
            "0xAD209ADbCDF8B6917E69E6BcF9D05592388B8ada",
        ]);
    }
    else if (network.name === "polygon_mainnet") {
        multiSigAddress = "0x4aA2Dd5D5387E4b8dcf9b6Bfa4D9236038c3AD43"; // 4/8 Multisig
        // Attach to 3rd party bAssets
        deployedUsdBassets = attachBassets(deployer, exports.mUsdBassets, [
            "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
            "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
            "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        ], [
            "0x1a13F4Ca1d028320A707D99520AbFefca3998b7F",
            "0x27F8D03b3a2196956ED754baDc28D73be8830A6e",
            "0x60D55F02A771d515e077c9C2403a1ef324885CeC",
        ]);
    }
    await sleep(sleepTime);
    // Deploy mAsset dependencies
    const massetLogic = new generated_1.MassetLogic__factory(deployer).attach("0x586aEa9943b6be5bA3e23B5cdFa7F05EfEA7aD23");
    const managerLib = new generated_1.MassetManager__factory(deployer).attach("0xb4159dFd94D81a838b3aaaf2329b4a16a967256E");
    const linkedAddress = {
        __$6a4be19f34d71a078def5cee18ccebcd10$__: massetLogic.address,
        __$3b19b776afde68cd758db0cae1b8e49f94$__: managerLib.address,
    };
    // Deploy mUSD Masset
    const mUsd = await deployMasset(deployer, linkedAddress, nexus, delayedProxyAdmin);
    await sleep(sleepTime);
    const { integrator, liquidator } = await deployAaveIntegration(deployer, nexus, mUsd, deployedUsdBassets.map((b) => b.bAssetContract.address), deployedUsdBassets.map((b) => b.pTokenContract.address), network.name);
    const config = {
        a: 300,
        limits: {
            min: math_1.simpleToExactAmount(5, 16),
            max: math_1.simpleToExactAmount(75, 16),
        },
    };
    const txMusd = await mUsd.initialize("mUSD", "mStable USD (Polygon PoS)", deployedUsdBassets.map((b) => ({
        addr: b.bAssetContract.address,
        integrator: network.name === "polygon_mainnet" ? integrator.address : constants_1.ZERO_ADDRESS,
        hasTxFee: false,
        status: 0,
    })), config, { gasLimit: 8000000 });
    console.log(`mUSD initialize tx ${txMusd.hash}`);
    const receiptMusd = await txMusd.wait();
    console.log(`mUSD initialize status ${receiptMusd.status} from receipt`);
    await sleep(sleepTime);
    // Deploy Interest Bearing mUSD
    const imUsd = await deployInterestBearingMasset(deployer, nexus, mUsd, delayedProxyAdmin, constants_1.DEAD_ADDRESS, "imUSD", "Interest bearing mStable USD (Polygon PoS)");
    await sleep(sleepTime);
    // Deploy Save Wrapper
    const saveWrapper = await deploy_utils_1.deployContract(new generated_1.SaveWrapper__factory(deployer), "SaveWrapper");
    // Deploy Savings Manager
    const savingsManager = await deploy_utils_1.deployContract(new generated_1.SavingsManager__factory(deployer), "SavingsManager", [
        nexus.address,
        mUsd.address,
        imUsd.address,
        math_1.simpleToExactAmount(9, 17),
        constants_1.ONE_DAY,
    ]);
    await sleep(sleepTime);
    // SaveWrapper contract approves the savings contract (imUSD) to spend its USD mAsset tokens (mUSD)
    await saveWrapper["approve(address,address)"](mUsd.address, imUsd.address);
    // SaveWrapper approves the mUSD contract to spend its bAsset tokens
    const bAssetAddresses = deployedUsdBassets.map((b) => b.bAssetContract.address);
    await saveWrapper["approve(address[],address)"](bAssetAddresses, mUsd.address);
    console.log("Successful token approvals from the SaveWrapper");
    await sleep(sleepTime);
    // Initialize Nexus Modules
    const moduleKeys = [constants_1.KEY_SAVINGS_MANAGER, constants_1.KEY_PROXY_ADMIN, constants_1.KEY_LIQUIDATOR];
    const moduleAddresses = [savingsManager.address, delayedProxyAdmin.address, liquidator.address];
    const moduleIsLocked = [false, true, false];
    const nexusTx = await nexus.connect(deployer).initialize(moduleKeys, moduleAddresses, moduleIsLocked, multiSigAddress);
    const nexusReceipt = await nexusTx.wait();
    console.log(`Nexus initialize status ${nexusReceipt.status} from receipt`);
    await sleep(sleepTime);
    if (hre.network.name !== "polygon_mainnet") {
        await mint(deployer, deployedUsdBassets, mUsd, math_1.simpleToExactAmount(20));
        await save(deployer, mUsd, imUsd, math_1.simpleToExactAmount(15));
    }
    else if (hre.network.name === "polygon_mainnet") {
        // Multimint 2 USD and then save 4
        await mint(deployer, deployedUsdBassets, mUsd, math_1.simpleToExactAmount(2));
        await save(deployer, mUsd, imUsd, math_1.simpleToExactAmount(4));
    }
});
config_1.task("liquidator-snap", "Dumps the config details of the liquidator on Polygon").setAction(async (_, hre) => {
    const { network } = hre;
    const [signer] = await hre.ethers.getSigners();
    if (network.name !== "polygon_mainnet")
        throw Error("Not connected to polygon_mainnet");
    // Polygon addresses
    const liquidatorAddress = "0x9F1C06CC13EDc7691a2Cf02E31FaAA64d57867e2";
    const integrationAddress = "0xeab7831c96876433dB9B8953B4e7e8f66c3125c3";
    const liquidator = generated_1.PLiquidator__factory.connect(liquidatorAddress, signer);
    const liquidationConfig = await liquidator.liquidations(integrationAddress);
    console.log(liquidationConfig);
});
module.exports = {};
//# sourceMappingURL=deployPolygon.js.map