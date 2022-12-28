// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IChildChainStreamer } from "../peripheral/Balancer/IChildChainStreamer.sol";
import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";
import { InitializableRewardsDistributionRecipient } from "../rewards/InitializableRewardsDistributionRecipient.sol";
import { Initializable } from "../shared/@openzeppelin-2.5/Initializable.sol";
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { BasicRewardsForwarder } from "./BasicRewardsForwarder.sol";

/**
 * @title  BalRewardsForwarder
 * @author voltfinance
 * @notice Transfers any received reward tokens to another contract and notifies it.
 * @dev    VERSION: 1.0
 *         DATE:    2022-06-16
 */
contract BalRewardsForwarder is BasicRewardsForwarder {
    using SafeERC20 for IERC20;

    /**
     * @param _nexus        mStable system Nexus address
     * @param _rewardsToken Token that is being distributed as a reward. eg MTA
     */
    constructor(address _nexus, address _rewardsToken)
        BasicRewardsForwarder(_nexus, _rewardsToken)
    {}

    /**
     * @notice Called by the Emissions Controller to trigger the processing of the weekly BAL rewards.
     * @dev    The Emissions Controller has already transferred the MTA to this contract.
     * @param _rewards Units of reward tokens that were distributed to this contract
     */
    function notifyRewardAmount(uint256 _rewards)
        external
        override(BasicRewardsForwarder)
        onlyRewardsDistributor
    {
        // Send the rewards to the end recipient
        REWARDS_TOKEN.safeTransfer(endRecipient, _rewards);
        // Notify the end recipient of the rewards
        IChildChainStreamer(endRecipient).notify_reward_amount(address(REWARDS_TOKEN));
        emit RewardsReceived(_rewards);
    }
}
