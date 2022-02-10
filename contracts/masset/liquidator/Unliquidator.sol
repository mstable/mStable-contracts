// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IClaimRewards } from "../../polygon/IClaimRewards.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title   Unliquidator
 * @author  mStable
 * @notice  The Liquidator allows rewards to be swapped for another token
 *          and returned to a calling contract
 * @dev     VERSION: 1.3
 *          DATE:    2021-05-28
 */
contract Unliquidator is ImmutableModule {
    using SafeERC20 for IERC20;

    event ClaimedAndSendRewards(address from, address token, uint256 amount, address to);
    event NewReceiver(address receiver);

    /// @notice Address to which the tokens will be send at the end
    address public receiverSafe;

    constructor(address _nexus, address _receiverSafe) ImmutableModule(_nexus) {
        require(_receiverSafe != address(0), "Invalid receiver address");
        receiverSafe = _receiverSafe;
    }

    /***************************************
                    GOVERNANCE
    ****************************************/

    /**
     * @notice Sets a new receive address for the tokens
     */

    function setReceiver(address _receiver) external onlyGovernance {
        //
        require(_receiver != address(0), "Invalid receiver address");
        receiverSafe = _receiver;

        emit NewReceiver(_receiver);
    }

    /***************************************
                    CLAIM REWARDS
    ****************************************/

    /**
     * @notice Triggers to claim rewards for all integration contracts
     */
    function triggerClaimAndDistribute(address _integration, address _token) external {
        //
        require(_integration != address(0), "Invalid integration address");
        require(_token != address(0), "Invalid token address");

        // 1. Claim rewards for the integration contract
        IClaimRewards(_integration).claimRewards();

        // 2. Send aave rewards to receiverSafe
        _sendRewards(_integration, _token);
    }

    function triggerDistribute(address _integration, address _token) external {
        require(_integration != address(0), "Invalid integration address");
        require(_token != address(0), "Invalid token address");

        _sendRewards(_integration, _token);
    }

    function _sendRewards(address _from, address _token) internal {
        //
        // 1. Get balances of the token
        uint256 amount = IERC20(_token).balanceOf(_from);
        require(amount > 0, "No rewards to send");

        // 2. Send the tokens to the receiverSafe
        IERC20(_token).transferFrom(_from, receiverSafe, amount);

        // 3. Emit the event
        emit ClaimedAndSendRewards(_from, _token, amount, receiverSafe);
    }
}
