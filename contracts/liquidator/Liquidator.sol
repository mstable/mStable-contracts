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

}
