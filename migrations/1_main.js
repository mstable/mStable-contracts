
// Import TypeScript; it can't be run directly, but Truffle must use
// babel because requiring it works.
const initialMigration = require(`./src/1_initial_migration.ts`).default;
const systemMigration = require(`./src/2_system.ts`).default;
const rewardsMigration = require(`./src/3_rewards.ts`).default;
const stakingMigration = require(`./src/4_staking.ts`).default;
const saveV2Migration = require(`./src/4_savev2.ts`).default;

// Bind the first argument of the script to the global truffle argument,
// with `web3`, `artifacts` and so on, and pass in all CLI arguments.
module.exports = async (deployer, network, accounts) => {
    await initialMigration(this, deployer);
    await systemMigration(this, deployer, network, accounts);
    await rewardsMigration(this, deployer, network, accounts);
    await stakingMigration(this, deployer, network, accounts);
    await saveV2Migration(this, deployer, network, accounts);
};
