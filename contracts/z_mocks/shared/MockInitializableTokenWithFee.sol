pragma solidity 0.5.16;

import { ERC20WithFee } from "./MockERC20WithFee.sol";

/**
 * @title  InitializableToken
 * @author Stability Labs Pty. Ltd.
 * @dev    Basic ERC20Detailed Token functionality for Masset
 */
contract MockInitializableTokenWithFee is ERC20WithFee {

    /**
     * @dev Initialization function for implementing contract
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function initialize(string calldata _nameArg, string calldata _symbolArg, uint8 _decimals, address _initialRecipient, uint256 _initialMint) external {
        ERC20WithFee._initialize(_nameArg, _symbolArg, _decimals);
        feeRate = 1e15;
        _mint(_initialRecipient, _initialMint.mul(10 ** uint256(_decimals)));
    }
}
