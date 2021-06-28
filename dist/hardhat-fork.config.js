"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_config_1 = require("./hardhat.config");
exports.default = {
    ...hardhat_config_1.hardhatConfig,
    networks: {
        ...hardhat_config_1.hardhatConfig.networks,
        hardhat: {
            allowUnlimitedContractSize: false,
            blockGasLimit: 15000000,
            gasPrice: 52000000000,
            forking: {
                url: process.env.NODE_URL || "",
                blockNumber: 12452435,
            },
        },
    },
};
//# sourceMappingURL=hardhat-fork.config.js.map