// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
import { ILiquidator } from "./ILiquidator.sol";
import { ISavingsManager } from "../../interfaces/ISavingsManager.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { IStakedAave } from "../../peripheral/Aave/IAave.sol";
import { IUniswapV3SwapRouter } from "../../peripheral/Uniswap/IUniswapV3SwapRouter.sol";
import { IUniswapV3Quoter } from "../../peripheral/Uniswap/IUniswapV3Quoter.sol";
import { IClaimRewards } from "../../polygon/IClaimRewards.sol";

// Need to use the old OZ Initializable as it reserved the first 50 slots of storage
import { Initializable } from "../../shared/@openzeppelin-2.5/Initializable.sol";
import { ModuleKeysStorage } from "../../shared/ModuleKeysStorage.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";

import { IBasicToken } from "../../shared/IBasicToken.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title   Liquidator
 * @author  mStable
 * @notice  The Liquidator allows rewards to be swapped for another token
 *          and returned to a calling contract
 * @dev     VERSION: 1.3
 *          DATE:    2021-05-28
 */
contract Liquidator is ILiquidator, Initializable, ModuleKeysStorage, ImmutableModule {
    using SafeERC20 for IERC20;

    event LiquidationModified(address indexed integration);
    event LiquidationEnded(address indexed integration);
    event Liquidated(address indexed sellToken, address mUSD, uint256 mUSDAmount, address buyToken);
    event ClaimedStakedAave(uint256 rewardsAmount);
    event RedeemedAave(uint256 redeemedAmount);

    // Deprecated stotage variables, but kept around to mirror storage layout
    address private deprecated_nexus;
    address public deprecated_mUSD;
    address public deprecated_curve;
    address public deprecated_uniswap;
    uint256 private deprecated_interval = 7 days;
    mapping(address => DeprecatedLiquidation) public deprecated_liquidations;
    mapping(address => uint256) public deprecated_minReturn;

    /// @notice mapping of integration addresses to liquidation data
    mapping(address => Liquidation) public liquidations;
    /// @notice Array of integration contracts used to loop through the Aave balances
    address[] public aaveIntegrations;
    /// @notice The total amount of stkAave that was claimed from all the Aave integration contracts.
    /// This can then be redeemed for Aave after the 10 day cooldown period.
    uint256 public totalAaveBalance;

    // Immutable variables set in the constructor
    /// @notice Staked AAVE token (stkAAVE) address
    address public immutable stkAave;
    /// @notice Aave Token (AAVE) address
    address public immutable aaveToken;
    /// @notice Uniswap V3 Router address
    IUniswapV3SwapRouter public immutable uniswapRouter;
    /// @notice Uniswap V3 Quoter address
    IUniswapV3Quoter public immutable uniswapQuoter;
    /// @notice Compound Token (COMP) address
    address public immutable compToken;
    /// @notice Alchemix (ALCX) address
    address public immutable alchemixToken;

    // No longer used
    struct DeprecatedLiquidation {
        address sellToken;
        address bAsset;
        int128 curvePosition;
        address[] uniswapPath;
        uint256 lastTriggered;
        uint256 trancheAmount;
    }

    struct Liquidation {
        address sellToken;
        address bAsset;
        bytes uniswapPath;
        bytes uniswapPathReversed;
        uint256 lastTriggered;
        uint256 trancheAmount; // The max amount of bAsset units to buy each week, with token decimals
        uint256 minReturn;
        address mAsset;
        uint256 aaveBalance;
    }

    constructor(
        address _nexus,
        address _stkAave,
        address _aaveToken,
        address _uniswapRouter,
        address _uniswapQuoter,
        address _compToken,
        address _alchemixToken
    ) ImmutableModule(_nexus) {
        require(_stkAave != address(0), "Invalid stkAAVE address");
        stkAave = _stkAave;

        require(_aaveToken != address(0), "Invalid AAVE address");
        aaveToken = _aaveToken;

        require(_uniswapRouter != address(0), "Invalid Uniswap Router address");
        uniswapRouter = IUniswapV3SwapRouter(_uniswapRouter);

        require(_uniswapQuoter != address(0), "Invalid Uniswap Quoter address");
        uniswapQuoter = IUniswapV3Quoter(_uniswapQuoter);

        require(_compToken != address(0), "Invalid COMP address");
        compToken = _compToken;

        require(_alchemixToken != address(0), "Invalid ALCX address");
        alchemixToken = _alchemixToken;
    }

    /**
     * @notice Liquidator approves Uniswap to transfer Aave, COMP and ALCX tokens
     * @dev to be called via the proxy proposeUpgrade function, not the constructor.
     */
    function initialize() external initializer {
        IERC20(aaveToken).safeApprove(address(uniswapRouter), type(uint256).max);
        IERC20(compToken).safeApprove(address(uniswapRouter), type(uint256).max);
    }

    /**
     * @notice Liquidator approves Uniswap to transfer Aave, COMP and ALCX tokens
     * @dev to be called via the proxy proposeUpgrade function, not the constructor.
     */
    function upgrade() external {
        IERC20(alchemixToken).safeApprove(address(uniswapRouter), type(uint256).max);
    }

    /***************************************
                    GOVERNANCE
    ****************************************/

    /**
     * @notice Create a liquidation
     * @param _integration The integration contract address from which to receive sellToken
     * @param _sellToken Token harvested from the integration contract. eg COMP, stkAave or ALCX.
     * @param _bAsset The asset to buy on Uniswap. eg USDC, WBTC, GUSD or alUSD
     * @param _uniswapPath The Uniswap V3 bytes encoded path.
     * @param _trancheAmount The max amount of bAsset units to buy in each weekly tranche.
     * @param _minReturn Minimum exact amount of bAsset to get for each (whole) sellToken unit
     * @param _mAsset optional address of the mAsset. eg mUSD or mBTC. Use zero address if from a Feeder Pool.
     * @param _useAave flag if integration is with Aave
     */
    function createLiquidation(
        address _integration,
        address _sellToken,
        address _bAsset,
        bytes calldata _uniswapPath,
        bytes calldata _uniswapPathReversed,
        uint256 _trancheAmount,
        uint256 _minReturn,
        address _mAsset,
        bool _useAave
    ) external override onlyGovernance {
        require(liquidations[_integration].sellToken == address(0), "Liquidation already exists");

        require(
            _integration != address(0) &&
                _sellToken != address(0) &&
                _bAsset != address(0) &&
                _minReturn > 0,
            "Invalid inputs"
        );
        require(_validUniswapPath(_sellToken, _bAsset, _uniswapPath), "Invalid uniswap path");
        require(
            _validUniswapPath(_bAsset, _sellToken, _uniswapPathReversed),
            "Invalid uniswap path reversed"
        );

        liquidations[_integration] = Liquidation({
            sellToken: _sellToken,
            bAsset: _bAsset,
            uniswapPath: _uniswapPath,
            uniswapPathReversed: _uniswapPathReversed,
            lastTriggered: 0,
            trancheAmount: _trancheAmount,
            minReturn: _minReturn,
            mAsset: _mAsset,
            aaveBalance: 0
        });
        if (_useAave) {
            aaveIntegrations.push(_integration);
        }

        if (_mAsset != address(0)) {
            // This Liquidator contract approves the mAsset to transfer bAssets for mint.
            // eg USDC in mUSD or WBTC in mBTC
            IERC20(_bAsset).safeApprove(_mAsset, 0);
            IERC20(_bAsset).safeApprove(_mAsset, type(uint256).max);

            // This Liquidator contract approves the Savings Manager to transfer mAssets
            // for depositLiquidation. eg mUSD
            // If the Savings Manager address was to change then
            // this liquidation would have to be deleted and a new one created.
            // Alternatively, a new liquidation contract could be deployed and proxy upgraded.
            address savings = _savingsManager();
            IERC20(_mAsset).safeApprove(savings, 0);
            IERC20(_mAsset).safeApprove(savings, type(uint256).max);
        }

        emit LiquidationModified(_integration);
    }

    function reApproveLiquidation(address _integration) external {
        Liquidation memory liquidation = liquidations[_integration];

        address bAsset = liquidation.bAsset;
        require(bAsset != address(0), "Liquidation does not exist");

        address mAsset = liquidation.mAsset;
        if (mAsset != address(0)) {
            IERC20(bAsset).safeApprove(mAsset, 0);
            IERC20(bAsset).safeApprove(mAsset, type(uint256).max);

            address savings = _savingsManager();
            IERC20(mAsset).safeApprove(savings, 0);
            IERC20(mAsset).safeApprove(savings, type(uint256).max);
        }
    }

    /**
     * @notice Update a liquidation
     * @param _integration The integration contract in question
     * @param _bAsset New asset to buy on Uniswap
     * @param _uniswapPath The Uniswap V3 bytes encoded path.
     * @param _trancheAmount The max amount of bAsset units to buy in each weekly tranche.
     * @param _minReturn Minimum exact amount of bAsset to get for each (whole) sellToken unit
     */
    function updateBasset(
        address _integration,
        address _bAsset,
        bytes calldata _uniswapPath,
        bytes calldata _uniswapPathReversed,
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
        require(
            _validUniswapPath(_bAsset, liquidation.sellToken, _uniswapPathReversed),
            "Invalid uniswap path reversed"
        );

        liquidations[_integration].bAsset = _bAsset;
        liquidations[_integration].uniswapPath = _uniswapPath;
        liquidations[_integration].trancheAmount = _trancheAmount;
        liquidations[_integration].minReturn = _minReturn;

        emit LiquidationModified(_integration);
    }

    /**
     * @notice Validates a given uniswap path - valid if sellToken at position 0 and bAsset at end
     * @param _sellToken Token harvested from the integration contract
     * @param _bAsset New asset to buy on Uniswap
     * @param _uniswapPath The Uniswap V3 bytes encoded path.
     */
    function _validUniswapPath(
        address _sellToken,
        address _bAsset,
        bytes calldata _uniswapPath
    ) internal pure returns (bool) {
        uint256 len = _uniswapPath.length;
        require(_uniswapPath.length >= 43, "Uniswap path too short");
        // check sellToken is first 20 bytes and bAsset is the last 20 bytes of the uniswap path
        return
            keccak256(abi.encodePacked(_sellToken)) ==
            keccak256(abi.encodePacked(_uniswapPath[0:20])) &&
            keccak256(abi.encodePacked(_bAsset)) ==
            keccak256(abi.encodePacked(_uniswapPath[len - 20:len]));
    }

    /**
     * @notice Delete a liquidation
     */
    function deleteLiquidation(address _integration) external override onlyGovernance {
        Liquidation memory liquidation = liquidations[_integration];
        require(liquidation.bAsset != address(0), "Liquidation does not exist");

        delete liquidations[_integration];

        emit LiquidationEnded(_integration);
    }

    /***************************************
                    LIQUIDATION
    ****************************************/

    /**
     * @notice Triggers a liquidation, flow (once per week):
     *    - transfer sell token from integration to liquidator. eg COMP or ALCX
     *    - Swap sell token for bAsset on Uniswap (up to trancheAmount). eg
     *      - COMP for USDC
     *      - ALCX for alUSD
     *    - If bAsset in mAsset. eg USDC in mUSD
     *      - Mint mAsset using bAsset. eg mint mUSD using USDC.
     *      - Deposit mAsset to Savings Manager. eg deposit mUSD
     *    - else bAsset in Feeder Pool. eg alUSD in fPmUSD/alUSD.
     *      - Transfer bAsset to integration contract. eg transfer alUSD
     * @param _integration Integration for which to trigger liquidation
     */
    function triggerLiquidation(address _integration) external override {
        Liquidation memory liquidation = liquidations[_integration];

        address bAsset = liquidation.bAsset;
        require(bAsset != address(0), "Liquidation does not exist");

        require(block.timestamp > liquidation.lastTriggered + 7 days, "Must wait for interval");
        liquidations[_integration].lastTriggered = block.timestamp;

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
        require(liquidation.trancheAmount > 0, "Liquidation has been paused");
        //    Calc amounts for max tranche
        uint256 sellAmount = uniswapQuoter.quoteExactOutput(
            liquidation.uniswapPathReversed,
            liquidation.trancheAmount
        );

        if (sellTokenBal < sellAmount) {
            sellAmount = sellTokenBal;
        }

        // 3. Make the swap
        // Uniswap V2 > https://docs.uniswap.org/reference/periphery/interfaces/ISwapRouter#exactinput
        // min amount out = sellAmount * priceFloor / 1e18
        // e.g. 1e18 * 100e6 / 1e18 = 100e6
        // e.g. 30e8 * 100e6 / 1e8 = 3000e6
        // e.g. 30e18 * 100e18 / 1e18 = 3000e18
        uint256 sellTokenDec = IBasicToken(sellToken).decimals();
        uint256 minOut = (sellAmount * liquidation.minReturn) / (10**sellTokenDec);
        require(minOut > 0, "Must have some price floor");
        IUniswapV3SwapRouter.ExactInputParams memory param = IUniswapV3SwapRouter.ExactInputParams(
            liquidation.uniswapPath,
            address(this),
            block.timestamp,
            sellAmount,
            minOut
        );
        uniswapRouter.exactInput(param);

        address mAsset = liquidation.mAsset;
        // If the integration contract is connected to a mAsset like mUSD or mBTC
        if (mAsset != address(0)) {
            // 4a. Mint mAsset using purchased bAsset
            uint256 minted = _mint(bAsset, mAsset);

            // 5a. Send to SavingsManager
            address savings = _savingsManager();
            ISavingsManager(savings).depositLiquidation(mAsset, minted);

            emit Liquidated(sellToken, mAsset, minted, bAsset);
        } else {
            // If a feeder pool like alUSD
            // 4b. transfer bAsset directly to the integration contract.
            // this will then increase the boosted savings vault price.
            IERC20 bAssetToken = IERC20(bAsset);
            uint256 bAssetBal = bAssetToken.balanceOf(address(this));
            bAssetToken.transfer(_integration, bAssetBal);

            emit Liquidated(sellToken, mAsset, bAssetBal, bAsset);
        }
    }

    /**
     * @notice Claims stake Aave token rewards from each Aave integration contract
     * and then transfers all reward tokens to the liquidator contract.
     * Can only claim more stkAave if the last claim's unstake window has ended.
     */
    function claimStakedAave() external override {
        // If the last claim has not yet been liquidated
        uint256 totalAaveBalanceMemory = totalAaveBalance;
        if (totalAaveBalanceMemory > 0) {
            // Check unstake period has expired for this liquidator contract
            IStakedAave stkAaveContract = IStakedAave(stkAave);
            uint256 cooldownStartTime = stkAaveContract.stakersCooldowns(address(this));
            uint256 cooldownPeriod = stkAaveContract.COOLDOWN_SECONDS();
            uint256 unstakeWindow = stkAaveContract.UNSTAKE_WINDOW();

            // Can not claim more stkAave rewards if the last unstake window has not ended
            // Wait until the cooldown ends and liquidate
            require(
                block.timestamp > cooldownStartTime + cooldownPeriod,
                "Last claim cooldown not ended"
            );
            // or liquidate now as currently in the
            require(
                block.timestamp > cooldownStartTime + cooldownPeriod + unstakeWindow,
                "Must liquidate last claim"
            );
            // else the current time is past the unstake window so claim more stkAave and reactivate the cool down
        }

        // 1. For each Aave integration contract
        uint256 len = aaveIntegrations.length;
        for (uint256 i = 0; i < len; i++) {
            address integrationAdddress = aaveIntegrations[i];

            // 2. Claim the platform rewards on the integration contract. eg stkAave
            IClaimRewards(integrationAdddress).claimRewards();

            // 3. Transfer sell token from integration contract if there are some
            //    Assumes the integration contract has already given infinite approval to this liquidator contract.
            uint256 integrationBal = IERC20(stkAave).balanceOf(integrationAdddress);
            if (integrationBal > 0) {
                IERC20(stkAave).safeTransferFrom(
                    integrationAdddress,
                    address(this),
                    integrationBal
                );
            }
            // Increate the integration contract's staked Aave balance.
            liquidations[integrationAdddress].aaveBalance += integrationBal;
            totalAaveBalanceMemory += integrationBal;
        }

        // Store the final total Aave balance in memory to storage variable.
        totalAaveBalance = totalAaveBalanceMemory;

        // 4. Restart the cool down as the start timestamp would have been reset to zero after the last redeem
        IStakedAave(stkAave).cooldown();

        emit ClaimedStakedAave(totalAaveBalanceMemory);
    }

    /**
     * @notice liquidates stkAave rewards earned by the Aave integration contracts:
     *      - Redeems Aave for stkAave rewards
     *      - swaps Aave for bAsset using Uniswap V2. eg Aave for USDC
     *      - for each Aave integration contract
     *        - if from a mAsset
     *          - mints mAssets using bAssets. eg mUSD for USDC
     *          - deposits mAssets to Savings Manager. eg mUSD
     *        - else from a Feeder Pool
     *          - transfer bAssets to integration contract. eg GUSD
     */
    function triggerLiquidationAave() external override {
        // solium-disable-next-line security/no-tx-origin
        require(tx.origin == msg.sender, "Must be EOA");
        // Can not liquidate stkAave rewards if not already claimed by the integration contracts.
        require(totalAaveBalance > 0, "Must claim before liquidation");

        // 1. Redeem as many stkAave as we can for Aave
        // This will fail if the 10 day cooldown period has not passed
        // which is triggered in claimStakedAave().
        IStakedAave(stkAave).redeem(address(this), type(uint256).max);

        // 2. Get the amount of Aave tokens to sell
        uint256 totalAaveToLiquidate = IERC20(aaveToken).balanceOf(address(this));
        require(totalAaveToLiquidate > 0, "No Aave redeemed from stkAave");

        // for each Aave integration
        uint256 len = aaveIntegrations.length;
        for (uint256 i = 0; i < len; i++) {
            address _integration = aaveIntegrations[i];
            Liquidation memory liquidation = liquidations[_integration];

            // 3. Get the proportional amount of Aave tokens for this integration contract to liquidate
            // Amount of Aave to sell for this integration = total Aave to liquidate * integration's Aave balance / total of all integration Aave balances
            uint256 aaveSellAmount = (liquidation.aaveBalance * totalAaveToLiquidate) /
                totalAaveBalance;
            address bAsset = liquidation.bAsset;
            // If there's no Aave tokens to liquidate for this integration contract
            // or the liquidation has been deleted for the integration
            // then just move to the next integration contract.
            if (aaveSellAmount == 0 || bAsset == address(0)) {
                continue;
            }

            // Reset integration's Aave balance in storage
            liquidations[_integration].aaveBalance = 0;

            // 4. Make the swap of Aave for the bAsset
            // Make the sale > https://docs.uniswap.org/reference/periphery/interfaces/ISwapRouter#exactinput
            // min bAsset amount out = Aave sell amount * priceFloor / 1e18
            // e.g. 1e18 * 100e6 / 1e18 = 100e6
            // e.g. 30e8 * 100e6 / 1e8 = 3000e6
            // e.g. 30e18 * 100e18 / 1e18 = 3000e18
            uint256 minBassetsOut = (aaveSellAmount * liquidation.minReturn) / 1e18;
            require(minBassetsOut > 0, "Must have some price floor");
            IUniswapV3SwapRouter.ExactInputParams memory param = IUniswapV3SwapRouter
            .ExactInputParams(
                liquidation.uniswapPath,
                address(this),
                block.timestamp + 1,
                aaveSellAmount,
                minBassetsOut
            );
            uniswapRouter.exactInput(param);

            address mAsset = liquidation.mAsset;
            // If the integration contract is connected to a mAsset like mUSD or mBTC
            if (mAsset != address(0)) {
                // 5a. Mint mAsset using bAsset from the Uniswap swap
                uint256 minted = _mint(bAsset, mAsset);

                // 6a. Send to SavingsManager to streamed to the savings vault. eg imUSD or imBTC
                address savings = _savingsManager();
                ISavingsManager(savings).depositLiquidation(mAsset, minted);

                emit Liquidated(aaveToken, mAsset, minted, bAsset);
            } else {
                // If a feeder pool like GUSD
                // 5b. transfer bAsset directly to the integration contract.
                // this will then increase the boosted savings vault price.
                IERC20 bAssetToken = IERC20(bAsset);
                uint256 bAssetBal = bAssetToken.balanceOf(address(this));
                bAssetToken.transfer(_integration, bAssetBal);

                emit Liquidated(aaveToken, mAsset, bAssetBal, bAsset);
            }
        }

        totalAaveBalance = 0;
    }

    function _mint(address _bAsset, address _mAsset) internal returns (uint256 minted) {
        uint256 bAssetBal = IERC20(_bAsset).balanceOf(address(this));

        uint256 bAssetDec = IBasicToken(_bAsset).decimals();
        // e.g. 100e6 * 95e16 / 1e6 = 100e18
        uint256 minOut = (bAssetBal * 90e16) / (10**bAssetDec);
        minted = IMasset(_mAsset).mint(_bAsset, bAssetBal, minOut, address(this));
    }
}
