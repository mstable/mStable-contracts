// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// Internal
import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";
import { IRootChainManager } from "../interfaces/IRootChainManager.sol";
import { InitializableRewardsDistributionRecipient } from "../rewards/InitializableRewardsDistributionRecipient.sol";
import { Initializable } from "../shared/@openzeppelin-2.5/Initializable.sol";

// Libs
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  ForwarderRecipient
 * @author mStable
 * @notice transfers any received reward tokens to another contract or account.
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-28
 */
contract ForwarderRecipient is
    IRewardsDistributionRecipient,
    Initializable,
    InitializableRewardsDistributionRecipient
{
    using SafeERC20 for IERC20;

    /// @notice token the rewards are distributed in. eg MTA
    IERC20 public immutable rewardsToken;
    /// @notice account that ultimately receives the reward tokens.
    address public endRecipient;

    /**
     * @param _nexus mStable system Nexus address
     * @param _rewardsToken token that is being distributed as a reward. eg MTA
     */
    constructor(
        address _nexus,
        address _rewardsToken
    ) InitializableRewardsDistributionRecipient(_nexus) {
        require(_rewardsToken != address(0), "Rewards token is zero");

        rewardsToken = IERC20(_rewardsToken);
    }

    /**
     * @param _emissionsController mStable Emissions Controller that distributes MTA rewards
     * @param _endRecipient account that ultimately receives the reward tokens.
     */
    function initialize(address _emissionsController, address _endRecipient) external initializer {
        InitializableRewardsDistributionRecipient._initialize(_emissionsController);

        endRecipient = _endRecipient;
    }

    /**
     * @notice is called by the Emissions Controller to trigger the processing of the weekly rewards.
     * @param _rewards the amount of reward tokens that were distributed to this contract.
     * @dev the Emissions Controller has already transferred the MTA to this contract.
     */
    function notifyRewardAmount(uint256 _rewards)
        external
        override(IRewardsDistributionRecipient)
        onlyRewardsDistributor
    {
        rewardsToken.safeTransfer(endRecipient, _rewards);
    }

    /***************************************
                    SETTERS
    ****************************************/

    /**
     * @notice Change the endRecipient. Can only be called by mStable governor.
     * @param _endRecipient the account the reward tokens are sent to. 
     */
    function setEndRecipient(address _endRecipient) external onlyGovernor {
        endRecipient = _endRecipient;
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
        return rewardsToken;
    }
}
