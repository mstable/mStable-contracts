"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deployTx = exports.sendTx = exports.params = void 0;
const ethereumjs_util_1 = require("ethereumjs-util");
const errors_1 = require("hardhat/internal/core/errors");
const errors_list_1 = require("hardhat/internal/core/errors-list");
const chalk_1 = __importDefault(require("chalk"));
/**
 * Hardhat task CLI argument types
 */
exports.params = {
    address: {
        name: "address",
        parse: (argName, strValue) => strValue,
        validate: (argName, value) => {
            const isValid = typeof value === "string" && ethereumjs_util_1.isValidAddress(value);
            if (!isValid) {
                throw new errors_1.HardhatError(errors_list_1.ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
                    value,
                    name: argName,
                    type: "address",
                });
            }
        },
    },
    addressArray: {
        name: "address[]",
        parse: (argName, strValue) => strValue.split(","),
        validate: (argName, value) => {
            const isValid = Array.isArray(value) && value.every(ethereumjs_util_1.isValidAddress);
            if (!isValid) {
                throw new errors_1.HardhatError(errors_list_1.ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
                    value,
                    name: argName,
                    type: "address[]",
                });
            }
        },
    },
};
/**
 * Send a transaction (with given args) and return the result, with logging
 * @param contract      Ethers contract with signer
 * @param func          Function name to call
 * @param description   Description of call (optional)
 * @param args          Arguments for call
 */
const sendTx = async (contract, func, description, ...args) => {
    console.log(chalk_1.default.blue(`Sending transaction${description ? `: ${description}` : ""}`));
    if (args.length) {
        console.log(chalk_1.default.blue(`Using: ${chalk_1.default.yellow(contract.address)}:${chalk_1.default.blue(func)}{ ${chalk_1.default.blue(args.join(", "))} }`));
    }
    const tx = await contract.functions[func](...args);
    console.log(chalk_1.default.blue(`Transaction: ${chalk_1.default.yellow(tx.hash)}`));
    const receipt = await tx.wait();
    console.log(chalk_1.default.blue(`${chalk_1.default.greenBright("Confirmed.")} Gas used ${chalk_1.default.yellow(receipt.gasUsed)}`));
    return receipt;
};
exports.sendTx = sendTx;
/**
 * Deploy a transaction (with given args) and wait for it to complete, with logging
 * @param deployer     Ethers signer to deploy with
 * @param Factory      Ethers/Typechain contract factory
 * @param description  Description of deployment
 * @param args         Required arguments for deploy transaction
 */
const deployTx = async (deployer, Factory, description, ...args) => {
    console.log(chalk_1.default.blue(`Deploying: ${description}`));
    if (args.length) {
        console.log(chalk_1.default.blue(`Using: { ${chalk_1.default.yellow(args.join(", "))} }`));
    }
    const deployment = (await new Factory(deployer).deploy(...args));
    await deployment.deployed();
    const receipt = await deployment.deployTransaction.wait();
    console.log(chalk_1.default.blue(`Deploy transaction: ${chalk_1.default.yellow(receipt.transactionHash)}. Gas used ${chalk_1.default.yellow(receipt.gasUsed.toString())}`));
    console.log(chalk_1.default.greenBright(`Deployed to ${chalk_1.default.yellow(receipt.contractAddress)}`));
    return deployment;
};
exports.deployTx = deployTx;
//# sourceMappingURL=taskUtils.js.map