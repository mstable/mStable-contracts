// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IFAssetRedemptionPriceGetter {
    function snappedRedemptionPrice() external view returns (uint256);
}
