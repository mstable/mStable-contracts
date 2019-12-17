pragma solidity ^0.5.12;

import "../ERC20Mock.sol";

contract USDT is ERC20Mock {
    constructor() public ERC20Mock("Tether", "USDT", 6, msg.sender, uint256(60057493).mul(10 ** 6)) {}
}