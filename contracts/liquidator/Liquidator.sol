pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
//import { ILiquidator } from "../interfaces/ILiquidator.sol";
import { IUniswapV2Router02 } from '../masset/platform-integrations/IUniswapV2Router02.sol';

// Internal
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { InitializableModule } from "../shared/InitializableModule.sol";
import { InitializableReentrancyGuard } from "../shared/InitializableReentrancyGuard.sol";

// Libs
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event LiquidationAdded(address indexed bAsset);
    event LiquidationRemoved(address indexed bAsset);
    event LiquidationPaused(address indexed bAsset);
    event LiquidationTriggered(address indexed bAsset);
    event LiquidationCollected(address indexed bAsset);
    event UniswapUpdated(address indexed uniswapAddress);

    address public uniswapAddress;

    struct Liquidation {
        address     bAsset;
        address     integration;
        address     sellToken;
        address[]   uniswapPath;
        uint        amount;
        bool        paused;
    }

    mapping(address => Liquidation) public liquidations;

    /**
     * @dev Constructor
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function initialize(
        address     _nexus,
        address     _uniswapAddress
    )
        external
        initializer
    {
        InitializableModule._initialize(_nexus);
        InitializableReentrancyGuard._initialize();
        _initialize(_uniswapAddress);
    }


    /**
    * @dev Internal initialize function, to set the Uniswap address
    * @param _uniswapAddress   Uniswap contract address
    */
    function _initialize(address _uniswapAddress)
        internal
    {
        uniswapAddress = _uniswapAddress;
    }

    /**
    * @dev Create a liquidation
    * @param _bAsset The _bAsset address that this liquidation is for
    * @param _integration The integration contract address for the _bAsset
    * @param _sellToken The token address to be sold
    * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
    * @param _amount The amount of tokens to be sold
    * @param _paused Whether the liquidation is paused
    */
    function createLiquidation(
        address     _bAsset,
        address     _integration,
        address     _sellToken,
        address[]   calldata _uniswapPath,
        uint        _amount,
        bool        _paused
    )
        external
        onlyGovernor
    {
        require(_bAsset != address(0), "_bAsset cannot be zero address");
        require(_integration != address(0), "integration cannot be zero address");

        Liquidation storage liq = liquidations[_bAsset];
        liq.bAsset = _bAsset;
        liq.integration = _integration;
        liq.sellToken = _sellToken;
        liq.uniswapPath = _uniswapPath;
        liq.amount = _amount;
        liq.paused = _paused;

        emit LiquidationAdded(_bAsset);
    }

    /**
     * @dev Get a liquidation
     * @param   _bAsset Address for the underlying bAsset
     * @return  liquidation The liquidation data
     */
    function readLiquidation(address _bAsset)
        external
        onlyGovernor
        returns (Liquidation memory liquidation)
    {
        require(liquidations[_bAsset].bAsset != address(0), "No liquidation for this bAsset");

        liquidation = liquidations[_bAsset];
        return liquidation;
    }

    /**
    * @dev Update a liquidation
    * @param _bAsset The _bAsset address that this liquidation is for
    * @param _integration The integration contract address for the _bAsset
    * @param _sellToken The token address to be sold
    * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
    * @param _amount The amount of tokens to be sold
    * @param _paused Whether the liquidation is paused
    */
    function updateLiquidation(
        address     _bAsset,
        address     _integration,
        address     _sellToken,
        address[]   calldata _uniswapPath,
        uint        _amount,
        bool        _paused
    )

        external
        onlyGovernor
    {
        require(liquidations[_bAsset].bAsset != address(0), "No liquidation for this bAsset");

        Liquidation storage liq = liquidations[_bAsset];
        liq = liquidations[_bAsset];
        liq.bAsset = _bAsset;
        liq.integration = _integration;
        liq.sellToken = _sellToken;
        liq.uniswapPath = _uniswapPath;
        liq.amount = _amount;
        liq.paused = _paused;

        emit LiquidationPaused(_bAsset);
    }

    /**
    * @dev Delete a liquidation
    * @param _bAsset The _bAsset for the liquidation
    */
    function deleteLiquidation(address _bAsset)
        external
        onlyGovernor
    {
        require(liquidations[_bAsset].bAsset != address(0), "No liquidation for this bAsset");

        delete liquidations[_bAsset];
        emit LiquidationRemoved(_bAsset);
    }

    /**
    * @dev  Update the Uniswap contract address
    *       Whilst it is unlikely this will be needed it is helpful for testing
    * @param _uniswapAddress The uniswap address to assign
    */
    function updateUniswapAddress(address _uniswapAddress)
        external
        onlyGovernor
    {

        require(_uniswapAddress != address(0), "_uniswapAddress cannot be zero address");
        uniswapAddress = _uniswapAddress;
        emit UniswapUpdated(_uniswapAddress);
    }

    /**
    * @dev Allows a calling integration contract to collect redeemed tokens
    */
    function collect(address _bAsset)
        external   
    {
        Liquidation memory liq = liquidations[_bAsset];
        require(msg.sender == liq.integration, "Only integration contract can execute");

        address sendAddress = liq.integration;
        address asset = liq.sellToken;
        
        uint256 balance = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeApprove(sendAddress, 0);
        IERC20(asset).safeApprove(sendAddress, balance);
        IERC20(asset).safeTransfer(sendAddress, balance);
    }

    /**
    * @dev Triggers a liquidation
    * @param _bAsset The _bAsset liquidation to be triggered
    */
    function triggerLiquidation(address _bAsset)
        external
    {
        // TODO  limit calling to a 24 hour period

        Liquidation memory liquidation = liquidations[_bAsset];
        address asset = liquidation.sellToken;
        uint256 sellAmount;

        // TODO estimate dollar amount
        uint256 randomAmountToSell = uint(blockhash(block.number-1)) % 3000 + 1000;
        uint256 balance = IERC20(asset).balanceOf(address(this));

        if (balance > sellAmount) {
            sellAmount = randomAmountToSell;
        } else {
            sellAmount = balance;
        }

        IERC20(asset).safeApprove(uniswapAddress, 0);
        IERC20(asset).safeApprove(uniswapAddress, sellAmount);

        IUniswapV2Router02(uniswapAddress).swapExactTokensForTokens(
            sellAmount,     
            uint256(0),
            liquidation.uniswapPath,
            address(this),
            now.add(1800)
        );
    }

    /**
    * @dev Generate a random number in a range 
    */
    function randomNumber() 
        external 
        returns (uint) 
    {
        return uint(blockhash(block.number-1))% 2000 + 1000;
    }

}
