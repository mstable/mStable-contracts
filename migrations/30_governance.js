/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */

const c_MultiSig = artifacts.require('MultiSigWallet');

/** @dev Updates the min quorum on the governance multisig after initialisation has completed */
module.exports = async (deployer, network, accounts) => {

    // const [ _, governor, fundManager, oracleSource ] = accounts;

    // const newMinQuorum = 5;

    // const d_MultiSig = await c_MultiSig.deployed()


    // const txData = d_MultiSig.contract.methods.changeRequirement(newMinQuorum).encodeABI();
    // await d_MultiSig.submitTransaction(d_MultiSig.address, 0, txData, { from : governor });

}
