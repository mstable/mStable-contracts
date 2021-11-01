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
    /**
     * @dev Estimate output
     * @param _routeIndex     0 || 1 -> determines action
     * @param _router         masset or feederpool
     * @param _input          input token address
     * @param _output         output token address
     * @param _amount         amount
     * @return output         Units of credits burned from sender
     */
    function getUnwrapOutput(
        uint8 _routeIndex,
        address _router,
        address _input,
        address _output,
        uint256 _amount
    ) external view override returns (uint256 output) {
        if (_routeIndex == 0) {
            output = IMasset(_router).getRedeemOutput(_output, _amount);
        } else {
            output = IFeederPool(_router).getSwapOutput(_input, _output, _amount);
        }
    }

    /**
     * @dev Unwrap and send
     * @param _routeIndex     0 || 1 -> determines action
     * @param _router         masset or feederpool
     * @param _input          input token address
     * @param _output         output token address
     * @param _amount         amount
     * @param _minAmountOut   min amount
     * @param _beneficiary    beneficiary
     * @return outputQuantity Units of credits burned from sender
     */
    function unwrapAndSend(
        uint8 _routeIndex,
        address _router,
        address _input,
        address _output,
        uint256 _amount,
        uint256 _minAmountOut,
        address _beneficiary
    ) external override returns (uint256 outputQuantity) {
        require(IERC20(_input).transferFrom(msg.sender, address(this), _amount), "Transfer input");

        if (_routeIndex == 0) {
            outputQuantity = IMasset(_router).redeem(_output, _amount, _minAmountOut, _beneficiary);
        } else {
            // TODO: - Pull approval out to constructor/func?
            IERC20(_input).approve(_router, _amount);
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
