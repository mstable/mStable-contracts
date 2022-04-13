// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

/**
 * @title   Fills 102 storage slots so the new StakedToken contracts storage
 * aligns with the already deployed StakedTokenMTA and StakedTokenBPT contracts.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2022-04-13
 */
contract SlotFiller {
    uint256[102] private __gap;
}
