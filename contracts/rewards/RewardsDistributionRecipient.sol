pragma solidity 0.5.16;

import { Module } from "../shared/Module.sol";

/**
 * @title  RewardsDistributionRecipient
 * @notice RewardsDistributionRecipient gets notified of additional rewards by the rewardsDistributor
 * @author Originally: Synthetix (forked from /Synthetixio/synthetix/contracts/RewardsDistributionRecipient.sol)
 *         Changes by: Stability Labs Pty. Ltd.
 */
contract RewardsDistributionRecipient is Module {

    // TODO - change the rewardsDistributor to be a Module in the Nexus
    // This can be accessed by getModule(keccak'RewardsDistributor')
    // This way all the rewards distributors are maintained centrally

    address public rewardsDistributor;

    function notifyRewardAmount(uint256 reward) external;

    /** @dev Recipient is a module, governed by mStable governance */
    constructor(address _nexus, address _rewardsDistributor)
        public
        Module(_nexus)
    {
        rewardsDistributor = _rewardsDistributor;
    }

    /**
     * @dev Change the rewardsDistributor - only called by mStable governor
     */
    modifier onlyRewardsDistributor() {
        require(msg.sender == rewardsDistributor, "Caller is not reward distributor");
        _;
    }

    /**
     * @dev Change the rewardsDistributor - only called by mStable governor
     * @param _rewardsDistributor Updated Distributor address
     */
    function setRewardDistributor(address _rewardsDistributor)
        external
        onlyGovernor
    {
        rewardsDistributor = _rewardsDistributor;
    }
}
