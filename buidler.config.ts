import { usePlugin } from "@nomiclabs/buidler/config";

require("ts-node/register");
// OPTIONAL: Allows the use of tsconfig path mappings with ts-node
require("tsconfig-paths/register");

usePlugin("@nomiclabs/buidler-truffle5");

export default {
    networks: { buidlerevm: { allowUnlimitedContractSize: true } },
    solc: { version: "0.5.16" },
    paths: { artifacts: "./build/contracts" },
};
