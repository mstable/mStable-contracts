import { hardhatConfig } from "./hardhat.config"

export default {
    ...hardhatConfig,
    networks: {
        ...hardhatConfig.networks,
        hardhat: {
            allowUnlimitedContractSize: false,
            blockGasLimit: 20000000, // 20 million
            forking: {
                url: process.env.NODE_URL || "https://matic-mainnet-archive-rpc.bwarelabs.com",
            },
        },
    },
}
