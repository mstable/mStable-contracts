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

contract Unwrapper is IUnwrapper, ImmutableModule {
    using SafeERC20 for IERC20;

    constructor(address _nexus) ImmutableModule(_nexus) {}

    /**
     * @dev Query whether output address is a bAsset for given mAsset
     * @param _input          input asset (either mAsset or imAsset)
     * @param _inputIsCredit  true if imAsset, false if mAsset
     * @param _output         output asset
     * @return isBassetOut    boolean status of output asset
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
     * @dev Estimate output
     * @param _isBassetOut    Route action of redeem/swap
     * @param _router         Router address = mAsset || feederPool
     * @param _input          either mAsset or imAsset address
     * @param _inputIsCredit  true if imAsset, false if mAsset
     * @param _output         output token address
     * @param _amount         amount
     * @return output         Units of credits burned from sender
     */
    function getUnwrapOutput(
        bool _isBassetOut,
        address _router,
        address _input,
        bool _inputIsCredit,
        address _output,
        uint256 _amount
    ) external view override returns (uint256 output) {
        uint256 amt = _inputIsCredit
            ? ISavingsContractV3(_input).creditsToUnderlying(_amount)
            : _amount;
        if (_isBassetOut) {
            output = IMasset(_router).getRedeemOutput(_output, amt);
        } else {
            address input = _inputIsCredit
                ? address(ISavingsContractV3(_input).underlying())
                : _input;
            output = IFeederPool(_router).getSwapOutput(input, _output, amt);
        }
    }

    /**
     * @dev Unwrap and send
     * @param _isBassetOut    Route action of redeem/swap
     * @param _router         Router address = mAsset || feederPool
     * @param _input          input token address
     * @param _output         output token address
     * @param _amount         amount
     * @param _minAmountOut   min amount
     * @param _beneficiary    beneficiary
     * @return outputQuantity Units of credits burned from sender
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
     * @dev Approve tokens for router
     * @param _spenders     router addresses
     * @param _tokens       tokens to approve for router
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
