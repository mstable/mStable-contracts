// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { ISavingsContractV3 } from "../../interfaces/ISavingsContract.sol";
import { IUnwrapper } from "../../interfaces/IUnwrapper.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { IFeederPool } from "../../interfaces/IFeederPool.sol";
import { IBoostedVaultWithLockup } from "../../interfaces/IBoostedVaultWithLockup.sol";

contract Unwrapper is IUnwrapper, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    /**
     * @dev Initialize contract
     */
    function initialize() public initializer {
        __Ownable_init();
    }

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
     * @param _routers      router addresses
     * @param _tokens       tokens to approve for router
     */
    function approve(address[] calldata _routers, address[] calldata _tokens) external onlyOwner {
        require(_routers.length == _tokens.length, "Array mismatch");
        for (uint256 i = 0; i < _tokens.length; i++) {
            require(_tokens[i] != address(0), "Invalid token");
            require(_routers[i] != address(0), "Invalid router");
            IERC20(_tokens[i]).safeApprove(_routers[i], 2**256 - 1);
        }
    }
}
