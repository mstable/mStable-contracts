pragma solidity 0.5.16;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { InitializableERC20Detailed } from "./InitializableERC20Detailed.sol";

/**
 * @title  InitializableToken
 * @author Stability Labs Pty. Ltd.
 * @dev    Basic ERC20Detailed Token functionality for Masset
 */
contract InitializableToken is ERC20, InitializableERC20Detailed {

    /**
     * @dev Initialization function for implementing contract
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function _initialize(string memory _nameArg, string memory _symbolArg) internal {
        InitializableERC20Detailed._initialize(_nameArg, _symbolArg, 18);
    }
}