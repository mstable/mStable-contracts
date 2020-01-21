/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */
const c_Manager = artifacts.require('Manager')
const c_Governance = artifacts.require('GovernancePortal')
const c_MUSD = artifacts.require('MUSD')

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
  const d_Governance = await c_Governance.deployed()

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
  /* Basses symbols in hex */
  const basketKeys = [
    aToH("USDT<>USD"),
    aToH("USDC<>USD"),
    aToH("TUSD<>USD"),
    aToH("DAI<>USD"),
    aToH("SUSD<>USD"),
    aToH("GUSD<>USD"),
    aToH("PAX<>USD"),
  ];
  /* Assign basset weightings in percent */
  const basketWeights =  [
    percentToWeight(30), // max 30
    percentToWeight(40), // 40
    percentToWeight(30), // 30
    percentToWeight(30), // 30
    percentToWeight(25), // 20
    percentToWeight(0), // 25
    percentToWeight(25)  // 20
  ];

  /* Assign basset ratios in percent */
  const basketMultiples =  [
    createMultiple(1),
    createMultiple(1),
    createMultiple(1),
    createMultiple(1),
    createMultiple(1),
    createMultiple(1),
    createMultiple(1)
  ];

  /* Assign minting and redemption fees */
  const redemptionFee = percentToWeight(1.5)
  const grace = simpleToExactAmount(5000000, 18)

  const x = await deployer.deploy(
    c_MUSD,
    basketAddresses,
    basketKeys,
    basketWeights,
    feePool,
    d_Manager.address
  );
  
  const txData = d_Manager.contract.methods.addMasset(
    aToH("mUSD"),
    x.address).encodeABI();

  await d_Governance.submitTransaction(d_Manager.address, 0, txData, { from : governor });

  const massets = await d_Manager.getMassets();
  console.log(`[mUSD]: '${massets[0][0]}'`);
}