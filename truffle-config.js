require('ts-node/register')
// OPTIONAL: Allows the use of tsconfig path mappings with ts-node
require('tsconfig-paths/register')

const HDWalletProvider = require('@truffle/hdwallet-provider')


module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // for more about customizing your Truffle configuration!

  migrations_directory: './migrations',
  contracts_build_directory: './build/contracts',
  plugins: ["solidity-coverage"],
  networks: {
    development: {
      host: '127.0.0.1',
      port: 7545,
      network_id: '*', // Match any network id
      gas: 8000000
    },
    coverage: {
      host: "127.0.0.1",
      port: 7546,
      network_id: "*",
      gas: 0xfffffffffff, // <-- Use this high gas value
      gasPrice: 0x01      // <-- Use this low gas price
    },
    rinkeby: {
      provider() {
        return new HDWalletProvider(process.env.PHRASE, `https://rinkeby.infura.io/v3/${process.env.INFURA}`, 4, 7)
      },
      network_id: 4,
      gasPrice: 10000000000, // 10 GWei,
      skipDryRun: true
    }
  },
  mocha: {
    reporter: 'eth-gas-reporter',
    reporterOptions : {
      currency: 'USD'
    }
  },
  compilers: {
    solc: {
      version: '0.5.16',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
}
