/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */
const c_Manager = artifacts.require('Manager')
const c_Masset = artifacts.require('Masset')

const c_DGX = artifacts.require('DGX')
const c_AWG = artifacts.require('AWG')
const c_EGD = artifacts.require('EGD')
const c_OGC = artifacts.require('OGC')

const { MASSET_FACTORY_BYTES } = require('@utils/constants')
const { aToH } = require('@utils/tools')
const { percentToWeight, createMultiple,simpleToExactAmount } = require('@utils/math')

module.exports = async (deployer, network, accounts) => {

	const [ _, governor, fundManager, oracleSource ] = accounts;

  /* Get deployed Manager */
  const d_Manager = await c_Manager.deployed();

  /* ~~~~~~~~~ mUSD Setup ~~~~~~~~~  */

  /* Deploy baset assets */
  await deployer.deploy(c_DGX);
  let DGX = await c_DGX.deployed();
  await deployer.deploy(c_AWG);
  let AWG = await c_AWG.deployed();
  await deployer.deploy(c_EGD);
  let EGD = await c_EGD.deployed();
  await deployer.deploy(c_OGC);
  let OGC = await c_OGC.deployed();

  /* Basset addresses */
  const basketAddresses = [
    DGX.address,
    AWG.address,
    EGD.address,
    OGC.address
  ];
  /* Basses symbols in hex */
  const basketKeys = [
    aToH("DGX<>Gold"),
    aToH("AWG<>Gold"),
    aToH("EGD<>Gold"),
    aToH("OGC<>Gold"),
  ];
  /* Assign basset weightings in percent */
  const basketWeights =  [
    percentToWeight(60),
    percentToWeight(20),
    percentToWeight(10),
    percentToWeight(10)
  ];

  /* Assign basset ratios in percent */
  const basketMultiples =  [
    createMultiple(1),
    createMultiple(1),
    createMultiple(1),
    createMultiple(0.0321507)
  ];

  /* Assign minting and redemption fees */
  const mintingFee = percentToWeight(0)
  const redemptionFee = percentToWeight(1)
  const grace = simpleToExactAmount(3000000, 18)

  const d_mGLD = await deployer.deploy(
    c_Masset,
    "mStable Gold",
    "mGLD",
    basketAddresses,
    basketKeys,
    basketWeights,
    basketMultiples,
    d_Manager.address
  );

  await d_Manager.addMasset(
    aToH("mGLD"),
    d_mGLD.address,
    [mintingFee, redemptionFee],
    grace,
    { from: governor }
  );

  const massets = await d_Manager.getMassets();
  console.log(`[mGLD]: '${massets[0][1]}'`);
}