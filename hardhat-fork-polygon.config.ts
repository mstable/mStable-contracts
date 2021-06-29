import { hardhatConfig } from "./hardhat.config"

export default {
    ...hardhatConfig,
    networks: {
        ...hardhatConfig.networks,
        hardhat: {
            allowUnlimitedContractSize: false,
            blockGasLimit: 20000000, // 20 million
            gasPrice: 5000000000, // 5 Gwei
            forking: {
                url: "https://matic-mainnet-archive-rpc.bwarelabs.com",
                blockNumber: 15510323,
            },
        },
    },
}
