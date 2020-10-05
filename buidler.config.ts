import { usePlugin } from "@nomiclabs/buidler/config";

require("ts-node/register");
require("tsconfig-paths/register");

usePlugin("solidity-coverage");
usePlugin("@nomiclabs/buidler-truffle5");
usePlugin("buidler-gas-reporter");

export default {
    networks: {
        buidlerevm: { allowUnlimitedContractSize: true },
        localhost: { url: "http://localhost:8545" },
        fork: { url: "http://localhost:7545" },
        coverage: {
            url: "http://localhost:7546",
        },
    },
    solc: { version: "0.5.16" },
    paths: { artifacts: "./build/contracts" },
    gasReporter: {
        currency: "USD",
        gasPrice: 30,
    },
    mocha: {
        timeout: 240000, // 4 min timeout
    },
};
