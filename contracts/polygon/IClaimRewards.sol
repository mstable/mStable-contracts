// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IClaimRewards {
    /**
     * @notice claims platform reward tokens from a platform integration.
     * For example, stkAAVE from Aave.
     */
    function claimRewards() external;
}
