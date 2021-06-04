// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

interface ICurveMetaPool {
    function exchange_underlying(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256);

    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) external view returns (uint256);
}
