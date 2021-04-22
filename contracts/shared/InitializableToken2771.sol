// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { ERC202771, IERC20 } from "./ERC202771.sol";
import { InitializableERC20Detailed } from "./InitializableERC20Detailed.sol";
import { ImmutableModule } from "./ImmutableModule.sol";

/**
 * @title  InitializableToken
 * @author mStable
 * @dev    Basic ERC20Detailed Token functionality for Masset
 */
abstract contract InitializableToken2771 is ERC202771, InitializableERC20Detailed, ImmutableModule {
    constructor(address _nexus) ImmutableModule(_nexus) {}

    /**
     * @dev Initialization function for implementing contract
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function _initialize(
        string memory _nameArg,
        string memory _symbolArg,
        address _forwarder
    ) internal {
        InitializableERC20Detailed._initialize(_nameArg, _symbolArg, 18);
        _trustedForwarder = _forwarder;
    }

    /**
     * @dev Updates Forwarder address
     */
    function setTrustedForwarder(address _forwarder) public override onlyGovernor {
        require(_forwarder != address(0), "Forwarder Address cannot be 0");
        _trustedForwarder = _forwarder;
    }
}
