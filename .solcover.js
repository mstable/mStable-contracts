module.exports = {
  port: 7546,
  testrpcOptions: '-p 7546 -l 0xfffffffffff --allowUnlimitedContractSize',
  buildDirPath: '/build',
  dir: '.',
  providerOptions: {
    "gasLimit": 0xfffffffffff,
    "callGasLimit": 0xfffffffffff,
    "allowUnlimitedContractSize": true
  },
  silent: false,
  // client: require("ganache-core"),
  copyPackages: ['@openzeppelin'],
  skipFiles: [
    'Migrations.sol',
    'interfaces',
    'integrations',
    'z_mocks',
    'shared/InitializableReentrancyGuard.sol',
    'integrations'
  ]
};