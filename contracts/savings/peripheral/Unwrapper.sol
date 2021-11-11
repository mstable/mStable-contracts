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
     * @param _masset    masset
     * @param _output    output asset
     * @return isBassetOut   boolean status of output asset
     */
    function getIsBassetOut(address _masset, address _output)
        external
        view
        override
        returns (bool isBassetOut)
    {
        (BassetPersonal[] memory bAssets, ) = IMasset(_masset).getBassets();
        for (uint256 i = 0; i < bAssets.length; i++) {
            if (bAssets[i].addr == _output) return true;
        }
        return false;
    }

    /**
     * @dev Estimate output
     * @param _isBassetOut    masset redemption or fpool swap
     * @param _router         masset or feederpool
     * @param _input          input token address
     * @param _output         output token address
     * @param _amount         amount
     * @return output         Units of credits burned from sender
     */
    function getUnwrapOutput(
        bool _isBassetOut,
        address _router,
        address _input,
        address _output,
        uint256 _amount
    ) external view override returns (uint256 output) {
        if (_isBassetOut) {
            output = IMasset(_router).getRedeemOutput(_output, _amount);
        } else {
            output = IFeederPool(_router).getSwapOutput(_input, _output, _amount);
        }
    }

    /**
     * @dev Unwrap and send
     * @param _isBassetOut    masset redemption or fpool swap
     * @param _router         masset or feederpool
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
