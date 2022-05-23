// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IStakedToken } from "./interfaces/IStakedToken.sol";

/**
 * @title StakedTokenBatcher
 * @dev Batch transactions for staking a given staked token.
 */
contract StakedTokenBatcher {
    /**
     * @dev Called by anyone to poke the timestamp of an array of accounts. This allows users to
     * effectively 'claim' any new timeMultiplier, but will revert if any of the accounts has no changes.
     * It is recommend to validate off-chain the accounts before calling this function.
     * @param _stakedToken Address of user the staked token.
     * @param _accounts Array of account addresses to update.
     */
    function reviewTimestamp(address _stakedToken, address[] calldata _accounts) external {
        IStakedToken stakedToken = IStakedToken(_stakedToken);
        uint256 len = _accounts.length;
        require(len > 0, "Invalid inputs");
        for (uint256 i = 0; i < len; ) {
            stakedToken.reviewTimestamp(_accounts[i]);
            unchecked {
                ++i;
            }
        }
    }
}
