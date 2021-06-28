"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("ts-node/register");
require("tsconfig-paths/register");
const constants_1 = require("@utils/constants");
const config_1 = require("hardhat/config");
const utils_1 = require("ethers/lib/utils");
const generated_1 = require("types/generated");
const math_1 = require("@utils/math");
const tokens_1 = require("./utils/tokens");
const deploy_utils_1 = require("./utils/deploy-utils");
const defender_utils_1 = require("./utils/defender-utils");
const COEFF = 48;
const deployFasset = async (sender, name, symbol, decimals = 18, initialMint = 500000) => {
    // Implementation
    const impl = await new generated_1.MockInitializableToken__factory(sender).deploy();
    await impl.deployTransaction.wait();
    // Initialization Data
    const data = impl.interface.encodeFunctionData("initialize", [name, symbol, decimals, await sender.getAddress(), initialMint]);
    // Proxy
    const proxy = await new generated_1.AssetProxy__factory(sender).deploy(impl.address, constants_1.DEAD_ADDRESS, data);
    const receipt = await proxy.deployTransaction.wait();
    console.log(`Deployed ${name} (${symbol}) to address ${proxy.address}. gas used ${receipt.gasUsed}`);
    return new generated_1.MockERC20__factory(sender).attach(proxy.address);
};
const deployFeederPool = async (sender, addresses, ethers, feederData) => {
    // Invariant Validator
    let feederPoolFactory;
    if (addresses.feederLogic && addresses.feederManager) {
        console.log(`Using FeederLogic ${addresses.feederLogic.address} and FeederManager ${addresses.feederManager.address}`);
        const linkedAddress = {
            __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: addresses.feederManager.address,
            __$7791d1d5b7ea16da359ce352a2ac3a881c$__: addresses.feederLogic.address,
        };
        // Implementation
        feederPoolFactory = new generated_1.FeederPool__factory(linkedAddress, sender);
    }
    else {
        console.log(`Deploying FeederLogic`);
        const feederLogic = await new generated_1.FeederLogic__factory(sender).deploy();
        const receiptFeederLogic = await feederLogic.deployTransaction.wait();
        console.log(`Deployed FeederLogic to ${feederLogic.address}. gas used ${receiptFeederLogic.gasUsed}`);
        // External linked library
        const Manager = await ethers.getContractFactory("FeederManager");
        const managerLib = await Manager.deploy();
        const receiptManager = await managerLib.deployTransaction.wait();
        console.log(`Deployed FeederManager library to ${managerLib.address}. gas used ${receiptManager.gasUsed}`);
        const linkedAddress = {
            __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: managerLib.address,
            __$7791d1d5b7ea16da359ce352a2ac3a881c$__: feederLogic.address,
        };
        // Implementation
        feederPoolFactory = new generated_1.FeederPool__factory(linkedAddress, sender);
    }
    console.log(`Deploying FeederPool impl with Nexus ${addresses.nexus} and mAsset ${feederData.mAsset.address}`);
    const impl = await feederPoolFactory.deploy(addresses.nexus, feederData.mAsset.address);
    const receiptImpl = await impl.deployTransaction.wait();
    console.log(`Deployed FeederPool impl to ${impl.address}. gas used ${receiptImpl.gasUsed}`);
    // Initialization Data
    const mpAssets = (await feederPoolFactory.attach(feederData.mAsset.address).getBassets())[0].map((p) => p[0]);
    console.log(`mpAssets. count = ${mpAssets.length}, list: `, mpAssets);
    console.log(`Initializing FeederPool with: ${feederData.name}, ${feederData.symbol}, mAsset ${feederData.mAsset.address}, fAsset ${feederData.fAsset.contract.address}, A: ${feederData.config.a.toString()}, min: ${utils_1.formatEther(feederData.config.limits.min)}, max: ${utils_1.formatEther(feederData.config.limits.max)}`);
    const data = impl.interface.encodeFunctionData("initialize", [
        feederData.name,
        feederData.symbol,
        {
            addr: feederData.mAsset.address,
            integrator: constants_1.ZERO_ADDRESS,
            hasTxFee: false,
            status: 0,
        },
        {
            addr: feederData.fAsset.address,
            integrator: feederData.fAsset.integrator,
            hasTxFee: false,
            status: 0,
        },
        mpAssets,
        feederData.config,
    ]);
    console.log(`Deploying FeederPool proxy with impl: ${impl.address} and admin ${addresses.proxyAdmin}`);
    const feederPoolProxy = await new generated_1.AssetProxy__factory(sender).deploy(impl.address, addresses.proxyAdmin, data);
    const receiptProxy = await feederPoolProxy.deployTransaction.wait();
    console.log(`Deployed FeederPool proxy to address ${feederPoolProxy.address}. gas used ${receiptProxy.gasUsed}`);
    // Create a FeederPool contract pointing to the deployed proxy contract
    return feederPoolFactory.attach(feederPoolProxy.address);
};
const mint = async (sender, bAssets, feederData) => {
    // e.e. $4e18 * 1e18 / 1e18 = 4e18
    // e.g. 4e18 * 1e18 / 5e22 = 8e13 or 0.00008
    const scaledTestQty = math_1.simpleToExactAmount(4).mul(math_1.simpleToExactAmount(1)).div(feederData.priceCoeff);
    // Approve spending
    const approvals = [];
    // eslint-disable-next-line
    for (const bAsset of bAssets) {
        // eslint-disable-next-line
        const dec = await bAsset.contract.decimals();
        const approval = dec === 18 ? scaledTestQty : scaledTestQty.div(math_1.simpleToExactAmount(1, math_1.BN.from(18).sub(dec)));
        approvals.push(approval);
        // eslint-disable-next-line
        const tx = await bAsset.contract.approve(feederData.pool.address, approval);
        // eslint-disable-next-line
        const receiptApprove = await tx.wait();
        console.log(
        // eslint-disable-next-line
        `Approved FeederPool to transfer ${utils_1.formatUnits(approval, dec)} ${bAsset.symbol} from ${await sender.getAddress()}. gas used ${receiptApprove.gasUsed}`);
    }
    // Mint
    console.log(bAssets.map(() => scaledTestQty.toString()), await Promise.all(bAssets.map(async (b) => (await b.contract.allowance(await sender.getAddress(), feederData.pool.address)).toString())), await Promise.all(bAssets.map(async (b) => (await b.contract.balanceOf(await sender.getAddress())).toString())), bAssets.map((b) => b.address), (await feederData.pool.getBassets())[0].map((b) => b[0]), await feederData.pool.mAsset());
    const tx = await feederData.pool.mintMulti(bAssets.map((b) => b.address), approvals, 1, await sender.getAddress());
    const receiptMint = await tx.wait();
    // Log minted amount
    const mAssetAmount = utils_1.formatEther(await feederData.pool.totalSupply());
    console.log(`Minted ${mAssetAmount} fpToken from ${utils_1.formatEther(scaledTestQty)} Units for each [mAsset, fAsset]. gas used ${receiptMint.gasUsed}`);
};
const deployVault = async (sender, addresses, lpToken, priceCoeff, vaultName, vaultSymbol, depositAmt = math_1.BN.from(0)) => {
    console.log(`Deploying Vault Impl with LP token ${lpToken}, director ${addresses.boostDirector}, priceCoeff ${utils_1.formatEther(priceCoeff)}, coeff ${COEFF}, mta: ${addresses.mta}}`);
    const vImpl = await new generated_1.BoostedSavingsVault__factory(sender).deploy(addresses.nexus, lpToken, addresses.boostDirector, priceCoeff, COEFF, addresses.mta);
    const receiptVaultImpl = await vImpl.deployTransaction.wait();
    console.log(`Deployed Vault Impl to ${vImpl.address}. gas used ${receiptVaultImpl.gasUsed}`);
    // Data
    console.log(`Initializing Vault with: distributor: ${addresses.rewardsDistributor}, admin ${addresses.proxyAdmin}, ${vaultName}, ${vaultSymbol}`);
    const vData = vImpl.interface.encodeFunctionData("initialize", [addresses.rewardsDistributor, vaultName, vaultSymbol]);
    // Proxy
    const vProxy = await new generated_1.AssetProxy__factory(sender).deploy(vImpl.address, addresses.proxyAdmin, vData);
    const receiptVaultProxy = await vProxy.deployTransaction.wait();
    console.log(`Deployed Vault Proxy to ${vProxy.address}. gas used ${receiptVaultProxy.gasUsed}`);
    if (depositAmt.gt(0)) {
        const erc20 = await new generated_1.MockERC20__factory(sender).attach(lpToken);
        console.log(`Approving the vault deposit of ${depositAmt.toString()}. Your balance: ${(await erc20.balanceOf(await sender.getAddress())).toString()}`);
        const approval = await erc20.approve(vProxy.address, depositAmt);
        await approval.wait();
        console.log(`Depositing to vault...`);
        const vault = new generated_1.BoostedSavingsVault__factory(sender).attach(vProxy.address);
        const deposit = await vault["stake(uint256)"](depositAmt);
        await deposit.wait();
    }
    return generated_1.BoostedSavingsVault__factory.connect(vProxy.address, sender);
};
const deployFeederWrapper = async (sender, feederPools, vaults) => {
    // Deploy FeederWrapper
    const feederWrapper = await new generated_1.FeederWrapper__factory(sender).deploy();
    const deployReceipt = await feederWrapper.deployTransaction.wait();
    console.log(`Deployed FeederWrapper to ${feederWrapper.address}. gas used ${deployReceipt.gasUsed}`);
    // Get tokens to approve
    const len = feederPools.length;
    // eslint-disable-next-line
    for (let i = 0; i < len; i++) {
        const [[{ addr: massetAddr }, { addr: fassetAddr }]] = await feederPools[i].getBassets();
        const masset = generated_1.Masset__factory.connect(massetAddr, sender);
        const [bassets] = await masset.getBassets();
        const assets = [massetAddr, fassetAddr, ...bassets.map(({ addr }) => addr)];
        // Make the approval in one tx
        const approveTx = await feederWrapper["approve(address,address,address[])"](feederPools[i].address, vaults[i].address, assets);
        const approveReceipt = await approveTx.wait();
        console.log(`Approved FeederWrapper tokens. gas used ${approveReceipt.gasUsed}`);
    }
    return feederWrapper;
};
config_1.task("fSize", "Gets the bytecode size of the FeederPool.sol contract").setAction(async (_, hre) => {
    const { ethers } = hre;
    const [deployer] = await ethers.getSigners();
    const linkedAddress = {
        __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: constants_1.DEAD_ADDRESS,
        __$7791d1d5b7ea16da359ce352a2ac3a881c$__: constants_1.DEAD_ADDRESS,
    };
    // Implementation
    const feederPoolFactory = new generated_1.FeederPool__factory(linkedAddress, deployer);
    let size = feederPoolFactory.bytecode.length / 2 / 1000;
    if (size > 24.576) {
        console.error(`FeederPool size is ${size} kb: ${size - 24.576} kb too big`);
    }
    else {
        console.log(`FeederPool = ${size} kb`);
    }
    const logic = await new generated_1.FeederLogic__factory(deployer);
    size = logic.bytecode.length / 2 / 1000;
    console.log(`FeederLogic = ${size} kb`);
    // External linked library
    const manager = await ethers.getContractFactory("FeederManager");
    size = manager.bytecode.length / 2 / 1000;
    console.log(`FeederManager = ${size} kb`);
});
config_1.task("deployFeeder", "Deploys a feeder pool").setAction(async (_, hre) => {
    const { ethers, network } = hre;
    const [deployer] = await ethers.getSigners();
    const addresses = network.name === "ropsten"
        ? {
            mta: "0x273bc479E5C21CAA15aA8538DecBF310981d14C0",
            staking: "0x77f9bf80e0947408f64faa07fd150920e6b52015",
            nexus: "0xeD04Cd19f50F893792357eA53A549E23Baf3F6cB",
            proxyAdmin: "0x2d369F83E9DC764a759a74e87a9Bc542a2BbfdF0",
            rewardsDistributor: "0x99B62B75E3565bEAD786ddBE2642E9c40aA33465",
        }
        : {
            mta: constants_1.DEAD_ADDRESS,
            staking: (await new generated_1.MockERC20__factory(deployer).deploy("Stake", "ST8", 18, constants_1.DEAD_ADDRESS, 1)).address,
            nexus: constants_1.DEAD_ADDRESS,
            proxyAdmin: constants_1.DEAD_ADDRESS,
            rewardsDistributor: constants_1.DEAD_ADDRESS,
        };
    // 1. Deploy fAsset
    const fAsset = await deployFasset(deployer, "Feeder pool Asset", "fAST", 18, 1000000);
    console.log(fAsset.address);
    console.log(await fAsset.decimals());
    console.log(await fAsset.symbol());
    const deployedFasset = {
        integrator: constants_1.ZERO_ADDRESS,
        txFee: false,
        contract: fAsset,
        address: fAsset.address,
        symbol: await fAsset.symbol(),
    };
    const pairs = network.name === "ropsten"
        ? [
            {
                mAsset: "0x4A677A48A790f26eac4c97f495E537558Abf6A79",
                fAsset: fAsset.address,
                aToken: constants_1.ZERO_ADDRESS,
                priceCoeff: math_1.simpleToExactAmount(30000),
                A: math_1.BN.from(100),
            },
        ]
        : [
            {
                // NOTE - mAsset must be replaced with an addr before running this
                mAsset: "0xC8B899851026f49678caa461ABFfe5faa9EfbA28",
                fAsset: fAsset.address,
                aToken: constants_1.ZERO_ADDRESS,
                priceCoeff: math_1.simpleToExactAmount(30000),
                A: math_1.BN.from(100),
            },
        ];
    const mAssetContract = await new generated_1.MockERC20__factory(deployer).attach(pairs[0].mAsset);
    const deployedMasset = {
        integrator: constants_1.ZERO_ADDRESS,
        txFee: false,
        contract: mAssetContract,
        address: pairs[0].mAsset,
        symbol: await mAssetContract.symbol(),
    };
    const feederData = {
        mAsset: deployedMasset,
        fAsset: deployedFasset,
        aToken: constants_1.ZERO_ADDRESS,
        name: `${deployedMasset.symbol}/${deployedFasset.symbol} FeederPool`,
        symbol: `fP${deployedMasset.symbol}/${deployedFasset.symbol}`,
        config: {
            a: math_1.BN.from(100),
            limits: {
                min: math_1.simpleToExactAmount(3, 16),
                max: math_1.simpleToExactAmount(97, 16),
            },
        },
        vaultName: `${deployedMasset.symbol}/${deployedFasset.symbol} fPool Vault`,
        vaultSymbol: `v-fP${deployedMasset.symbol}/${deployedFasset.symbol}`,
        priceCoeff: math_1.simpleToExactAmount(30000),
    };
    const director = await new generated_1.BoostDirector__factory(deployer).deploy(addresses.nexus, addresses.staking);
    await director.deployTransaction.wait();
    addresses.boostDirector = director.address;
    // 2. Deploy Feeder Pool
    const feederPool = await deployFeederPool(deployer, addresses, ethers, feederData);
    feederData.pool = feederPool;
    // 3. Mint initial supply
    await mint(deployer, [deployedMasset, deployedFasset], feederData);
    // 4. Rewards Contract
    await deployVault(deployer, addresses, feederData.pool.address, feederData.priceCoeff, feederData.vaultName, feederData.vaultSymbol);
    // TODO
    // - Fund vault
    // - deploy InterestValidator
    // - deploy feederRouter
    // - add InterestValidator as a module
});
config_1.task("deployFeeder-mainnet", "Deploys all the feeder pools and required contracts").setAction(async (_, hre) => {
    const { ethers, network } = hre;
    if (network.name !== "mainnet")
        throw Error("Must be mainnet");
    const [deployer] = await ethers.getSigners();
    const addresses = {
        mta: "0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2",
        staking: "0xae8bc96da4f9a9613c323478be181fdb2aa0e1bf",
        nexus: "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3",
        proxyAdmin: "0x5c8eb57b44c1c6391fc7a8a0cf44d26896f92386",
        rewardsDistributor: "0x04dfdfa471b79cc9e6e8c355e6c71f8ec4916c50",
        aave: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
    };
    const pairs = [
        // mBTC / hBTC
        {
            mAsset: "0x945facb997494cc2570096c74b5f66a3507330a1",
            fAsset: "0x0316EB71485b0Ab14103307bf65a021042c6d380",
            aToken: constants_1.ZERO_ADDRESS,
            priceCoeff: math_1.simpleToExactAmount(58000),
            A: math_1.BN.from(325),
        },
        // mBTC / tBTC
        {
            mAsset: "0x945facb997494cc2570096c74b5f66a3507330a1",
            fAsset: "0x8dAEBADE922dF735c38C80C7eBD708Af50815fAa",
            aToken: constants_1.ZERO_ADDRESS,
            priceCoeff: math_1.simpleToExactAmount(58000),
            A: math_1.BN.from(175),
        },
        // mUSD / bUSD
        {
            mAsset: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
            fAsset: "0x4fabb145d64652a948d72533023f6e7a623c7c53",
            aToken: "0xa361718326c15715591c299427c62086f69923d9",
            priceCoeff: math_1.simpleToExactAmount(1),
            A: math_1.BN.from(500),
        },
        // mUSD / GUSD
        {
            mAsset: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
            fAsset: "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd",
            aToken: "0xD37EE7e4f452C6638c96536e68090De8cBcdb583",
            priceCoeff: math_1.simpleToExactAmount(1),
            A: math_1.BN.from(225),
        },
    ];
    // 1.    Deploy boostDirector & Libraries
    const start = await deployer.getBalance();
    console.log(`\n~~~~~ PHASE 1 - LIBS ~~~~~\n\n`);
    console.log("Remaining ETH in deployer: ", utils_1.formatUnits(await deployer.getBalance()));
    console.log(`Deploying BoostDirector with ${addresses.nexus}, ${addresses.staking}`);
    const director = await new generated_1.BoostDirector__factory(deployer).deploy(addresses.nexus, addresses.staking);
    await director.deployTransaction.wait();
    console.log(`Deployed Director to ${director.address}`);
    addresses.boostDirector = director.address;
    console.log(`Deploying FeederLogic`);
    const feederLogic = await new generated_1.FeederLogic__factory(deployer).deploy();
    const receiptFeederLogic = await feederLogic.deployTransaction.wait();
    console.log(`Deployed FeederLogic to ${feederLogic.address}. gas used ${receiptFeederLogic.gasUsed}`);
    addresses.feederLogic = feederLogic;
    // External linked library
    const Manager = await ethers.getContractFactory("FeederManager");
    const managerLib = await Manager.deploy();
    const receiptManager = await managerLib.deployTransaction.wait();
    console.log(`Deployed FeederManager library to ${managerLib.address}. gas used ${receiptManager.gasUsed}`);
    addresses.feederManager = managerLib;
    // 2.1   Deploy imBTC vault & deposit
    console.log(`\n~~~~~ PHASE 2 - POOLS ~~~~~\n\n`);
    console.log("Remaining ETH in deployer: ", utils_1.formatUnits(await deployer.getBalance()));
    const imBTC = await deployVault(deployer, addresses, "0x17d8cbb6bce8cee970a4027d1198f6700a7a6c24", math_1.simpleToExactAmount(5800), "imBTC Vault", "v-imBTC", math_1.simpleToExactAmount(3, 15));
    console.log(`imBTC vault deployed to ${imBTC.address}`);
    // 2.2   For each fAsset
    //        - fetch fAsset & mAsset
    const data = [];
    // eslint-disable-next-line
    for (const pair of pairs) {
        const mAssetContract = await new generated_1.MockERC20__factory(deployer).attach(pair.mAsset);
        const fAssetContract = await new generated_1.MockERC20__factory(deployer).attach(pair.fAsset);
        const deployedMasset = {
            integrator: constants_1.ZERO_ADDRESS,
            txFee: false,
            contract: mAssetContract,
            address: pair.mAsset,
            symbol: await mAssetContract.symbol(),
        };
        const deployedFasset = {
            integrator: constants_1.ZERO_ADDRESS,
            txFee: false,
            contract: fAssetContract,
            address: pair.fAsset,
            symbol: await fAssetContract.symbol(),
        };
        data.push({
            mAsset: deployedMasset,
            fAsset: deployedFasset,
            aToken: pair.aToken,
            name: `${deployedMasset.symbol}/${deployedFasset.symbol} Feeder Pool`,
            symbol: `fP${deployedMasset.symbol}/${deployedFasset.symbol}`,
            config: {
                a: pair.A,
                limits: {
                    min: math_1.simpleToExactAmount(10, 16),
                    max: math_1.simpleToExactAmount(90, 16),
                },
            },
            vaultName: `${deployedMasset.symbol}/${deployedFasset.symbol} fPool Vault`,
            vaultSymbol: `v-fP${deployedMasset.symbol}/${deployedFasset.symbol}`,
            priceCoeff: pair.priceCoeff,
        });
    }
    //        - create fPool (nexus, mAsset, name, integrator, config)
    // eslint-disable-next-line
    for (const poolData of data) {
        console.log(`\n~~~~~ POOL ${poolData.symbol} ~~~~~\n\n`);
        console.log("Remaining ETH in deployer: ", utils_1.formatUnits(await deployer.getBalance()));
        // Deploy Feeder Pool
        const feederPool = await deployFeederPool(deployer, addresses, ethers, poolData);
        poolData.pool = feederPool;
        // Mint initial supply
        await mint(deployer, [poolData.mAsset, poolData.fAsset], poolData);
        // Rewards Contract
        const bal = await feederPool.balanceOf(await deployer.getAddress());
        const vault = await deployVault(deployer, addresses, poolData.pool.address, poolData.priceCoeff, poolData.vaultName, poolData.vaultSymbol, bal);
        poolData.vault = vault;
    }
    // 3.    Clean
    //        - initialize boostDirector with pools
    console.log(`\n~~~~~ PHASE 3 - ETC ~~~~~\n\n`);
    console.log("Remaining ETH in deployer: ", utils_1.formatUnits(await deployer.getBalance()));
    console.log(`Initializing BoostDirector...`, [...data.map((d) => d.vault.address), imBTC.address]);
    const directorInit = await director.initialize(data.map((d) => d.vault.address));
    await directorInit.wait();
    //        - if aToken != 0: deploy integrator & initialize with fPool & aToken addr
    // eslint-disable-next-line
    for (const poolData of data) {
        if (poolData.aToken !== constants_1.ZERO_ADDRESS) {
            const integration = await new generated_1.AaveV2Integration__factory(deployer).deploy(addresses.nexus, poolData.pool.address, addresses.aave, constants_1.DEAD_ADDRESS);
            console.log(`Deploying integration for ${poolData.symbol} at pool ${poolData.pool.address}`);
            await integration.deployTransaction.wait();
            console.log(`Deployed integration to ${integration.address}`);
            console.log(`Initializing pToken ${poolData.aToken} for bAsset ${poolData.fAsset.address}...`);
            const init = await integration.initialize([poolData.fAsset.address], [poolData.aToken]);
            await init.wait();
        }
    }
    //        - deploy feederRouter
    console.log("Deploying feederRouter...");
    await deployFeederWrapper(deployer, data.map((d) => d.pool), data.map((d) => d.vault));
    //        - deploy interestValidator
    const interestValidator = await new generated_1.InterestValidator__factory(deployer).deploy(addresses.nexus);
    const deployReceipt = await interestValidator.deployTransaction.wait();
    console.log(`Deployed Interest Validator to ${interestValidator.address}. gas used ${deployReceipt.gasUsed}`);
    console.log(`\n~~~~~ 🥳 CONGRATS! Time for Phase 4 🥳 ~~~~~\n\n`);
    // 4.    Post
    //        -  Fund small amt to vaults
    //        -  migrate GUSD & bUSD to aave
    //        -  Add InterestValidator as a module
    //        -  Fund vaults
    console.log("Remaining ETH in deployer: ", utils_1.formatUnits(await deployer.getBalance()));
    const end = await deployer.getBalance();
    console.log("Total ETH used: ", utils_1.formatUnits(end.sub(start)));
});
config_1.task("deployIronBank", "Deploys mUSD Iron Bank (CREAM) integration contracts for GUSD and BUSD Feeder Pools")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", config_1.types.string)
    .setAction(async (taskArgs, hre) => {
    const nexusAddress = "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3";
    let deployer;
    if (hre.network.name === "mainnet") {
        deployer = await defender_utils_1.getDefenderSigner(taskArgs.speed);
    }
    else {
        ;
        [deployer] = await hre.ethers.getSigners();
    }
    // CREAM's ABI is the same as Compound so can use the CompoundIntegration contract
    const gusdIntegration = await deploy_utils_1.deployContract(new generated_1.CompoundIntegration__factory(deployer), "CREAM Integration for GUSD FP", [nexusAddress, tokens_1.GUSD.feederPool, tokens_1.CREAM.address]);
    let tx = await gusdIntegration.initialize([tokens_1.mUSD.address], [tokens_1.cyMUSD.address]);
    await deploy_utils_1.logTxDetails(tx, "initialize GUSD Iron Bank integration");
    const busdIntegration = await deploy_utils_1.deployContract(new generated_1.CompoundIntegration__factory(deployer), "CREAM Integration for BUSD FP", [nexusAddress, tokens_1.BUSD.feederPool, tokens_1.CREAM.address]);
    tx = await busdIntegration.initialize([tokens_1.mUSD.address], [tokens_1.cyMUSD.address]);
    await deploy_utils_1.logTxDetails(tx, "initialize BUSD Iron Bank integration");
    // This will be done via the delayedProxyAdmin on mainnet
    // Governor approves Liquidator to spend the reward (CREAM) token
    const approveRewardTokenData = await gusdIntegration.interface.encodeFunctionData("approveRewardToken");
    console.log(`\napproveRewardToken data for GUSD and BUSD: ${approveRewardTokenData}`);
    const gudsFp = generated_1.FeederPool__factory.connect(tokens_1.GUSD.address, deployer);
    const gusdMigrateBassetsData = await gudsFp.interface.encodeFunctionData("migrateBassets", [
        [tokens_1.mUSD.address],
        gusdIntegration.address,
    ]);
    console.log(`GUSD Feeder Pool migrateBassets tx data: ${gusdMigrateBassetsData}`);
    const budsFp = generated_1.FeederPool__factory.connect(tokens_1.BUSD.address, deployer);
    const busdMigrateBassetsData = await budsFp.interface.encodeFunctionData("migrateBassets", [
        [tokens_1.mUSD.address],
        busdIntegration.address,
    ]);
    console.log(`BUSD Feeder Pool migrateBassets tx data: ${busdMigrateBassetsData}`);
});
module.exports = {};
//# sourceMappingURL=deployFeeders.js.map