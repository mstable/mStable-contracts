pragma solidity 0.5.16;

import "../ERC20Mock.sol";

contract SUSD is ERC20Mock {
    constructor() public ERC20Mock("Synthetix USD", "SUSD", 18, msg.sender, uint256(100000000).mul(10 ** 18)) {}
}