pragma solidity ^0.5.16;

interface IAave {
    function deposit(address _reserve, uint256 _amount, uint16 _referralCode) external;
    //TODO Unable to find redeem() on LendingPool
}