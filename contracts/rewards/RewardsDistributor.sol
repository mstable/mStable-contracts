// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IRewardsRecipientWithPlatformToken } from "../interfaces/IRewardsDistributionRecipient.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  RewardsDistributor
 * @author mStable
 * @notice RewardsDistributor allows Fund Managers to send rewards (usually in MTA)
 * to specified Reward Recipients.
 */
contract RewardsDistributor is ImmutableModule {
    using SafeERC20 for IERC20;

    mapping(address => bool) public fundManagers;

    event AddedFundManager(address indexed _address);
    event RemovedFundManager(address indexed _address);
    event DistributedReward(
        address funder,
        address recipient,
        address rewardToken,
        uint256 amount,
        address platformToken,
        uint256 platformAmount
    );

    /**
     * @dev Modifier to allow function calls only from a fundManager address.
     */
    modifier onlyFundManager() {
        require(fundManagers[msg.sender], "Not a fund manager");
        _;
    }

    /** @dev Recipient is a module, governed by mStable governance */
    constructor(address _nexus, address[] memory _fundManagers) ImmutableModule(_nexus) {
        for (uint256 i = 0; i < _fundManagers.length; i++) {
            _addFundManager(_fundManagers[i]);
        }
    }

    /**
     * @dev Allows the mStable governance to add a new FundManager
     * @param _address  FundManager to add
     */
    function addFundManager(address _address) external onlyGovernor {
        _addFundManager(_address);
    }

    /**
     * @dev Adds a new whitelist address
     * @param _address Address to add in whitelist
     */
    function _addFundManager(address _address) internal {
        require(_address != address(0), "Address is zero");
        require(!fundManagers[_address], "Already fund manager");

        fundManagers[_address] = true;

        emit AddedFundManager(_address);
    }

    /**
     * @dev Allows the mStable governance to remove inactive FundManagers
     * @param _address  FundManager to remove
     */
    function removeFundManager(address _address) external onlyGovernor {
        require(_address != address(0), "Address is zero");
        require(fundManagers[_address], "Not a fund manager");

        fundManagers[_address] = false;

        emit RemovedFundManager(_address);
    }

    /**
     * @dev Distributes reward tokens to list of recipients and notifies them
     * of the transfer. Only callable by FundManagers
     * @param _recipients        Array of Reward recipients to credit
     * @param _amounts           Amounts of reward tokens to distribute
     * @param _platformAmounts   Amounts of platform tokens to distribute
     */
    function distributeRewards(
        IRewardsRecipientWithPlatformToken[] calldata _recipients,
        uint256[] calldata _amounts,
        uint256[] calldata _platformAmounts
    ) external onlyFundManager {
        uint256 len = _recipients.length;
        require(len > 0, "Must choose recipients");
        require(len == _amounts.length, "Mismatching inputs");
        require(len == _platformAmounts.length, "Mismatching inputs");

        for (uint256 i = 0; i < len; i++) {
            uint256 amount = _amounts[i];
            IRewardsRecipientWithPlatformToken recipient = _recipients[i];

            // Send the RewardToken to recipient
            IERC20 rewardToken = recipient.getRewardToken();
            rewardToken.safeTransferFrom(msg.sender, address(recipient), amount);

            // Send the PlatformToken to recipient
            uint256 platformAmount = _platformAmounts[i];
            address platformTokenAddress = address(0);
            if (platformAmount > 0) {
                IERC20 platformToken = recipient.getPlatformToken();
                platformTokenAddress = address(platformToken);
                platformToken.safeTransferFrom(msg.sender, address(recipient), platformAmount);
            }

            // Only after successful tx - notify the contract of the new funds
            recipient.notifyRewardAmount(amount);

            emit DistributedReward(
                msg.sender,
                address(recipient),
                address(rewardToken),
                amount,
                platformTokenAddress,
                platformAmount
            );
        }
    }
}
