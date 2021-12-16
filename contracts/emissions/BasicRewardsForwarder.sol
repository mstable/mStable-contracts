// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";
import { InitializableRewardsDistributionRecipient } from "../rewards/InitializableRewardsDistributionRecipient.sol";
import { Initializable } from "../shared/@openzeppelin-2.5/Initializable.sol";
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  BasicRewardsForwarder
 * @author mStable
 * @notice Transfers any received reward tokens to another contract or account.
 * @dev    VERSION: 1.0
 *         DATE:    2021-10-28
 */
contract BasicRewardsForwarder is
    IRewardsDistributionRecipient,
    Initializable,
    InitializableRewardsDistributionRecipient,
    Ownable
{
    using SafeERC20 for IERC20;

    /// @notice Token the rewards are distributed in. eg MTA
    IERC20 public immutable REWARDS_TOKEN;
    /// @notice Account that ultimately receives the reward tokens
    address public endRecipient;

    event RewardsReceived(uint256 amount);
    event RecipientChanged(address indexed newRecipient);

    /**
     * @param _nexus        mStable system Nexus address
     * @param _rewardsToken Token that is being distributed as a reward. eg MTA
     */
    constructor(address _nexus, address _rewardsToken)
        InitializableRewardsDistributionRecipient(_nexus)
    {
        require(_rewardsToken != address(0), "Rewards token is zero");
        REWARDS_TOKEN = IERC20(_rewardsToken);
    }

    /**
     * @dev Init fn
     * @param _emissionsController mStable Emissions Controller that distributes MTA rewards
     * @param _endRecipient        Account that ultimately receives the reward tokens
     */
    function initialize(address _emissionsController, address _endRecipient) external initializer {
        InitializableRewardsDistributionRecipient._initialize(_emissionsController);
        require(_endRecipient != address(0), "Recipient address is zero");

        endRecipient = _endRecipient;
    }

    /**
     * @notice Called by the Emissions Controller to trigger the processing of the weekly rewards.
     * @dev    The Emissions Controller has already transferred the MTA to this contract.
     * @param _rewards Units of reward tokens that were distributed to this contract
     */
    function notifyRewardAmount(uint256 _rewards)
        external
        override(IRewardsDistributionRecipient)
        onlyRewardsDistributor
    {
        REWARDS_TOKEN.safeTransfer(endRecipient, _rewards);

        emit RewardsReceived(_rewards);
    }

    /***************************************
                    SETTERS
    ****************************************/

    /**
     * @notice Change the endRecipient. Can only be called by mStable governor.
     * @param _endRecipient The account the reward tokens are sent to
     */
    function setEndRecipient(address _endRecipient) external onlyOwner {
        require(endRecipient != _endRecipient, "Same end recipient");
        endRecipient = _endRecipient;

        emit RecipientChanged(_endRecipient);
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @dev Gets the RewardsToken
     */
    function getRewardToken()
        external
        view
        override(IRewardsDistributionRecipient)
        returns (IERC20)
    {
        return REWARDS_TOKEN;
    }
}
