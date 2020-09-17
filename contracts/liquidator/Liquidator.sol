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

    // Module-key => Liquidation
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

    //function addLiquidation(address _bAsset, address _integration, uint _amount ) external;
    /**
    * @dev Propose a new or update existing module
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
        emit LiquidationAdded(_bAsset);
    }

    /**
     * @dev Get the liquidation for a bAsset
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


    // Governor only
    //function removeLiquidation(address _bAsset) external;

    // Restricted to the `integrationContract` given in addLiquidation
    //function collect() external;

    // Callable by anyone to trigger a selling event 
    //function triggerLiquidation(address _bAsset) external;

    // Governor only
    //function removeLiquidation(address _bAsset) external;
    //function pauseLiquidation(address _bAsset) external;
    //function setCollectDrip(address _bAsset) external;

}
