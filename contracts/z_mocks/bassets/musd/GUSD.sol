pragma solidity 0.5.16;

import "../ERC20Mock.sol";

contract GUSD is ERC20Mock {
    constructor() public ERC20Mock("Gemini Dollar", "GUSD", 2, msg.sender, uint256(71213675).mul(10 ** 2)) {}
}