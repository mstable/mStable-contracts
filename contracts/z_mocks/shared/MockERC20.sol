// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import "../../shared/@openzeppelin-2.5/ERC20Detailed.sol";
import "../../shared/@openzeppelin-2.5/ERC20Mintable.sol";
import "../../shared/@openzeppelin-2.5/ERC20.sol";

contract MockERC20 is ERC20, ERC20Detailed, ERC20Mintable {

    constructor (
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    )
        ERC20Detailed(
            _name,
            _symbol,
            _decimals
        )
        public
    {
        _mint(_initialRecipient, _initialMint.mul(10 ** uint256(_decimals)));
    }
}

contract MockUSDT {
    function setParams(uint newBasisPoints, uint newMaxFee) public;
}
