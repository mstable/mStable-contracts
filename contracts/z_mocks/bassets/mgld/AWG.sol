pragma solidity ^0.5.16;

import "../ERC20Mock.sol";

contract AWG is ERC20Mock {
    constructor() public ERC20Mock("AurusGold", "AWG", 12, msg.sender, uint256(241559231).mul(10 ** 12)) {}
}