pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

/**
  * @title ILiquidator
  * @dev Interface for the Liquidator component
  */

interface ILiquidator {

    enum LendingPlatform { Compound, Aave, Cream, Dydx, Fulcrum }
    enum Dex { Uniswap, Balancer }

    struct Liquidation {
        address         integration;
        address         sellToken;
        address         pToken;
        uint            trancheAmount;
        LendingPlatform lendingPlatform;
        address[]       uniswapPath;
        bool            paused;
        uint            lastTriggered;
    }

    function triggerLiquidation(
        address _bAsset) external;
    function createLiquidation(
        address _bAsset,
        address _integration,
        address _sellToken,
        uint _trancheAmount,
        LendingPlatform _lendingPlatform,
        address[] calldata _uniswapPath,
        bool _paused) external;
    function updateLiquidation(
        address _bAsset,
        address _integration,
        address _sellToken,
        uint _trancheAmount,
        LendingPlatform _lendingPlatform,
        address[] calldata _uniswapPath,
        bool paused) external;
    function deleteLiquidation(address _bAsset) external;
    function updateUniswapAddress(address _uniswapAddress) external;
}
