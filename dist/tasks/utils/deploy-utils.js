"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logTxDetails = exports.deployContract = void 0;
const units_1 = require("@ethersproject/units");
const deployContract = async (contractFactory, contractName = "Contract", contractorArgs = []) => {
    console.log(`Deploying ${contractName}`);
    const contract = (await contractFactory.deploy(...contractorArgs));
    const contractReceipt = await contract.deployTransaction.wait();
    const ethUsed = contractReceipt.gasUsed.mul(contract.deployTransaction.gasPrice);
    const abiEncodedConstructorArgs = contract.interface.encodeDeploy(contractorArgs);
    console.log(`Deployed ${contractName} to ${contract.address}, gas used ${contractReceipt.gasUsed}, eth ${units_1.formatUnits(ethUsed)}`);
    console.log(`ABI encoded args: ${abiEncodedConstructorArgs}`);
    return contract;
};
exports.deployContract = deployContract;
const logTxDetails = async (tx, method) => {
    console.log(`Sent ${method} transaction with hash ${tx.hash} from ${tx.from} with gas price ${tx.gasPrice.toNumber() / 1e9} Gwei`);
    const receipt = await tx.wait();
    // Calculate tx cost in Wei
    const txCost = receipt.gasUsed.mul(tx.gasPrice);
    console.log(`Processed ${method} tx in block ${receipt.blockNumber}, using ${receipt.gasUsed} gas costing ${units_1.formatUnits(txCost)} ETH`);
    return receipt;
};
exports.logTxDetails = logTxDetails;
//# sourceMappingURL=deploy-utils.js.map