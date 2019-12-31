pragma solidity ^0.5.12;

import "../ERC20Mock.sol";

contract DGX is ERC20Mock {
    constructor() public ERC20Mock("DigixGold", "DGX", 18, msg.sender, uint256(12380072).mul(10 ** 18)) {}
}