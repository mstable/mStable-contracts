// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";

import { ISavingsContractV3 } from "../../interfaces/ISavingsContract.sol";
import { IUnwrapper } from "../../interfaces/IUnwrapper.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { IFeederPool } from "../../interfaces/IFeederPool.sol";
import { IBoostedVaultWithLockup } from "../../interfaces/IBoostedVaultWithLockup.sol";
import { BassetPersonal } from "../../masset/MassetStructs.sol";

/**
 * @title  Unwrapper
 * @author mStable
 * @notice Used to exchange interest-bearing mAssets or mAssets to base assets (bAssets) or Feeder Pool assets (fAssets).
 * @dev    VERSION: 1.0
 *         DATE:    2022-01-31
 */
contract Unwrapper is IUnwrapper, ImmutableModule {
    using SafeERC20 for IERC20;

    constructor(address _nexus) ImmutableModule(_nexus) {}

    /**
     * @notice Query whether output address is a bAsset for given interest-bearing mAsset or mAsset. eg DAI is a bAsset of imUSD.
     * @param _input          Address of either interest-bearing mAsset or mAsset. eg imUSD or mUSD.
     * @param _inputIsCredit  `true` if `input` is an interest-bearing mAsset, eg imUSD. `false` if `input` is an mAsset, eg mUSD.
     * @param _output         Address to test if a bAsset token of the `input`.
     * @return isBassetOut    `true` if `output` is a bAsset. `false` if `output` is not a bAsset.
     */
    function getIsBassetOut(
        address _input,
        bool _inputIsCredit,
        address _output
    ) external view override returns (bool isBassetOut) {
        address input = _inputIsCredit ? address(ISavingsContractV3(_input).underlying()) : _input;
        (BassetPersonal[] memory bAssets, ) = IMasset(input).getBassets();
        for (uint256 i = 0; i < bAssets.length; i++) {
            if (bAssets[i].addr == _output) return true;
        }
        return false;
    }

    /**
     * @notice Estimate units of bAssets or fAssets in exchange for interest-bearing mAssets or mAssets.
     * @param _isBassetOut    `true` if `output` is a bAsset. `false` if `output` is a fAsset.
     * @param _router         mAsset address if the `output` is a bAsset. Feeder Pool address if the `output` is a fAsset.
     * @param _input          Token address of either mAsset or interest-bearing mAsset. eg mUSD, imUSD, mBTC or imBTC.
     * @param _inputIsCredit  `true` if interest-beaing mAsset like imUSD or imBTC. `false` if mAsset like mUSD or mBTC.
     * @param _output         Asset to receive in exchange for the `input` token. This can be a bAsset or a fAsset. For example:
        - bAssets (USDC, DAI, sUSD or USDT) or fAssets (GUSD, BUSD, alUSD, FEI or RAI) for mUSD.
        - bAssets (USDC, DAI or USDT) or fAsset FRAX for Polygon mUSD.
        - bAssets (WBTC, sBTC or renBTC) or fAssets (HBTC or TBTCV2) for mainnet mBTC.
     * @param _amount         Units of `input` token.
     * @return outputQuantity Units of bAssets or fAssets received in exchange for inputs. This is to the same decimal places as the `output` token.
     */
    function getUnwrapOutput(
        bool _isBassetOut,
        address _router,
        address _input,
        bool _inputIsCredit,
        address _output,
        uint256 _amount
    ) external view override returns (uint256 outputQuantity) {
        uint256 amt = _inputIsCredit
            ? ISavingsContractV3(_input).creditsToUnderlying(_amount)
            : _amount;
        if (_isBassetOut) {
            outputQuantity = IMasset(_router).getRedeemOutput(_output, amt);
        } else {
            address input = _inputIsCredit
                ? address(ISavingsContractV3(_input).underlying())
                : _input;
            outputQuantity = IFeederPool(_router).getSwapOutput(input, _output, amt);
        }
    }

    /**
     * @notice Swaps mAssets for either bAssets or fAssets.
     * Transfers mAssets to this Unwrapper contract and then either
     * 1. redeems mAsset tokens for bAsset tokens.
     * 2. Swaps mAsset tokens for fAsset tokens using a Feeder Pool.
     * @param _isBassetOut    `true` if `output` is a bAsset. `false` if `output` is a fAsset.
     * @param _router         mAsset address if the `output` is a bAsset. Feeder Pool address if the `output` is a fAsset.
     * @param _input          mAsset address
     * @param _output         Asset to receive in exchange for the redeemed mAssets. This can be a bAsset or a fAsset. For example:
        - bAssets (USDC, DAI, sUSD or USDT) or fAssets (GUSD, BUSD, alUSD, FEI or RAI) for mUSD.
        - bAssets (USDC, DAI or USDT) or fAsset FRAX for Polygon mUSD.
        - bAssets (WBTC, sBTC or renBTC) or fAssets (HBTC or TBTCV2) for mainnet mBTC.
     * @param _amount         Units of mAssets that have been redeemed.
     * @param _minAmountOut   Minimum units of `output` tokens to be received by the beneficiary. This is to the same decimal places as the `output` token.
     * @param _beneficiary    Address to send `output` tokens to.
     * @return outputQuantity Units of `output` tokens sent to the `beneficiary`.
     */
    function unwrapAndSend(
        bool _isBassetOut,
        address _router,
        address _input,
        address _output,
        uint256 _amount,
        uint256 _minAmountOut,
        address _beneficiary
    ) external override returns (uint256 outputQuantity) {
        require(IERC20(_input).transferFrom(msg.sender, address(this), _amount), "Transfer input");

        if (_isBassetOut) {
            outputQuantity = IMasset(_router).redeem(_output, _amount, _minAmountOut, _beneficiary);
        } else {
            outputQuantity = IFeederPool(_router).swap(
                _input,
                _output,
                _amount,
                _minAmountOut,
                _beneficiary
            );
        }
    }

    /**
     * @notice Approve mAsset tokens to be transferred to mAsset or Feeder Pool contracts for `redeem` to bAssets or `swap` for fAssets.
     * @param _spenders Address of mAssets and Feeder Pools that will `redeem` or `swap` the mAsset tokens.
     * @param _tokens   Address of the mAssets that will be redeemed or swapped.
     */
    function approve(address[] calldata _spenders, address[] calldata _tokens)
        external
        onlyGovernor
    {
        require(_spenders.length == _tokens.length, "Array mismatch");
        for (uint256 i = 0; i < _tokens.length; i++) {
            require(_tokens[i] != address(0), "Invalid token");
            require(_spenders[i] != address(0), "Invalid router");
            IERC20(_tokens[i]).safeApprove(_spenders[i], type(uint256).max);
        }
    }
}
