"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("ts-node/register");
require("tsconfig-paths/register");
const config_1 = require("hardhat/config");
const constants_1 = require("@utils/constants");
const math_1 = require("@utils/math");
const defaultConfig = {
    a: 120,
    limits: {
        min: math_1.simpleToExactAmount(5, 16),
        max: math_1.simpleToExactAmount(65, 16),
    },
};
config_1.task("deployMV3", "Deploys the mUSD V3 implementation").setAction(async (_, hre) => {
    const { ethers, network } = hre;
    const [deployer] = await ethers.getSigners();
    const nexus = network.name === "mainnet" ? "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3" : constants_1.DEAD_ADDRESS;
    const Logic = await ethers.getContractFactory("MassetLogic");
    const logicLib = await Logic.deploy();
    await logicLib.deployTransaction.wait();
    const Manager = await ethers.getContractFactory("MassetManager");
    const managerLib = await Manager.deploy();
    await managerLib.deployTransaction.wait();
    const Migrator = await ethers.getContractFactory("Migrator");
    const migratorLib = await Migrator.deploy();
    await migratorLib.deployTransaction.wait();
    const linkedAddress = {
        libraries: {
            MassetLogic: logicLib.address,
            MassetManager: managerLib.address,
        },
    };
    const massetFactory = await ethers.getContractFactory("MV3", linkedAddress);
    const size = massetFactory.bytecode.length / 2 / 1000;
    if (size > 24.576) {
        console.error(`Masset size is ${size} kb: ${size - 24.576} kb too big`);
    }
    else {
        console.log(`Masset = ${size} kb`);
    }
    const impl = await massetFactory.deploy(nexus);
    const receiptImpl = await impl.deployTransaction.wait();
    console.log(`Deployed to ${impl.address}. gas used ${receiptImpl.gasUsed}`);
    const Validator = await ethers.getContractFactory("InvariantValidator");
    const validator = await Validator.deploy();
    await validator.deployTransaction.wait();
    const data = await impl.interface.encodeFunctionData("upgrade", [validator.address, defaultConfig]);
    console.log(`Upgrade data:\n\n${data}\n\n`);
});
module.exports = {};
//# sourceMappingURL=deployMV3.js.map