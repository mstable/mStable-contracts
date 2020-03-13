/* eslint-disable no-undef */
/* eslint-disable prefer-const */
/* eslint-disable one-var */
const c_DelayedProxyAdmin = artifacts.require('DelayedProxyAdmin');
const c_MockProxy = artifacts.require('MockProxy');
const c_AaveVault = artifacts.require('AaveVault');
const c_CompoundVault = artifacts.require('CompoundVault');
const c_Nexus = artifacts.require('Nexus')

module.exports = async (deployer, network, accounts) => {

    const [_, governor, masset, basketManager, aavePlatform, compoundPlatform] = accounts;
    // TODO Nexus is broken on migration hence creating new Nexus
    const nexus = await c_Nexus.new(governor);

    // Deploy DelayedProxyAdmin
    const proxyAdmin = await deployer.deploy(c_DelayedProxyAdmin, nexus.address);
    console.log("ProxyAdmin: " + proxyAdmin.address);

    // Deploy InitializableAdminUpgradeabilityProxy
    // Creating new instance each time as truffle does not support deploying same contract 
    // multiple times
    const proxyForAave = await c_MockProxy.new();
    console.log("AaveProxy: " + proxyForAave.address);

    const proxyForCompound = await c_MockProxy.new();
    console.log("CompoundProxy: " + proxyForCompound.address);

    // Deploy AaveVault Implementation
    const aaveVaultImpl = await c_AaveVault.new(
        nexus.address,
        [masset, basketManager],
        aavePlatform,
    );
    console.log("AaveVault Implementation: " + aaveVaultImpl.address);

    // Deploy CompoundVault Implementation
    const compoundVaultImpl = await c_CompoundVault.new(
        nexus.address,
        [masset, basketManager],
        aavePlatform,
    );
    console.log("CompoundVault Implementation: " + compoundVaultImpl.address);

    console.log("Linking Proxy to Implementation...");
    // Link AaveProxy with AaveVault implementation
    // const data = "";
    // await proxyForAave.initialize(
    //     aaveVaultImpl.address,
    //     proxyAdmin.address,
    //     data
    // );

    // Link CompoundProxy with CompoundVault implementation
}    