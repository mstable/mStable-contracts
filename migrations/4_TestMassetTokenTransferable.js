TestMassetTokenTransferable = artifacts.require("TestMassetTokenTransferable");
module.exports = function(deployer) {
  deployer.deploy(TestMassetTokenTransferable, {from: "0x627306090abaB3A6e1400e9345bC60c78a8BEf57"});
};
