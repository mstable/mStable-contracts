pragma solidity 0.5.16;


contract ILiquidator {

    function createLiquidation(
        address _integration,
        address _sellToken,
        address _bAsset,
        int128 _curvePosition,
        address[] calldata _uniswapPath,
        uint256 _sellTranche
    ) external;
    function updateBasset(address _integration, address _bAsset, int128 _curvePosition, address[] calldata _uniswapPath) external;
    function changeTrancheAmount(address _integration, uint256 _sellTranche) external;
    function deleteLiquidation(address _integration) external;

    function triggerLiquidation(address _integration) external;
}