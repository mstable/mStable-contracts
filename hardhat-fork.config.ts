import { hardhatConfig } from "./hardhat.config"

export default {
    ...hardhatConfig,
    networks: {
        ...hardhatConfig.networks,
        hardhat: {
            allowUnlimitedContractSize: false,
            blockGasLimit: 9000000,
            gasPrice: 151000000000,
            forking: {
                url: process.env.NODE_URL || "",
                blockNumber: 12205156,
            },
        },
    },
}
