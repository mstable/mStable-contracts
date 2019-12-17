module.exports = {
  port: 7545,
  testrpcOptions: '-p 7545 -l 0xfffffffffff --allowUnlimitedContractSize',
  buildDirPath: '/build',
  dir: '.',
  providerOptions: {
    "gasLimit": 0xfffffffffff,
    "callGasLimit": 0xfffffffffff,
    "allowUnlimitedContractSize": true
  },
  silent: false,
  // client: require("ganache-core"),
  copyPackages: ['openzeppelin-solidity'],
  skipFiles: [
    'Migrations.sol',
    'interfaces',
    'z_mocks',
  ]
};

// TODO - clean out this solcover config and figure out why it's failing on certain tests (i suspect gas limit of TX when creating Masset)