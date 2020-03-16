const Migrations = artifacts.require("Migrations");

module.exports = async (deployer) => {
    process.env.NETWORK = deployer.network;
    await deployer.deploy(Migrations);
};
