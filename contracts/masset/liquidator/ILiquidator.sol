// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface ILiquidator {
    function createLiquidation(
        address _integration,
        address _sellToken,
        address _bAsset,
        bytes calldata _uniswapPath,
        bytes calldata _uniswapPathReversed,
        uint256 _trancheAmount,
        uint256 _minReturn,
        address _mAsset,
        bool _useAave
    ) external;

    function updateBasset(
        address _integration,
        address _bAsset,
        bytes calldata _uniswapPath,
        bytes calldata _uniswapPathReversed,
        uint256 _trancheAmount,
        uint256 _minReturn
    ) external;

    function deleteLiquidation(address _integration) external;

    function triggerLiquidation(address _integration) external;

    function claimStakedAave() external;

    function triggerLiquidationAave() external;
}
