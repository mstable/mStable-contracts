// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

interface ILiquidator {
    function createLiquidation(
        address _integration,
        address _sellToken,
        address _bAsset,
        int128 _curvePosition,
        address[] calldata _uniswapPath,
        uint256 _trancheAmount,
        uint256 _minReturn,
        address _mAsset
    ) external;

    function updateBasset(
        address _integration,
        address _bAsset,
        int128 _curvePosition,
        address[] calldata _uniswapPath,
        uint256 _trancheAmount,
        uint256 _minReturn
    ) external;

    function deleteLiquidation(address _integration) external;

    function triggerLiquidation(address _integration) external;
}
