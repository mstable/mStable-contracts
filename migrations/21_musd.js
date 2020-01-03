/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */
const c_Manager = artifacts.require('Manager')
const c_Governance = artifacts.require('GovernancePortal')
const c_Masset = artifacts.require('Masset')

const c_TUSD = artifacts.require('TUSD')
const c_USDC = artifacts.require('USDC')
const c_USDT = artifacts.require('USDT')

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

  /* Basset addresses */
  const basketAddresses = [
    USDT.address,
    USDC.address,
    TUSD.address
  ];
  /* Basses symbols in hex */
  const basketKeys = [
    aToH("USDT<>USD"),
    aToH("USDC<>USD"),
    aToH("TUSD<>USD"),
  ];
  /* Assign basset weightings in percent */
  const basketWeights =  [
    percentToWeight(50),
    percentToWeight(25),
    percentToWeight(25)
  ];

  /* Assign basset ratios in percent */
  const basketMultiples =  [
    createMultiple(1),
    createMultiple(1),
    createMultiple(1)
  ];

  /* Assign minting and redemption fees */
  const mintingFee = percentToWeight(0)
  const redemptionFee = percentToWeight(1.5)
  const grace = simpleToExactAmount(5000000, 18)

  const x = await deployer.deploy(
    c_Masset,
    "mStable USD",
    "mUSD",
    basketAddresses,
    basketKeys,
    basketWeights,
    basketMultiples,
    feePool,
    d_Manager.address
  );
  
  const txData = d_Manager.contract.methods.addMasset(
    aToH("mUSD"),
    x.address).encodeABI();

  await d_Governance.submitTransaction(d_Manager.address, 0, txData, { from : governor });

  const massets = await d_Manager.getMassets();
  // console.log(`[mUSD]: '${massets[0][0]}'`);
}