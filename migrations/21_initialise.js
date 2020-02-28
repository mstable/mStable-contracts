/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */


const c_Nexus = artifacts.require('Nexus');
const c_OracleHub = artifacts.require('SimpleOracleHub');
const c_OracleHubMock = artifacts.require('SimpleOracleHubMock');
const c_MetaToken = artifacts.require('MetaToken');
const c_Manager = artifacts.require('Manager');


/** @dev Updates the min quorum on the governance multisig after initialisation has completed */
module.exports = async (deployer, network, accounts) => {

    const [_, governor, fundManager, oracleSource] = accounts;
    let newGovernorAddress = governor;
    if (network != 'development' && network != 'coverage') {
        // do something
    }

    /* Get deployed contracts */
    const d_Manager = await c_Manager.deployed()
    const d_Nexus = await c_Nexus.deployed()
    const d_MetaToken = await c_MetaToken.deployed();

    let keys = new Array(3);
    let addresses = new Array(3);
    let isLocked = new Array(3);

    keys[0] = await d_Nexus.Key_MetaToken();
    addresses[0] = d_MetaToken.address;
    isLocked[0] = true;

    if (network == 'development' || network == 'coverage') {
        const d_OracleHubMock = await c_OracleHubMock.deployed()
        keys[1] = await d_Nexus.Key_OracleHub();
        addresses[1] = d_OracleHubMock.address;
        isLocked[1] = false;
    } else {
        const d_OracleHub = await c_OracleHub.deployed()
        keys[1] = await d_Nexus.Key_OracleHub();
        addresses[1] = d_OracleHub.address;
        isLocked[1] = false;
    }

    keys[2] = await d_Nexus.Key_Manager();
    addresses[2] = d_Manager.address;
    isLocked[2] = false;

    await d_Nexus.initialize(keys, addresses, isLocked, newGovernorAddress, { from: governor });
}
