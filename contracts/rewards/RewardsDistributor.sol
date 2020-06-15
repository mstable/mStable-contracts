pragma solidity 0.5.16;

import { Module } from "../shared/Module.sol";
import { IRewardsDistributionRecipient } from "./RewardsDistributionRecipient.sol";

/**
 * @title  RewardsDistributor
 * @author Stability Labs Pty. Ltd.
 * @notice RewardsDistributor
 */
contract RewardsDistributor is Module {

    IRewardsDistributionRecipient[] public _rewardRecipients;

    /** @dev Recipient is a module, governed by mStable governance */
    constructor(address _nexus)
        public
        Module(_nexus)
    {
    }

    // Add/remove rewards things

    // Distribute rewards
}
