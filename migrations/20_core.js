/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */

const c_Nexus = artifacts.require('Nexus');
const c_OracleHub = artifacts.require('SimpleOracleHub');
const c_OracleHubMock = artifacts.require('SimpleOracleHubMock');

const c_MetaToken = artifacts.require('MetaToken');
const c_MetaTokenController = artifacts.require("MetaTokenController");
const c_MiniMeTokenFactory = artifacts.require("MiniMeTokenFactory");

const c_Manager = artifacts.require('Manager');

const c_CommonHelpers = artifacts.require('CommonHelpers');
const c_ForgeValidator = artifacts.require('ForgeValidator');
const c_StableMath = artifacts.require('StableMath');
const c_PublicStableMath = artifacts.require('PublicStableMath');

const c_MassetHelpers = artifacts.require('MassetHelpers')
const c_Masset = artifacts.require('Masset')

async function publishModuleThroughMultisig(d_Nexus, d_MultiSig, key, address, governor) {
  const txData = d_Nexus.contract.methods.addModule(key, address).encodeABI();
  await d_MultiSig.submitTransaction(d_Nexus.address, 0, txData, { from: governor });
}

async function lockModuleThroughMultisig(d_Nexus, d_MultiSig, key, governor) {
  const txData = d_Nexus.contract.methods.lockModule(key).encodeABI();
  await d_MultiSig.submitTransaction(d_Nexus.address, 0, txData, { from: governor });
}

module.exports = async (deployer, network, accounts) => {

  // Address of the price source to whitelist in the OracleHub
  // const oracleSource = [];
  const [_, governor, fundManager, oracleSource, feePool] = accounts;

  /** Common Libs */
  await deployer.deploy(c_StableMath, { from: _ });
  await deployer.link(c_StableMath, c_Masset);
  await deployer.link(c_StableMath, c_PublicStableMath);
  await deployer.link(c_StableMath, c_ForgeValidator);
  await deployer.link(c_StableMath, c_MassetHelpers);
  await deployer.deploy(c_ForgeValidator);
  await deployer.deploy(c_PublicStableMath, { from: _ });
  await deployer.deploy(c_CommonHelpers, { from: _ });
  await deployer.link(c_CommonHelpers, c_Masset);
  // await deployer.link(c_Masset, c_MassetHelpers);
  await deployer.deploy(c_MassetHelpers, { from: _ });

  /** Nexus */
  await deployer.deploy(c_Nexus, governor, { from: governor });
  const d_Nexus = await c_Nexus.deployed();


  /** MetaToken */
  // Step 1. Deploy the MiniMe Token Factory
  await deployer.deploy(c_MiniMeTokenFactory, { from: _ });
  const d_MiniMeTokenFactory = await c_MiniMeTokenFactory.deployed();

  // Step 2. Deploy MetaToken itself (MiniMe)
  await deployer.deploy(c_MetaToken, d_MiniMeTokenFactory.address, fundManager, { from: _ });
  const d_MetaToken = await c_MetaToken.deployed();

  // Step 3. Deploy the TokenController
  await deployer.deploy(c_MetaTokenController, d_Nexus.address, d_MetaToken.address, { from: _ })
  const d_MetaTokenController = await c_MetaTokenController.deployed();

  // Step 4. Transfer ownership to MetaTokenController
  await d_MetaToken.changeController(d_MetaTokenController.address, { from: _ })

  // Step 5. Validate transfer
  console.log(`[MetaTokenController]: '${d_MetaTokenController.address}'`)
  console.log(`[MiniMe 'controller']: '${await d_MetaToken.controller()}'`)


  /** OracleHub */
  let d_OracleHub;
  if (network == 'development' || network == 'coverage') {
    await deployer.deploy(c_OracleHubMock, d_Nexus.address, oracleSource);
    d_OracleHub = await c_OracleHubMock.deployed();
  } else {
    await deployer.deploy(c_OracleHub, d_Nexus.address, oracleSource);
    d_OracleHub = await c_OracleHub.deployed();
  }

  /** Manager */
  await deployer.deploy(c_Manager, d_Nexus.address);
  const d_Manager = await c_Manager.deployed();


  console.log(`[Nexus]: '${d_Nexus.address}'`)
  console.log(`[MetaToken (aka MTA)]: '${d_MetaToken.address}'`)
  console.log(`[OracleHub]: '${d_OracleHub.address}'`)
  console.log(`[Manager]: '${d_Manager.address}'`)
}
