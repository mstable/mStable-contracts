pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { ILiquidator } from "../interfaces/ILiquidator.sol";

// Internal
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { InitializableModule } from "../shared/InitializableModule.sol";
import { InitializableReentrancyGuard } from "../shared/InitializableReentrancyGuard.sol";

// Libs
import { StableMath } from "../shared/StableMath.sol";

/**
 * @title   Liquidator
 * @author  Stability Labs Pty. Ltd.
 * @notice  The Liquidator allows rewards to be swapped for another token
 *          and returned to a calling contract
 * @dev     VERSION: 1.0
 *          DATE:    2020-09-17
 */
contract Liquidator is
    Initializable,
    InitializableModule,
    InitializableReentrancyGuard
    {
    using StableMath for uint256;

    event LiquidationAdded(address indexed bAsset);
    event LiquidationRemoved(address indexed bAsset);
    event LiquidationPaused(address indexed bAsset);
    event LiquidationTriggered(address indexed bAsset);
    event LiquidationCollected(address indexed bAsset);

    struct Liquidation {
        address basset;
        address integration;
        address rewardToken;
        uint    amount;
        uint    collectDrip;
        bool    paused;
    }

    // bAsset key => Liquidation
    mapping(address => Liquidation) public liquidations;

    /**
     * @dev Constructor
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function initialize(
        address _nexus
    )
        external
        initializer
    {
        InitializableModule._initialize(_nexus);
        InitializableReentrancyGuard._initialize();
    }

    /**
    * @dev Add a liquidation
    * @param _bAsset The _bAsset
    * @param _integration The integration contract address for the _bAsset
    * @param _amount The amount to be sold
    */
    function addLiquidation(
        address _bAsset,
        address _integration,
        uint _amount
    )
        external
        onlyGovernor
    {
        require(_bAsset != address(0), "_bAsset cannot be zero address");
        require(_integration != address(0), "integration cannot be zero address");

        Liquidation storage liq = liquidations[_bAsset];

        liq.basset = _bAsset;
        liq.integration = _integration;
        liq.amount = _amount;
        emit LiquidationAdded(_bAsset);
    }

    /**
     * @dev Get a liquidation
     * @param   _bAsset Address for the underlying bAsset
     * @return  liquidation The liquidation data
     */
    function getLiquidation(address _bAsset)
        external
        onlyGovernor
        returns (Liquidation memory liquidation)
    {
        require(liquidations[_bAsset].basset != address(0), "No liquidation for this bAsset");
        liquidation = liquidations[_bAsset];
        return liquidation;
    }


    /**
    * @dev Remove a liquidation
    * @param _bAsset The _bAsset for the liquidation
    */
    function removeLiquidation(address _bAsset)
        external
        onlyGovernor
    {
        require(liquidations[_bAsset].basset != address(0), "No liquidation for this bAsset");

        delete liquidations[_bAsset];
        emit LiquidationRemoved(_bAsset);
    }

    /**
    * @dev Pause a liquidation
    * @param _bAsset The _bAsset liquidation to be paused
    */
    function pauseLiquidation(address _bAsset)
        external
        onlyGovernor
    {
        require(liquidations[_bAsset].basset != address(0), "No liquidation for this bAsset");

        liquidations[_bAsset].amount = 10;
        liquidations[_bAsset].paused = true;
        emit LiquidationPaused(_bAsset);
    }

    /**
    * @dev Collect assets from the Liquidator
    */
    function collect(address _bAsset)
        external
    {
        // TODO
    }

    /**
    * @dev Collect assets from the Liquidator
    * @param _bAsset The _bAsset liquidation to be triggered
    */
    function triggerLiquidation(address _bAsset)
        external
    {
        // TODO
    }


    // Governor only
    //function setCollectDrip(address _bAsset) external;

}
