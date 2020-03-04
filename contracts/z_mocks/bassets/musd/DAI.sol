pragma solidity 0.5.16;

import "../ERC20Mock.sol";

contract DAI is ERC20Mock {
    constructor() public ERC20Mock("Dai", "DAI", 18, msg.sender, uint256(91448613).mul(10 ** 18)) {}
}
