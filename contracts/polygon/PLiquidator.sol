// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.6;

import { ISavingsManager } from "../interfaces/ISavingsManager.sol";
import { IMasset } from "../interfaces/IMasset.sol";
import { IPLiquidator } from "./IPLiquidator.sol";
import { IUniswapV2Router02 } from "../peripheral/Uniswap/IUniswapV2Router02.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { IBasicToken } from "../shared/IBasicToken.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title   PLiquidator
 * @author  mStable
 * @notice  The Liquidator allows rewards to be swapped for another token and sent
 *          to SavingsManager for distribution
 * @dev     VERSION: 1.0
 *          DATE:    2021-04-22
 */
contract PLiquidator is IPLiquidator, ImmutableModule {
    using SafeERC20 for IERC20;

    event LiquidationModified(address indexed integration);
    event LiquidationEnded(address indexed integration);
    event Liquidated(address indexed sellToken, address mUSD, uint256 mUSDAmount, address buyToken);

    address public immutable mUSD;
    IUniswapV2Router02 public immutable quickSwap;

    mapping(address => PLiquidation) public liquidations;
    mapping(address => uint256) public minReturn;

    struct PLiquidation {
        address sellToken;
        address bAsset;
        address[] uniswapPath;
        uint256 lastTriggered;
    }

    constructor(
        address _nexus,
        address _quickswapRouter,
        address _mUSD
    ) ImmutableModule(_nexus) {
        require(_quickswapRouter != address(0), "Invalid quickSwap address");
        quickSwap = IUniswapV2Router02(_quickswapRouter);
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
     * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
     * @param _minReturn Minimum exact amount of bAsset to get for each (whole) sellToken unit
     */
    function createLiquidation(
        address _integration,
        address _sellToken,
        address _bAsset,
        address[] calldata _uniswapPath,
        uint256 _minReturn
    ) external override onlyGovernance {
        require(
            liquidations[_integration].sellToken == address(0),
            "Liquidation exists for this bAsset"
        );

        require(
            _integration != address(0) &&
                _sellToken != address(0) &&
                _bAsset != address(0) &&
                _uniswapPath.length >= 2 &&
                _minReturn > 0,
            "Invalid inputs"
        );
        require(_validUniswapPath(_sellToken, _bAsset, _uniswapPath), "Invalid uniswap path");

        liquidations[_integration] = PLiquidation({
            sellToken: _sellToken,
            bAsset: _bAsset,
            uniswapPath: _uniswapPath,
            lastTriggered: 0
        });
        minReturn[_integration] = _minReturn;

        emit LiquidationModified(_integration);
    }

    /**
     * @dev Update a liquidation
     * @param _integration The integration contract in question
     * @param _bAsset New asset to buy on Uniswap
     * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
     * @param _minReturn Minimum exact amount of bAsset to get for each (whole) sellToken unit
     */
    function updateBasset(
        address _integration,
        address _bAsset,
        address[] calldata _uniswapPath,
        uint256 _minReturn
    ) external override onlyGovernance {
        PLiquidation memory liquidation = liquidations[_integration];

        address oldBasset = liquidation.bAsset;
        require(oldBasset != address(0), "Liquidation does not exist");

        require(_minReturn > 0, "Must set some minimum value");
        require(_bAsset != address(0), "Invalid bAsset");
        require(
            _validUniswapPath(liquidation.sellToken, _bAsset, _uniswapPath),
            "Invalid uniswap path"
        );

        liquidations[_integration].bAsset = _bAsset;
        liquidations[_integration].uniswapPath = _uniswapPath;
        minReturn[_integration] = _minReturn;

        emit LiquidationModified(_integration);
    }

    /**
     * @dev Validates a given uniswap path - valid if sellToken at position 0 and bAsset at end
     * @param _sellToken Token harvested from the integration contract
     * @param _bAsset New asset to buy on Uniswap
     * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
     */
    function _validUniswapPath(
        address _sellToken,
        address _bAsset,
        address[] memory _uniswapPath
    ) internal pure returns (bool) {
        uint256 len = _uniswapPath.length;
        return _sellToken == _uniswapPath[0] && _bAsset == _uniswapPath[len - 1];
    }

    /**
     * @dev Delete a liquidation
     */
    function deleteLiquidation(address _integration) external override onlyGovernance {
        PLiquidation memory liquidation = liquidations[_integration];
        require(liquidation.bAsset != address(0), "Liquidation does not exist");

        delete liquidations[_integration];
        delete minReturn[_integration];

        emit LiquidationEnded(_integration);
    }

    /***************************************
                    LIQUIDATION
    ****************************************/

    /**
     * @dev Triggers a liquidation, flow (once per week):
     *    - Sells $COMP for $USDC (or other) on Uniswap (up to trancheAmount)
     *    - Mint mUSD from USDC
     *    - Send to SavingsManager
     * @param _integration Integration for which to trigger liquidation
     */
    function triggerLiquidation(address _integration) external override {
        // solium-disable-next-line security/no-tx-origin
        require(tx.origin == msg.sender, "Must be EOA");

        PLiquidation memory liquidation = liquidations[_integration];

        address bAsset = liquidation.bAsset;
        require(bAsset != address(0), "Liquidation does not exist");

        require(block.timestamp > liquidation.lastTriggered + 22 hours, "Must wait for interval");
        liquidations[_integration].lastTriggered = block.timestamp;

        // Cache variables
        address sellToken = liquidation.sellToken;

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
        // 3. Make the swap
        // 3.1 Approve Uniswap and make the swap
        IERC20(sellToken).safeApprove(address(quickSwap), 0);
        IERC20(sellToken).safeApprove(address(quickSwap), sellTokenBal);
        // 3.2. Make the sale > https://uniswap.org/docs/v2/smart-contracts/router02/#swapexacttokensfortokens
        // min amount out = sellAmount * priceFloor / 1e18
        // e.g. 1e18 * 100e6 / 1e18 = 100e6
        // e.g. 30e8 * 100e6 / 1e8 = 3000e6
        // e.g. 30e18 * 100e18 / 1e18 = 3000e18
        uint256 sellTokenDec = IBasicToken(sellToken).decimals();
        uint256 minOut = (sellTokenBal * minReturn[_integration]) / (10**sellTokenDec);
        require(minOut > 0, "Must have some price floor");
        quickSwap.swapExactTokensForTokens(
            sellTokenBal,
            minOut,
            liquidation.uniswapPath,
            address(this),
            block.timestamp + 1800
        );

        // 3.3. Mint via mUSD
        uint256 minted = _mint(bAsset, mUSD);

        // 4.0. Send to SavingsManager
        address savings = _savingsManager();
        IERC20(mUSD).safeApprove(savings, 0);
        IERC20(mUSD).safeApprove(savings, minted);
        ISavingsManager(savings).depositLiquidation(mUSD, minted);

        emit Liquidated(sellToken, mUSD, minted, bAsset);
    }

    function _mint(address _bAsset, address _mUSD) internal returns (uint256 minted) {
        uint256 bAssetBal = IERC20(_bAsset).balanceOf(address(this));
        IERC20(_bAsset).safeApprove(_mUSD, 0);
        IERC20(_bAsset).safeApprove(_mUSD, bAssetBal);

        uint256 bAssetDec = IBasicToken(_bAsset).decimals();
        // e.g. 100e6 * 95e16 / 1e6 = 100e18
        uint256 minOut = (bAssetBal * 90e16) / (10**bAssetDec);
        minted = IMasset(_mUSD).mint(_bAsset, bAssetBal, minOut, address(this));
    }
}
