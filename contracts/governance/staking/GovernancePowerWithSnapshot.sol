// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { GovernancePowerDelegationERC20 } from "./GovernancePowerDelegationERC20.sol";
import { ITransferHook } from "./_i/ITransferHook.sol";

/**
 * @title ERC20WithSnapshot
 * @notice ERC20 including snapshots of balances on transfer-related actions
 * @author Aave
 **/
abstract contract GovernancePowerWithSnapshot is GovernancePowerDelegationERC20 {
    mapping(address => mapping(uint256 => Snapshot)) public _votingSnapshots;
    mapping(address => uint256) public _votingSnapshotsCounts;

    /// TODO - remove? If a proxy, this can be set during constructor init
    /// @dev reference to the Aave governance contract to call (if initialized) on _beforeTokenTransfer
    /// !!! IMPORTANT The Aave governance is considered a trustable contract, being its responsibility
    /// to control all potential reentrancies by calling back the this contract
    ITransferHook public _aaveGovernance;

    function _setAaveGovernance(ITransferHook aaveGovernance) internal virtual {
        _aaveGovernance = aaveGovernance;
    }
}
