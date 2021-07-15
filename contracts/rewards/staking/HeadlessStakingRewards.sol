// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// Internal
import { InitializableRewardsDistributionRecipient } from "../InitializableRewardsDistributionRecipient.sol";
import { StableMath } from "../../shared/StableMath.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title  HeadlessStakingRewards
 * @author mStable
 * @notice Rewards stakers of a given LP token (a.k.a StakingToken) with REWARDS_TOKEN, on a pro-rata basis
 * @dev
 */
abstract contract HeadlessStakingRewards is
    Initializable,
    InitializableRewardsDistributionRecipient
{
    using SafeERC20 for IERC20;
    using StableMath for uint256;

    /// @notice token the rewards are distributed in. eg MTA
    IERC20 public immutable REWARDS_TOKEN;

    /// @notice length of each staking period in seconds. 7 days = 604,800; 3 months = 7,862,400
    uint256 public immutable DURATION;

    /// @notice Timestamp for current period finish
    uint256 public periodFinish = 0;
    /// @notice RewardRate for the rest of the period
    uint256 public rewardRate = 0;
    /// @notice Last time any user took action
    uint256 public lastUpdateTime = 0;
    /// @notice Ever increasing rewardPerToken rate, based on % of total supply
    uint256 public rewardPerTokenStored = 0;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event RewardAdded(uint256 reward);
    event RewardPaid(address indexed user, address indexed to, uint256 reward);

    /**
     * @param _nexus mStable system Nexus address
     * @param _rewardsToken first token that is being distributed as a reward. eg MTA
     * @param _duration length of each staking period in seconds. 7 days = 604,800; 3 months = 7,862,400
     */
    constructor(
        address _nexus,
        address _rewardsToken,
        uint256 _duration
    ) InitializableRewardsDistributionRecipient(_nexus) {
        REWARDS_TOKEN = IERC20(_rewardsToken);
        DURATION = _duration;
    }

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     *      To avoid variable shadowing appended `Arg` after arguments name.
     * @param _rewardsDistributorArg mStable Reward Distributor contract address
     */
    function _initialize(address _rewardsDistributorArg) internal virtual override {
        InitializableRewardsDistributionRecipient._initialize(_rewardsDistributorArg);
    }

    /** @dev Updates the reward for a given address, before executing function */
    modifier updateReward(address _account) {
        // Setting of global vars
        (uint256 newRewardPerToken, uint256 lastApplicableTime) = _rewardPerToken();
        // If statement protects against loss in initialisation case
        if (newRewardPerToken > 0) {
            rewardPerTokenStored = newRewardPerToken;
            lastUpdateTime = lastApplicableTime;
            // Setting of personal vars based on new globals
            if (_account != address(0)) {
                rewards[_account] = _earned(_account, newRewardPerToken);
                userRewardPerTokenPaid[_account] = newRewardPerToken;
            }
        }
        _;
    }

    /** @dev Updates the reward for a given address, before executing function */
    modifier updateRewards(address _account1, address _account2) {
        // Setting of global vars
        (uint256 newRewardPerToken, uint256 lastApplicableTime) = _rewardPerToken();
        // If statement protects against loss in initialisation case
        if (newRewardPerToken > 0) {
            rewardPerTokenStored = newRewardPerToken;
            lastUpdateTime = lastApplicableTime;
            // Setting of personal vars based on new globals
            if (_account1 != address(0)) {
                rewards[_account1] = _earned(_account1, newRewardPerToken);
                userRewardPerTokenPaid[_account1] = newRewardPerToken;
            }
            if (_account2 != address(0) && _account1 != _account2) {
                rewards[_account2] = _earned(_account2, newRewardPerToken);
                userRewardPerTokenPaid[_account2] = newRewardPerToken;
            }
        }
        _;
    }

    /***************************************
                    ACTIONS
    ****************************************/

    /**
     * @dev Claims outstanding rewards for the sender.
     * First updates outstanding reward allocation and then transfers.
     */
    function claimReward(address _to) public updateReward(msg.sender) {
        _claimReward(_to);
    }

    /**
     * @dev Claims outstanding rewards for the sender.
     * First updates outstanding reward allocation and then transfers.
     */
    function claimReward() public updateReward(msg.sender) {
        _claimReward(msg.sender);
    }

    function _claimReward(address _to) internal updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            REWARDS_TOKEN.safeTransfer(_to, reward);
            emit RewardPaid(msg.sender, _to, reward);
        }
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @dev Gets the RewardsToken
     */
    function getRewardToken() external view override returns (IERC20) {
        return REWARDS_TOKEN;
    }

    /**
     * @dev Gets the last applicable timestamp for this reward period
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return StableMath.min(block.timestamp, periodFinish);
    }

    /**
     * @dev Calculates the amount of unclaimed rewards per token since last update,
     * and sums with stored to give the new cumulative reward per token
     * @return 'Reward' per staked token
     */
    function rewardPerToken() public view returns (uint256) {
        (uint256 rewardPerToken_, ) = _rewardPerToken();
        return rewardPerToken_;
    }

    function _rewardPerToken()
        internal
        view
        returns (uint256 rewardPerToken_, uint256 lastTimeRewardApplicable_)
    {
        uint256 lastApplicableTime = lastTimeRewardApplicable(); // + 1 SLOAD
        uint256 timeDelta = lastApplicableTime - lastUpdateTime; // + 1 SLOAD
        // If this has been called twice in the same block, shortcircuit to reduce gas
        if (timeDelta == 0) {
            return (rewardPerTokenStored, lastApplicableTime);
        }
        // new reward units to distribute = rewardRate * timeSinceLastUpdate
        uint256 rewardUnitsToDistribute = rewardRate * timeDelta; // + 1 SLOAD
        uint256 supply = _totalSupply(); // + 1 SLOAD
        // If there is no StakingToken liquidity, avoid div(0)
        // If there is nothing to distribute, short circuit
        if (supply == 0 || rewardUnitsToDistribute == 0) {
            return (rewardPerTokenStored, lastApplicableTime);
        }
        // new reward units per token = (rewardUnitsToDistribute * 1e18) / totalTokens
        uint256 unitsToDistributePerToken = rewardUnitsToDistribute.divPrecisely(supply);
        // return summed rate
        return (rewardPerTokenStored + unitsToDistributePerToken, lastApplicableTime); // + 1 SLOAD
    }

    /**
     * @dev Calculates the amount of unclaimed rewards a user has earned
     * @param _account User address
     * @return Total reward amount earned
     */
    function earned(address _account) public view returns (uint256) {
        return _earned(_account, rewardPerToken());
    }

    function _earned(address _account, uint256 _currentRewardPerToken)
        internal
        view
        returns (uint256)
    {
        // current rate per token - rate user previously received
        uint256 userRewardDelta = _currentRewardPerToken - userRewardPerTokenPaid[_account]; // + 1 SLOAD
        // Short circuit if there is nothing new to distribute
        if (userRewardDelta == 0) {
            return rewards[_account];
        }
        // new reward = staked tokens * difference in rate
        uint256 userNewReward = _balanceOf(_account).mulTruncate(userRewardDelta); // + 1 SLOAD
        // add to previous rewards
        return rewards[_account] + userNewReward;
    }

    /***************************************
                ABSTRACT GETTERS
    ****************************************/

    function _balanceOf(address account) internal view virtual returns (uint256);

    function _totalSupply() internal view virtual returns (uint256);

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev Notifies the contract that new rewards have been added.
     * Calculates an updated rewardRate based on the rewards in period.
     * @param _reward Units of RewardToken that have been added to the pool
     */
    function notifyRewardAmount(uint256 _reward)
        external
        override
        onlyRewardsDistributor
        updateReward(address(0))
    {
        require(_reward < 1e24, "Cannot notify with more than a million units");

        uint256 currentTime = block.timestamp;
        // If previous period over, reset rewardRate
        if (currentTime >= periodFinish) {
            rewardRate = _reward / DURATION;
        }
        // If additional reward to existing period, calc sum
        else {
            uint256 remaining = periodFinish - currentTime;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (_reward + leftover) / DURATION;
        }

        lastUpdateTime = currentTime;
        periodFinish = currentTime + DURATION;

        emit RewardAdded(_reward);
    }
}
