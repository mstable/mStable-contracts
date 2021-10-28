// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { ISavingsContractV3 } from "../../interfaces/ISavingsContract.sol";
import { IUnwrapper } from "../../interfaces/IUnwrapper.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { IFeederPool } from "../../interfaces/IFeederPool.sol";
import { IBoostedVaultWithLockup } from "../../interfaces/IBoostedVaultWithLockup.sol";

// Q: Should this be Governable?
contract Unwrapper is IUnwrapper, Ownable {
    /// @dev Estimate output
    function getUnwrapOutput(
        uint8 _routeType,
        address _router,
        address _input,
        address _output,
        uint256 _amount
    ) external view override returns (uint256 output) {
        if (_routeType == 0) {
            output = IMasset(_router).getRedeemOutput(_output, _amount);
        } else {
            output = IFeederPool(_router).getSwapOutput(_input, _output, _amount);
        }
    }

    /// @dev Unwrap and send
    function unwrapAndSend(
        uint8 _routeType,
        address _router,
        address _input,
        address _output,
        uint256 _amount,
        uint256 _minAmountOut,
        address _beneficiary
    ) external override returns (uint256 outputQuantity) {
        require(IERC20(_input).transfer(address(this), _amount), "Transfer input");

        if (_routeType == 0) {
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
}
