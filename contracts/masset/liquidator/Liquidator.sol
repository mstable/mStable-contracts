// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;
import { IUniswapV2Router02 } from "../../interfaces/IUniswapV2Router02.sol";
import { ISavingsManager } from "../../interfaces/ISavingsManager.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { IPlatformIntegration } from "../../interfaces/IPlatformIntegration.sol";
import { IStakedAave } from "../peripheral/IAave.sol";
import { PAaveIntegration } from "../../polygon/PAaveIntegration.sol";

import { Initializable } from "@openzeppelin/contracts/utils/Initializable.sol";
import { ModuleKeysStorage } from "../../shared/ModuleKeysStorage.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";
import { ILiquidator } from "./ILiquidator.sol";

import { IBasicToken } from "../../shared/IBasicToken.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// TODO remove before prod deploy
import "hardhat/console.sol";

/**
 * @title   Liquidator
 * @author  mStable
 * @notice  The Liquidator allows rewards to be swapped for another token
 *          and returned to a calling contract
 * @dev     VERSION: 1.2
 *          DATE:    2020-12-16
 */
contract Liquidator is ILiquidator, Initializable, ModuleKeysStorage, ImmutableModule {
    using SafeERC20 for IERC20;

    event LiquidationModified(address indexed integration);
    event LiquidationEnded(address indexed integration);
    event Liquidated(address indexed sellToken, address mUSD, uint256 mUSDAmount, address buyToken);
    event ClaimedStakedAave(address indexed integration, uint256 rewardsAmount);
    event RedeemedAave(uint256 redeemedAmount);

    // Deprecated stotage variables, but kept around to mirror storage layout
    address private deprecated_nexus;
    address public deprecated_mUSD;
    address public deprecated_curve;
    address public deprecated_uniswap;
    uint256 private deprecated_interval = 7 days;

    // map of integration addresses to liquidations
    mapping(address => Liquidation) public liquidations;
    // map of integration addresses to minimum exact amount of bAsset to get for each (whole) sellToken unit
    mapping(address => uint256) public minReturn;
    // map of integration addresses to mAssets like mUSD or mBTC.
    // Is not used if the integration contract is connected to a Feeder Pool.
    mapping(address => address) public mAssets;
    // map of integration addresses to aave balances
    mapping(address => uint256) public aaveBalances;
    // Array of integration contracts used to loop through the Aave balances
    address[] public integrations;

    // Immutable variables set in the constructor
    address public immutable stkAave;
    address public immutable aaveToken;
    IUniswapV2Router02 public immutable uniswap;

    // Constants
    uint256 private constant MAX_UINT = 2**256-1;

    struct Liquidation {
        address sellToken;
        address bAsset;
        int128 curvePosition;
        address[] uniswapPath;
        uint256 lastTriggered;
        uint256 trancheAmount; // The amount of bAsset units to buy each week, with token decimals
    }

    constructor(
        address _nexus,
        address _stkAave,
        address _aaveToken,
        address _uniswap)
        ImmutableModule(_nexus)
    {
        require(_stkAave != address(0), "Invalid stkAave address");
        stkAave = _stkAave;

        require(_aaveToken != address(0), "Invalid Aave Token address");
        aaveToken = _aaveToken;

        require(_uniswap != address(0), "Invalid Uniswap address");
        uniswap = IUniswapV2Router02(_uniswap);
    }

    function approvals() external {
        // Approve Uniswap to transfer Aave tokens from this liquidator
        IERC20(aaveToken).safeApprove(address(uniswap), MAX_UINT);
    }

    /***************************************
                    GOVERNANCE
    ****************************************/

    /**
     * @dev Create a liquidation
     * @param _integration The integration contract address from which to receive sellToken
     * @param _sellToken Token harvested from the integration contract. eg COMP or stkAave.
     * @param _bAsset The asset to buy on Uniswap. eg USDC or WBTC
     * @param _curvePosition deprecated
     * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, USDC]
     * @param _trancheAmount The max amount of bAsset units to buy in each weekly tranche.
     * @param _minReturn Minimum exact amount of bAsset to get for each (whole) sellToken unit
     * @param _mAsset optional address of the mAsset. eg mUSD or mBTC. Use zero address if from a Feeder Pool.
     */
    function createLiquidation(
        address _integration,
        address _sellToken,
        address _bAsset,
        int128 _curvePosition,
        address[] calldata _uniswapPath,
        uint256 _trancheAmount,
        uint256 _minReturn,
        address _mAsset
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

        liquidations[_integration] = Liquidation({
            sellToken: _sellToken,
            bAsset: _bAsset,
            curvePosition: _curvePosition,
            uniswapPath: _uniswapPath,
            lastTriggered: 0,
            trancheAmount: _trancheAmount
        });
        minReturn[_integration] = _minReturn;
        mAssets[_integration] = _mAsset;
        integrations.push(_integration);

        if (_mAsset != address(0)) {
            // This Liquidator contract approves the mAsset to transfer bAssets for mint.
            // eg USDC in mUSD or WBTC in mBTC
            IERC20(_bAsset).safeApprove(_mAsset, 0);
            IERC20(_bAsset).safeApprove(_mAsset, MAX_UINT);
        } else {
            // This Liquidator contract approves the integration contract to transfer bAssets for deposits.
            // eg GUSD as part of the GUSD Feeder Pool.
            IERC20(_bAsset).safeApprove(_integration, 0);
            IERC20(_bAsset).safeApprove(_integration, MAX_UINT);
        }

        emit LiquidationModified(_integration);
    }

    /**
     * @dev Update a liquidation
     * @param _integration The integration contract in question
     * @param _bAsset New asset to buy on Uniswap
     * @param _curvePosition Position of the bAsset in Curves MetaPool
     * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
     * @param _trancheAmount The max amount of bAsset units to buy in each weekly tranche.
     * @param _minReturn Minimum exact amount of bAsset to get for each (whole) sellToken unit
     */
    function updateBasset(
        address _integration,
        address _bAsset,
        int128 _curvePosition,
        address[] calldata _uniswapPath,
        uint256 _trancheAmount,
        uint256 _minReturn
    ) external override onlyGovernance {
        Liquidation memory liquidation = liquidations[_integration];

        address oldBasset = liquidation.bAsset;
        require(oldBasset != address(0), "Liquidation does not exist");

        require(_minReturn > 0, "Must set some minimum value");
        require(_bAsset != address(0), "Invalid bAsset");
        require(
            _validUniswapPath(liquidation.sellToken, _bAsset, _uniswapPath),
            "Invalid uniswap path"
        );

        liquidations[_integration].bAsset = _bAsset;
        // liquidations[_integration].curvePosition = _curvePosition;
        liquidations[_integration].uniswapPath = _uniswapPath;
        liquidations[_integration].trancheAmount = _trancheAmount;
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
        Liquidation memory liquidation = liquidations[_integration];
        require(liquidation.bAsset != address(0), "Liquidation does not exist");

        delete liquidations[_integration];
        delete minReturn[_integration];
        delete mAssets[_integration];

        emit LiquidationEnded(_integration);
    }

    /***************************************
                    LIQUIDATION
    ****************************************/

    /**
     * @dev Triggers a liquidation, flow (once per week):
     *    - Sells $COMP for $USDC (or other) on Uniswap (up to trancheAmount)
     *    - Mint mUSD using USDC
     *    - Send to SavingsManager
     * @param _integration Integration for which to trigger liquidation
     */
    function triggerLiquidation(address _integration) external override {
        // solium-disable-next-line security/no-tx-origin
        require(tx.origin == msg.sender, "Must be EOA");

        Liquidation memory liquidation = liquidations[_integration];

        address bAsset = liquidation.bAsset;
        require(bAsset != address(0), "Liquidation does not exist");

        require(block.timestamp > liquidation.lastTriggered + 7 days, "Must wait for interval");
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
        uint256[] memory amountsIn = uniswap.getAmountsIn(liquidation.trancheAmount, uniswapPath);
        uint256 sellAmount = amountsIn[0];

        if (sellTokenBal < sellAmount) {
            sellAmount = sellTokenBal;
        }

        // 3. Make the swap
        // 3.1 Approve Uniswap and make the swap
        IERC20(sellToken).safeApprove(address(uniswap), 0);
        IERC20(sellToken).safeApprove(address(uniswap), sellAmount);
        // 3.2. Make the sale > https://uniswap.org/docs/v2/smart-contracts/router02/#swapexacttokensfortokens

        // min amount out = sellAmount * priceFloor / 1e18
        // e.g. 1e18 * 100e6 / 1e18 = 100e6
        // e.g. 30e8 * 100e6 / 1e8 = 3000e6
        // e.g. 30e18 * 100e18 / 1e18 = 3000e18
        uint256 sellTokenDec = IBasicToken(sellToken).decimals();
        uint256 minOut = (sellAmount * minReturn[_integration]) / (10**sellTokenDec);
        require(minOut > 0, "Must have some price floor");
        uniswap.swapExactTokensForTokens(
            sellAmount,
            minOut,
            uniswapPath,
            address(this),
            block.timestamp + 1800
        );

        // 4. Trade on Curve
        // uint256 purchased = _sellOnCrv(bAsset, liquidation.curvePosition);

        // 4. Mint mAsset using purchaed bAsset
        address mAsset = mAssets[_integration];
        uint256 minted = _mint(bAsset, mAsset);

        // 4.0. Send to SavingsManager
        address savings = _savingsManager();
        IERC20(mAsset).safeApprove(savings, minted);
        ISavingsManager(savings).depositLiquidation(mAsset, minted);

        emit Liquidated(sellToken, mAsset, minted, bAsset);
    }

    /**
     * @dev Claims token rewards from the integration contract and
     * then transfers all reward tokens to the liquidator contract.
     * 
     * @param _integration Integration for which to claim the rewards tokens
     */
    function claimStakedAave(address _integration)
        external
    {
        // solium-disable-next-line security/no-tx-origin
        require(tx.origin == msg.sender, "Must be EOA");

        // 1. Claim the platform rewards on the integration contract. eg stkAave
        PAaveIntegration integration = PAaveIntegration(_integration);
        integration.claimRewards();

        // 2. Transfer sell token from integration contract if there are some
        //    Assumes the integration contract has already given infinite approval to this liquidator contract.
        uint256 integrationBal = IERC20(stkAave).balanceOf(_integration);
        if (integrationBal > 0) {
            IERC20(stkAave).safeTransferFrom(_integration, address(this), integrationBal);
        }
        // Increase the integration contract's staked Aave balance.
        aaveBalances[_integration] += integrationBal;

        // Restart the cool down as the start timestamp would have been reset to zero after the last redeem
        IStakedAave(stkAave).cooldown();

        emit ClaimedStakedAave(_integration, integrationBal);
    }

    /**
     * @dev 
     */
    function triggerLiquidationAave() external {
        // solium-disable-next-line security/no-tx-origin
        require(tx.origin == msg.sender, "Must be EOA");

        // 1. Redeem as many stkAave as we can for Aave
        IStakedAave(stkAave).redeem(address(this), MAX_UINT);

        // 2. Get the amount of Aave tokens to sell
        uint256 aaveUnallocated = IERC20(aaveToken).balanceOf(address(this));
        require(aaveUnallocated > 0, "No Aave redeemed from stkAave");

         // for each integration contract
        uint256 len = integrations.length;
        for (uint256 i = 0; i < len; i++) {
            address _integration = integrations[i];

            // 3. Get the amount of Aave tokens for this integration contract from the stkAave balance
            uint256 integrationAaveBalance = aaveBalances[_integration];
            aaveBalances[_integration] = 0;
            aaveUnallocated -= integrationAaveBalance;

            // If there's no Aave tokens to liquidate for this integration contract
            // then just move to the next integration contract.
            if (integrationAaveBalance == 0) {
                continue;
            }

            Liquidation memory liquidation = liquidations[_integration];
            address bAsset = liquidation.bAsset;
            require(bAsset != address(0), "Liquidation does not exist");

            // 4. Make the swap of Aave for the bAsset
            // Make the sale > https://uniswap.org/docs/v2/smart-contracts/router02/#swapexacttokensfortokens
            // min amount out = Aave amount * priceFloor / 1e18
            // e.g. 1e18 * 100e6 / 1e18 = 100e6
            // e.g. 30e8 * 100e6 / 1e8 = 3000e6
            // e.g. 30e18 * 100e18 / 1e18 = 3000e18
            uint256 minOut = (integrationAaveBalance * minReturn[_integration]) / 1e18;
            console.log("Integration %s Uniswap path %s %s", _integration, liquidation.uniswapPath[0], liquidation.uniswapPath[1]);
            console.log("minOut %s, integrationAaveBalance %s, minReturn %s", minOut, integrationAaveBalance, minReturn[_integration]);
            require(minOut > 0, "Must have some price floor");
            uniswap.swapExactTokensForTokens(
                integrationAaveBalance,
                minOut,
                liquidation.uniswapPath,
                address(this),
                block.timestamp + 1
            );

            address mAsset = mAssets[_integration];
            // If the integration contract is connected to a mAsset like mUSD or mBTC
            if (mAsset != address(0)) {
                // 5a. Mint mAsset using bAsset from the Uniswap swap
                uint256 minted = _mint(bAsset, mAsset);

                // 6. Send to SavingsManager to streamed to the savings vault. eg imUSD or imBTC
                address savings = _savingsManager();
                IERC20(mAsset).safeApprove(savings, minted);
                ISavingsManager(savings).depositLiquidation(mAsset, minted);

                emit Liquidated(aaveToken, mAsset, minted, bAsset);
            // If a feeder pool like GUSD
            } else {
                // 5b. transfer bAsset directly to the integration contract.
                // this will then increase the boosted savings vault price.
                IERC20 bAssetToken = IERC20(bAsset);
                uint256 bAssetBal = bAssetToken.balanceOf(address(this));
                bAssetToken.transfer(_integration, bAssetBal);

                emit Liquidated(aaveToken, mAsset, bAssetBal, bAsset);
            }
        }

        console.log("Unallocated Aave after liquidation %s", aaveUnallocated);

        // All the Aave should be now be accounted. If stkAave or Aave was transferred into the liquidator
        // from another source, then just allocated it to the first integration contract for processing next liquidation.
        if (aaveUnallocated > 0) {
            aaveBalances[integrations[0]] += aaveUnallocated;
        }
    }

    function _mint(address _bAsset, address _mAsset) internal returns (uint256 minted) {
        uint256 bAssetBal = IERC20(_bAsset).balanceOf(address(this));
        console.log("bAssets to mint from Uniswap output %s", bAssetBal);

        uint256 bAssetDec = IBasicToken(_bAsset).decimals();
        // e.g. 100e6 * 95e16 / 1e6 = 100e18
        uint256 minOut = (bAssetBal * 90e16) / (10**bAssetDec);
        minted = IMasset(_mAsset).mint(_bAsset, bAssetBal, minOut, address(this));
    }
}
