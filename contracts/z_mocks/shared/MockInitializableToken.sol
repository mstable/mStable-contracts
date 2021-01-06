// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { ERC20Mintable } from "../../shared/@openzeppelin-2.5/ERC20Mintable.sol";
import { ERC20 } from "../../shared/@openzeppelin-2.5/ERC20.sol";
import { InitializableERC20Detailed } from "../../shared/InitializableERC20Detailed.sol";

/**
 * @title  InitializableToken
 * @author Stability Labs Pty. Ltd.
 * @dev    Basic ERC20Detailed Token functionality for Masset
 */
contract MockInitializableToken is ERC20, ERC20Mintable, InitializableERC20Detailed {

    /**
     * @dev Initialization function for implementing contract
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function initialize(string calldata _nameArg, string calldata _symbolArg, uint8 _decimals, address _initialRecipient, uint256 _initialMint) external {
        InitializableERC20Detailed._initialize(_nameArg, _symbolArg, _decimals);
        _mint(_initialRecipient, _initialMint.mul(10 ** uint256(_decimals)));
    }
}