// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

/**
 * @title ISavingsManager
 */
interface ISavingsManager {
    /** @dev Admin privs */
    function distributeUnallocatedInterest(address _mAsset) external;

    /** @dev Liquidator */
    function depositLiquidation(address _mAsset, uint256 _liquidation) external;

    /** @dev Liquidator */
    function collectAndStreamInterest(address _mAsset) external;

    /** @dev Public privs */
    function collectAndDistributeInterest(address _mAsset) external;
}
