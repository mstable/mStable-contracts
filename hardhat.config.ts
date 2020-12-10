require("hardhat-gas-reporter");
require("solidity-coverage");
require("@nomiclabs/hardhat-truffle5");
require("hardhat-typechain");
require("@tenderly/hardhat-tenderly");

require("ts-node/register");
require("tsconfig-paths/register");

export default {
    networks: {
        hardhat: { allowUnlimitedContractSize: true },
        localhost: { url: "http://localhost:8545" },
        fork: { url: "http://localhost:7545" },
    },
    solidity: {
        version: "0.5.16",
        settings: {
            optimizer: {
                enabled: true,
            },
        },
    },
    paths: { artifacts: "./build/contracts" },
    gasReporter: {
        currency: "USD",
        gasPrice: 30,
    },
    mocha: {
        timeout: 240000, // 4 min timeout
    },
    typechain: {
        outDir: "types/generated",
        target: "truffle-v5",
    },
    tenderly: {
        username: "mStable",
        project: "mStable-contracts",
    },
};
