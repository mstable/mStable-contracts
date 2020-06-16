pragma solidity 0.5.16;

import { InitializableGovernableWhitelist } from "../governance/InitializableGovernableWhitelist.sol";
import { IRewardsDistributionRecipient } from "./RewardsDistributionRecipient.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

/**
 * @title  RewardsDistributor
 * @author Stability Labs Pty. Ltd.
 * @notice RewardsDistributor
 */
contract RewardsDistributor is InitializableGovernableWhitelist {

    using SafeERC20 for IERC20;

    event RemovedFundManager(address indexed _address);

    /** @dev Recipient is a module, governed by mStable governance */
    constructor(
        address _nexus,
        address[] memory _fundManagers
    )
        public
    {
        InitializableGovernableWhitelist._initialize(_nexus, _fundManagers);
    }

    function addFundManager(address _address)
        internal
        onlyGovernor
    {
        _addWhitelist(_address);
    }

    function removeFundManager(address _address)
        internal
        onlyGovernor
    {
        require(_address != address(0), "Address is zero");
        require(whitelist[_address], "Address is not whitelisted");

        whitelist[_address] = false;

        emit RemovedFundManager(_address);
    }

    function distributeRewards(
        IRewardsDistributionRecipient[] calldata _recipients,
        uint256[] calldata _amounts
    )
        external
        onlyWhitelisted
    {
        uint256 len = _recipients.length;
        require(len > 0, "Must choose recipients");
        require(len == _amounts.length, "Mismatching inputs");

        for(uint i = 0; i < len; i++){
            uint256 amount = _amounts[i];
            IRewardsDistributionRecipient recipient = _recipients[i];
            // Send the RewardToken to recipient
            IERC20 rewardToken = recipient.getRewardToken();
            rewardToken.safeTransferFrom(msg.sender, address(recipient), amount);
            // Notify the contract of the new funds
            recipient.notifyRewardAmount(amount);
        }
    }
}
