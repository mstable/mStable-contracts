pragma solidity ^0.5.16;

interface ILendingPoolAddressesProvider {
    function getLendingPool() external view returns (address);
}