// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";

/**
 * @title  OwnableRewardsDistributionRecipient
 * @author mStable
 * @notice OwnerableDistributionRecipient gets notified of additional rewards by the Emissions Controller.
 * @dev    Uses Open Zeppelin's Ownable contract so third parties can administor the contract instead of the Protocol DAO.
 */
abstract contract OwnableRewardsDistributionRecipient is IRewardsDistributionRecipient, Ownable {
    // This address has the ability to distribute the rewards
    address public rewardsDistributor;

    /** @dev Recipient is a module, governed by mStable governance */
    function _initialize(address _rewardsDistributor) internal virtual {
        rewardsDistributor = _rewardsDistributor;
    }

    /**
     * @dev Only the rewards distributor can notify about rewards
     */
    modifier onlyRewardsDistributor() {
        require(msg.sender == rewardsDistributor, "Caller is not reward distributor");
        _;
    }

    /**
     * @dev Change the rewardsDistributor - only called by mStable governor
     * @param _rewardsDistributor   Address of the new distributor
     */
    function setRewardsDistribution(address _rewardsDistributor) external onlyOwner {
        rewardsDistributor = _rewardsDistributor;
    }
}
