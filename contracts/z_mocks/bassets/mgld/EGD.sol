pragma solidity ^0.5.12;

import "../ERC20Mock.sol";

contract EGD is ERC20Mock {
    constructor() public ERC20Mock("Egold", "EGD", 6, msg.sender, uint256(34234233).mul(10 ** 6)) {}
}