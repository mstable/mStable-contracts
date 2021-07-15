import { hardhatConfig } from "./hardhat.config"

export default {
    ...hardhatConfig,
    networks: {
        ...hardhatConfig.networks,
        hardhat: {
            allowUnlimitedContractSize: false,
            blockGasLimit: 15000000,
            gasPrice: 20000000000,
            forking: {
                url: process.env.NODE_URL || "",
            },
        },
    },
}
