/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */

const c_Governance = artifacts.require('GovernancePortal');

/** @dev Updates the min quorum on the governance multisig after initialisation has completed */
module.exports = async (deployer, network, accounts) => {

  const [ _, governor, fundManager, oracleSource ] = accounts;

  const newMinQuorum = 4;

  const d_Governance = await c_Governance.deployed()


  const txData = d_Governance.contract.methods.changeRequirement(newMinQuorum).encodeABI();
  await d_Governance.submitTransaction(d_Governance.address, 0, txData, { from : governor });

  console.log(await d_Governance.required());
}
