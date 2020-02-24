pragma solidity ^0.5.16;

import "../ERC20Mock.sol";

contract TUSD is ERC20Mock {
    constructor() public ERC20Mock("TrueUSD", "TUSD", 18, msg.sender, uint256(202619765).mul(10 ** 18)) {}
}