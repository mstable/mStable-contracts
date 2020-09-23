pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IUniswapV2Router02 } from '../platform-integrations/IUniswapV2Router02.sol';
import { ICERC20 } from '../platform-integrations/ICompound.sol';
import { IPlatformIntegration } from '../../interfaces/IPlatformIntegration.sol';
import { ILiquidator } from '../../interfaces/ILiquidator.sol';

// Internal
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { InitializableModule } from "../../shared/InitializableModule.sol";
import { InitializableReentrancyGuard } from "../../shared/InitializableReentrancyGuard.sol";
import { InitializableAbstractIntegration } from "../platform-integrations/InitializableAbstractIntegration.sol";

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
    ILiquidator,
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
    event UniswapUpdated(address indexed uniswapAddress);

    address public uniswapAddress;

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
    * @param _sellToken The integration contract address for the _bAsset
    * @param _trancheAmount The amount of tokens to be sold when triggered
    * @param _lendingPlatform The lending platform to use for the deposit
    * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
    * @param _paused Whether the liquidation is paused
    */
    function createLiquidation(
        address         _bAsset,
        address         _integration,
        address         _sellToken,
        uint            _trancheAmount,
        LendingPlatform _lendingPlatform,
        address[]       calldata _uniswapPath,
        bool            _paused
    )
        external
        onlyGovernor
    {
        require(_bAsset != address(0), "bAsset cannot be zero address");
        require(_integration != address(0), "integration cannot be zero address");
        require(_sellToken != address(0), "sellToken cannot be zero address");
        require(_trancheAmount != uint(0), "trancheAmount cannot be zero");
        require(_uniswapPath.length >= uint(2), "uniswapPath must have at least two addresses");

        address pToken = IPlatformIntegration(_integration).bAssetToPToken(_bAsset);
        require(pToken != address(0), "no pToken for this bAsset");

        Liquidation storage liq = liquidations[_bAsset];

        liq.bAsset = _bAsset;
        liq.integration = _integration;
        liq.sellToken = _sellToken;
        liq.trancheAmount = _trancheAmount;
        liq.lendingPlatform = _lendingPlatform;
        liq.pToken = pToken;
        liq.uniswapPath = _uniswapPath;
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
    * @param _sellToken The integration contract address for the _bAsset
    * @param _trancheAmount The amount of tokens to be sold when triggered
    * @param _lendingPlatform The DEX to sell the token on
    * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
    * @param _paused Whether the liquidation is paused
    */
    function updateLiquidation(
        address         _bAsset,
        address         _integration,
        address         _sellToken,
        uint            _trancheAmount,
        LendingPlatform _lendingPlatform,
        address[]       calldata _uniswapPath,
        bool            _paused
    )

        external
        onlyGovernor
    {
        require(liquidations[_bAsset].bAsset != address(0), "No liquidation for this bAsset");
        require(_bAsset != address(0), "bAsset cannot be zero address");
        require(_integration != address(0), "integration cannot be zero address");
        require(_sellToken != address(0), "sellToken cannot be zero address");
        require(_trancheAmount != uint(0), "trancheAmount cannot be zero");
        require(_uniswapPath.length >= uint(2), "uniswapPath must have at least two addresses");

        Liquidation storage liquidation = liquidations[_bAsset];

        uint256 pTokenBalance = IERC20(liquidation.pToken).balanceOf(address(this));
        require(pTokenBalance == uint(0), "Unclaimed pTokens on this liquidation");

        uint256 sellTokenBalance = IERC20(liquidation.sellToken).balanceOf(address(this));
        require(sellTokenBalance == uint(0), "Unsold sellTokens on this liquidation");
        
        liquidation.integration = _integration;
        liquidation.sellToken = _sellToken;
        liquidation.trancheAmount = _trancheAmount;
        liquidation.lendingPlatform = _lendingPlatform;
        liquidation.uniswapPath = _uniswapPath;
        liquidation.trancheAmount = _trancheAmount;
        liquidation.paused = _paused;

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

        Liquidation memory liquidation = liquidations[_bAsset];

        uint256 pTokenBalance = IERC20(liquidation.pToken).balanceOf(address(this));
        require(pTokenBalance == uint(0), "Unclaimed pTokens on this liquidation");

        uint256 sellTokenBalance = IERC20(liquidation.sellToken).balanceOf(address(this));
        require(sellTokenBalance == uint(0), "Unsold sellTokens on this liquidation");

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
    * @dev Triggers a liquidation
    * @param _bAsset The _bAsset liquidation to be triggered
    */
    function triggerLiquidation(address _bAsset)
        external
        payable
    {
        Liquidation storage liquidation = liquidations[_bAsset];
        require(block.timestamp > liquidation.lastTriggered.add(1 days),
                "Trigger liquidation only callable every 24 hours");
        liquidation.lastTriggered = block.timestamp;

        // Cache variables
        address sellToken = liquidation.sellToken;
        address bAsset = liquidation.bAsset;
        address integration = liquidation.integration;

        // Transfer sellTokens from integration contract if there are some
        // Assumes infinite approval
        uint256 integrationBal = IERC20(sellToken).balanceOf(integration);
        if (integrationBal > 0) {
            IERC20(sellToken).safeTransferFrom(integration, address(this), integrationBal);
        }

        // Check contract balance
        uint256 bal = IERC20(sellToken).balanceOf(address(this));
        require((bal > 0), "No sell tokens to liquidate");

        // Get the amount to sell based on the tranche amount we want to buy
        (uint256 amountToSell , uint256 expectedAmount) = getAmountToSell(liquidation.uniswapPath, liquidation.trancheAmount);

        // The minimum amount of output tokens that must be received for the transaction not to revert
        // Set to 80% of expected
        uint256 minAcceptable = expectedAmount.mul(uint(8000)).div(uint(10000));

        // Sell amountToSell unless balance is lower in which case sell everything and relax acceptable check
        uint256 sellAmount;
        if (bal > amountToSell) {
            sellAmount = amountToSell;
        } else {
            sellAmount = bal;
            minAcceptable = 0;
        }

        // Approve Uniswap and make the swap
        // https://uniswap.org/docs/v2/smart-contracts/router02/#swapexacttokensfortokens
        IERC20(sellToken).safeApprove(uniswapAddress, 0);
        IERC20(sellToken).safeApprove(uniswapAddress, amountToSell);
        IUniswapV2Router02(uniswapAddress).swapExactTokensForTokens(
            sellAmount,     
            minAcceptable,
            liquidation.uniswapPath,
            address(this),
            now.add(1800)
        );

        // Deposit to lending platform
        // Assumes integration contracts have inifinte approval to collect them
        if (liquidation.lendingPlatform == LendingPlatform.Compound) {
            depositToCompound(liquidation.pToken, bAsset); 
        } else {
            revert("Lending Platform not supported");
        }

        emit LiquidationTriggered(_bAsset);
    }

    /**
    * @dev Deposits to Compound 
    * @param _pToken The _pToken to mint
    * @param _bAsset The _bAsset liquidation to be triggered
    */
    function depositToCompound(address _pToken, address _bAsset)
        internal
    {
        uint256 bAssetBalance = IERC20(_bAsset).balanceOf(address(this));
        require((bAssetBalance > 0), "No tokens to deposit");
        require(ICERC20(_pToken).mint(bAssetBalance) == 0, "cToken mint failed");
    }

    /**
    * @dev Get the amount of sellToken to be sold for a number of bAsset
    * @param _uniswapPath The Uniswap path for this liquidation
    * @param _trancheAmount The tranche size that we want to buy each time 
    */
    function getAmountToSell(
        address[]   memory _uniswapPath,
        uint256      _trancheAmount
    )
        internal view returns (uint256, uint256)
    {

        // The _trancheAmount is the number of bAsset we want to buy each time
        // DAI has 18 decimals so 1000 DAI is 10*10^18 or 1000000000000000000000
        // This value is set when adding the liquidation
        // We randomize this amount by buying betwen 80% and 95% of the amount.
        // Uniswap gives us the amount we need to sell with `getAmountsIn`.
        uint256 randomBasisPoint = uint256(blockhash(block.number-1)).mod(uint(1500)).add(uint(8000));
        uint256 amountWanted = _trancheAmount.mul(randomBasisPoint).div(uint(10000));

        // Returns the minimum input asset amount required to buy 
        // the given output asset amount (accounting for fees) given reserves
        // https://uniswap.org/docs/v2/smart-contracts/router02/#getamountsin
        uint[] memory amountsIn = IUniswapV2Router02(uniswapAddress).getAmountsIn(amountWanted, _uniswapPath); 

        return (amountsIn[0], amountWanted);
    }

}
