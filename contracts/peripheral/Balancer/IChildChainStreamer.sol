// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IChildChainStreamer {
    /**
     * @notice Notifies reward tokens for `rewardToken`
     * @param rewardToken Reward token to notify
     */
    function notify_reward_amount(address rewardToken) external;
}
