import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@tenderly/hardhat-tenderly";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
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
            accounts: string[];
            gasPrice: number;
            gasLimit: number;
        };
        polygon_testnet: {
            url: string;
            accounts: string[];
        };
        polygon_mainnet: {
            url: string;
            accounts: string[];
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
