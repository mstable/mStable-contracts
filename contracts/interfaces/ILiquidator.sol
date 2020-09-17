pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

/**
  * @title ILiquidator
  * @dev Interface for the Liquidator component
  */

interface ILiquidator {
    struct Liquidation {
        address basset;
        address integration;
        address rewardToken;
        uint    amount;
        uint    collectDrip;
        bool    paused;
    }

    // Views
    function getLiquidation(address _bAsset) external view returns (Liquidation memory liquidation);

    // Restricted to the `integrationContract` given in addLiquidation
    function collect() external;

    // Callable by anyone to trigger a selling event 
    function triggerLiquidation(address _bAsset) external;

    // Governor only
    function addLiquidation(address _bAsset, address _integration, uint _amount ) external;
    function removeLiquidation(address _bAsset) external;
    function pauseLiquidation(address _bAsset) external;
    function setCollectDrip(address _bAsset) external;
}

