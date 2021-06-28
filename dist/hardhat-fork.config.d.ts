declare const _default: {
    networks: {
        hardhat: {
            allowUnlimitedContractSize: boolean;
            blockGasLimit: number;
            gasPrice: number;
            forking: {
                url: string;
                blockNumber: number;
            };
        };
        localhost: {
            url: string;
        };
        fork: {
            url: string;
        };
        env: {
            url: string;
        };
        ropsten: {
            url: string;
            gasPrice: number;
            gasLimit: number;
        };
        polygon_testnet: {
            url: string;
        };
        polygon_mainnet: {
            url: string;
        };
        mainnet: {
            url: string;
        };
    };
    solidity: {
        version: string;
        settings: {
            optimizer: {
                enabled: boolean;
                runs: number;
            };
            outputSelection: {
                "*": {
                    Masset: string[];
                    FeederPool: string[];
                };
            };
        };
    };
    paths: {
        artifacts: string;
    };
    abiExporter: {
        path: string;
        clear: boolean;
        flat: boolean;
    };
    gasReporter: {
        currency: string;
        gasPrice: number;
    };
    mocha: {
        timeout: number;
    };
    typechain: {
        outDir: string;
        target: string;
    };
    tenderly: {
        username: string;
        project: string;
    };
};
export default _default;
