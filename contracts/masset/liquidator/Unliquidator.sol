// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IClaimRewards } from "../../polygon/IClaimRewards.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title   Unliquidator
 * @author  mStable
 * @notice  Replacement Contract for the Liquidator.
 *          Does not liquidate the tokens but sends them to the treasury or a set address
 * @dev     VERSION: 1
 *          DATE:    2022-02-10
 */
contract Unliquidator is ImmutableModule {
    using SafeERC20 for IERC20;

    event DistributedRewards(address from, address token, uint256 amount, address to);
    event ReceiverUpdated(address receiver);

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
     * @param  _receiverSafe  Address to which the tokens will be send at the end
     */

    function setReceiver(address _receiverSafe) external onlyGovernance {
        //
        require(_receiverSafe != address(0), "Invalid receiver address");
        receiverSafe = _receiverSafe;

        emit ReceiverUpdated(_receiverSafe);
    }

    /***************************************
                    CLAIM REWARDS
    ****************************************/

    /**
     * @notice Claims the rewards and sends them to the receiverSafe, e.g. claims and sends stkAave
     * @param  _integration  Integration address, this contract should have permissions to spend the token
     * @param  _token  Address of the token that are claimed and send
     */
    function claimAndDistributeRewards(address _integration, address _token) external {
        //
        require(_integration != address(0), "Invalid integration address");
        require(_token != address(0), "Invalid token address");

        // 1. Claim rewards for the integration contract
        IClaimRewards(_integration).claimRewards();

        // 2. Send token rewards to receiverSafe
        _sendRewards(_integration, _token);
    }

    /**
     * @notice Sends rewards them to the receiverSafe, without claiming them e.g. COMP can be claimed by anyone
     * @param  _integration  Integration address, this contract should have permissions to spend the token
     * @param  _token  Address of the token that are transferred
     */
    function distributeRewards(address _integration, address _token) external {
        require(_integration != address(0), "Invalid integration address");
        require(_token != address(0), "Invalid token address");

        _sendRewards(_integration, _token);
    }

    function _sendRewards(address _from, address _token) internal {
        //
        IERC20 token = IERC20(_token);

        // 1. Get balances of the token
        uint256 amount = token.balanceOf(_from);
        require(amount > 0, "No rewards to send");

        // 2. Send the tokens to the receiverSafe
        SafeERC20.safeTransferFrom(token, _from, receiverSafe, amount);

        // 3. Emit the event
        emit DistributedRewards(_from, _token, amount, receiverSafe);
    }
}
