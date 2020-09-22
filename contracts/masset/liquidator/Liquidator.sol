pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IUniswapV2Router02 } from '../platform-integrations/IUniswapV2Router02.sol';
import { ICERC20 } from '../platform-integrations/ICompound.sol';
import { IPlatformIntegration } from '../../interfaces/IPlatformIntegration.sol';
// import { ILiquidator } from '../../interfaces/ILiquidator.sol';

// Internal
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { InitializableModule } from "../../shared/InitializableModule.sol";
import { InitializableReentrancyGuard } from "../../shared/InitializableReentrancyGuard.sol";
import { InitializableAbstractIntegration } from "../platform-integrations/InitializableAbstractIntegration.sol";

// Libs
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface Integration {
    
}

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

    event LiquidationCreated(address indexed bAsset);
    event LiquidationDeleted(address indexed bAsset);
    event LiquidationUpdated(address indexed bAsset);
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
        uint        lastCollected;
        uint        lastTriggered;
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
        // TODO add mocks for this in tests
        //address pToken = IPlatformIntegration(_integration).bAssetToPToken(_bAsset);
        //require(pToken != address(0), "no pToken for this bAsset");

        Liquidation storage liq = liquidations[_bAsset];
        liq.bAsset = _bAsset;
        liq.integration = _integration;
        liq.sellToken = _sellToken;
        liq.uniswapPath = _uniswapPath;
        liq.amount = _amount;
        liq.paused = _paused;

        emit LiquidationCreated(_bAsset);
    }

    /**
     * @dev Get a liquidation
     * @param   _bAsset Address for the underlying bAsset
     * @return  liquidation The liquidation data
     */
    function readLiquidation(address _bAsset)
        external
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

        // Check for unclaimed pTokens and revert
        // TODO Add mocks to tests for this call
        //address pToken = IPlatformIntegration(_integration).bAssetToPToken(_bAsset);
        //uint256 pTokenbalance = IERC20(pToken).balanceOf(address(this));
        //require(pTokenbalance > 0, "Unclaimed pTokens on this liquidation");
        
        liq.integration = _integration;
        liq.sellToken = _sellToken;
        liq.uniswapPath = _uniswapPath;
        liq.amount = _amount;
        liq.paused = _paused;

        emit LiquidationUpdated(_bAsset);
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
        emit LiquidationDeleted(_bAsset);
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
    * @return  liquidation The liquidation data
    */
    function collect(address _bAsset)
        external   
    {
        Liquidation memory liquidation = liquidations[_bAsset];
        liquidation.lastCollected = block.timestamp;

        require(msg.sender == liquidation.integration, 
                "Only integration contract can execute");

        // Randomise the time delay
        uint256 salt = uint256(keccak256(abi.encodePacked(blockhash(block.number)))).mod(3000000);
        uint256 timeDelay = ((uint256(1 hours)).mul(salt)).div(1000000);

        require(block.timestamp > liquidation.lastCollected.add(timeDelay),
                "Collect called too soon");

        // Get the pToken for the bAsset from the Integration contract
        address pToken = IPlatformIntegration(liquidation.integration).bAssetToPToken(liquidation.bAsset);
        
        uint256 balance = IERC20(pToken).balanceOf(address(this));
        require(balance > 0, "No balance to send");

        // if the balance is less than 1000 transfer everything
        if (balance < 1000) {
            IERC20(pToken).safeTransfer(liquidation.integration, balance);
        } else {
            // generate a random basis point number between 1000 & 4000
            uint256 randomBp = uint256(blockhash(block.number-1)).mod(3000).add(1000);
            // calculate a percentage of total balance
            uint256 toSend = balance.mul(randomBp).div(uint(10000));

            // Send tokens
            IERC20(pToken).safeTransfer(liquidation.integration, toSend);
        }

        emit LiquidationCollected(_bAsset);
    }

    /**
    * @dev Triggers a liquidation
    * @param _bAsset The _bAsset liquidation to be triggered
    */
    function triggerLiquidation(address _bAsset)
        external
    {
        Liquidation memory liquidation = liquidations[_bAsset];
        liquidation.lastTriggered = block.timestamp;

        require(block.timestamp > liquidation.lastTriggered.add(1 days),
                "Trigger liquidation only callable every 24 hours");

        // Token being sold is the first in the Uniswap path
        address sellToken = liquidation.uniswapPath[0];

        // Token being bought is the last in the Uniswap path
        address buyToken = liquidation.uniswapPath[liquidation.uniswapPath.length.sub(1)];

        uint256 allowance = IERC20(sellToken).allowance(liquidation.integration, address(this));
        require(allowance = 0, "No allowance on sell tokens to liquidate");

        // The amount we want to receive
        // This computes a randomised amount of the buyToken wanted between 1000 & 4000
        uint256 randomAmountWanted = uint256(blockhash(block.number-1)).mod(3000).add(1000);

        // Get minimum amount of sellTokens needed for the amount of buyTokens
        // https://uniswap.org/docs/v2/smart-contracts/router02/#getamountsout
        uint[] memory amountsIn = IUniswapV2Router02(uniswapAddress).getAmountsIn(randomAmountWanted, liquidation.uniswapPath); 

        // Add 10 % to remain over minimum amount
        uint256 tenPercentOfMinAmount = amountsIn[0].mul(uint(1000)).div(uint(10000));
        uint256 minAmount = amountsIn[0].add(tenPercentOfMinAmount);
        uint256 sellAmount;

        // If the allowance is less than the minAmount then sell everything 
        if (allowance < minAmount) {
            sellAmount = allowance;
        } else {
            sellAmount = minAmount;
        }

        // Approve the transfer to Uniswap
        IERC20(sellToken).safeApprove(uniswapAddress, 0);
        IERC20(sellToken).safeApprove(uniswapAddress, sellAmount);

        // Make the swap
        // https://uniswap.org/docs/v2/smart-contracts/router02/#swapexacttokensfortokens
        uint[] memory uniswapAmounts = IUniswapV2Router02(uniswapAddress).swapExactTokensForTokens(
            sellAmount,     
            uint256(0),
            liquidation.uniswapPath,
            address(this),
            now.add(1800)
        );

        // Get the pToken for this bAsset
        address cToken = IPlatformIntegration(liquidation.integration).bAssetToPToken(liquidation.bAsset);

        uint256 cTokenBalance = IERC20(cToken).balanceOf(address(this));

        // Deposit to lending platform
        require(ICERC20(cToken).mint(cTokenBalance) == 0, "cToken mint failed");

        emit LiquidationTriggered(_bAsset);
    }

}
