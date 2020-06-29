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
        coverage: {
            url: "http://localhost:7546",
        },
    },
    solc: { version: "0.5.16" },
    paths: { artifacts: "./build/contracts" },
    gasReporter: {
        currency: "USD",
        gasPrice: 30,
        enabled: process.env.REPORT_GAS === "true" ? true : false,
    },
};
