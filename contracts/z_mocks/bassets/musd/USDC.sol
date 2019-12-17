pragma solidity ^0.5.12;

import "../ERC20Mock.sol";

contract USDC is ERC20Mock {
    constructor() public ERC20Mock("USD Coin", "USDC", 6, msg.sender, uint256(241559231).mul(10 ** 6)) {}
}