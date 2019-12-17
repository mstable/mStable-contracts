pragma solidity ^0.5.12;

import "./ERC20Mock.sol";

contract MockERC20Factory {
    function create (
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _supply
    )
        public
        returns (address)
    {
        ERC20Mock newToken = new ERC20Mock(
            _name,
            _symbol,
            _decimals,
            msg.sender,
            _supply
        );

        return address(newToken);
    }
}