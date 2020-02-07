/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */

const c_MultiSig = artifacts.require('MultiSigWallet');
const c_Nexus = artifacts.require('Nexus');
const c_OracleHub = artifacts.require('SimpleOracleHub');
const c_Systok = artifacts.require('Systok');
const c_Manager = artifacts.require('Manager');
const c_CommonHelpers = artifacts.require('CommonHelpers');
const c_ForgeValidator = artifacts.require('ForgeValidator');

const c_StableMath = artifacts.require('StableMath');

const c_Masset = artifacts.require('Masset')

async function publishModuleThroughMultisig(d_Nexus, d_MultiSig, key, address, governor) {
  const txData = d_Nexus.contract.methods.addModule(key, address).encodeABI();
  await d_MultiSig.submitTransaction(d_Nexus.address, 0, txData, { from : governor });
}

async function lockModuleThroughMultisig(d_Nexus, d_MultiSig, key, governor) {
  const txData = d_Nexus.contract.methods.lockModule(key).encodeABI();
  await d_MultiSig.submitTransaction(d_Nexus.address, 0, txData, { from : governor });
}

module.exports = async (deployer, network, accounts) => {

  // Address of the price source to whitelist in the OracleHub
  // const oracleSource = [];
  const [ _, governor, fundManager, oracleSource, feePool ] = accounts;

  // CRITICAL - Owners of the Governance Portal Multisig!!!
  const govOwners = accounts.slice(0, 5);
  const minQuorum = 1;


  /** Common Libs */
  await deployer.deploy(c_StableMath, { from: _ });

  await deployer.deploy(c_CommonHelpers, { from: _ });


  /** Governor - multisig */
  await deployer.deploy(c_MultiSig, govOwners, minQuorum);
  const d_MultiSig = await c_MultiSig.deployed();


  /** Nexus */
  await deployer.deploy(c_Nexus, d_MultiSig.address);
  const d_Nexus = await c_Nexus.deployed();


  /** Systok */
  await deployer.deploy(c_Systok, d_Nexus.address, fundManager, { from : _ });
  const d_Systok = await c_Systok.deployed();

  await publishModuleThroughMultisig(d_Nexus, d_MultiSig, await d_Nexus.Key_Systok(), d_Systok.address, governor);
  await lockModuleThroughMultisig(d_Nexus, d_MultiSig, await d_Nexus.Key_Systok(), governor);

  /** OracleHub */

  await deployer.deploy(c_OracleHub, d_Nexus.address, oracleSource );
  const d_OracleHub = await c_OracleHub.deployed();

  await publishModuleThroughMultisig(d_Nexus, d_MultiSig, await d_Nexus.Key_OracleHub(), d_OracleHub.address, governor);


  /** Manager */

  // Deploy ForgeValidator
  await deployer.link(c_StableMath, c_ForgeValidator);
  await deployer.deploy(c_ForgeValidator);
  const d_ForgeValidator = await c_ForgeValidator.deployed();

  await deployer.link(c_StableMath, c_Manager);
  await deployer.deploy(c_Manager, d_Nexus.address, d_ForgeValidator.address);
  const d_Manager = await c_Manager.deployed();

  await publishModuleThroughMultisig(d_Nexus, d_MultiSig, await d_Nexus.Key_Manager(), d_Manager.address, governor);


  /** Masset prep */
  await deployer.link(c_StableMath, c_Masset);
  await deployer.link(c_CommonHelpers, c_Masset);


  console.log(`[Nexus]: '${d_Nexus.address}'`)
  console.log(`[OracleHub]: '${d_OracleHub.address}'`)
  console.log(`[Systok (aka MTA)]: '${d_Systok.address}'`)
  console.log(`[Governor (Multisig)]: '${d_MultiSig.address}'`)
  console.log(`[Manager]: '${d_Manager.address}'`)
}
