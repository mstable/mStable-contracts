import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@tenderly/hardhat-tenderly";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-abi-exporter";
import "ts-node/register";
import "tsconfig-paths/register";
export declare const hardhatConfig: {
    networks: {
        hardhat: {
            allowUnlimitedContractSize: boolean;
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
export default hardhatConfig;
