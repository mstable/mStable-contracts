pragma solidity 0.5.16;

import { Module } from "../shared/Module.sol";

interface IRewardsDistributionRecipient {
    function notifyRewardAmount(uint256 reward) external;
}

/**
 * @title  RewardsDistributionRecipient
 * @author Stability Labs Pty. Ltd.
 * @notice RewardsDistributionRecipient gets notified of additional rewards by the rewardsDistributor
 */
contract RewardsDistributionRecipient is IRewardsDistributionRecipient, Module {

    // @abstract
    function notifyRewardAmount(uint256 reward) external;

    /** @dev Recipient is a module, governed by mStable governance */
    constructor(address _nexus)
        public
        Module(_nexus)
    {
    }

    /**
     * @dev Change the rewardsDistributor - only called by mStable governor
     */
    modifier onlyRewardsDistributor() {
        require(msg.sender == _rewardsDistributor(), "Caller is not reward distributor");
        _;
    }
}
