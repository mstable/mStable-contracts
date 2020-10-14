pragma solidity 0.5.16;



contract ILiquidator {

    enum LendingPlatform { Null, Compound, Aave }

    function createLiquidation(
        address _integration,
        LendingPlatform _lendingPlatform,
        address _sellToken,
        address _bAsset,
        address[] calldata _uniswapPath,
        uint256 _sellTranche
    ) external;
    function updateBasset(address _bAsset, address[] calldata _uniswapPath) external;
    function deleteLiquidation(address _integration) external;
    function changeTrancheAmount(uint256 _sellTranche) external;

    function triggerLiquidation(address _integration) external;

    function collect() external;
}