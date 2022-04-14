// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

/**
 * @title   Fills 51 storage slots.
 * @notice  To be used in inheritance when upgrading contracts to preserve previous storage slots.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-04-13
 */
contract SlotFiller51 {
    uint256[51] private __gap;
}
