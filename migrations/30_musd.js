/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */
const c_Manager = artifacts.require('Manager')
const c_Nexus = artifacts.require('Nexus')
const c_ForgeValidator = artifacts.require('ForgeValidator')
const c_MUSD = artifacts.require('MUSD')

const c_ForgeRewardsMUSD = artifacts.require('ForgeRewardsMUSD')
const c_Systok = artifacts.require('Systok');

const c_TUSD = artifacts.require('TUSD')
const c_USDC = artifacts.require('USDC')
const c_USDT = artifacts.require('USDT')
const c_DAI = artifacts.require('DAI')
const c_SUSD = artifacts.require('SUSD')
const c_GUSD = artifacts.require('GUSD')
const c_PAX = artifacts.require('PAX')

const { MASSET_FACTORY_BYTES } = require('@utils/constants')
const { aToH } = require('@utils/tools')
const { percentToWeight, createMultiple,simpleToExactAmount } = require('@utils/math')


module.exports = async (deployer, network, accounts) => {

	const [ _, governor, fundManager, oracleSource, feePool ] = accounts;

  /* Get deployed Manager */
  const d_Manager = await c_Manager.deployed()
  const d_Nexus = await c_Nexus.deployed()
  const d_ForgeValidator = await c_ForgeValidator.deployed()
  const d_Systok = await c_Systok.deployed();

  /* ~~~~~~~~~ mUSD Setup ~~~~~~~~~  */

  /* Deploy baset assets */
  await deployer.deploy(c_USDT);
  let USDT = await c_USDT.deployed();
  await deployer.deploy(c_USDC);
  let USDC = await c_USDC.deployed();
  await deployer.deploy(c_TUSD);
  let TUSD = await c_TUSD.deployed();
  await deployer.deploy(c_DAI);
  let DAI = await c_DAI.deployed();
  await deployer.deploy(c_SUSD);
  let SUSD = await c_SUSD.deployed();
  await deployer.deploy(c_GUSD);
  let GUSD = await c_GUSD.deployed();
  await deployer.deploy(c_PAX);
  let PAX = await c_PAX.deployed();

  /* Basset addresses */
  const basketAddresses = [
    USDT.address,
    USDC.address,
    TUSD.address,
    DAI.address,
    SUSD.address,
    GUSD.address,
    PAX.address,
  ];

  /* Assign basset weightings in percent */
  const basketWeights =  [
    percentToWeight(30), // max 30
    percentToWeight(40), // 40
    percentToWeight(30), // 30
    percentToWeight(30), // 30
    percentToWeight(25), // 20
    percentToWeight(0), // 0
    percentToWeight(25)  // 20
  ];

  const basketIsTransferFeeCharged = [
    true, // USDT changes transfer fees
    false,
    false,
    false,
    false,
    false,
    false,
  ];

  const d_MUSD = await deployer.deploy(
    c_MUSD,
    d_Nexus.address,
    basketAddresses,
    basketWeights,
    basketIsTransferFeeCharged,
    feePool,
    d_ForgeValidator.address
  );

  if(network == 'development' || network == 'coverage') {
    const txData = await d_Manager.addMasset(
      aToH("mUSD"),
      d_MUSD.address,
      {from: governor});
  } else {
    // We need to send the transaction from the multisig
    //await d_MultiSig.submitTransaction(d_Manager.address, 0, txData, { from : governor });
  }

  const massets = await d_Manager.getMassets();
  console.log(`[mUSD]: '${massets[0][0]}'`);
  
  console.log('here')
  // Deploy ForgeRewardsMUSD contract
  await deployer.deploy(
    c_ForgeRewardsMUSD,
    d_MUSD.address,
    d_Systok.address,
    governor,
    {from: governor}
  );
}
