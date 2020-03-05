pragma solidity ^0.5.16;

interface IAaveLendingPool {
    /**
     * deposit() function on LendingPool
     */
    function deposit(address _reserve, uint256 _amount, uint16 _referralCode) external;

}