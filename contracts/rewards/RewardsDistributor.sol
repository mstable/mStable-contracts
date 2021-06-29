// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";

// import { InitializableGovernableWhitelist } from "../governance/InitializableGovernableWhitelist.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  RewardsDistributor
 * @author Stability Labs Pty. Ltd.
 * @notice RewardsDistributor allows Fund Managers to send rewards (usually in MTA)
 * to specified Reward Recipients.
 */
contract RewardsDistributor is ImmutableModule {

    using SafeERC20 for IERC20;

    mapping(address => bool) public fundManagers;

    event AddFundManager(address indexed _address);
    event RemovedFundManager(address indexed _address);
    event DistributedReward(address funder, address recipient, address rewardToken, uint256 amount);

    /**
     * @dev Modifier to allow function calls only from a fundManager address.
     */
    modifier onlyFundManager() {
        require(fundManagers[msg.sender], "Not a fund manager");
        _;
    }

    /** @dev Recipient is a module, governed by mStable governance */
    constructor(
        address _nexus,
        address[] memory _fundManagers
    )
        ImmutableModule(_nexus)
    {}

    /**
     * @dev Allows the mStable governance to add a new FundManager
     * @param _address  FundManager to add
     */
    function addFundManager(address _address)
        external
        onlyGovernor
    {
        require(_address != address(0), "Address is zero");
        require(! fundManagers[_address], "Already fund manager");

        fundManagers[_address] = true;

        emit AddFundManager(_address);
    }

    /**
     * @dev Allows the mStable governance to remove inactive FundManagers
     * @param _address  FundManager to remove
     */
    function removeFundManager(address _address)
        external
        onlyGovernor
    {
        require(_address != address(0), "Address is zero");
        require(fundManagers[_address], "Not a fund manager");

        fundManagers[_address] = false;

        emit RemovedFundManager(_address);
    }

    /**
     * @dev Distributes reward tokens to list of recipients and notifies them
     * of the transfer. Only callable by FundManagers
     * @param _recipients  Array of Reward recipients to credit
     * @param _amounts     Amounts of reward tokens to distribute
     */
    function distributeRewards(
        IRewardsDistributionRecipient[] calldata _recipients,
        uint256[] calldata _amounts
    )
        external
        onlyFundManager
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
            // Only after successfull tx - notify the contract of the new funds
            recipient.notifyRewardAmount(amount);

            emit DistributedReward(msg.sender, address(recipient), address(rewardToken), amount);
        }
    }
}