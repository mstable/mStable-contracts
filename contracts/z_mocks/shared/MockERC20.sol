// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import "@openzeppelin/contracts-sol8/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {

    constructor (
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    )
        ERC20(
            _name,
            _symbol
        )
    {
      _setupDecimals(_decimals);
        _mint(_initialRecipient, _initialMint * (10 ** uint256(_decimals)));
    }
}