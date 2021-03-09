// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

interface IRevenueRecipient {
    /** @dev Recipient */
    function notifyRedistributionAmount(address _mAsset, uint256 _amount) external;
}
