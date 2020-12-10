pragma solidity 0.5.16;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
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