pragma solidity 0.5.16;


interface IConnector {
  function deposit(uint256) external;
  function withdraw(uint256) external;
  function checkBalance() external view returns (uint256);
}