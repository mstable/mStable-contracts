pragma solidity 0.5.16;

interface ICurveMetaPool {
    function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
}
