// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.6;
pragma experimental ABIEncoderV2;

interface IRedemptionPriceSnap {
    function TEN_THOUSAND() external view returns (uint256);

    function addAuthorization(address account) external;

    function authorizedAccounts(address) external view returns (uint256);

    function modifyParameters(bytes32 parameter, address data) external;

    function oracleRelayer() external view returns (address);

    function removeAuthorization(address account) external;

    function snappedRedemptionPrice() external view returns (uint256);

    function updateAndGetSnappedPrice() external returns (uint256);

    function updateSnappedPrice() external;
}
