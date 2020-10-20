pragma solidity 0.5.16;

import { ICurveMetaPool } from "./ICurveMetaPool.sol";
import { IUniswapV2Router02 } from "./IUniswapV2Router02.sol";
import { ISavingsManager } from "../../interfaces/ISavingsManager.sol";

import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { InitializableModule } from "../../shared/InitializableModule.sol";
import { ILiquidator } from "./ILiquidator.sol";
import { MassetHelpers } from "../../masset/shared/MassetHelpers.sol";

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/**
 * @title   Liquidator
 * @author  Stability Labs Pty. Ltd.
 * @notice  The Liquidator allows rewards to be swapped for another token
 *          and returned to a calling contract
 * @dev     VERSION: 1.0
 *          DATE:    2020-10-13
 */
contract Liquidator is
    ILiquidator,
    Initializable,
    InitializableModule
{
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event LiquidationModified(address indexed integration);
    event LiquidationEnded(address indexed integration);
    event Liquidated(address indexed sellToken, address mUSD, uint256 mUSDAmount, address buyToken);

    address public mUSD;
    ICurveMetaPool public curve;
    IUniswapV2Router02 public uniswap;
    uint256 private interval = 7 days;

    mapping(address => Liquidation) public liquidations;

    struct Liquidation {
        address sellToken;

        address bAsset;
        int128 curvePosition;
        address[] uniswapPath;

        uint256 lastTriggered;
        uint256 trancheAmount;   // The amount of bAsset units to buy each week, with token decimals
    }

    function initialize(
        address _nexus,
        address _uniswap,
        address _curve,
        address _mUSD
    )
        external
        initializer
    {
        InitializableModule._initialize(_nexus);

        require(_uniswap != address(0), "Invalid uniswap address");
        uniswap = IUniswapV2Router02(_uniswap);

        require(_curve != address(0), "Invalid curve address");
        curve = ICurveMetaPool(_curve);

        require(_mUSD != address(0), "Invalid mUSD address");
        mUSD = _mUSD;
    }

    /***************************************
                    GOVERNANCE
    ****************************************/

    /**
    * @dev Create a liquidation
    * @param _integration The integration contract address from which to receive sellToken
    * @param _sellToken Token harvested from the integration contract
    * @param _bAsset The asset to buy on Uniswap
    * @param _curvePosition Position of the bAsset in Curves MetaPool
    * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
    * @param _trancheAmount The amount of bAsset units to buy in each weekly tranche
    */
    function createLiquidation(
        address _integration,
        address _sellToken,
        address _bAsset,
        int128 _curvePosition,
        address[] calldata _uniswapPath,
        uint256 _trancheAmount
    )
        external
        onlyGovernance
    {
        require(liquidations[_integration].sellToken == address(0), "Liquidation exists for this bAsset");

        require(
            _integration != address(0) &&
            _sellToken != address(0) &&
            _bAsset != address(0) &&
            _uniswapPath.length >= 2,
            "Invalid inputs"
        );
        require(_validUniswapPath(_sellToken, _bAsset, _uniswapPath), "Invalid uniswap path");

        liquidations[_integration] = Liquidation({
            sellToken: _sellToken,
            bAsset: _bAsset,
            curvePosition: _curvePosition,
            uniswapPath: _uniswapPath,
            lastTriggered: 0,
            trancheAmount: _trancheAmount
        });

        emit LiquidationModified(_integration);
    }

    /**
    * @dev Update a liquidation
    * @param _integration The integration contract in question
    * @param _bAsset New asset to buy on Uniswap
    * @param _curvePosition Position of the bAsset in Curves MetaPool
    * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
    * @param _trancheAmount The amount of bAsset units to buy in each weekly tranche
    */
    function updateBasset(
        address _integration,
        address _bAsset,
        int128 _curvePosition,
        address[] calldata _uniswapPath,
        uint256 _trancheAmount
    )
        external
        onlyGovernance
    {
        Liquidation memory liquidation = liquidations[_integration];

        address oldBasset = liquidation.bAsset;
        require(oldBasset != address(0), "Liquidation does not exist");
        
        require(_bAsset != address(0), "Invalid bAsset");
        require(_validUniswapPath(liquidation.sellToken, _bAsset, _uniswapPath), "Invalid uniswap path");

        liquidations[_integration].bAsset = _bAsset;
        liquidations[_integration].curvePosition = _curvePosition;
        liquidations[_integration].uniswapPath = _uniswapPath;
        liquidations[_integration].trancheAmount = _trancheAmount;

        emit LiquidationModified(_integration);
    }

    /**
    * @dev Validates a given uniswap path - valid if sellToken at position 0 and bAsset at end
    * @param _sellToken Token harvested from the integration contract
    * @param _bAsset New asset to buy on Uniswap
    * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
    */
    function _validUniswapPath(address _sellToken, address _bAsset, address[] memory _uniswapPath)
        internal
        pure
        returns (bool)
    {
        uint256 len = _uniswapPath.length;
        return _sellToken == _uniswapPath[0] && _bAsset == _uniswapPath[len-1];
    }

    /**
    * @dev Delete a liquidation
    */
    function deleteLiquidation(address _integration)
        external
        onlyGovernance
    {
        Liquidation memory liquidation = liquidations[_integration];
        require(liquidation.bAsset != address(0), "Liquidation does not exist");

        delete liquidations[_integration];
        emit LiquidationEnded(_integration);
    }

    /***************************************
                    LIQUIDATION
    ****************************************/

    /**
    * @dev Triggers a liquidation, flow (once per week):
    *    - Sells $COMP for $USDC (or other) on Uniswap (up to trancheAmount)
    *    - Sell USDC for mUSD on Curve
    *    - Send to SavingsManager
    * @param _integration Integration for which to trigger liquidation
    */
    function triggerLiquidation(address _integration)
        external
    {
        Liquidation memory liquidation = liquidations[_integration];

        address bAsset = liquidation.bAsset;
        require(bAsset != address(0), "Liquidation does not exist");

        require(block.timestamp > liquidation.lastTriggered.add(interval), "Must wait for interval");
        liquidations[_integration].lastTriggered = block.timestamp;

        // Cache variables
        address sellToken = liquidation.sellToken;
        address[] memory uniswapPath = liquidation.uniswapPath;

        // 1. Transfer sellTokens from integration contract if there are some
        //    Assumes infinite approval
        uint256 integrationBal = IERC20(sellToken).balanceOf(_integration);
        if (integrationBal > 0) {
            IERC20(sellToken).safeTransferFrom(_integration, address(this), integrationBal);
        }

        // 2. Get the amount to sell based on the tranche amount we want to buy
        //    Check contract balance
        uint256 sellTokenBal = IERC20(sellToken).balanceOf(address(this));
        require(sellTokenBal > 0, "No sell tokens to liquidate");
        require(liquidation.trancheAmount > 0, "Liquidation has been paused");
        //    Calc amounts for max tranche
        uint[] memory amountsIn = uniswap.getAmountsIn(liquidation.trancheAmount, uniswapPath);
        uint256 sellAmount = amountsIn[0];

        if (sellTokenBal < sellAmount) {
            sellAmount = sellTokenBal;
        }

        // 3. Make the swap
        // 3.1 Approve Uniswap and make the swap
        IERC20(sellToken).safeApprove(address(uniswap), 0);
        IERC20(sellToken).safeApprove(address(uniswap), sellAmount);
        // 3.2. Make the sale > https://uniswap.org/docs/v2/smart-contracts/router02/#swapexacttokensfortokens
        uniswap.swapExactTokensForTokens(
            sellAmount,
            0,
            uniswapPath,
            address(this),
            block.timestamp.add(1800)
        );
        uint256 bAssetBal = IERC20(bAsset).balanceOf(address(this));

        // 3.3. Trade on Curve
        IERC20(bAsset).safeApprove(address(curve), 0);
        IERC20(bAsset).safeApprove(address(curve), bAssetBal);
        uint256 purchased = curve.exchange_underlying(liquidation.curvePosition, 0, bAssetBal, 0);

        // 4.0. Send to SavingsManager
        address savings = _savingsManager();
        IERC20(mUSD).safeApprove(savings, 0);
        IERC20(mUSD).safeApprove(savings, purchased);
        ISavingsManager(savings).depositLiquidation(mUSD, purchased);

        emit Liquidated(sellToken, mUSD, purchased, bAsset);
    }
}