/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */

const c_Nexus = artifacts.require('Nexus');
const c_OracleHub = artifacts.require('SimpleOracleHub');
const c_Systok = artifacts.require('Systok');
const c_MiniMeTokenFactory = artifacts.require("MiniMeTokenFactory");
const c_Manager = artifacts.require('Manager');
const c_CommonHelpers = artifacts.require('CommonHelpers');
const c_ForgeValidator = artifacts.require('ForgeValidator');

const c_StableMath = artifacts.require('StableMath');
const c_PublicStableMath = artifacts.require('PublicStableMath');

const c_Masset = artifacts.require('Masset')
const c_ForgeRewardsMUSD = artifacts.require('ForgeRewardsMUSD')
const c_MassetHelpers = artifacts.require('MassetHelpers')

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

  /** Common Libs */
  await deployer.deploy(c_MassetHelpers, { from: _ });
  await deployer.link(c_MassetHelpers, c_ForgeRewardsMUSD);
  await deployer.deploy(c_StableMath, { from: _ });
  await deployer.link(c_StableMath, c_Masset);
	await deployer.link(c_StableMath, c_PublicStableMath);
  await deployer.link(c_StableMath, c_ForgeValidator);
	await deployer.deploy(c_PublicStableMath, { from: _ });
  await deployer.deploy(c_CommonHelpers, { from: _ });
  await deployer.link(c_CommonHelpers, c_Masset);

  /** Nexus */
  await deployer.deploy(c_Nexus, governor, {from: governor});
  const d_Nexus = await c_Nexus.deployed();


  /** Systok */
  // await deployer.deploy(c_Systok, d_Nexus.address, fundManager, { from : _ });
  // const d_Systok = await c_Systok.deployed();
  await deployer.deploy(c_MiniMeTokenFactory, { from : _ });
  const d_MiniMeTokenFactory = await c_MiniMeTokenFactory.deployed();

  await deployer.deploy(c_Systok, d_MiniMeTokenFactory.address, d_Nexus.address, fundManager, { from : governor });
  const d_Systok = await c_Systok.deployed();

  /** OracleHub */
  await deployer.deploy(c_OracleHub, d_Nexus.address, oracleSource );
  const d_OracleHub = await c_OracleHub.deployed();


  /** Manager */
  await deployer.deploy(c_ForgeValidator);

  await deployer.deploy(c_Manager, d_Nexus.address);
  const d_Manager = await c_Manager.deployed();


  console.log(`[Nexus]: '${d_Nexus.address}'`)
  console.log(`[OracleHub]: '${d_OracleHub.address}'`)
  console.log(`[Systok (aka MTA)]: '${d_Systok.address}'`)
  console.log(`[Manager]: '${d_Manager.address}'`)
}
