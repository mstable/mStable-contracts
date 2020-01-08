pragma solidity ^0.5.12;

import "../ERC20Mock.sol";

contract PAX is ERC20Mock {
    constructor() public ERC20Mock("Paxos USD", "PAX", 18, msg.sender, uint256(100000000).mul(10 ** 18)) {}
}