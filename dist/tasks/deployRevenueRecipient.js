"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("ts-node/register");
require("tsconfig-paths/register");
const config_1 = require("hardhat/config");
const generated_1 = require("types/generated");
const math_1 = require("@utils/math");
config_1.task("deployRevenueRecipient", "Deploys an instance of revenue recipient contract").setAction(async (_, hre) => {
    const { ethers, network } = hre;
    const [deployer] = await ethers.getSigners();
    if (network.name !== "mainnet")
        throw Error("Invalid network");
    const config = {
        deployer: await deployer.getAddress(),
        tokens: [
            "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
            "0x945Facb997494CC2570096c74b5F66A3507330a1",
            "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2",
        ],
        amounts: [
            math_1.simpleToExactAmount(4993),
            math_1.simpleToExactAmount("8.50635", 15),
            math_1.simpleToExactAmount("6.99", 17),
            math_1.simpleToExactAmount(1428),
        ],
        weights: [math_1.simpleToExactAmount(25), math_1.simpleToExactAmount(2), math_1.simpleToExactAmount(6), math_1.simpleToExactAmount(17)],
        swapFee: math_1.simpleToExactAmount(5, 16),
        bFactory: "0x9424B1412450D0f8Fc2255FAf6046b98213B76Bd",
        factory: "0xed52D8E202401645eDAD1c0AA21e872498ce47D0",
        mAssets: ["0xe2f2a5C287993345a840Db3B0845fbC70f5935a5", "0x945Facb997494CC2570096c74b5F66A3507330a1"],
        minOuts: [math_1.simpleToExactAmount(3, 17), math_1.simpleToExactAmount(20000, 18)],
        dao: "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2",
        daoProxy: "0x7fFAF4ceD81E7c4E71b3531BD7948d7FA8f20329",
        nexus: "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3",
        balToken: "0xba100000625a3754423978a60c9317c58a424e3D",
    };
    const poolRights = {
        canPauseSwapping: false,
        canChangeSwapFee: true,
        canChangeWeights: true,
        canAddRemoveTokens: true,
        canWhitelistLPs: true,
        canChangeCap: false,
    };
    // Check balances
    const erc20Factory = await new generated_1.MockERC20__factory(deployer);
    const tokens = config.tokens.map((t) => erc20Factory.attach(t));
    const balances = await Promise.all(tokens.map((t) => t.balanceOf(config.deployer)));
    console.log("Checking balances...");
    balances.map((b, i) => {
        if (b.lt(config.amounts[i])) {
            throw new Error(`${config.tokens[i]} invalid balance`);
        }
        return 0;
    });
    // Deploy step 1
    const crpFactory = await generated_1.CRPFactory__factory.connect(config.factory, deployer);
    let tx = await crpFactory.newCrp(config.bFactory, {
        poolTokenSymbol: "mBPT1",
        poolTokenName: "mStable BPT 1",
        constituentTokens: config.tokens,
        tokenBalances: config.amounts,
        tokenWeights: config.weights,
        swapFee: config.swapFee,
    }, poolRights);
    console.log("Creating CRP... ", tx.hash);
    let receipt = await tx.wait();
    const chosenLog = receipt.logs.find((log) => log.address === config.factory);
    const poolAddress = `0x${chosenLog.topics[2].substring(26)}`;
    console.log("Pool address: ", poolAddress);
    // Deploy step 2 - just calls createPool() to deploy and fund the BPool
    console.log(`Approving ${tokens[0].address}...`);
    let approveTx = await tokens[0].approve(poolAddress, config.amounts[0]);
    await approveTx.wait();
    console.log(`Approving ${tokens[1].address}...`);
    approveTx = await tokens[1].approve(poolAddress, config.amounts[1]);
    await approveTx.wait();
    console.log(`Approving ${tokens[2].address}...`);
    approveTx = await tokens[2].approve(poolAddress, config.amounts[2]);
    await approveTx.wait();
    console.log(`Approving ${tokens[3].address}...`);
    approveTx = await tokens[3].approve(poolAddress, config.amounts[3]);
    await approveTx.wait();
    const crp = await generated_1.ConfigurableRightsPool__factory.connect(poolAddress, deployer);
    tx = await crp.createPool(math_1.simpleToExactAmount(10000));
    console.log(`Creating Pool... ${tx.hash}`);
    receipt = await tx.wait();
    // Transfer mBPT to DAO
    const poolToken = await erc20Factory.attach(poolAddress);
    const balance = await poolToken.balanceOf(config.deployer);
    tx = await poolToken.transfer(config.dao, balance);
    console.log(`Transferring tokens to DAO... ${tx.hash}`);
    await tx.wait();
    // Deploy RevenueRecipient contract
    const recipient = await new generated_1.RevenueRecipient__factory(deployer).deploy(config.nexus, poolAddress, config.balToken, config.mAssets, config.minOuts);
    console.log(`Deploying recipient... ${tx.hash}`);
    receipt = await recipient.deployTransaction.wait();
    console.log(`Deployed Recipient to ${recipient.address}. gas used ${receipt.gasUsed}`);
    // Deploy step 3 - Complete setup
    //  - Whitelist RevenueRecipient as LP
    tx = await crp.whitelistLiquidityProvider(recipient.address);
    console.log(`Whitelisting recipient... ${tx.hash}`);
    receipt = await tx.wait();
    //  - Transfer ownership to DSProxy
    tx = await crp.setController(config.daoProxy);
    console.log(`Transferring ownership... ${tx.hash}`);
    receipt = await tx.wait();
    // Finalise via governance:
    //  - Update SavingsRate in SavingsManager
    //  - Add RevenueRecipient address in SavingsManager
});
module.exports = {};
//# sourceMappingURL=deployRevenueRecipient.js.map