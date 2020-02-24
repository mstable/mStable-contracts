pragma solidity ^0.5.16;

import "../ERC20Mock.sol";

contract OGC is ERC20Mock {
    constructor() public ERC20Mock("OneGram Coin", "OGC", 18, msg.sender, uint256(112342234).mul(10 ** 18)) {}
}