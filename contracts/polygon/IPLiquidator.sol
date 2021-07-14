// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IPLiquidator {
    function createLiquidation(
        address _integration,
        address _sellToken,
        address _bAsset,
        address[] calldata _uniswapPath,
        uint256 _minReturn
    ) external;

    function updateBasset(
        address _integration,
        address _bAsset,
        address[] calldata _uniswapPath,
        uint256 _minReturn
    ) external;

    function deleteLiquidation(address _integration) external;

    function triggerLiquidation(address _integration) external;
}
